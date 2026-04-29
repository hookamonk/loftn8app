import { env } from "../../config/env";
import { prisma } from "../../db/prisma";

const SESSION_AUTO_END_AFTER_PAYMENT_MS =
  env.GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES * 60 * 1000;

export async function expireGuestSessionIfInactiveAfterPayment(
  sessionId: string,
  sessionSnapshot?: { id: string; endedAt: Date | null }
) {
  const session =
    sessionSnapshot ??
    (await prisma.guestSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        endedAt: true,
      },
    }));

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
  const [nextOrder, nextCall, nextPayment, nextRating] = await Promise.all([
    prisma.order.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.staffCall.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.paymentRequest.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    prisma.rating.findFirst({
      where: {
        sessionId,
        createdAt: { gt: paymentAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
  ]);

  const lastActivityAt = [paymentAt, nextOrder?.createdAt, nextCall?.createdAt, nextPayment?.createdAt, nextRating?.createdAt]
    .filter((value): value is Date => Boolean(value))
    .reduce((latest, current) => (current.getTime() > latest.getTime() ? current : latest), paymentAt);

  const autoEndsAt = new Date(lastActivityAt.getTime() + SESSION_AUTO_END_AFTER_PAYMENT_MS);

  if (autoEndsAt.getTime() > Date.now()) {
    return { expired: false as const, autoEndsAt };
  }

  await prisma.guestSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  return { expired: true as const, reason: "auto-ended" as const, autoEndsAt };
}
