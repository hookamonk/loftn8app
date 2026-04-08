"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminOrManager = exports.requireAdminOnly = exports.requireManagerOnly = exports.requireStaffAuth = exports.STAFF_COOKIE_NAME = void 0;
exports.setStaffCookie = setStaffCookie;
exports.clearStaffCookie = clearStaffCookie;
exports.requireStaffRole = requireStaffRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../../db/prisma");
const httpError_1 = require("../../utils/httpError");
const env_1 = require("../../config/env");
exports.STAFF_COOKIE_NAME = "sid";
const JWT_STAFF_SECRET = process.env.JWT_STAFF_SECRET || "dev_staff_secret";
function setStaffCookie(res, token, maxAgeSeconds) {
    const isProd = env_1.env.NODE_ENV === "production";
    res.cookie(exports.STAFF_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: isProd ? "none" : "lax",
        secure: isProd,
        domain: env_1.env.COOKIE_DOMAIN || undefined,
        maxAge: maxAgeSeconds * 1000,
        path: "/",
    });
}
function clearStaffCookie(res) {
    const isProd = env_1.env.NODE_ENV === "production";
    res.clearCookie(exports.STAFF_COOKIE_NAME, {
        sameSite: isProd ? "none" : "lax",
        secure: isProd,
        domain: env_1.env.COOKIE_DOMAIN || undefined,
        path: "/",
    });
}
const requireStaffAuth = async (req, _res, next) => {
    try {
        const token = req.cookies?.[exports.STAFF_COOKIE_NAME] ?? undefined;
        if (!token)
            throw new httpError_1.HttpError(401, "STAFF_UNAUTH", "Staff auth required");
        const payload = jsonwebtoken_1.default.verify(token, JWT_STAFF_SECRET);
        const staff = await prisma_1.prisma.staffUser.findUnique({ where: { id: payload.staffId } });
        if (!staff || !staff.isActive)
            throw new httpError_1.HttpError(401, "STAFF_INVALID", "Staff session invalid");
        req.staff = { staffId: staff.id, venueId: staff.venueId, role: staff.role };
        next();
    }
    catch (e) {
        next(e);
    }
};
exports.requireStaffAuth = requireStaffAuth;
function requireStaffRole(roles) {
    return (req, _res, next) => {
        if (!req.staff)
            return next(new httpError_1.HttpError(401, "STAFF_UNAUTH", "Staff auth required"));
        if (!roles.includes(req.staff.role))
            return next(new httpError_1.HttpError(403, "STAFF_FORBIDDEN", "Forbidden"));
        next();
    };
}
exports.requireManagerOnly = requireStaffRole(["MANAGER"]);
exports.requireAdminOnly = requireStaffRole(["ADMIN"]);
exports.requireAdminOrManager = requireStaffRole(["ADMIN", "MANAGER"]);
