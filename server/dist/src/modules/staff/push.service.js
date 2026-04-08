"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushToStaff = pushToStaff;
exports.pushToVenueRoles = pushToVenueRoles;
exports.notifyOrderCreated = notifyOrderCreated;
exports.notifyCallCreated = notifyCallCreated;
exports.notifyPaymentRequested = notifyPaymentRequested;
const web_push_1 = __importDefault(require("web-push"));
const prisma_1 = require("../../db/prisma");
const env_1 = require("../../config/env");
let configured = false;
function ensureConfiguredOrThrow() {
    if (configured)
        return;
    const subject = env_1.env.VAPID_SUBJECT;
    const pub = env_1.env.VAPID_PUBLIC_KEY;
    const priv = env_1.env.VAPID_PRIVATE_KEY;
    if (!subject || !pub || !priv) {
        throw new Error("WebPush not configured: set VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY");
    }
    web_push_1.default.setVapidDetails(subject, pub, priv);
    configured = true;
}
function uniq(base) {
    return `${base}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
}
function trimMessage(message, max = 120) {
    const normalized = String(message ?? "")
        .trim()
        .replace(/\s+/g, " ");
    if (!normalized)
        return null;
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
function normalizeCallMessage(type, message) {
    const trimmed = trimMessage(message, 110);
    if (!trimmed)
        return null;
    if (type === "BILL" && trimmed.startsWith("PAYMENT_METHOD:")) {
        const method = trimmed.slice("PAYMENT_METHOD:".length).trim().toUpperCase();
        if (method === "CARD")
            return "Карта";
        if (method === "CASH")
            return "Наличные";
    }
    return trimmed;
}
async function sendToSubscriptions(subs, payload) {
    ensureConfiguredOrThrow();
    const safePayload = {
        ...payload,
        ts: payload.ts ?? Date.now(),
        tag: payload.tag ?? uniq("evt"),
        renotify: payload.renotify ?? true,
        requireInteraction: payload.requireInteraction ?? true,
        vibrate: payload.vibrate ?? [320, 140, 320, 140, 420],
    };
    const json = JSON.stringify(safePayload);
    let ok = 0;
    let failed = 0;
    let removed = 0;
    await Promise.all(subs.map(async (s) => {
        try {
            await web_push_1.default.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json, {
                TTL: 60 * 60 * 4,
                urgency: "high",
            });
            ok += 1;
        }
        catch (e) {
            failed += 1;
            const status = e?.statusCode;
            if (status === 404 || status === 410) {
                removed += 1;
                await prisma_1.prisma.staffPushSubscription.delete({ where: { id: s.id } }).catch(() => { });
            }
            console.warn("webpush failed", {
                status,
                endpoint: s.endpoint?.slice(0, 60) + "...",
                msg: e?.message,
            });
        }
    }));
    return { ok, failed, removed };
}
async function pushToStaff(staffId, payload) {
    const subs = await prisma_1.prisma.staffPushSubscription.findMany({
        where: { staffId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subs.length === 0)
        return { sent: 0, failed: 0, removed: 0 };
    const r = await sendToSubscriptions(subs, payload);
    return { sent: r.ok, failed: r.failed, removed: r.removed };
}
async function pushToVenueRoles(venueId, roles, payload) {
    const staff = await prisma_1.prisma.staffUser.findMany({
        where: { venueId, isActive: true, role: { in: roles } },
        select: { id: true },
    });
    const staffIds = staff.map((x) => x.id);
    if (staffIds.length === 0)
        return { sent: 0, failed: 0, removed: 0 };
    const subs = await prisma_1.prisma.staffPushSubscription.findMany({
        where: { venueId, staffId: { in: staffIds } },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subs.length === 0)
        return { sent: 0, failed: 0, removed: 0 };
    const r = await sendToSubscriptions(subs, payload);
    return { sent: r.ok, failed: r.failed, removed: r.removed };
}
async function notifyOrderCreated(orderId) {
    const order = await prisma_1.prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            table: { select: { venueId: true, code: true } },
            items: {
                select: {
                    menuItem: {
                        select: {
                            category: { select: { section: true } },
                        },
                    },
                },
            },
        },
    });
    if (!order)
        return;
    const venueId = order.table.venueId;
    const tableCode = order.table.code;
    const sections = order.items.map((it) => it.menuItem.category.section);
    const hasHookah = sections.includes("HOOKAH");
    const hasNonHookah = sections.some((s) => s !== "HOOKAH");
    const roles = ["MANAGER"];
    if (hasHookah)
        roles.push("HOOKAH");
    if (hasNonHookah)
        roles.push("WAITER");
    await pushToVenueRoles(venueId, Array.from(new Set(roles)), {
        title: "Новый заказ",
        body: `Стол ${tableCode}`,
        url: "/staff/orders",
        tag: `order_new:${order.id}`,
        ts: Date.now(),
        kind: "ORDER_CREATED",
        tableCode,
        vibrate: [240, 120, 240, 120, 360],
    });
}
async function notifyCallCreated(callId) {
    const call = await prisma_1.prisma.staffCall.findUnique({
        where: { id: callId },
        select: {
            id: true,
            type: true,
            message: true,
            table: { select: { venueId: true, code: true } },
        },
    });
    if (!call)
        return;
    const venueId = call.table.venueId;
    const tableCode = call.table.code;
    const roles = ["MANAGER"];
    if (call.type === "HOOKAH")
        roles.push("HOOKAH");
    if (call.type === "WAITER")
        roles.push("WAITER");
    if (call.type === "HELP")
        roles.push("WAITER", "HOOKAH");
    if (call.type === "BILL")
        roles.push("WAITER");
    const kind = call.type === "HOOKAH"
        ? "Нужен кальянщик"
        : call.type === "WAITER"
            ? "Нужен официант"
            : call.type === "BILL"
                ? "Запрос оплаты"
                : "Нужна помощь";
    const messagePreview = normalizeCallMessage(call.type, call.message);
    const isMessageOnly = call.type === "HELP" && !!messagePreview;
    const title = isMessageOnly ? "Новое сообщение от гостя" : "Новый вызов";
    const body = isMessageOnly
        ? `Стол ${tableCode} • ${messagePreview}`
        : messagePreview
            ? `${kind} • Стол ${tableCode} • ${messagePreview}`
            : `${kind} • Стол ${tableCode}`;
    await pushToVenueRoles(venueId, Array.from(new Set(roles)), {
        title,
        body,
        url: "/staff/calls",
        tag: `call_new:${call.id}`,
        ts: Date.now(),
        kind: isMessageOnly ? "GUEST_MESSAGE" : "CALL_CREATED",
        message: messagePreview ?? undefined,
        tableCode,
        vibrate: isMessageOnly ? [420, 140, 420, 140, 560] : [320, 140, 320, 140, 420],
    });
}
async function notifyPaymentRequested(paymentRequestId) {
    const pr = await prisma_1.prisma.paymentRequest.findUnique({
        where: { id: paymentRequestId },
        select: { id: true, status: true, method: true, table: { select: { venueId: true, code: true } } },
    });
    if (!pr)
        return;
    if (pr.status !== "PENDING")
        return;
    await pushToVenueRoles(pr.table.venueId, ["WAITER", "MANAGER"], {
        title: "Запрос оплаты",
        body: `${pr.method === "CARD" ? "Карта" : "Наличные"} • Стол ${pr.table.code}`,
        url: "/staff/payments",
        tag: `payment_pending:${pr.id}`,
        ts: Date.now(),
        kind: "PAYMENT_REQUESTED",
        tableCode: pr.table.code,
        vibrate: [280, 120, 280, 120, 460],
    });
}
