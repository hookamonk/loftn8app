"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.guestSessionAuth = guestSessionAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../../config/env");
const prisma_1 = require("../../db/prisma");
const httpError_1 = require("../../utils/httpError");
async function guestSessionAuth(req, _res, next) {
    const gsid = req.cookies?.gsid ?? undefined;
    if (!gsid)
        return next(new httpError_1.HttpError(401, "NO_GUEST_SESSION", "Guest session is required"));
    let guestPayload;
    try {
        guestPayload = jsonwebtoken_1.default.verify(gsid, env_1.env.JWT_GUEST_SESSION_SECRET);
    }
    catch {
        return next(new httpError_1.HttpError(401, "INVALID_GUEST_SESSION", "Invalid guest session token"));
    }
    const session = await prisma_1.prisma.guestSession.findUnique({
        where: { id: guestPayload.sessionId },
        include: { table: true },
    });
    if (!session || session.endedAt) {
        return next(new httpError_1.HttpError(401, "SESSION_NOT_FOUND", "Session not found or ended"));
    }
    req.guestSession = session;
    // optional user
    const uid = req.cookies?.uid ?? undefined;
    if (uid) {
        try {
            const userPayload = jsonwebtoken_1.default.verify(uid, env_1.env.JWT_USER_SECRET);
            const user = await prisma_1.prisma.user.findUnique({ where: { id: userPayload.userId } });
            if (user) {
                req.user = user;
                if (session.userId !== user.id) {
                    const syncedSession = await prisma_1.prisma.guestSession.update({
                        where: { id: session.id },
                        data: { userId: user.id },
                        include: { table: true },
                    });
                    req.guestSession = syncedSession;
                }
            }
        }
        catch {
        }
    }
    next();
}
