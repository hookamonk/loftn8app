import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { notifyCallCreated } from "../staff/push.service";
import { HttpError } from "../../utils/httpError";

export const callsRouter = Router();

const CreateCallSchema = z.object({
  type: z.enum(["WAITER", "HOOKAH", "BILL", "HELP"]),
  message: z.string().max(500).optional(),
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

callsRouter.post(
  "/",
  guestSessionAuth,
  validate(CreateCallSchema),
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    const attachedSession = await attachSessionToActiveShiftIfNeeded(session.id);

    const body = req.body as z.infer<typeof CreateCallSchema>;

    if (attachedSession.shiftId !== session.shiftId) {
      req.guestSession = {
        ...session,
        shiftId: attachedSession.shiftId,
      } as any;
    }

    const call = await prisma.staffCall.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        type: body.type,
        message: body.message,
      },
    });

    void notifyCallCreated(call.id).catch((e) => {
      console.warn("push notifyCallCreated failed", e);
    });

    res.json({ ok: true, call });
  })
); 
