"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffShiftRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const httpError_1 = require("../../utils/httpError");
const staff_middleware_1 = require("./staff.middleware");
exports.staffShiftRouter = (0, express_1.Router)();
exports.staffShiftRouter.use(staff_middleware_1.requireStaffAuth);
// staff venue
exports.staffShiftRouter.get("/current", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        include: {
            participants: {
                where: { isActive: true },
                select: {
                    id: true,
                    staffId: true,
                    role: true,
                    joinedAt: true,
                    staff: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });
    res.json({ ok: true, shift });
}));
// manager open
exports.staffShiftRouter.post("/open", (0, staff_middleware_1.requireStaffRole)(["MANAGER"]), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const managerId = req.staff.staffId;
    const existing = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
    });
    if (existing) {
        throw new httpError_1.HttpError(409, "SHIFT_ALREADY_OPEN", "Shift is already open");
    }
    const shift = await prisma_1.prisma.shift.create({
        data: {
            venueId,
            openedByManagerId: managerId,
            participants: {
                create: {
                    staffId: managerId,
                    role: "MANAGER",
                    isActive: true,
                },
            },
        },
        include: {
            participants: {
                where: { isActive: true },
                select: {
                    id: true,
                    staffId: true,
                    role: true,
                    joinedAt: true,
                },
            },
        },
    });
    res.json({ ok: true, shift });
}));
// staff join
exports.staffShiftRouter.post("/join", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const staffId = req.staff.staffId;
    const role = req.staff.role;
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
    });
    if (!shift) {
        throw new httpError_1.HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
    }
    const participant = await prisma_1.prisma.shiftParticipant.upsert({
        where: {
            shiftId_staffId: {
                shiftId: shift.id,
                staffId,
            },
        },
        update: {
            isActive: true,
            leftAt: null,
            role,
        },
        create: {
            shiftId: shift.id,
            staffId,
            role,
            isActive: true,
        },
    });
    res.json({ ok: true, shiftId: shift.id, participant });
}));
// staff leave
exports.staffShiftRouter.post("/leave", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const staffId = req.staff.staffId;
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
    });
    if (!shift) {
        throw new httpError_1.HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
    }
    const participant = await prisma_1.prisma.shiftParticipant.findUnique({
        where: {
            shiftId_staffId: {
                shiftId: shift.id,
                staffId,
            },
        },
    });
    if (!participant) {
        return res.json({ ok: true });
    }
    await prisma_1.prisma.shiftParticipant.update({
        where: { id: participant.id },
        data: {
            isActive: false,
            leftAt: new Date(),
        },
    });
    res.json({ ok: true });
}));
// manager close
exports.staffShiftRouter.post("/close", (0, staff_middleware_1.requireStaffRole)(["MANAGER"]), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const managerId = req.staff.staffId;
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
    });
    if (!shift) {
        throw new httpError_1.HttpError(404, "SHIFT_NOT_FOUND", "Active shift not found");
    }
    const now = new Date();
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.shiftParticipant.updateMany({
            where: { shiftId: shift.id, isActive: true },
            data: { isActive: false, leftAt: now },
        });
        await tx.guestSession.updateMany({
            where: { shiftId: shift.id, endedAt: null },
            data: { endedAt: now },
        });
        await tx.shift.update({
            where: { id: shift.id },
            data: {
                status: "CLOSED",
                closedAt: now,
                closedByManagerId: managerId,
            },
        });
    });
    res.json({ ok: true, shiftId: shift.id, closedAt: now });
}));
