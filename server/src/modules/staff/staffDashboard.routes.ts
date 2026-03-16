import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { requireStaffAuth } from "./staff.middleware";
import type {
  CallType,
  CallStatus,
  OrderStatus,
  PaymentStatus,
  StaffRole,
  MenuSection,
} from "@prisma/client";

export const staffDashboardRouter = Router();
staffDashboardRouter.use(requireStaffAuth);

const IdParamSchema = z.object({
  id: z.string().min(1),
});

function callTypesForRole(role: StaffRole): CallType[] {
  if (role === "WAITER") return ["WAITER", "BILL", "HELP"];
  if (role === "HOOKAH") return ["HOOKAH", "HELP"];
  return ["WAITER", "HOOKAH", "BILL", "HELP"];
}

function orderSectionsForRole(role: StaffRole): MenuSection[] | null {
  if (role === "HOOKAH") return ["HOOKAH"];
  if (role === "WAITER") return ["DISHES", "DRINKS"];
  return null;
}

async function getActiveShiftOrThrow(venueId: number) {
  const shift = await prisma.shift.findFirst({
    where: { venueId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (!shift) {
    throw new HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
  }

  return shift;
}

// summary
staffDashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const types = callTypesForRole(role);

    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);

    const ordersWhere: any = {
      status: "NEW",
      session: { shiftId: shift.id },
    };

    if (sections) {
      ordersWhere.items = {
        some: {
          menuItem: { category: { section: { in: sections } } },
        },
      };
    }

    const [newOrders, newCalls, pendingPayments] = await Promise.all([
      prisma.order.count({ where: ordersWhere }),
      prisma.staffCall.count({
        where: {
          status: "NEW",
          type: { in: types },
          session: { shiftId: shift.id },
        },
      }),
      role === "HOOKAH"
        ? Promise.resolve(0)
        : prisma.paymentRequest.count({
            where: {
              status: "PENDING",
              session: { shiftId: shift.id },
            },
          }),
    ]);

    res.json({
      ok: true,
      shift: {
        id: shift.id,
        openedAt: shift.openedAt,
      },
      newOrders,
      newCalls,
      pendingPayments,
    });
  })
);

// ORDERS
staffDashboardRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const status = (req.query.status as OrderStatus | undefined) ?? "NEW";

    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);

    const where: any = {
      status,
      session: { shiftId: shift.id },
    };

    if (sections) {
      where.items = {
        some: {
          menuItem: { category: { section: { in: sections } } },
        },
      };
    }

    const itemsInclude: any = sections
      ? {
          where: { menuItem: { category: { section: { in: sections } } } },
          include: { menuItem: { select: { id: true, name: true } } },
        }
      : {
          include: { menuItem: { select: { id: true, name: true } } },
        };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
        items: itemsInclude,
      },
    });

    res.json({ ok: true, orders });
  })
);

const UpdateOrderStatusSchema = z.object({
  status: z.enum(["NEW", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "CANCELLED"]),
});

staffDashboardRouter.patch(
  "/orders/:id/status",
  validate(UpdateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body as any;

    const sections = orderSectionsForRole(role);

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        tableId: true,
        session: { select: { shiftId: true } },
        items: {
          select: {
            menuItem: { select: { category: { select: { section: true } } } },
          },
        },
      },
    });

    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.session?.shiftId !== shift.id) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");

    if (sections) {
      const allowed = order.items.some((it) => sections.includes(it.menuItem.category.section));
      if (!allowed) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { status },
    });

    res.json({ ok: true });
  })
);

// CALLS
staffDashboardRouter.get(
  "/calls",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const status = (req.query.status as CallStatus | undefined) ?? "NEW";
    const types = callTypesForRole(role);

    const shift = await getActiveShiftOrThrow(venueId);

    const calls = await prisma.staffCall.findMany({
      where: {
        status,
        type: { in: types },
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    res.json({ ok: true, calls });
  })
);

const UpdateCallStatusSchema = z.object({
  status: z.enum(["NEW", "ACKED", "DONE"]),
});

staffDashboardRouter.patch(
  "/calls/:id/status",
  validate(UpdateCallStatusSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body as any;

    const allowedTypes = callTypesForRole(role);

    const call = await prisma.staffCall.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        session: { select: { shiftId: true } },
      },
    });

    if (!call) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (call.session?.shiftId !== shift.id) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (!allowedTypes.includes(call.type)) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");

    await prisma.staffCall.update({
      where: { id: call.id },
      data: { status },
    });

    res.json({ ok: true });
  })
);

// PAYMENTS
staffDashboardRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;

    if (role === "HOOKAH") {
      return res.json({ ok: true, payments: [] });
    }

    const status = (req.query.status as PaymentStatus | undefined) ?? "PENDING";
    const shift = await getActiveShiftOrThrow(venueId);

    const payments = await prisma.paymentRequest.findMany({
      where: {
        status,
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { code: true, label: true } },
        session: { select: { id: true, userId: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    res.json({ ok: true, payments });
  })
);

const ConfirmPaymentSchema = z.object({
  amountCzk: z.coerce.number().int().min(1),
});

staffDashboardRouter.post(
  "/payments/:id/confirm",
  validate(ConfirmPaymentSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    if (role === "HOOKAH") {
      throw new HttpError(403, "FORBIDDEN", "Hookah role cannot confirm payments");
    }

    const staffId = req.staff!.staffId;
    const { id } = IdParamSchema.parse(req.params);
    const { amountCzk } = req.body as any;
    const CASHBACK_PERCENT = 5;

    const result = await prisma.$transaction(async (tx) => {
      const pr = await tx.paymentRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          sessionId: true,
          method: true,
          session: { select: { shiftId: true, userId: true } },
        },
      });

      if (!pr) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
      if (pr.session?.shiftId !== shift.id) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");

      if (pr.status !== "PENDING") {
        throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
      }

      const updated = await tx.paymentRequest.update({
        where: { id: pr.id },
        data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedByStaffId: staffId },
      });

      const confirmation = await tx.paymentConfirmation.upsert({
        where: { paymentRequestId: pr.id },
        update: { amountCzk },
        create: {
          paymentRequestId: pr.id,
          venueId,
          staffId,
          userId: pr.session?.userId ?? null,
          method: pr.method,
          amountCzk,
        },
      });

      let loyalty = null;
      const userId = pr.session?.userId ?? null;

      if (userId) {
        const cashbackCzk = Math.floor((amountCzk * CASHBACK_PERCENT) / 100);
        loyalty = await tx.loyaltyTransaction.upsert({
          where: { paymentConfirmationId: confirmation.id },
          update: { baseAmountCzk: amountCzk, cashbackCzk },
          create: {
            venueId,
            userId,
            staffId,
            paymentConfirmationId: confirmation.id,
            baseAmountCzk: amountCzk,
            cashbackCzk,
          },
        });
      }

      return { updated, confirmation, loyalty };
    });

    res.json({ ok: true, ...result });
  })
); 