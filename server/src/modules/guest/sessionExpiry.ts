import { prisma } from "../../db/prisma";

const SESSION_AUTO_END_AFTER_PAYMENT_MS = 3 * 60 * 60 * 1000;

export async function expireGuestSessionIfInactiveAfterPayment(sessionId: string) {
  const session = await prisma.guestSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      endedAt: true,
    },
  });

  if (!session) {
    return { expired: true as const, reason: "missing" as const };
  }

  if (session.endedAt) {
    return { expired: true as const, reason: "ended" as const };
  }

  const latestConfirmedPayment = await prisma.paymentRequest.findFirst({
    where: {
      sessionId,
      status: "CONFIRMED",
    },
    orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      createdAt: true,
      confirmedAt: true,
    },
  });

  if (!latestConfirmedPayment) {
    return { expired: false as const, autoEndsAt: null };
  }

  const paymentAt = latestConfirmedPayment.confirmedAt ?? latestConfirmedPayment.createdAt;
  const autoEndsAt = new Date(paymentAt.getTime() + SESSION_AUTO_END_AFTER_PAYMENT_MS);

  if (autoEndsAt.getTime() > Date.now()) {
    return { expired: false as const, autoEndsAt };
  }

  const [nextOrder, nextCall, nextPayment] = await Promise.all([
    prisma.order.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      select: { id: true },
    }),
    prisma.staffCall.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      select: { id: true },
    }),
    prisma.paymentRequest.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      select: { id: true },
    }),
  ]);

  if (nextOrder || nextCall || nextPayment) {
    return { expired: false as const, autoEndsAt: null };
  }

  await prisma.guestSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  return { expired: true as const, reason: "auto-ended" as const, autoEndsAt };
}
