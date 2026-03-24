import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";

export const guestRouter = Router();

const CreateSessionSchema = z.object({
  tableCode: z.string().min(1),
});

const CreateRatingSchema = z.object({
  food: z.number().min(1).max(5).optional(),
  drinks: z.number().min(1).max(5).optional(),
  hookah: z.number().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
});

function setCookie(res: any, name: string, value: string, maxAgeSeconds: number) {
  const isProd = env.NODE_ENV === "production";

  res.cookie(name, value, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

function normalizeTableCode(raw: string) {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!v) return "";
  if (/^\d+$/.test(v)) return `T${v}`;
  if (/^T\d+$/.test(v)) return v;
  if (v === "TVIP" || v === "T-VIP") return "VIP";
  return v;
}

function isKnownPilotTableCode(code: string) {
  if (code === "VIP") return true;
  if (!/^T\d+$/.test(code)) return false;
  const n = Number(code.slice(1));
  return Number.isInteger(n) && n >= 1 && n <= 17;
}

async function resolveTableByCode(rawTableCode: string) {
  const tableCode = normalizeTableCode(rawTableCode);
  if (!tableCode) return null;

  const existing = await prisma.table.findUnique({
    where: { code: tableCode },
    select: { id: true, code: true, label: true, venueId: true },
  });
  if (existing) return existing;

  if (!isKnownPilotTableCode(tableCode)) return null;

  const venue = await prisma.venue.findUnique({
    where: { slug: "pilot" },
    select: { id: true },
  });
  if (!venue) return null;

  const label = tableCode === "VIP" ? "VIP" : `Table ${Number(tableCode.slice(1))}`;

  return prisma.table.upsert({
    where: { code: tableCode },
    update: {
      venueId: venue.id,
      label,
    },
    create: {
      venueId: venue.id,
      code: tableCode,
      label,
    },
    select: { id: true, code: true, label: true, venueId: true },
  });
}

async function resolveUserFromCookie(req: any) {
  const uid = (req.cookies?.uid as string | undefined) ?? undefined;
  if (!uid) return null;

  try {
    const payload = jwt.verify(uid, env.JWT_USER_SECRET) as { userId: string };
    return prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
  } catch {
    return null;
  }
}

async function closePreviousSessionFromCookie(req: any) {
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (!gsid) return;

  try {
    const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
    await prisma.guestSession.updateMany({
      where: {
        id: payload.sessionId,
        endedAt: null,
      },
      data: { endedAt: new Date() },
    });
  } catch {
    // ignore stale cookie
  }
}

async function resolveGuestSessionFromCookie(req: any) {
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (!gsid) return null;

  try {
    const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
    const session = await prisma.guestSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        table: {
          select: { id: true, code: true, label: true, venueId: true },
        },
        shift: {
          select: { id: true, status: true, openedAt: true, closedAt: true },
        },
      },
    });

    if (!session || session.endedAt) return null;

    const user = await resolveUserFromCookie(req);
    if (user && session.userId !== user.id) {
      return prisma.guestSession.update({
        where: { id: session.id },
        data: { userId: user.id },
        include: {
          table: {
            select: { id: true, code: true, label: true, venueId: true },
          },
          shift: {
            select: { id: true, status: true, openedAt: true, closedAt: true },
          },
        },
      });
    }

    return session;
  } catch {
    return null;
  }
}

function toGuestSessionResponse(
  session: {
    id: string;
    startedAt: Date;
    table: { id: number; code: string; label: string | null };
    shift?: { id: string; openedAt: Date } | { id: string; status: string; openedAt: Date; closedAt: Date | null } | null;
  }
) {
  return {
    id: session.id,
    table: {
      id: session.table.id,
      code: session.table.code,
      label: session.table.label,
    },
    shift: session.shift
      ? {
          id: session.shift.id,
          openedAt: session.shift.openedAt,
        }
      : null,
    startedAt: session.startedAt,
  };
}

guestRouter.post(
  "/session",
  validate(CreateSessionSchema),
  asyncHandler(async (req, res) => {
    const { tableCode: rawTableCode } = req.body as { tableCode: string };

    const table = await resolveTableByCode(rawTableCode);

    if (!table) {
      throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");
    }

    const user = await resolveUserFromCookie(req);
    const shift = await prisma.shift.findFirst({
      where: {
        venueId: table.venueId,
        status: "OPEN",
      },
      orderBy: { openedAt: "desc" },
      select: { id: true, openedAt: true },
    });

    const existingSession = await resolveGuestSessionFromCookie(req);
    if (existingSession && existingSession.table.id === table.id) {
      const nextUserId = user?.id ?? existingSession.userId ?? null;
      const nextShiftId = existingSession.shiftId ?? shift?.id ?? null;

      const syncedSession =
        nextUserId !== existingSession.userId || nextShiftId !== existingSession.shiftId
          ? await prisma.guestSession.update({
              where: { id: existingSession.id },
              data: {
                userId: nextUserId,
                shiftId: nextShiftId,
              },
              include: {
                table: {
                  select: { id: true, code: true, label: true },
                },
                shift: {
                  select: { id: true, openedAt: true },
                },
              },
            })
          : {
              id: existingSession.id,
              startedAt: existingSession.startedAt,
              table: {
                id: existingSession.table.id,
                code: existingSession.table.code,
                label: existingSession.table.label,
              },
              shift: existingSession.shift
                ? {
                    id: existingSession.shift.id,
                    openedAt: existingSession.shift.openedAt,
                  }
                : null,
            };

      const token = jwt.sign(
        { sessionId: existingSession.id },
        env.JWT_GUEST_SESSION_SECRET,
        { expiresIn: "24h" }
      );

      setCookie(res, "gsid", token, 60 * 60 * 24);

      return res.json({
        ok: true,
        session: toGuestSessionResponse(syncedSession),
        reused: true,
      });
    }

    await closePreviousSessionFromCookie(req);

    const session = await prisma.guestSession.create({
      data: {
        tableId: table.id,
        shiftId: shift?.id ?? null,
        userId: user?.id ?? null,
      },
    });

    const token = jwt.sign(
      { sessionId: session.id },
      env.JWT_GUEST_SESSION_SECRET,
      { expiresIn: "24h" }
    );

    setCookie(res, "gsid", token, 60 * 60 * 24);

    res.json({
      ok: true,
      session: toGuestSessionResponse({
        ...session,
        table,
        shift,
      }),
      reused: false,
    });
  })
);

guestRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const session = await resolveGuestSessionFromCookie(req);
    if (!session) {
      return res.json({ ok: false, session: null });
    }

    res.json({
      ok: true,
      session: {
        id: session.id,
        table: {
          id: session.table.id,
          code: session.table.code,
          label: session.table.label,
        },
        shift: session.shift ?? null,
        startedAt: session.startedAt,
      },
    });
  })
);

guestRouter.post(
  "/rating",
  guestSessionAuth,
  validate(CreateRatingSchema),
  asyncHandler(async (req, res) => {
    const s = req.guestSession!;
    const { food, drinks, hookah, comment } = req.body;

    const session = await prisma.guestSession.findUnique({
      where: { id: s.id },
    });

    if (!session) {
      throw new HttpError(401, "SESSION_INVALID", "Session invalid");
    }

    if (session.endedAt) {
      throw new HttpError(401, "SESSION_ENDED", "Session ended");
    }

    const values = [food, drinks, hookah].filter((v) => typeof v === "number") as number[];

    const overall =
      values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 5;

    await prisma.rating.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        overall,
        food,
        drinks,
        hookah,
        comment,
      },
    });

    res.json({ ok: true });
  })
);
