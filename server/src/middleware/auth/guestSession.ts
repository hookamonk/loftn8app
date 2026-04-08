import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { expireGuestSessionIfInactiveAfterPayment } from "../../modules/guest/sessionExpiry";

type GuestPayload = { sessionId: string };
type UserPayload = { userId: string; role: string };

export async function guestSessionAuth(req: Request, _res: Response, next: NextFunction) {
  const res = _res;
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (!gsid) return next(new HttpError(401, "NO_GUEST_SESSION", "Guest session is required"));

  let guestPayload: GuestPayload;
  try {
    guestPayload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as GuestPayload;
  } catch {
    return next(new HttpError(401, "INVALID_GUEST_SESSION", "Invalid guest session token"));
  }

  const session = await prisma.guestSession.findUnique({
    where: { id: guestPayload.sessionId },
    include: { table: true }, 
  });

  if (!session || session.endedAt) {
    return next(new HttpError(401, "SESSION_NOT_FOUND", "Session not found or ended"));
  }

  const expiry = await expireGuestSessionIfInactiveAfterPayment(session.id);
  if (expiry.expired) {
    const isProd = env.NODE_ENV === "production";
    res.clearCookie("gsid", {
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      domain: env.COOKIE_DOMAIN || undefined,
      path: "/",
    });
    return next(new HttpError(401, "SESSION_NOT_FOUND", "Session not found or ended"));
  }

  req.guestSession = session;

  // optional user
  const uid = (req.cookies?.uid as string | undefined) ?? undefined;
  if (uid) {
    try {
      const userPayload = jwt.verify(uid, env.JWT_USER_SECRET) as UserPayload;
      const user = await prisma.user.findUnique({ where: { id: userPayload.userId } });
      if (user) {
        req.user = user;

        if (session.userId !== user.id) {
          const syncedSession = await prisma.guestSession.update({
            where: { id: session.id },
            data: { userId: user.id },
            include: { table: true },
          });
          req.guestSession = syncedSession;
        }
      }
    } catch {
      
    }
  }

  next();
}
