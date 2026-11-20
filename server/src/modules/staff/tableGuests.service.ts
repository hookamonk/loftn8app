import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { emitStaffEvent } from "./staffEvents";
import { toPublicTable } from "./tableView";

/**
 * Regulars who didn't scan the QR code: a waiter or manager opens the table
 * by hand, finds the guest's account (name, e-mail, phone or loyalty card) and
 * attaches it to the table — the guest's name shows up and the cashback of the
 * part they pay goes to them. Every manual attach is kept (who, when) for the
 * shift report.
 */

type Ctx = { venueId: number; shiftId: string; staffId: string };

const SEARCH_MIN = 3;
const SEARCH_LIMIT = 10;

/** "iurii@gmail.com" → "iu•••@gmail.com": enough to tell two Ivans apart, not to copy. */
export function maskEmail(email: string | null) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

/** "+420777123517" → "••• 517". */
export function maskPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 3 ? `••• ${digits.slice(-3)}` : "•••";
}

export const cardTail = (cardNumber: string | null) => (cardNumber ? cardNumber.slice(-4) : null);

async function tableInVenue(tableId: number, venueId: number) {
  if (!Number.isInteger(tableId) || tableId <= 0) throw new HttpError(400, "TABLE_ID_INVALID", "Table id is invalid");
  const table = await prisma.table.findFirst({
    where: { id: tableId, venueId },
    select: { id: true, code: true, label: true },
  });
  if (!table) throw new HttpError(404, "TABLE_NOT_FOUND", "Стол не найден");
  return table;
}

/** Name, e-mail, phone or card number — at least 3 characters. */
export async function searchGuests(ctx: Ctx, raw: string) {
  const q = raw.trim().slice(0, 80);
  if (q.length < SEARCH_MIN) return [];
  const digits = q.replace(/\D/g, "");

  const users = await prisma.user.findMany({
    where: {
      role: "USER",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(digits.length >= SEARCH_MIN
          ? [{ phone: { contains: digits } }, { cardNumber: { contains: digits } }]
          : []),
      ],
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    take: SEARCH_LIMIT,
    select: { id: true, name: true, email: true, phone: true, cardNumber: true },
  });
  if (users.length === 0) return [];

  // Where each of them sits right now in this venue (a scanned or attached table).
  const seated = await prisma.guestSession.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      shiftId: ctx.shiftId,
      endedAt: null,
      table: { venueId: ctx.venueId },
    },
    orderBy: { startedAt: "desc" },
    select: { userId: true, table: { select: { id: true, code: true, label: true } } },
  });
  const atTable = new Map<string, string>();
  for (const s of seated) if (s.userId && !atTable.has(s.userId)) atTable.set(s.userId, toPublicTable(s.table).code);

  return users.map((u) => ({
    id: u.id,
    name: u.name?.trim() || "Гость с аккаунтом",
    email: maskEmail(u.email),
    phone: maskPhone(u.phone),
    card: cardTail(u.cardNumber),
    atTable: atTable.get(u.id) ?? null,
  }));
}

/** «Открыть стол»: the guests didn't scan — the table is opened by the staff. */
export async function openTable(ctx: Ctx, tableId: number) {
  await tableInVenue(tableId, ctx.venueId);
  const existing = await prisma.guestSession.findFirst({
    where: { tableId, shiftId: ctx.shiftId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (existing) return { sessionId: existing.id, opened: false };

  const session = await prisma.guestSession.create({
    data: { tableId, shiftId: ctx.shiftId },
    select: { id: true },
  });
  emitStaffEvent(ctx.venueId, { kind: "DATA_CHANGED" });
  return { sessionId: session.id, opened: true };
}

/** «+ Гость»: attach a registered guest to the table (opens it if needed). */
export async function attachGuest(ctx: Ctx, tableId: number, userId: string) {
  await tableInVenue(tableId, ctx.venueId);
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "USER" },
    select: { id: true, name: true },
  });
  if (!user) throw new HttpError(404, "GUEST_NOT_FOUND", "Гость не найден");
  const name = user.name?.trim() || "Гость с аккаунтом";

  // Already at this table (scanned, or attached before): nothing to add.
  const already = await prisma.guestSession.findFirst({
    where: { tableId, shiftId: ctx.shiftId, endedAt: null, userId },
    select: { id: true },
  });
  if (already) return { sessionId: already.id, name, already: true };

  const session = await prisma.guestSession.create({
    data: { tableId, shiftId: ctx.shiftId, userId, boundById: ctx.staffId, boundAt: new Date() },
    select: { id: true },
  });
  emitStaffEvent(ctx.venueId, { kind: "DATA_CHANGED" });
  return { sessionId: session.id, name, already: false };
}

/**
 * «Отвязать»: a guest attached by mistake. Only an attach made by hand, and
 * only while nothing was billed to them (their cashback can't be taken back).
 */
export async function detachGuest(ctx: Ctx, tableId: number, sessionId: string) {
  await tableInVenue(tableId, ctx.venueId);
  const session = await prisma.guestSession.findFirst({
    where: { id: sessionId, tableId, shiftId: ctx.shiftId, endedAt: null },
    select: {
      id: true,
      boundById: true,
      userId: true,
      _count: {
        select: {
          orders: true,
          payments: { where: { status: { in: ["PENDING", "CONFIRMED"] } } },
        },
      },
    },
  });
  if (!session || !session.userId) throw new HttpError(404, "GUEST_NOT_FOUND", "Гость не найден за этим столом");
  if (!session.boundById) {
    throw new HttpError(409, "GUEST_SCANNED", "Гость сам отсканировал QR — его не отвязать");
  }
  if (session._count.payments > 0) {
    throw new HttpError(409, "GUEST_HAS_BILL", "Гостю уже выставлен счёт — отвязать нельзя");
  }

  if (session._count.orders > 0) {
    // The table's order hangs on this session: keep it, just without the guest.
    await prisma.$transaction([
      prisma.order.updateMany({
        where: { sessionId: session.id, userId: session.userId },
        data: { userId: null },
      }),
      prisma.guestSession.update({
        where: { id: session.id },
        data: { userId: null, boundById: null, boundAt: null },
      }),
    ]);
  } else {
    // Nothing on it: the session goes; a mistake leaves no line in the journal.
    await prisma.guestSession.update({
      where: { id: session.id },
      data: { endedAt: new Date(), boundById: null, boundAt: null },
    });
  }
  emitStaffEvent(ctx.venueId, { kind: "DATA_CHANGED" });
  return { detached: true };
}
