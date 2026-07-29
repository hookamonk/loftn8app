import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { requireUser } from "../../middleware/auth/requireUser";
// Use the shared shift-attach helper (fresh open-shift lookup) instead of a
// local copy that read the stale 5s cache and could bind to a just-closed shift.
import { attachSessionToActiveShiftIfNeeded } from "../staff/shiftCache";

export const ratingsRouter = Router();

const RatingSchema = z.object({
  overall: z.number().int().min(1).max(5),
  food: z.number().int().min(1).max(5).optional(),
  drinks: z.number().int().min(1).max(5).optional(),
  hookah: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(800).optional(),
});

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
