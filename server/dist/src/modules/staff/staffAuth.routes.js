"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffAuthRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../../db/prisma");
const validate_1 = require("../../middleware/validate");
const asyncHandler_1 = require("../../utils/asyncHandler");
const httpError_1 = require("../../utils/httpError");
const staff_middleware_1 = require("./staff.middleware");
exports.staffAuthRouter = (0, express_1.Router)();
const LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(3),
    password: zod_1.z.string().min(4),
});
const JWT_STAFF_SECRET = process.env.JWT_STAFF_SECRET || "dev_staff_secret";
exports.staffAuthRouter.post("/login", (0, validate_1.validate)(LoginSchema), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { username, password } = req.body;
    const staff = await prisma_1.prisma.staffUser.findUnique({ where: { username } });
    if (!staff || !staff.isActive)
        throw new httpError_1.HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");
    const ok = await bcryptjs_1.default.compare(password, staff.passwordHash);
    if (!ok)
        throw new httpError_1.HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");
    const token = jsonwebtoken_1.default.sign({ staffId: staff.id, venueId: staff.venueId, role: staff.role }, JWT_STAFF_SECRET, { expiresIn: "7d" });
    (0, staff_middleware_1.setStaffCookie)(res, token, 60 * 60 * 24 * 7);
    res.json({ ok: true, staff: { id: staff.id, role: staff.role, venueId: staff.venueId, username: staff.username } });
}));
exports.staffAuthRouter.get("/me", staff_middleware_1.requireStaffAuth, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const staff = await prisma_1.prisma.staffUser.findUnique({ where: { id: req.staff.staffId } });
    res.json({ ok: true, staff: staff ? { id: staff.id, role: staff.role, venueId: staff.venueId, username: staff.username } : null });
}));
exports.staffAuthRouter.post("/logout", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    (0, staff_middleware_1.clearStaffCookie)(res);
    res.json({ ok: true });
}));
