"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ordersRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const validate_1 = require("../../middleware/validate");
const guestSession_1 = require("../../middleware/auth/guestSession");
const requireUser_1 = require("../../middleware/auth/requireUser");
const httpError_1 = require("../../utils/httpError");
const push_service_1 = require("../staff/push.service");
exports.ordersRouter = (0, express_1.Router)();
const OPEN_ORDER_STATUSES = ["NEW", "ACCEPTED", "IN_PROGRESS"];
const CreateOrderSchema = zod_1.z.object({
    comment: zod_1.z.string().max(500).optional(),
    items: zod_1.z
        .array(zod_1.z.object({
        menuItemId: zod_1.z.number().int().positive(),
        qty: zod_1.z.number().int().min(1).max(50),
        comment: zod_1.z.string().max(300).optional(),
    }))
        .min(1),
});
async function attachSessionToActiveShiftIfNeeded(sessionId) {
    const session = await prisma_1.prisma.guestSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            shiftId: true,
            table: { select: { venueId: true } },
        },
    });
    if (!session)
        throw new httpError_1.HttpError(401, "SESSION_INVALID", "Session invalid");
    if (session.shiftId)
        return session;
    const activeShift = await prisma_1.prisma.shift.findFirst({
        where: {
            venueId: session.table.venueId,
            status: "OPEN",
        },
        orderBy: { openedAt: "desc" },
        select: { id: true },
    });
    if (!activeShift)
        return session;
    await prisma_1.prisma.guestSession.update({
        where: { id: session.id },
        data: { shiftId: activeShift.id },
    });
    return {
        ...session,
        shiftId: activeShift.id,
    };
}
function mergeOrderComment(current, incoming) {
    const left = String(current ?? "").trim();
    const right = String(incoming ?? "").trim();
    if (!left)
        return right || null;
    if (!right || left === right)
        return left;
    return `${left} | ${right}`;
}
exports.ordersRouter.post("/", guestSession_1.guestSessionAuth, requireUser_1.requireUser, (0, validate_1.validate)(CreateOrderSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = req.guestSession;
    const user = req.user;
    await attachSessionToActiveShiftIfNeeded(session.id);
    const body = req.body;
    const menuItemIds = body.items.map((i) => i.menuItemId);
    const menuItems = await prisma_1.prisma.menuItem.findMany({
        where: { id: { in: menuItemIds }, isActive: true },
    });
    if (menuItems.length !== menuItemIds.length) {
        throw new httpError_1.HttpError(400, "MENU_ITEM_INVALID", "Some menu items are invalid/inactive");
    }
    const priceMap = new Map(menuItems.map((m) => [m.id, m.priceCzk]));
    const order = await prisma_1.prisma.$transaction(async (tx) => {
        const existingOpenOrder = await tx.order.findFirst({
            where: {
                sessionId: session.id,
                status: { in: [...OPEN_ORDER_STATUSES] },
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                comment: true,
            },
        });
        const nextItems = body.items.map((it) => ({
            menuItemId: it.menuItemId,
            qty: it.qty,
            comment: it.comment,
            priceCzk: priceMap.get(it.menuItemId),
        }));
        if (existingOpenOrder) {
            return tx.order.update({
                where: { id: existingOpenOrder.id },
                data: {
                    userId: user.id,
                    comment: mergeOrderComment(existingOpenOrder.comment, body.comment),
                    items: {
                        create: nextItems,
                    },
                },
                include: { items: true },
            });
        }
        return tx.order.create({
            data: {
                sessionId: session.id,
                tableId: session.tableId,
                userId: user.id,
                comment: body.comment,
                items: {
                    create: nextItems,
                },
            },
            include: { items: true },
        });
    });
    void (0, push_service_1.notifyOrderCreated)(order.id).catch((e) => {
        console.warn("push notifyOrderCreated failed", e);
    });
    res.json({ ok: true, order });
}));
exports.ordersRouter.get("/current", guestSession_1.guestSessionAuth, requireUser_1.requireUser, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = req.guestSession;
    const orders = await prisma_1.prisma.order.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        include: { items: true },
    });
    res.json({ ok: true, orders });
}));
