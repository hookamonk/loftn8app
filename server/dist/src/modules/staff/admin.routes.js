"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffAdminRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const staff_middleware_1 = require("./staff.middleware");
const httpError_1 = require("../../utils/httpError");
exports.staffAdminRouter = (0, express_1.Router)();
exports.staffAdminRouter.use(staff_middleware_1.requireStaffAuth);
exports.staffAdminRouter.use(staff_middleware_1.requireAdminOrManager);
function getRangeKey(raw) {
    const v = String(raw ?? "all");
    if (v === "today" || v === "week" || v === "month")
        return v;
    return "all";
}
function getGuestFilter(raw) {
    const v = String(raw ?? "all");
    if (v === "registered" || v === "anonymous")
        return v;
    return "all";
}
function getDateFromRange(range) {
    const now = new Date();
    if (range === "today") {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
    if (range === "week") {
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    if (range === "month") {
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    return undefined;
}
function dateWhere(field, from) {
    if (!from)
        return {};
    return { [field]: { gte: from } };
}
// ОБЩАЯ СВОДКА
exports.staffAdminRouter.get("/summary", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const [usersCount, guestSessionsCount, registeredGuestSessionsCount, anonymousGuestSessionsCount, ordersCount, callsCount, ratingsCount, paymentsCount, revenueAgg, avgRatings, shiftsTotal, openShift,] = await Promise.all([
        prisma_1.prisma.user.count({
            where: {
                ...dateWhere("createdAt", from),
                sessions: {
                    some: {
                        table: { venueId },
                    },
                },
            },
        }),
        prisma_1.prisma.guestSession.count({
            where: {
                ...dateWhere("startedAt", from),
                table: { venueId },
            },
        }),
        prisma_1.prisma.guestSession.count({
            where: {
                ...dateWhere("startedAt", from),
                table: { venueId },
                userId: { not: null },
            },
        }),
        prisma_1.prisma.guestSession.count({
            where: {
                ...dateWhere("startedAt", from),
                table: { venueId },
                userId: null,
            },
        }),
        prisma_1.prisma.order.count({
            where: {
                ...dateWhere("createdAt", from),
                table: { venueId },
            },
        }),
        prisma_1.prisma.staffCall.count({
            where: {
                ...dateWhere("createdAt", from),
                table: { venueId },
            },
        }),
        prisma_1.prisma.rating.count({
            where: {
                ...dateWhere("createdAt", from),
                table: { venueId },
            },
        }),
        prisma_1.prisma.paymentConfirmation.count({
            where: {
                ...dateWhere("createdAt", from),
                venueId,
            },
        }),
        prisma_1.prisma.paymentConfirmation.aggregate({
            where: {
                ...dateWhere("createdAt", from),
                venueId,
            },
            _sum: { amountCzk: true },
        }),
        prisma_1.prisma.rating.aggregate({
            where: {
                ...dateWhere("createdAt", from),
                table: { venueId },
            },
            _avg: {
                overall: true,
                food: true,
                drinks: true,
                hookah: true,
            },
        }),
        prisma_1.prisma.shift.count({
            where: {
                venueId,
                ...dateWhere("openedAt", from),
            },
        }),
        prisma_1.prisma.shift.findFirst({
            where: { venueId, status: "OPEN" },
            orderBy: { openedAt: "desc" },
            select: {
                id: true,
                openedAt: true,
                openedByManagerId: true,
            },
        }),
    ]);
    res.json({
        ok: true,
        summary: {
            range,
            usersCount,
            guestSessionsCount,
            registeredGuestSessionsCount,
            anonymousGuestSessionsCount,
            ordersCount,
            callsCount,
            ratingsCount,
            paymentsCount,
            totalRevenueCzk: revenueAgg._sum.amountCzk ?? 0,
            avgOverall: avgRatings._avg.overall ?? null,
            avgFood: avgRatings._avg.food ?? null,
            avgDrinks: avgRatings._avg.drinks ?? null,
            avgHookah: avgRatings._avg.hookah ?? null,
            shiftsTotal,
            openShift,
        },
    });
}));
exports.staffAdminRouter.get("/shifts", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const shifts = await prisma_1.prisma.shift.findMany({
        where: {
            venueId,
            ...dateWhere("openedAt", from),
        },
        orderBy: { openedAt: "desc" },
        include: {
            openedByManager: {
                select: { id: true, username: true, role: true },
            },
            closedByManager: {
                select: { id: true, username: true, role: true },
            },
            participants: {
                orderBy: { joinedAt: "asc" },
                select: {
                    id: true,
                    staffId: true,
                    role: true,
                    joinedAt: true,
                    leftAt: true,
                    isActive: true,
                    staff: {
                        select: { id: true, username: true, role: true },
                    },
                },
            },
            guestSessions: {
                select: { id: true },
            },
        },
    });
    res.json({ ok: true, shifts });
}));
exports.staffAdminRouter.get("/shifts/:id", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const shiftId = String(req.params.id);
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { id: shiftId, venueId },
        include: {
            openedByManager: {
                select: { id: true, username: true, role: true },
            },
            closedByManager: {
                select: { id: true, username: true, role: true },
            },
            participants: {
                orderBy: { joinedAt: "asc" },
                include: {
                    staff: {
                        select: { id: true, username: true, role: true },
                    },
                },
            },
        },
    });
    if (!shift) {
        throw new httpError_1.HttpError(404, "SHIFT_NOT_FOUND", "Shift not found");
    }
    const [sessionsCount, ordersCount, callsCount, ratingsCount, paymentsCount, revenueAgg, avgRatings, registrationsCount,] = await Promise.all([
        prisma_1.prisma.guestSession.count({
            where: { shiftId: shift.id },
        }),
        prisma_1.prisma.order.count({
            where: { session: { shiftId: shift.id } },
        }),
        prisma_1.prisma.staffCall.count({
            where: { session: { shiftId: shift.id } },
        }),
        prisma_1.prisma.rating.count({
            where: { session: { shiftId: shift.id } },
        }),
        prisma_1.prisma.paymentConfirmation.count({
            where: {
                venueId,
                paymentRequest: {
                    session: { shiftId: shift.id },
                },
            },
        }),
        prisma_1.prisma.paymentConfirmation.aggregate({
            where: {
                venueId,
                paymentRequest: {
                    session: { shiftId: shift.id },
                },
            },
            _sum: { amountCzk: true },
        }),
        prisma_1.prisma.rating.aggregate({
            where: { session: { shiftId: shift.id } },
            _avg: {
                overall: true,
                food: true,
                drinks: true,
                hookah: true,
            },
        }),
        prisma_1.prisma.user.count({
            where: {
                sessions: {
                    some: { shiftId: shift.id },
                },
            },
        }),
    ]);
    res.json({
        ok: true,
        shift,
        stats: {
            sessionsCount,
            ordersCount,
            callsCount,
            ratingsCount,
            paymentsCount,
            revenueCzk: revenueAgg._sum.amountCzk ?? 0,
            avgOverall: avgRatings._avg.overall ?? null,
            avgFood: avgRatings._avg.food ?? null,
            avgDrinks: avgRatings._avg.drinks ?? null,
            avgHookah: avgRatings._avg.hookah ?? null,
            registrationsCount,
        },
    });
}));
exports.staffAdminRouter.get("/ratings", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const ratings = await prisma_1.prisma.rating.findMany({
        where: {
            ...dateWhere("createdAt", from),
            table: { venueId },
        },
        orderBy: { createdAt: "desc" },
        include: {
            table: {
                select: { id: true, code: true, label: true },
            },
            session: {
                select: {
                    id: true,
                    user: {
                        select: { id: true, name: true, phone: true },
                    },
                    shiftId: true,
                },
            },
        },
        take: 200,
    });
    res.json({ ok: true, ratings });
}));
exports.staffAdminRouter.get("/users", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const users = await prisma_1.prisma.user.findMany({
        where: {
            ...dateWhere("createdAt", from),
            sessions: {
                some: {
                    table: { venueId },
                },
            },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            role: true,
            privacyAcceptedAt: true,
            createdAt: true,
        },
        take: 200,
    });
    res.json({ ok: true, users });
}));
exports.staffAdminRouter.get("/guest-sessions", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const filter = getGuestFilter(req.query.filter);
    const from = getDateFromRange(range);
    const sessions = await prisma_1.prisma.guestSession.findMany({
        where: {
            ...dateWhere("startedAt", from),
            table: { venueId },
            ...(filter === "registered"
                ? { userId: { not: null } }
                : filter === "anonymous"
                    ? { userId: null }
                    : {}),
        },
        orderBy: { startedAt: "desc" },
        include: {
            table: {
                select: { id: true, code: true, label: true },
            },
            shift: {
                select: { id: true, status: true, openedAt: true },
            },
            user: {
                select: { id: true, name: true, phone: true, email: true },
            },
            _count: {
                select: {
                    orders: true,
                    calls: true,
                    payments: true,
                    ratings: true,
                },
            },
        },
        take: 200,
    });
    res.json({
        ok: true,
        sessions: sessions.map((s) => ({
            id: s.id,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            table: s.table,
            shift: s.shift,
            user: s.user,
            ordersCount: s._count.orders,
            callsCount: s._count.calls,
            paymentsCount: s._count.payments,
            ratingsCount: s._count.ratings,
        })),
    });
}));
exports.staffAdminRouter.get("/orders", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const orders = await prisma_1.prisma.order.findMany({
        where: {
            ...dateWhere("createdAt", from),
            table: { venueId },
        },
        orderBy: { createdAt: "desc" },
        include: {
            table: {
                select: { id: true, code: true, label: true },
            },
            user: {
                select: { id: true, name: true, phone: true },
            },
            session: {
                select: {
                    id: true,
                    user: {
                        select: { id: true, name: true, phone: true },
                    },
                },
            },
            items: {
                select: {
                    qty: true,
                    priceCzk: true,
                },
            },
        },
        take: 200,
    });
    res.json({
        ok: true,
        orders: orders.map((o) => ({
            id: o.id,
            status: o.status,
            comment: o.comment,
            createdAt: o.createdAt,
            table: o.table,
            user: o.user,
            session: o.session,
            itemsCount: o.items.reduce((sum, x) => sum + x.qty, 0),
            totalCzk: o.items.reduce((sum, x) => sum + x.qty * x.priceCzk, 0),
        })),
    });
}));
exports.staffAdminRouter.get("/calls", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const calls = await prisma_1.prisma.staffCall.findMany({
        where: {
            ...dateWhere("createdAt", from),
            table: { venueId },
        },
        orderBy: { createdAt: "desc" },
        include: {
            table: {
                select: { id: true, code: true, label: true },
            },
            session: {
                select: {
                    id: true,
                    user: {
                        select: { id: true, name: true, phone: true },
                    },
                },
            },
        },
        take: 200,
    });
    res.json({ ok: true, calls });
}));
exports.staffAdminRouter.get("/payments", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const payments = await prisma_1.prisma.paymentRequest.findMany({
        where: {
            ...dateWhere("createdAt", from),
            table: { venueId },
        },
        orderBy: { createdAt: "desc" },
        include: {
            table: {
                select: { id: true, code: true, label: true },
            },
            session: {
                select: {
                    id: true,
                    user: {
                        select: { id: true, name: true, phone: true },
                    },
                },
            },
            confirmation: {
                select: {
                    id: true,
                    amountCzk: true,
                    createdAt: true,
                    staff: {
                        select: { id: true, username: true, role: true },
                    },
                },
            },
        },
        take: 200,
    });
    res.json({ ok: true, payments });
}));
exports.staffAdminRouter.get("/staff-performance", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const venueId = req.staff.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const staff = await prisma_1.prisma.staffUser.findMany({
        where: { venueId, isActive: true },
        select: {
            id: true,
            username: true,
            role: true,
            createdAt: true,
        },
        orderBy: [{ role: "asc" }, { username: "asc" }],
    });
    const result = await Promise.all(staff.map(async (s) => {
        const shiftsJoined = await prisma_1.prisma.shiftParticipant.count({
            where: {
                staffId: s.id,
                shift: {
                    venueId,
                    ...dateWhere("openedAt", from),
                },
            },
        });
        return {
            ...s,
            shiftsJoined,
        };
    }));
    res.json({ ok: true, staff: result });
}));
