import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { requireUser } from "../../middleware/auth/requireUser";
import { HttpError } from "../../utils/httpError";

export const ratingsRouter = Router();

const RatingSchema = z.object({
  overall: z.number().int().min(1).max(5),
  food: z.number().int().min(1).max(5).optional(),
  drinks: z.number().int().min(1).max(5).optional(),
  hookah: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(800).optional(),
});

async function attachSessionToActiveShiftIfNeeded(sessionId: string) {
  const session = await prisma.guestSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      shiftId: true,
      table: { select: { venueId: true } },
    },
  });

  if (!session) throw new HttpError(401, "SESSION_INVALID", "Session invalid");

  const activeShift = await prisma.shift.findFirst({
    where: {
      venueId: session.table.venueId,
      status: "OPEN",
    },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });

  if (!activeShift) return session;
  if (session.shiftId === activeShift.id) return session;

  await prisma.guestSession.update({
    where: { id: session.id },
    data: { shiftId: activeShift.id },
  });

  return {
    ...session,
    shiftId: activeShift.id,
  };
}

ratingsRouter.post(
  "/",
  guestSessionAuth,
  requireUser,
  validate(RatingSchema),
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    await attachSessionToActiveShiftIfNeeded(session.id);

    const body = req.body as z.infer<typeof RatingSchema>;

    const rating = await prisma.rating.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        overall: body.overall,
        food: body.food,
        drinks: body.drinks,
        hookah: body.hookah,
        comment: body.comment,
      },
    });

    res.json({ ok: true, rating });
  })
);
