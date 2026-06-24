import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";

const OPEN_SHIFT_CACHE_TTL_MS = 5_000;

type OpenShiftSnapshot = {
  id: string;
  venueId: number;
  status: "OPEN" | "CLOSED";
  openedAt: Date;
  closedAt: Date | null;
};

type CacheEntry = {
  expiresAt: number;
  shift: OpenShiftSnapshot | null;
};

const openShiftCache = new Map<number, CacheEntry>();

export function invalidateOpenShiftCache(venueId?: number) {
  if (typeof venueId === "number") {
    openShiftCache.delete(venueId);
    return;
  }

  openShiftCache.clear();
}

async function queryOpenShift(venueId: number) {
  const shift = await prisma.shift.findFirst({
    where: { venueId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      venueId: true,
      status: true,
      openedAt: true,
      closedAt: true,
    },
  });

  return (shift ?? null) as OpenShiftSnapshot | null;
}

export async function getOpenShift(venueId: number, opts?: { fresh?: boolean }) {
  const now = Date.now();
  const cached = openShiftCache.get(venueId);

  if (!opts?.fresh && cached && cached.expiresAt > now) {
    return cached.shift;
  }

  const shift = await queryOpenShift(venueId);
  openShiftCache.set(venueId, {
    expiresAt: now + OPEN_SHIFT_CACHE_TTL_MS,
    shift,
  });

  return shift;
}

export async function getOpenShiftOrThrow(venueId: number, opts?: { fresh?: boolean }) {
  const shift = await getOpenShift(venueId, opts);
  if (!shift) {
    throw new HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
  }

  return shift;
}

type AttachedSession = {
  id: string;
  shiftId: string | null;
  table: { venueId: number };
};

/**
 * Attach a guest session to the venue's currently open shift if it isn't
 * already. Uses a fresh shift lookup (skipping the cache) so a guest action
 * never binds to a just-closed shift — otherwise the resulting call/order would
 * be invisible on the staff dashboard, which filters by the open shift.
 *
 * Shared by the guest-facing calls / orders / payments routes.
 */
export async function attachSessionToActiveShiftIfNeeded(
  sessionId: string
): Promise<AttachedSession> {
  const session = await prisma.guestSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      shiftId: true,
      table: { select: { venueId: true } },
    },
  });

  if (!session) throw new HttpError(401, "SESSION_INVALID", "Session invalid");

  const activeShift = await getOpenShift(session.table.venueId, { fresh: true });

  if (!activeShift) return session;
  if (session.shiftId === activeShift.id) return session;

  await prisma.guestSession.update({
    where: { id: session.id },
    data: { shiftId: activeShift.id },
  });

  return { ...session, shiftId: activeShift.id };
}
