import type { MenuSection, PaymentMethod } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { venueNameBySlug, venueShortNameBySlug } from "../../config/venues";
import { paidQtyByOrderItemId } from "../payments/paymentAllocation";
import { toPublicTable } from "./tableView";

/**
 * The shift report the manager reconciles with Septim at closing.
 *
 * Money = payments CONFIRMED in the app during the shift (by confirmation
 * time, so it is what actually went into the terminal and the cash drawer).
 * Orders = everything punched in at the venue during the shift. The gap
 * between the two ("not paid in the app") is what was settled elsewhere,
 * i.e. in Septim, or is still open.
 */

const SECTION_ORDER: MenuSection[] = ["DISHES", "DRINKS", "HOOKAH"];

function secondsBetween(from: Date | null, to: Date | null) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

function average(values: Array<number | null>) {
  const real = values.filter((value): value is number => value !== null);
  if (!real.length) return null;
  return Math.round(real.reduce((sum, value) => sum + value, 0) / real.length);
}

type MethodTotals = { count: number; amountCzk: number; tipCzk: number; totalCzk: number };

/**
 * Where the shift's money window ends: its closing time; "now" while it is
 * open. A closed shift with no closing time recorded must never swallow the
 * payments of the shifts after it, so its window ends where it began.
 */
function shiftEnd(shift: { status: "OPEN" | "CLOSED"; openedAt: Date; closedAt: Date | null }) {
  return shift.closedAt ?? (shift.status === "OPEN" ? new Date() : shift.openedAt);
}

function emptyTotals(): MethodTotals {
  return { count: 0, amountCzk: 0, tipCzk: 0, totalCzk: 0 };
}

export async function buildShiftReport(shiftId: string) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      venueId: true,
      status: true,
      openedAt: true,
      closedAt: true,
      venue: { select: { slug: true } },
      openedByManager: { select: { username: true } },
      closedByManager: { select: { username: true } },
    },
  });
  if (!shift) throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift not found");

  const until = shiftEnd(shift);

  const [confirmations, orders, tickets, cancellations, shiftPayments] = await Promise.all([
    prisma.paymentConfirmation.findMany({
      where: { venueId: shift.venueId, createdAt: { gte: shift.openedAt, lte: until } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        method: true,
        billTotalCzk: true,
        amountCzk: true,
        loyaltyAppliedCzk: true,
        tipCzk: true,
        staff: { select: { username: true } },
        user: { select: { name: true } },
        paymentRequest: { select: { table: { select: { id: true, code: true, label: true } } } },
      },
    }),
    prisma.order.findMany({
      where: { session: { shiftId: shift.id }, status: { not: "CANCELLED" } },
      select: {
        id: true,
        table: { select: { id: true, code: true, label: true } },
        items: {
          select: {
            id: true,
            qty: true,
            priceCzk: true,
            menuItem: { select: { id: true, name: true, category: { select: { section: true } } } },
          },
        },
      },
    }),
    prisma.stationTicket.findMany({
      where: { shiftId: shift.id, status: { not: "CANCELLED" } },
      select: { station: true, status: true, createdAt: true, acceptedAt: true, readyAt: true, servedAt: true },
    }),
    prisma.orderItemCancellation.findMany({
      where: { order: { session: { shiftId: shift.id } } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        name: true,
        qty: true,
        priceCzk: true,
        reason: true,
        table: { select: { code: true, label: true } },
        cancelledBy: { select: { username: true } },
      },
    }),
    // What the guests' bills in this shift already covered, line by line.
    prisma.paymentRequest.findMany({
      where: { status: "CONFIRMED", session: { shiftId: shift.id } },
      select: { status: true, itemsJson: true, confirmation: { select: { itemsJson: true } } },
    }),
  ]);

  /* ---- money ---- */
  const byMethod: Record<PaymentMethod, MethodTotals> = { CARD: emptyTotals(), CASH: emptyTotals() };
  let billTotalCzk = 0;
  let cashbackCzk = 0;
  for (const c of confirmations) {
    const bucket = byMethod[c.method];
    bucket.count += 1;
    bucket.amountCzk += c.amountCzk;
    bucket.tipCzk += c.tipCzk;
    bucket.totalCzk += c.amountCzk + c.tipCzk;
    billTotalCzk += c.billTotalCzk;
    cashbackCzk += c.loyaltyAppliedCzk;
  }
  const revenueCzk = byMethod.CARD.amountCzk + byMethod.CASH.amountCzk;
  const tipsCzk = byMethod.CARD.tipCzk + byMethod.CASH.tipCzk;

  /* ---- orders, lines and what stayed unpaid in the app ---- */
  const paidQty = paidQtyByOrderItemId(shiftPayments);
  const itemsById = new Map<number, { menuItemId: number; name: string; station: MenuSection; qty: number; totalCzk: number }>();
  const unpaidByTable = new Map<number, { table: string; totalCzk: number }>();
  let orderedCzk = 0;
  let itemsQty = 0;

  for (const order of orders) {
    const table = toPublicTable(order.table);
    for (const item of order.items) {
      const lineTotal = item.qty * item.priceCzk;
      orderedCzk += lineTotal;
      itemsQty += item.qty;

      const entry = itemsById.get(item.menuItem.id) ?? {
        menuItemId: item.menuItem.id,
        name: item.menuItem.name,
        station: item.menuItem.category.section,
        qty: 0,
        totalCzk: 0,
      };
      entry.qty += item.qty;
      entry.totalCzk += lineTotal;
      itemsById.set(item.menuItem.id, entry);

      const unpaid = Math.max(item.qty - (paidQty.get(item.id) ?? 0), 0) * item.priceCzk;
      if (unpaid > 0) {
        const row = unpaidByTable.get(order.table.id) ?? { table: table.code, totalCzk: 0 };
        row.totalCzk += unpaid;
        unpaidByTable.set(order.table.id, row);
      }
    }
  }

  const items = Array.from(itemsById.values()).sort(
    (a, b) => SECTION_ORDER.indexOf(a.station) - SECTION_ORDER.indexOf(b.station) || b.qty - a.qty || a.name.localeCompare(b.name)
  );

  const stations = SECTION_ORDER.map((station) => {
    const lines = items.filter((item) => item.station === station);
    const own = tickets.filter((ticket) => ticket.station === station);
    return {
      station,
      itemsQty: lines.reduce((sum, item) => sum + item.qty, 0),
      totalCzk: lines.reduce((sum, item) => sum + item.totalCzk, 0),
      tickets: own.length,
      // Seconds from "sent" to accepted / ready / handed to the guest.
      avgAcceptSec: average(own.map((t) => secondsBetween(t.createdAt, t.acceptedAt))),
      avgReadySec: average(own.map((t) => secondsBetween(t.createdAt, t.readyAt))),
      avgServedSec: average(own.map((t) => secondsBetween(t.createdAt, t.servedAt))),
      notFinished: own.filter((t) => t.status !== "SERVED").length,
    };
  }).filter((row) => row.tickets > 0 || row.itemsQty > 0);

  const unpaidTables = Array.from(unpaidByTable.values()).sort((a, b) => b.totalCzk - a.totalCzk);

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      venueSlug: shift.venue.slug,
      venueName: venueNameBySlug(shift.venue.slug),
      venueShortName: venueShortNameBySlug(shift.venue.slug),
      openedAt: shift.openedAt,
      closedAt: shift.status === "OPEN" ? null : until,
      openedBy: shift.openedByManager?.username ?? null,
      closedBy: shift.closedByManager?.username ?? null,
    },
    money: {
      payments: confirmations.length,
      card: byMethod.CARD,
      cash: byMethod.CASH,
      revenueCzk,
      tipsCzk,
      totalCollectedCzk: revenueCzk + tipsCzk,
      billTotalCzk,
      cashbackCzk,
    },
    orders: {
      count: orders.length,
      tickets: tickets.length,
      itemsQty,
      orderedCzk,
      unpaidCzk: unpaidTables.reduce((sum, row) => sum + row.totalCzk, 0),
      unpaidTables,
      stations,
    },
    items,
    cancellations: {
      count: cancellations.length,
      totalCzk: cancellations.reduce((sum, c) => sum + c.qty * c.priceCzk, 0),
      list: cancellations.map((c) => ({
        id: c.id,
        at: c.createdAt,
        table: toPublicTable(c.table).code,
        name: c.name,
        qty: c.qty,
        totalCzk: c.qty * c.priceCzk,
        reason: c.reason,
        by: c.cancelledBy.username,
      })),
    },
    payments: confirmations.map((c) => ({
      id: c.id,
      at: c.createdAt,
      table: c.paymentRequest.table ? toPublicTable(c.paymentRequest.table).code : null,
      method: c.method,
      billTotalCzk: c.billTotalCzk,
      cashbackCzk: c.loyaltyAppliedCzk,
      amountCzk: c.amountCzk,
      tipCzk: c.tipCzk,
      by: c.staff.username,
      guest: c.user?.name ?? null,
    })),
  };
}

/** One line per shift for the lists (manager: own venue, admin: any). */
export async function listShiftSummaries(venueIds: number[], limit: number) {
  const shifts = await prisma.shift.findMany({
    where: { venueId: { in: venueIds } },
    orderBy: { openedAt: "desc" },
    take: limit,
    select: { id: true, venueId: true, status: true, openedAt: true, closedAt: true, venue: { select: { slug: true } } },
  });

  return Promise.all(
    shifts.map(async (shift) => {
      const groups = await prisma.paymentConfirmation.groupBy({
        by: ["method"],
        where: { venueId: shift.venueId, createdAt: { gte: shift.openedAt, lte: shiftEnd(shift) } },
        _sum: { amountCzk: true, tipCzk: true },
      });
      const sum = (method: PaymentMethod) => groups.find((g) => g.method === method)?._sum ?? null;
      const card = (sum("CARD")?.amountCzk ?? 0) + (sum("CARD")?.tipCzk ?? 0);
      const cash = (sum("CASH")?.amountCzk ?? 0) + (sum("CASH")?.tipCzk ?? 0);

      return {
        id: shift.id,
        status: shift.status,
        venueShortName: venueShortNameBySlug(shift.venue.slug),
        openedAt: shift.openedAt,
        closedAt: shift.status === "OPEN" ? null : shiftEnd(shift),
        cardCzk: card,
        cashCzk: cash,
        totalCzk: card + cash,
      };
    })
  );
}
