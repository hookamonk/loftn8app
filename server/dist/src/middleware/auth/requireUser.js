"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUser = requireUser;
const httpError_1 = require("../../utils/httpError");
function requireUser(req, _res, next) {
    if (!req.user) {
        return next(new httpError_1.HttpError(403, "AUTH_REQUIRED", "User authentication required"));
    }
    next();
}
