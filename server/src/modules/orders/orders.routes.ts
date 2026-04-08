import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { requireUser } from "../../middleware/auth/requireUser";
import { HttpError } from "../../utils/httpError";
import { notifyCallCreated } from "../staff/push.service";
import { ORDER_REQUEST_MARKER } from "./orderRequest";

export const ordersRouter = Router();

const CreateOrderSchema = z.object({
  comment: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        qty: z.number().int().min(1).max(50),
        comment: z.string().max(300).optional(),
      })
    )
    .min(1),
});

const RequestStaffOrderSchema = z.object({});


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
ordersRouter.post(
  "/",
  guestSessionAuth,
  requireUser,
  validate(CreateOrderSchema),
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    await attachSessionToActiveShiftIfNeeded(session.id);

    throw new HttpError(
      409,
      "GUEST_ORDERING_DISABLED",
      "Guests cannot place orders directly. Please request a staff member from the menu."
    );
  })
);

ordersRouter.post(
  "/request",
  guestSessionAuth,
  validate(RequestStaffOrderSchema),
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    const attachedSession = await attachSessionToActiveShiftIfNeeded(session.id);

    const existing = await prisma.staffCall.findFirst({
      where: {
        tableId: session.tableId,
        type: "HELP",
        message: ORDER_REQUEST_MARKER,
        status: { in: ["NEW", "ACKED"] },
        ...(attachedSession.shiftId
          ? {
              session: { shiftId: attachedSession.shiftId },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return res.json({ ok: true, request: existing, reused: true });
    }

    const requestCall = await prisma.staffCall.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        type: "HELP",
        message: ORDER_REQUEST_MARKER,
      },
    });

    void notifyCallCreated(requestCall.id).catch((e) => {
      console.warn("push notifyCallCreated failed", e);
    });

    res.json({ ok: true, request: requestCall, reused: false });
  })
);


ordersRouter.get(
  "/current",
  guestSessionAuth,
  requireUser,
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    const orders = await prisma.order.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });
    res.json({ ok: true, orders });
  })
);
