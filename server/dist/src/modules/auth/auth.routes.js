"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../../config/env");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
const httpError_1 = require("../../utils/httpError");
const validate_1 = require("../../middleware/validate");
exports.authRouter = (0, express_1.Router)();
const RequestOtpSchema = zod_1.z.object({
    phone: zod_1.z.string().min(6),
    intent: zod_1.z.enum(["login", "register"]).optional(),
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().optional(),
});
const VerifyOtpSchema = zod_1.z.object({
    phone: zod_1.z.string().min(6),
    code: zod_1.z.string().min(4),
    intent: zod_1.z.enum(["login", "register"]).optional(),
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().optional().or(zod_1.z.literal("")),
    consent: zod_1.z.boolean().optional(),
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
function clearCookie(res, name) {
    const isProd = env_1.env.NODE_ENV === "production";
    res.clearCookie(name, {
        sameSite: isProd ? "none" : "lax",
        secure: isProd,
        domain: env_1.env.COOKIE_DOMAIN || undefined,
        path: "/",
    });
}
function normalizePhone(phone) {
    return phone.replace(/\s+/g, "").trim();
}
function normalizeName(name) {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}
function normalizeEmail(raw) {
    const v = String(raw ?? "").trim();
    return v.length ? v : null;
}
function assertEmailOrNull(email) {
    if (!email)
        return null;
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok)
        throw new httpError_1.HttpError(400, "EMAIL_INVALID", "Email is invalid");
    return email;
}
function genOtpCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}
// POST /auth/guest/request-otp
exports.authRouter.post("/guest/request-otp", (0, validate_1.validate)(RequestOtpSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const intent = req.body.intent || "login";
    const nameRaw = String(req.body.name ?? "").trim();
    if (intent === "login") {
        const user = await prisma_1.prisma.user.findUnique({ where: { phone } });
        if (!user)
            throw new httpError_1.HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
        if (nameRaw) {
            const okName = normalizeName(nameRaw) === normalizeName(user.name);
            if (!okName)
                throw new httpError_1.HttpError(404, "NAME_MISMATCH", "Account not found. Please register.");
        }
    }
    const code = genOtpCode();
    const codeHash = await bcryptjs_1.default.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma_1.prisma.otpCode.create({ data: { phone, codeHash, expiresAt } });
    // DEMO/TEST MODE
    console.log(`[OTP DEMO] phone=${phone} code=${code}`);
    return res.json({
        ok: true,
        devOtp: code,
        expiresInSec: 600,
    });
}));
// POST /auth/guest/verify-otp
exports.authRouter.post("/guest/verify-otp", (0, validate_1.validate)(VerifyOtpSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { phone: rawPhone, code } = req.body;
    const intent = req.body.intent || "login";
    const nameRaw = String(req.body.name ?? "").trim();
    const consent = Boolean(req.body.consent);
    const phone = normalizePhone(rawPhone);
    const otp = await prisma_1.prisma.otpCode.findFirst({
        where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
    });
    if (!otp)
        throw new httpError_1.HttpError(400, "OTP_NOT_FOUND", "OTP code not found or expired");
    const ok = await bcryptjs_1.default.compare(String(code), otp.codeHash);
    if (!ok)
        throw new httpError_1.HttpError(400, "OTP_INVALID", "OTP code is invalid");
    await prisma_1.prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    let user = await prisma_1.prisma.user.findUnique({ where: { phone } });
    if (intent === "login") {
        if (!user)
            throw new httpError_1.HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
        if (nameRaw) {
            const okName = normalizeName(nameRaw) === normalizeName(user.name);
            if (!okName)
                throw new httpError_1.HttpError(404, "NAME_MISMATCH", "Account not found. Please register.");
        }
    }
    else {
        if (!nameRaw)
            throw new httpError_1.HttpError(400, "NAME_REQUIRED", "Name is required");
        if (!consent)
            throw new httpError_1.HttpError(400, "CONSENT_REQUIRED", "Consent is required");
        const emailNorm = assertEmailOrNull(normalizeEmail(req.body.email));
        user = await prisma_1.prisma.user.upsert({
            where: { phone },
            update: {
                name: nameRaw,
                email: emailNorm,
                privacyAcceptedAt: new Date(),
            },
            create: {
                phone,
                name: nameRaw,
                email: emailNorm,
                privacyAcceptedAt: new Date(),
            },
        });
    }
    const uidToken = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, env_1.env.JWT_USER_SECRET, { expiresIn: "30d" });
    setCookie(res, "uid", uidToken, 60 * 60 * 24 * 30);
    const gsid = req.cookies?.gsid ?? undefined;
    if (gsid) {
        try {
            const payload = jsonwebtoken_1.default.verify(gsid, env_1.env.JWT_GUEST_SESSION_SECRET);
            await prisma_1.prisma.guestSession.update({
                where: { id: payload.sessionId },
                data: { userId: user.id },
            });
        }
        catch {
            // ignore
        }
    }
    res.json({
        ok: true,
        user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            role: user.role,
            privacyAcceptedAt: user.privacyAcceptedAt ?? null,
        },
    });
}));
exports.authRouter.get("/guest/me", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const uid = req.cookies?.uid ?? undefined;
    if (!uid)
        return res.json({ authenticated: false });
    try {
        const payload = jsonwebtoken_1.default.verify(uid, env_1.env.JWT_USER_SECRET);
        const user = await prisma_1.prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user)
            return res.json({ authenticated: false });
        return res.json({
            authenticated: true,
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role,
                privacyAcceptedAt: user.privacyAcceptedAt ?? null,
            },
        });
    }
    catch {
        return res.json({ authenticated: false });
    }
}));
exports.authRouter.post("/guest/logout", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    clearCookie(res, "uid");
    clearCookie(res, "gsid");
    res.json({ ok: true });
}));
