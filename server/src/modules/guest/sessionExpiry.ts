import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { latestLegacyPaymentCutoff, paidQtyByOrderItemId } from "../payments/paymentAllocation";

const SESSION_AUTO_END_AFTER_INACTIVITY_MS =
  env.GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES * 60 * 1000;

// Longer grace once the guest explicitly chose to stay after paying: they get
// this long to place a new order before the table is freed anyway.
const SESSION_AUTO_END_AFTER_STAY_MS =
  env.GUEST_SESSION_STAY_GRACE_MINUTES * 60 * 1000;

// PERFORMANCE: the closure sweep is ~7 queries. It runs on every authenticated
// guest request (and per session on the staff /tables poll), so we throttle it
// per session — the grace period is minutes, so re-checking at most once per
// window is plenty. In-memory + bounded; the app runs as a single instance
// (a horizontally-scaled deploy would move this to Redis).
const EXPIRY_CHECK_THROTTLE_MS = 20_000;
const lastExpiryCheckAt = new Map<string, number>();

function shouldSkipExpiryCheck(sessionId: string): boolean {
  const now = Date.now();
  const last = lastExpiryCheckAt.get(sessionId);
  if (last !== undefined && now - last < EXPIRY_CHECK_THROTTLE_MS) return true;
  lastExpiryCheckAt.set(sessionId, now);
  // Bounded cleanup so the map can't grow unbounded over long uptime.
  if (lastExpiryCheckAt.size > 2000) {
    for (const [key, ts] of lastExpiryCheckAt) {
      if (now - ts > EXPIRY_CHECK_THROTTLE_MS * 3) lastExpiryCheckAt.delete(key);
    }
  }
  return false;
}

type SessionSnapshot = {
  id: string;
  endedAt: Date | null;
  startedAt?: Date;
};

function remainingUnpaidQty(params: {
  orders: Array<{
    createdAt: Date;
    status: string;
    items: Array<{ id: string; qty: number }>;
  }>;
  payments: Array<{
    status: string;
    createdAt: Date;
    confirmedAt?: Date | null;
    itemsJson?: unknown;
    confirmation?: { itemsJson?: unknown; createdAt?: Date | null } | null;
  }>;
}) {
  const legacyCutoff = latestLegacyPaymentCutoff(params.payments);
  const paidQtyMap = paidQtyByOrderItemId(params.payments);

  return params.orders
    .filter((order) => {
      if (order.status === "CANCELLED") return false;
      if (!legacyCutoff) return true;
      return new Date(order.createdAt).getTime() > legacyCutoff;
    })
    .reduce(
      (sum, order) =>
        sum +
        order.items.reduce(
          (itemSum, item) => itemSum + Math.max(item.qty - (paidQtyMap.get(item.id) ?? 0), 0),
          0
        ),
      0
    );
}

export async function getGuestSessionClosureState(
  sessionId: string,
  sessionSnapshot?: SessionSnapshot
) {
  const session =
    sessionSnapshot ??
    (await prisma.guestSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        endedAt: true,
        startedAt: true,
      },
    }));

  if (!session) {
    return { missing: true as const, eligible: false as const };
  }

  if (session.endedAt) {
    return { ended: true as const, eligible: false as const };
  }

  const baseStartedAt = session.startedAt ?? new Date(0);

  // The bill is SHARED across the table within a shift, so closure must be
  // evaluated TABLE-WIDE, not per single session. Otherwise a guest whose
  // session doesn't own the table's single open order would see "nothing to
  // pay" and get auto-ended while the shared bill is still unpaid (and vice
  // versa, a session could be force-closed while another still owes).
  const sessionRow = await prisma.guestSession.findUnique({
    where: { id: sessionId },
    select: {
      stayOptIn: true,
      tableId: true,
      shiftId: true,
      table: { select: { venueId: true } },
    },
  });

  // Table-wide only within the SAME shift. Without a shift, fall back to this
  // single session — never table-wide-across-all-history, which would drag in
  // confirmed payments/orders from previous shifts and mis-judge "fully paid".
  const scope: any =
    sessionRow?.tableId != null && sessionRow?.shiftId
      ? {
          tableId: sessionRow.tableId,
          ...(sessionRow.table?.venueId != null ? { table: { venueId: sessionRow.table.venueId } } : {}),
          session: { shiftId: sessionRow.shiftId },
        }
      : { sessionId };

  const [latestOrder, latestCall, latestPayment, latestRating, pendingPaymentsCount, confirmedPayments, orders] =
    await Promise.all([
      prisma.order.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.staffCall.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.paymentRequest.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.rating.findFirst({
        where: scope,
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.paymentRequest.count({
        where: { ...scope, status: "PENDING" },
      }),
      prisma.paymentRequest.findMany({
        where: { ...scope, status: "CONFIRMED" },
        select: {
          status: true,
          createdAt: true,
          confirmedAt: true,
          itemsJson: true,
          confirmation: {
            select: {
              itemsJson: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.order.findMany({
        where: { ...scope, status: { not: "CANCELLED" } },
        select: {
          createdAt: true,
          status: true,
          items: {
            select: {
              id: true,
              qty: true,
            },
          },
        },
      }),
    ]);

  const activityPoints = [
    baseStartedAt,
    latestOrder?.createdAt,
    latestCall?.createdAt,
    latestPayment?.createdAt,
    latestRating?.createdAt,
  ].filter((value): value is Date => Boolean(value));

  const lastActivityAt = activityPoints.reduce<Date>(
    (latest, current) => (current.getTime() > latest.getTime() ? current : latest),
    baseStartedAt
  );

  const hasConfirmedPayment = confirmedPayments.length > 0;
  const unpaidQty = remainingUnpaidQty({
    orders,
    payments: confirmedPayments,
  });
  const stayOptIn = Boolean(sessionRow?.stayOptIn);
  const billFullyPaid = pendingPaymentsCount === 0 && unpaidQty === 0;
  // Nothing owed → staff may free the table by hand.
  const eligible = billFullyPaid;

  // Auto-ending, however, is strictly a POST-PAYMENT courtesy (hence the env
  // var name). It MUST additionally require a confirmed payment: to this
  // function "the guest paid everything" and "the guest has not ordered yet"
  // both look like an empty balance, so without this check a guest who is
  // simply reading the menu would be thrown off the table after the grace
  // period — before they ever got to call a waiter.
  //
  // Choosing "stay" does not keep the session open forever either; it only
  // grants a longer grace to place the next order.
  const autoEndEligible = hasConfirmedPayment && billFullyPaid;
  const graceMs = stayOptIn ? SESSION_AUTO_END_AFTER_STAY_MS : SESSION_AUTO_END_AFTER_INACTIVITY_MS;

  return {
    eligible,
    autoEndEligible,
    hasConfirmedPayment,
    pendingPaymentsCount,
    unpaidQty,
    stayOptIn,
    billFullyPaid,
    lastActivityAt,
    autoEndsAt: autoEndEligible
      ? new Date(lastActivityAt.getTime() + graceMs)
      : null,
  };
}

export async function expireGuestSessionIfInactiveAfterPayment(
  sessionId: string,
  sessionSnapshot?: SessionSnapshot
) {
  // Already-ended sessions are cheap to short-circuit.
  if (sessionSnapshot?.endedAt) {
    return { expired: true as const, reason: "ended" as const };
  }
  // Skip the expensive sweep if we checked this session very recently.
  if (shouldSkipExpiryCheck(sessionId)) {
    return { expired: false as const, autoEndsAt: null, throttled: true as const };
  }

  const state = await getGuestSessionClosureState(sessionId, sessionSnapshot);

  if ("missing" in state) {
    return { expired: true as const, reason: "missing" as const };
  }

  if ("ended" in state) {
    return { expired: true as const, reason: "ended" as const };
  }

  if (!state.autoEndEligible || !state.autoEndsAt) {
    return { expired: false as const, autoEndsAt: null, waitingForClosedBill: true as const };
  }

  if (state.autoEndsAt.getTime() > Date.now()) {
    return { expired: false as const, autoEndsAt: state.autoEndsAt };
  }

  await prisma.guestSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  return { expired: true as const, reason: "auto-ended" as const, autoEndsAt: state.autoEndsAt };
}
