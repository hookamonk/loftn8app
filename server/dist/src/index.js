"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const env_1 = require("./config/env");
const errorHandler_1 = require("./middleware/errorHandler");
const auth_routes_1 = require("./modules/auth/auth.routes");
const guest_routes_1 = require("./modules/guest/guest.routes");
const menu_routes_1 = require("./modules/menu/menu.routes");
const orders_routes_1 = require("./modules/orders/orders.routes");
const calls_routes_1 = require("./modules/calls/calls.routes");
const payments_routes_1 = require("./modules/payments/payments.routes");
const ratings_routes_1 = require("./modules/ratings/ratings.routes");
const staff_router_1 = require("./modules/staff/staff.router");
const app = (0, express_1.default)();
const allowedOrigins = (env_1.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const corsMiddleware = (0, cors_1.default)({
    origin: (origin, cb) => {
        if (!origin)
            return cb(null, true);
        const isAllowed = allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
        if (isAllowed)
            return cb(null, true);
        return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
});
app.use(corsMiddleware);
app.use(express_1.default.json({ limit: "1mb" }));
app.use((0, cookie_parser_1.default)());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", auth_routes_1.authRouter);
app.use("/guest", guest_routes_1.guestRouter);
app.use("/menu", menu_routes_1.menuRouter);
app.use("/orders", orders_routes_1.ordersRouter);
app.use("/calls", calls_routes_1.callsRouter);
app.use("/payments", payments_routes_1.paymentsRouter);
app.use("/ratings", ratings_routes_1.ratingsRouter);
app.use("/staff", staff_router_1.staffRouter);
app.use(errorHandler_1.errorHandler);
app.listen(env_1.env.PORT, () => {
    console.log(`✅ API running on http://localhost:${env_1.env.PORT}`);
});
