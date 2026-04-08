"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffDashboardRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const httpError_1 = require("../../utils/httpError");
const validate_1 = require("../../middleware/validate");
const staff_middleware_1 = require("./staff.middleware");
exports.staffDashboardRouter = (0, express_1.Router)();
exports.staffDashboardRouter.use(staff_middleware_1.requireStaffAuth);
const IdParamSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
});
function callTypesForRole(role) {
    if (role === "WAITER")
        return ["WAITER", "BILL", "HELP"];
    if (role === "HOOKAH")
        return ["HOOKAH", "HELP"];
    return ["WAITER", "HOOKAH", "BILL", "HELP"];
}
function orderSectionsForRole(role) {
    if (role === "HOOKAH")
        return ["HOOKAH"];
    if (role === "WAITER")
        return ["DISHES", "DRINKS"];
    return null;
}
async function getActiveShiftOrThrow(venueId) {
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
    });
    if (!shift) {
        throw new httpError_1.HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
    }
    return shift;
}
// summary
exports.staffDashboardRouter.get("/summary", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const types = callTypesForRole(role);
    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);
    const ordersWhere = {
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
        prisma_1.prisma.order.count({ where: ordersWhere }),
        prisma_1.prisma.staffCall.count({
            where: {
                status: "NEW",
                type: { in: types },
                session: { shiftId: shift.id },
            },
        }),
        role === "HOOKAH"
            ? Promise.resolve(0)
            : prisma_1.prisma.paymentRequest.count({
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
}));
// ORDERS
exports.staffDashboardRouter.get("/orders", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const status = req.query.status ?? "NEW";
    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);
    const where = {
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
    const itemsInclude = sections
        ? {
            where: { menuItem: { category: { section: { in: sections } } } },
            include: { menuItem: { select: { id: true, name: true } } },
        }
        : {
            include: { menuItem: { select: { id: true, name: true } } },
        };
    const orders = await prisma_1.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
            table: { select: { code: true, label: true } },
            session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
            items: itemsInclude,
        },
    });
    res.json({ ok: true, orders });
}));
const UpdateOrderStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["NEW", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "CANCELLED"]),
});
exports.staffDashboardRouter.patch("/orders/:id/status", (0, validate_1.validate)(UpdateOrderStatusSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const shift = await getActiveShiftOrThrow(venueId);
    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body;
    const sections = orderSectionsForRole(role);
    const order = await prisma_1.prisma.order.findUnique({
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
    if (!order)
        throw new httpError_1.HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.session?.shiftId !== shift.id)
        throw new httpError_1.HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (sections) {
        const allowed = order.items.some((it) => sections.includes(it.menuItem.category.section));
        if (!allowed)
            throw new httpError_1.HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    }
    await prisma_1.prisma.order.update({
        where: { id: order.id },
        data: { status },
    });
    res.json({ ok: true });
}));
// CALLS
exports.staffDashboardRouter.get("/calls", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const status = req.query.status ?? "NEW";
    const types = callTypesForRole(role);
    const shift = await getActiveShiftOrThrow(venueId);
    const calls = await prisma_1.prisma.staffCall.findMany({
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
}));
const UpdateCallStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["NEW", "ACKED", "DONE"]),
});
exports.staffDashboardRouter.patch("/calls/:id/status", (0, validate_1.validate)(UpdateCallStatusSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const shift = await getActiveShiftOrThrow(venueId);
    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body;
    const allowedTypes = callTypesForRole(role);
    const call = await prisma_1.prisma.staffCall.findUnique({
        where: { id },
        select: {
            id: true,
            type: true,
            session: { select: { shiftId: true } },
        },
    });
    if (!call)
        throw new httpError_1.HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (call.session?.shiftId !== shift.id)
        throw new httpError_1.HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (!allowedTypes.includes(call.type))
        throw new httpError_1.HttpError(404, "CALL_NOT_FOUND", "Call not found");
    await prisma_1.prisma.staffCall.update({
        where: { id: call.id },
        data: { status },
    });
    res.json({ ok: true });
}));
// PAYMENTS
exports.staffDashboardRouter.get("/payments", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    if (role === "HOOKAH") {
        return res.json({ ok: true, payments: [] });
    }
    const status = req.query.status ?? "PENDING";
    const shift = await getActiveShiftOrThrow(venueId);
    const payments = await prisma_1.prisma.paymentRequest.findMany({
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
}));
const ConfirmPaymentSchema = zod_1.z.object({
    amountCzk: zod_1.z.coerce.number().int().min(1),
});
exports.staffDashboardRouter.post("/payments/:id/confirm", (0, validate_1.validate)(ConfirmPaymentSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const role = req.staff.role;
    const shift = await getActiveShiftOrThrow(venueId);
    if (role === "HOOKAH") {
        throw new httpError_1.HttpError(403, "FORBIDDEN", "Hookah role cannot confirm payments");
    }
    const staffId = req.staff.staffId;
    const { id } = IdParamSchema.parse(req.params);
    const { amountCzk } = req.body;
    const CASHBACK_PERCENT = 5;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
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
        if (!pr)
            throw new httpError_1.HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
        if (pr.session?.shiftId !== shift.id)
            throw new httpError_1.HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
        if (pr.status !== "PENDING") {
            throw new httpError_1.HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
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
}));
