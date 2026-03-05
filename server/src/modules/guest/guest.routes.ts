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

    const table = await prisma.table.findUnique({ where: { code: tableCode } });
    if (!table) throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");

    const session = await prisma.guestSession.create({
      data: { tableId: table.id },
      include: { table: true },
    });

    const token = jwt.sign({ sessionId: session.id }, env.JWT_GUEST_SESSION_SECRET, { expiresIn: "24h" });
    setCookie(res, "gsid", token, 60 * 60 * 24);

    res.json({
      ok: true,
      session: {
        id: session.id,
        table: { id: session.table.id, code: session.table.code, label: session.table.label },
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
      include: { table: { select: { id: true, code: true, label: true } } },
    });

    if (!session) throw new HttpError(401, "GUEST_SESSION_INVALID", "Guest session is invalid");

    res.json({
      ok: true,
      session: {
        id: session.id,
        table: session.table,
        startedAt: session.startedAt,
      },
    });
  })
);