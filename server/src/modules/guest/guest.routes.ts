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

guestRouter.post(
  "/session",
  validate(CreateSessionSchema),
  asyncHandler(async (req, res) => {
    const { tableCode } = req.body as { tableCode: string };

    const table = await prisma.table.findUnique({
      where: { code: tableCode },
      select: { id: true, code: true, label: true, venueId: true },
    });

    if (!table) {
      throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");
    }

    // ✅ гостевое приложение работает всегда:
    // если смена открыта — привязываем session к shift
    // если смены нет — просто создаём session без shiftId
    const shift = await prisma.shift.findFirst({
      where: {
        venueId: table.venueId,
        status: "OPEN",
      },
      orderBy: { openedAt: "desc" },
      select: { id: true, openedAt: true },
    });

    const session = await prisma.guestSession.create({
      data: {
        tableId: table.id,
        shiftId: shift?.id ?? null,
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
      session: {
        id: session.id,
        table: {
          id: table.id,
          code: table.code,
          label: table.label,
        },
        shift: shift
          ? {
              id: shift.id,
              openedAt: shift.openedAt,
            }
          : null,
        startedAt: session.startedAt,
      },
    });
  })
);

guestRouter.get(
  "/me",
  guestSessionAuth,
  asyncHandler(async (req, res) => {
    const s = req.guestSession!;

    const session = await prisma.guestSession.findUnique({
      where: { id: s.id },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        shift: {
          select: { id: true, status: true, openedAt: true, closedAt: true },
        },
      },
    });

    if (!session) {
      throw new HttpError(401, "GUEST_SESSION_INVALID", "Guest session is invalid");
    }

    if (session.endedAt) {
      throw new HttpError(401, "GUEST_SESSION_ENDED", "Guest session ended");
    }

    // ✅ больше НЕ блокируем гостя из-за закрытой смены
    res.json({
      ok: true,
      session: {
        id: session.id,
        table: session.table,
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
