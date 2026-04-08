"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../../config/env");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const httpError_1 = require("../../utils/httpError");
const validate_1 = require("../../middleware/validate");
const guestSession_1 = require("../../middleware/auth/guestSession");
exports.guestRouter = (0, express_1.Router)();
const CreateSessionSchema = zod_1.z.object({
    tableCode: zod_1.z.string().min(1),
});
const CreateRatingSchema = zod_1.z.object({
    food: zod_1.z.number().min(1).max(5).optional(),
    drinks: zod_1.z.number().min(1).max(5).optional(),
    hookah: zod_1.z.number().min(1).max(5).optional(),
    comment: zod_1.z.string().max(500).optional(),
});
function setCookie(res, name, value, maxAgeSeconds) {
    const isProd = env_1.env.NODE_ENV === "production";
    res.cookie(name, value, {
        httpOnly: true,
        sameSite: isProd ? "none" : "lax",
        secure: isProd,
        domain: env_1.env.COOKIE_DOMAIN || undefined,
        maxAge: maxAgeSeconds * 1000,
        path: "/",
    });
}
function normalizeTableCode(raw) {
    const v = String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
    if (!v)
        return "";
    if (/^\d+$/.test(v))
        return `T${v}`;
    if (/^T\d+$/.test(v))
        return v;
    if (v === "TVIP" || v === "T-VIP")
        return "VIP";
    return v;
}
function isKnownPilotTableCode(code) {
    if (code === "VIP")
        return true;
    if (!/^T\d+$/.test(code))
        return false;
    const n = Number(code.slice(1));
    return Number.isInteger(n) && n >= 1 && n <= 17;
}
async function resolveTableByCode(rawTableCode) {
    const tableCode = normalizeTableCode(rawTableCode);
    if (!tableCode)
        return null;
    const existing = await prisma_1.prisma.table.findUnique({
        where: { code: tableCode },
        select: { id: true, code: true, label: true, venueId: true },
    });
    if (existing)
        return existing;
    if (!isKnownPilotTableCode(tableCode))
        return null;
    const venue = await prisma_1.prisma.venue.findUnique({
        where: { slug: "pilot" },
        select: { id: true },
    });
    if (!venue)
        return null;
    const label = tableCode === "VIP" ? "VIP" : `Table ${Number(tableCode.slice(1))}`;
    return prisma_1.prisma.table.upsert({
        where: { code: tableCode },
        update: {
            venueId: venue.id,
            label,
        },
        create: {
            venueId: venue.id,
            code: tableCode,
            label,
        },
        select: { id: true, code: true, label: true, venueId: true },
    });
}
async function resolveUserFromCookie(req) {
    const uid = req.cookies?.uid ?? undefined;
    if (!uid)
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(uid, env_1.env.JWT_USER_SECRET);
        return prisma_1.prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true },
        });
    }
    catch {
        return null;
    }
}
async function closePreviousSessionFromCookie(req) {
    const gsid = req.cookies?.gsid ?? undefined;
    if (!gsid)
        return;
    try {
        const payload = jsonwebtoken_1.default.verify(gsid, env_1.env.JWT_GUEST_SESSION_SECRET);
        await prisma_1.prisma.guestSession.updateMany({
            where: {
                id: payload.sessionId,
                endedAt: null,
            },
            data: { endedAt: new Date() },
        });
    }
    catch {
        // ignore stale cookie
    }
}
async function resolveGuestSessionFromCookie(req) {
    const gsid = req.cookies?.gsid ?? undefined;
    if (!gsid)
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(gsid, env_1.env.JWT_GUEST_SESSION_SECRET);
        const session = await prisma_1.prisma.guestSession.findUnique({
            where: { id: payload.sessionId },
            include: {
                table: {
                    select: { id: true, code: true, label: true, venueId: true },
                },
                shift: {
                    select: { id: true, status: true, openedAt: true, closedAt: true },
                },
            },
        });
        if (!session || session.endedAt)
            return null;
        const user = await resolveUserFromCookie(req);
        if (user && session.userId !== user.id) {
            return prisma_1.prisma.guestSession.update({
                where: { id: session.id },
                data: { userId: user.id },
                include: {
                    table: {
                        select: { id: true, code: true, label: true, venueId: true },
                    },
                    shift: {
                        select: { id: true, status: true, openedAt: true, closedAt: true },
                    },
                },
            });
        }
        return session;
    }
    catch {
        return null;
    }
}
function toGuestSessionResponse(session) {
    return {
        id: session.id,
        table: {
            id: session.table.id,
            code: session.table.code,
            label: session.table.label,
        },
        shift: session.shift
            ? {
                id: session.shift.id,
                openedAt: session.shift.openedAt,
            }
            : null,
        startedAt: session.startedAt,
    };
}
function orderStatusView(status) {
    if (status === "NEW") {
        return {
            title: "Order sent",
            description: "Your order was sent to the staff team and is waiting for confirmation.",
            tone: "info",
            step: 1,
        };
    }
    if (status === "ACCEPTED") {
        return {
            title: "Order accepted",
            description: "The staff has accepted your order.",
            tone: "success",
            step: 2,
        };
    }
    if (status === "IN_PROGRESS") {
        return {
            title: "Preparing",
            description: "Your order is being prepared right now.",
            tone: "success",
            step: 3,
        };
    }
    if (status === "DELIVERED") {
        return {
            title: "Ready",
            description: "Your order is ready or already on the table.",
            tone: "success",
            step: 4,
        };
    }
    return {
        title: "Cancelled",
        description: "This order was cancelled by the staff.",
        tone: "error",
        step: 0,
    };
}
function callTypeLabel(type) {
    if (type === "WAITER")
        return "Waiter";
    if (type === "HOOKAH")
        return "Hookah service";
    if (type === "BILL")
        return "Payment";
    return "Message";
}
function callStatusView(type, status, message) {
    if (status === "NEW") {
        return {
            title: `${callTypeLabel(type)} requested`,
            description: type === "BILL"
                ? "Your payment request was sent to the staff."
                : "Your request was sent to the staff.",
            tone: "info",
        };
    }
    if (status === "ACKED") {
        return {
            title: "On the way",
            description: type === "WAITER"
                ? "A waiter has seen your request and is already coming to your table."
                : type === "HOOKAH"
                    ? "A hookah specialist has seen your request and is already coming to your table."
                    : type === "BILL"
                        ? "Your payment request was accepted and a staff member is on the way."
                        : message
                            ? "Your message was seen and taken into work."
                            : "Your request was accepted by the staff.",
            tone: "success",
        };
    }
    return {
        title: "Done",
        description: type === "BILL"
            ? "Your payment request was marked as completed."
            : "This request was marked as completed by the staff.",
        tone: "success",
    };
}
function paymentMethodLabel(method) {
    return method === "CARD" ? "Card" : "Cash";
}
function paymentStatusView(method, status, amountCzk) {
    if (status === "PENDING") {
        return {
            title: "Payment requested",
            description: `Waiting for staff: ${paymentMethodLabel(method)}.`,
            tone: "info",
        };
    }
    if (status === "CONFIRMED") {
        return {
            title: "Payment confirmed",
            description: amountCzk ? `Confirmed for ${amountCzk} Kč.` : "The payment was confirmed by the staff.",
            tone: "success",
        };
    }
    return {
        title: "Payment cancelled",
        description: "This payment request was cancelled.",
        tone: "error",
    };
}
exports.guestRouter.post("/session", (0, validate_1.validate)(CreateSessionSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { tableCode: rawTableCode } = req.body;
    const table = await resolveTableByCode(rawTableCode);
    if (!table) {
        throw new httpError_1.HttpError(404, "TABLE_NOT_FOUND", "Table not found");
    }
    const user = await resolveUserFromCookie(req);
    const shift = await prisma_1.prisma.shift.findFirst({
        where: {
            venueId: table.venueId,
            status: "OPEN",
        },
        orderBy: { openedAt: "desc" },
        select: { id: true, openedAt: true },
    });
    const existingSession = await resolveGuestSessionFromCookie(req);
    if (existingSession && existingSession.table.id === table.id) {
        const nextUserId = user?.id ?? existingSession.userId ?? null;
        const nextShiftId = existingSession.shiftId ?? shift?.id ?? null;
        const syncedSession = nextUserId !== existingSession.userId || nextShiftId !== existingSession.shiftId
            ? await prisma_1.prisma.guestSession.update({
                where: { id: existingSession.id },
                data: {
                    userId: nextUserId,
                    shiftId: nextShiftId,
                },
                include: {
                    table: {
                        select: { id: true, code: true, label: true },
                    },
                    shift: {
                        select: { id: true, openedAt: true },
                    },
                },
            })
            : {
                id: existingSession.id,
                startedAt: existingSession.startedAt,
                table: {
                    id: existingSession.table.id,
                    code: existingSession.table.code,
                    label: existingSession.table.label,
                },
                shift: existingSession.shift
                    ? {
                        id: existingSession.shift.id,
                        openedAt: existingSession.shift.openedAt,
                    }
                    : null,
            };
        const token = jsonwebtoken_1.default.sign({ sessionId: existingSession.id }, env_1.env.JWT_GUEST_SESSION_SECRET, { expiresIn: "24h" });
        setCookie(res, "gsid", token, 60 * 60 * 24);
        return res.json({
            ok: true,
            session: toGuestSessionResponse(syncedSession),
            reused: true,
        });
    }
    await closePreviousSessionFromCookie(req);
    const session = await prisma_1.prisma.guestSession.create({
        data: {
            tableId: table.id,
            shiftId: shift?.id ?? null,
            userId: user?.id ?? null,
        },
    });
    const token = jsonwebtoken_1.default.sign({ sessionId: session.id }, env_1.env.JWT_GUEST_SESSION_SECRET, { expiresIn: "24h" });
    setCookie(res, "gsid", token, 60 * 60 * 24);
    res.json({
        ok: true,
        session: toGuestSessionResponse({
            ...session,
            table,
            shift,
        }),
        reused: false,
    });
}));
exports.guestRouter.get("/me", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = await resolveGuestSessionFromCookie(req);
    if (!session) {
        return res.json({ ok: false, session: null });
    }
    res.json({
        ok: true,
        session: {
            id: session.id,
            table: {
                id: session.table.id,
                code: session.table.code,
                label: session.table.label,
            },
            shift: session.shift ?? null,
            startedAt: session.startedAt,
        },
    });
}));
exports.guestRouter.get("/feed", guestSession_1.guestSessionAuth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const session = req.guestSession;
    const [orders, calls, payments] = await Promise.all([
        prisma_1.prisma.order.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "desc" },
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: { id: true, name: true },
                        },
                    },
                },
            },
        }),
        prisma_1.prisma.staffCall.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "desc" },
        }),
        prisma_1.prisma.paymentRequest.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: "desc" },
            include: {
                confirmation: {
                    select: { amountCzk: true, createdAt: true },
                },
            },
        }),
    ]);
    const feedOrders = orders.map((order) => {
        const totalCzk = order.items.reduce((sum, item) => sum + item.priceCzk * item.qty, 0);
        const view = orderStatusView(order.status);
        return {
            id: order.id,
            status: order.status,
            comment: order.comment,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            totalCzk,
            step: view.step,
            statusTitle: view.title,
            statusDescription: view.description,
            statusTone: view.tone,
            items: order.items.map((item) => ({
                id: item.id,
                qty: item.qty,
                comment: item.comment,
                priceCzk: item.priceCzk,
                totalCzk: item.priceCzk * item.qty,
                menuItem: item.menuItem,
            })),
        };
    });
    const feedCalls = calls.map((call) => {
        const view = callStatusView(call.type, call.status, call.message);
        return {
            id: call.id,
            type: call.type,
            typeLabel: callTypeLabel(call.type),
            status: call.status,
            message: call.message,
            createdAt: call.createdAt,
            updatedAt: call.updatedAt,
            statusTitle: view.title,
            statusDescription: view.description,
            statusTone: view.tone,
        };
    });
    const feedPayments = payments.map((payment) => {
        const amountCzk = payment.confirmation?.amountCzk ?? null;
        const view = paymentStatusView(payment.method, payment.status, amountCzk);
        return {
            id: payment.id,
            method: payment.method,
            methodLabel: paymentMethodLabel(payment.method),
            status: payment.status,
            createdAt: payment.createdAt,
            confirmedAt: payment.confirmedAt,
            amountCzk,
            statusTitle: view.title,
            statusDescription: view.description,
            statusTone: view.tone,
        };
    });
    const orderedTotalCzk = feedOrders
        .filter((order) => order.status !== "CANCELLED")
        .reduce((sum, order) => sum + order.totalCzk, 0);
    const confirmedPaidCzk = feedPayments
        .filter((payment) => payment.status === "CONFIRMED")
        .reduce((sum, payment) => sum + (payment.amountCzk ?? 0), 0);
    res.json({
        ok: true,
        table: {
            id: session.table.id,
            code: session.table.code,
            label: session.table.label,
        },
        totals: {
            orderedTotalCzk,
            confirmedPaidCzk,
            dueCzk: Math.max(orderedTotalCzk - confirmedPaidCzk, 0),
        },
        orders: feedOrders,
        calls: feedCalls,
        payments: feedPayments,
    });
}));
exports.guestRouter.post("/rating", guestSession_1.guestSessionAuth, (0, validate_1.validate)(CreateRatingSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const s = req.guestSession;
    const { food, drinks, hookah, comment } = req.body;
    const session = await prisma_1.prisma.guestSession.findUnique({
        where: { id: s.id },
    });
    if (!session) {
        throw new httpError_1.HttpError(401, "SESSION_INVALID", "Session invalid");
    }
    if (session.endedAt) {
        throw new httpError_1.HttpError(401, "SESSION_ENDED", "Session ended");
    }
    const values = [food, drinks, hookah].filter((v) => typeof v === "number");
    const overall = values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 5;
    await prisma_1.prisma.rating.create({
        data: {
            sessionId: session.id,
            tableId: session.tableId,
            overall,
            food,
            drinks,
            hookah,
            comment,
        },
    });
    res.json({ ok: true });
}));
