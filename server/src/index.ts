import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";

import { authRouter } from "./modules/auth/auth.routes";
import { accountRouter } from "./modules/account/account.routes";
import { guestRouter } from "./modules/guest/guest.routes";
import { menuRouter } from "./modules/menu/menu.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { callsRouter } from "./modules/calls/calls.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { ratingsRouter } from "./modules/ratings/ratings.routes";
import { staffRouter } from "./modules/staff/staff.router";

const app = express();

const allowedOrigins = (env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    const isAllowed =
      allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");

    if (isAllowed) return cb(null, true);

    return cb(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
});

app.use(corsMiddleware);
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/account", accountRouter);
app.use("/auth", authRouter);
app.use("/guest", guestRouter);
app.use("/menu", menuRouter);
app.use("/orders", ordersRouter);
app.use("/calls", callsRouter);
app.use("/payments", paymentsRouter);
app.use("/ratings", ratingsRouter);
app.use("/staff", staffRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`✅ API running on http://localhost:${env.PORT}`);
});
