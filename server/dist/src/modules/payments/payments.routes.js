"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const validate_1 = require("../../middleware/validate");
const guestSession_1 = require("../../middleware/auth/guestSession");
const requireUser_1 = require("../../middleware/auth/requireUser");
const push_service_1 = require("../staff/push.service");
const httpError_1 = require("../../utils/httpError");
exports.paymentsRouter = (0, express_1.Router)();
const RequestPaymentSchema = zod_1.z.object({
    method: zod_1.z.enum(["CARD", "CASH"]),
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
exports.paymentsRouter.post("/request", guestSession_1.guestSessionAuth, requireUser_1.requireUser, (0, validate_1.validate)(RequestPaymentSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = req.guestSession;
    await attachSessionToActiveShiftIfNeeded(session.id);
    const body = req.body;
    const payment = await prisma_1.prisma.paymentRequest.create({
        data: {
            sessionId: session.id,
            tableId: session.tableId,
            method: body.method,
        },
    });
    void (0, push_service_1.notifyPaymentRequested)(payment.id).catch((e) => {
        console.warn("push notifyPaymentRequested failed", e);
    });
    res.json({ ok: true, payment });
}));
