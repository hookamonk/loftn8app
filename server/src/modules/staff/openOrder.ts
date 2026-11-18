import type { Prisma } from "@prisma/client";

/**
 * The table's open order in the current shift: new lines are appended to it,
 * or a fresh order is started after the last payment. Shared by punching an
 * order and by moving lines from another table.
 */
export async function upsertOpenTableOrder(
  tx: Prisma.TransactionClient,
  params: {
    tableId: number;
    sessionId: string;
    userId?: string | null;
    shiftId?: string | null;
    comment?: string | null;
  }
) {
  // Scope the "open order to append to" and the paid-through cutoff to the
  // CURRENT shift, so a stale unpaid order left over from a previous shift at
  // this table can't be merged into (and re-billed on) the current session.
  const shiftScope = params.shiftId ? { session: { shiftId: params.shiftId } } : {};

  const latestConfirmedPayment = await tx.paymentRequest.findFirst({
    where: {
      tableId: params.tableId,
      status: "CONFIRMED",
      ...shiftScope,
    },
    orderBy: { confirmedAt: "desc" },
    select: {
      confirmedAt: true,
      createdAt: true,
    },
  });

  const paidThroughAt = latestConfirmedPayment?.confirmedAt ?? latestConfirmedPayment?.createdAt ?? null;
  const existingOpenOrder = await tx.order.findFirst({
    where: {
      tableId: params.tableId,
      status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] },
      ...shiftScope,
      ...(paidThroughAt
        ? {
            createdAt: {
              gt: paidThroughAt,
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      comment: true,
    },
  });

  const mergedComment = (() => {
    const left = String(existingOpenOrder?.comment ?? "").trim();
    const right = String(params.comment ?? "").trim();
    if (!left) return right || null;
    if (!right || left === right) return left;
    return `${left} | ${right}`;
  })();

  if (existingOpenOrder) {
    return tx.order.update({
      where: { id: existingOpenOrder.id },
      data: {
        sessionId: params.sessionId,
        userId: params.userId ?? null,
        comment: mergedComment,
      },
      select: { id: true },
    });
  }

  return tx.order.create({
    data: {
      sessionId: params.sessionId,
      tableId: params.tableId,
      userId: params.userId ?? null,
      status: "NEW",
      comment: params.comment?.trim() || null,
    },
    select: { id: true },
  });
}
