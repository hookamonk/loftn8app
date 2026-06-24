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
import { attachSessionToActiveShiftIfNeeded } from "../staff/shiftCache";
import { emitGuestEvent } from "../guest/guestEvents";

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

const RequestStaffOrderSchema = z.object({
  // Optional menu selection the guest picked — shown to staff so they can place
  // the actual order. The order itself is created by staff, not here.
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        qty: z.number().int().min(1).max(50),
      })
    )
    .max(100)
    .optional(),
});

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

    const body = req.body as z.infer<typeof RequestStaffOrderSchema>;
    const requestedItems =
      body.items && body.items.length > 0 ? body.items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })) : null;

    const existing = await prisma.staffCall.findFirst({
      where: {
        tableId: session.tableId,
        table: { venueId: session.table.venueId },
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
      // Refresh the selection on the open request if the guest picked items.
      const updatedExisting = requestedItems
        ? await prisma.staffCall.update({
            where: { id: existing.id },
            data: { requestedItemsJson: requestedItems },
          })
        : existing;
      emitGuestEvent(session.tableId, "order-request-updated");
      return res.json({ ok: true, request: updatedExisting, reused: true });
    }

    const requestCall = await prisma.staffCall.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        type: "HELP",
        message: ORDER_REQUEST_MARKER,
        requestedItemsJson: requestedItems ?? undefined,
      },
    });

    void notifyCallCreated(requestCall.id).catch((e) => {
      console.warn("push notifyCallCreated failed", e);
    });

    emitGuestEvent(session.tableId, "order-request-created");

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
      where: {
        sessionId: session.id,
        table: { venueId: session.table.venueId },
      },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });
    res.json({ ok: true, orders });
  })
);
