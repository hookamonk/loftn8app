import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { latestLegacyPaymentCutoff, paidQtyByOrderItemId } from "../payments/paymentAllocation";
import { ORDER_REQUEST_MARKER } from "../orders/orderRequest";

const SESSION_AUTO_END_AFTER_INACTIVITY_MS =
  env.GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES * 60 * 1000;

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

/**
 * When a table's bill is fully settled (no pending payment requests and no
 * unpaid order items), end ALL active guest sessions at that table so it's
 * freed for the next guests and no one stays "connected" in the staff app.
 * Returns the number of sessions that were ended.
 */
export async function endTableSessionsIfFullyPaid(tableId: number, shiftId: string) {
  // Don't free the table while a fresh order request is still open (guest is
  // mid "order more"): they'd be kicked before staff handles it.
  const openRequests = await prisma.staffCall.count({
    where: {
      tableId,
      type: "HELP",
      message: ORDER_REQUEST_MARKER,
      status: { in: ["NEW", "ACKED"] },
      session: { shiftId },
    },
  });
  if (openRequests > 0) return 0;

  const [orders, confirmedPayments, pendingCount] = await Promise.all([
    prisma.order.findMany({
      where: { tableId, status: { not: "CANCELLED" }, session: { shiftId } },
      select: { createdAt: true, status: true, items: { select: { id: true, qty: true } } },
    }),
    prisma.paymentRequest.findMany({
      where: { tableId, status: "CONFIRMED", session: { shiftId } },
      select: {
        status: true,
        createdAt: true,
        confirmedAt: true,
        itemsJson: true,
        confirmation: { select: { itemsJson: true, createdAt: true } },
      },
    }),
    prisma.paymentRequest.count({ where: { tableId, status: "PENDING", session: { shiftId } } }),
  ]);

  // Nothing ordered, still-pending payment, or unpaid items left → keep open.
  if (orders.length === 0) return 0;
  if (pendingCount > 0) return 0;
  if (remainingUnpaidQty({ orders, payments: confirmedPayments as any }) > 0) return 0;

  const result = await prisma.guestSession.updateMany({
    where: { tableId, shiftId, endedAt: null },
    data: { endedAt: new Date() },
  });

  return result.count;
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

  const [latestOrder, latestCall, latestPayment, latestRating, pendingPaymentsCount, confirmedPayments, orders] =
    await Promise.all([
      prisma.order.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.staffCall.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.paymentRequest.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.rating.findFirst({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
      prisma.paymentRequest.count({
        where: {
          sessionId,
          status: "PENDING",
        },
      }),
      prisma.paymentRequest.findMany({
        where: {
          sessionId,
          status: "CONFIRMED",
        },
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
        where: {
          sessionId,
          status: { not: "CANCELLED" },
        },
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
  const eligible = pendingPaymentsCount === 0 && unpaidQty === 0;

  return {
    eligible,
    hasConfirmedPayment,
    pendingPaymentsCount,
    unpaidQty,
    lastActivityAt,
    autoEndsAt: eligible
      ? new Date(lastActivityAt.getTime() + SESSION_AUTO_END_AFTER_INACTIVITY_MS)
      : null,
  };
}

export async function expireGuestSessionIfInactiveAfterPayment(
  sessionId: string,
  sessionSnapshot?: SessionSnapshot
) {
  const state = await getGuestSessionClosureState(sessionId, sessionSnapshot);

  if ("missing" in state) {
    return { expired: true as const, reason: "missing" as const };
  }

  if ("ended" in state) {
    return { expired: true as const, reason: "ended" as const };
  }

  if (!state.eligible || !state.autoEndsAt) {
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
