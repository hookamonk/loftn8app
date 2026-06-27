import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { notifyCallCreated } from "../staff/push.service";
import { attachSessionToActiveShiftIfNeeded } from "../staff/shiftCache";
import { emitGuestEvent } from "../guest/guestEvents";
import { ORDER_REQUEST_MARKER } from "../orders/orderRequest";

export const callsRouter = Router();

const CreateCallSchema = z.object({
  type: z.enum(["WAITER", "HOOKAH", "BILL", "HELP"]),
  message: z
    .string()
    .max(500)
    // Don't let a guest spoof the internal order-request marker, which would
    // hide their call from the normal calls feed and fake an order request.
    .refine((m) => m.trim() !== ORDER_REQUEST_MARKER, "Invalid message")
    .optional(),
});

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

    emitGuestEvent(session.tableId, "call-created");

    res.json({ ok: true, call });
  })
); 
