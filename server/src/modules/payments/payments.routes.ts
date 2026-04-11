import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { notifyPaymentRequested } from "../staff/push.service";
import { HttpError } from "../../utils/httpError";
import { summarizeLoyalty } from "../../utils/loyalty";
import { latestLegacyPaymentCutoff, paidQtyByOrderItemId } from "./paymentAllocation";

export const paymentsRouter = Router();

const RequestPaymentSchema = z.object({
  method: z.enum(["CARD", "CASH"]),
  useLoyalty: z.boolean().optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        qty: z.number().int().min(1),
      })
    )
    .optional(),
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

paymentsRouter.post(
  "/request",
  guestSessionAuth,
  validate(RequestPaymentSchema),
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    const attachedSession = await attachSessionToActiveShiftIfNeeded(session.id);

    const body = req.body as z.infer<typeof RequestPaymentSchema>;
    const sessionWithUser = await (prisma as any).guestSession.findUnique({
      where: { id: session.id },
      select: {
        userId: true,
        tableId: true,
        table: {
          select: {
            venueId: true,
            orders: {
              where: attachedSession.shiftId
                ? {
                    table: { venueId: session.table.venueId },
                    session: { shiftId: attachedSession.shiftId },
                  }
                : {
                    table: { venueId: session.table.venueId },
                  },
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                createdAt: true,
                status: true,
                items: {
                  select: {
                    id: true,
                    qty: true,
                    priceCzk: true,
                    comment: true,
                    menuItem: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
            payments: {
              where: {
                status: "CONFIRMED",
                table: { venueId: session.table.venueId },
                ...(attachedSession.shiftId
                  ? {
                      session: { shiftId: attachedSession.shiftId },
                    }
                  : {}),
              },
              select: {
                id: true,
                status: true,
                createdAt: true,
                confirmedAt: true,
                itemsJson: true,
                confirmation: {
                  select: {
                    itemsJson: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            loyaltyTransactions: {
              select: {
                cashbackCzk: true,
                redeemedAmountCzk: true,
                availableAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const loyalty = summarizeLoyalty(sessionWithUser?.user?.loyaltyTransactions ?? []);
    const canUseLoyalty = Boolean(body.useLoyalty) && loyalty.availableCzk > 0;
    const legacyCutoff = latestLegacyPaymentCutoff(sessionWithUser?.table?.payments ?? []);
    const paidQtyMap = paidQtyByOrderItemId(sessionWithUser?.table?.payments ?? []);

    const payableItems = (((sessionWithUser?.table?.orders as any[]) ?? [])
      .filter((order: any) => {
        if (order.status === "CANCELLED") return false;
        if (!legacyCutoff) return true;
        return new Date(order.createdAt).getTime() > legacyCutoff;
      })
      .flatMap((order: any) =>
        order.items
          .map((item: any) => {
            const remainingQty = Math.max(item.qty - (paidQtyMap.get(item.id) ?? 0), 0);
            if (remainingQty <= 0) return null;

            return {
              orderItemId: item.id,
              menuItemId: item.menuItem.id,
              name: item.menuItem.name,
              qty: remainingQty,
              unitPriceCzk: item.priceCzk,
              totalCzk: remainingQty * item.priceCzk,
              comment: item.comment ?? undefined,
            };
          })
          .filter(Boolean)
      )) as Array<{
      orderItemId: string;
      menuItemId: number;
      name: string;
      qty: number;
      unitPriceCzk: number;
      totalCzk: number;
      comment?: string;
    }>;

    if (!payableItems.length) {
      throw new HttpError(409, "NOTHING_TO_PAY", "Nothing left to pay in this tab");
    }

    const requestedItems = body.items?.length
      ? body.items
      : payableItems.map((item) => ({ orderItemId: item.orderItemId, qty: item.qty }));

    const payableMap = new Map(payableItems.map((item) => [item.orderItemId, item]));
    const selection = requestedItems.map((selected) => {
      const source = payableMap.get(selected.orderItemId);
      if (!source) {
        throw new HttpError(400, "ITEM_NOT_PAYABLE", "Some selected items are not payable");
      }
      if (selected.qty > source.qty) {
        throw new HttpError(400, "ITEM_QTY_INVALID", "Some selected quantities are invalid");
      }

      return {
        orderItemId: source.orderItemId,
        menuItemId: source.menuItemId,
        name: source.name,
        qty: selected.qty,
        unitPriceCzk: source.unitPriceCzk,
        totalCzk: selected.qty * source.unitPriceCzk,
        comment: source.comment,
      };
    });

    const billTotalCzk = selection.reduce((sum, item) => sum + item.totalCzk, 0);
    if (billTotalCzk <= 0) {
      throw new HttpError(400, "EMPTY_PAYMENT_SELECTION", "Select at least one item to pay");
    }

    const existing = await prisma.paymentRequest.findFirst({
      where: {
        tableId: session.tableId,
        table: { venueId: session.table.venueId },
        status: "PENDING",
        ...(attachedSession.shiftId
          ? {
              session: { shiftId: attachedSession.shiftId },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const updatedExisting = await (prisma as any).paymentRequest.update({
        where: { id: existing.id },
        data: {
          sessionId: session.id,
          method: body.method,
          billTotalCzk,
          useLoyalty: canUseLoyalty,
          itemsJson: selection,
        },
      });

      return res.json({ ok: true, payment: updatedExisting });
    }

    const payment = await (prisma as any).paymentRequest.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        method: body.method,
        billTotalCzk,
        useLoyalty: canUseLoyalty,
        itemsJson: selection,
      },
    });

    void notifyPaymentRequested(payment.id).catch((e) => {
      console.warn("push notifyPaymentRequested failed", e);
    });

    res.json({ ok: true, payment });
  })
); 
