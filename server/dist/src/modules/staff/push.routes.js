"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffPushRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const validate_1 = require("../../middleware/validate");
const staff_middleware_1 = require("./staff.middleware");
const httpError_1 = require("../../utils/httpError");
const push_service_1 = require("./push.service");
const env_1 = require("../../config/env");
exports.staffPushRouter = (0, express_1.Router)();
// public key
exports.staffPushRouter.get("/vapid-public-key", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const key = env_1.env.VAPID_PUBLIC_KEY;
    if (!key)
        throw new httpError_1.HttpError(500, "VAPID_NOT_CONFIGURED", "VAPID_PUBLIC_KEY missing");
    res.json({ publicKey: key });
}));
const SubscribeSchema = zod_1.z.object({
    endpoint: zod_1.z.string().url(),
    keys: zod_1.z.object({
        p256dh: zod_1.z.string().min(10),
        auth: zod_1.z.string().min(10),
    }),
});
exports.staffPushRouter.post("/subscribe", staff_middleware_1.requireStaffAuth, (0, validate_1.validate)(SubscribeSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const sub = req.body;
    const staffId = req.staff.staffId;
    const venueId = req.staff.venueId;
    const ua = String(req.headers["user-agent"] ?? "");
    await prisma_1.prisma.staffPushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        update: {
            staffId,
            venueId,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            userAgent: ua,
        },
        create: {
            staffId,
            venueId,
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            userAgent: ua,
        },
    });
    res.json({ ok: true });
}));
const UnsubscribeSchema = zod_1.z.object({ endpoint: zod_1.z.string().url() });
exports.staffPushRouter.post("/unsubscribe", staff_middleware_1.requireStaffAuth, (0, validate_1.validate)(UnsubscribeSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { endpoint } = req.body;
    await prisma_1.prisma.staffPushSubscription.delete({ where: { endpoint } }).catch(() => { });
    res.json({ ok: true });
}));
// status
exports.staffPushRouter.get("/me", staff_middleware_1.requireStaffAuth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const staffId = req.staff.staffId;
    const count = await prisma_1.prisma.staffPushSubscription.count({ where: { staffId } });
    res.json({ ok: true, subscribed: count > 0, count });
}));
const TestSendSchema = zod_1.z.object({
    title: zod_1.z.string().max(60).optional(),
    body: zod_1.z.string().max(200).optional(),
    url: zod_1.z.string().max(200).optional(),
});
const devSendHandler = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (env_1.env.NODE_ENV === "production") {
        throw new httpError_1.HttpError(404, "NOT_FOUND", "Not found");
    }
    const staffId = req.staff.staffId;
    const title = req.body?.title ?? "Test push";
    const body = req.body?.body ?? `Hello from server • ${new Date().toLocaleString()}`;
    const url = req.body?.url ?? "/staff/summary";
    // tag push
    const { sent, failed, removed } = await (0, push_service_1.pushToStaff)(staffId, {
        title,
        body,
        url,
        tag: `dev_test:${Date.now()}`,
        ts: Date.now(),
    });
    res.json({ ok: true, sent, failed, removed });
});
exports.staffPushRouter.post("/dev/send-test", staff_middleware_1.requireStaffAuth, (0, validate_1.validate)(TestSendSchema), devSendHandler);
exports.staffPushRouter.post("/test-send", staff_middleware_1.requireStaffAuth, (0, validate_1.validate)(TestSendSchema), devSendHandler);
