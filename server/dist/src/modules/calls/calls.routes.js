"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const validate_1 = require("../../middleware/validate");
const guestSession_1 = require("../../middleware/auth/guestSession");
const push_service_1 = require("../staff/push.service");
const httpError_1 = require("../../utils/httpError");
exports.callsRouter = (0, express_1.Router)();
const CreateCallSchema = zod_1.z.object({
    type: zod_1.z.enum(["WAITER", "HOOKAH", "BILL", "HELP"]),
    message: zod_1.z.string().max(500).optional(),
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
exports.callsRouter.post("/", guestSession_1.guestSessionAuth, (0, validate_1.validate)(CreateCallSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = req.guestSession;
    await attachSessionToActiveShiftIfNeeded(session.id);
    const body = req.body;
    const call = await prisma_1.prisma.staffCall.create({
        data: {
            sessionId: session.id,
            tableId: session.tableId,
            type: body.type,
            message: body.message,
        },
    });
    void (0, push_service_1.notifyCallCreated)(call.id).catch((e) => {
        console.warn("push notifyCallCreated failed", e);
    });
    res.json({ ok: true, call });
}));
