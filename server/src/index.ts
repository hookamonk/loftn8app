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

// Behind Caddy/Vercel — trust the first proxy so req.ip reflects the real client
// (needed for rate limiting and logging).
app.set("trust proxy", 1);

const allowedOrigins = (env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Allow *.vercel.app previews ONLY when explicitly opted in via env.
// A blanket wildcard with credentials:true lets any vercel.app site send
// authenticated requests with the user's cookies (CSRF-like) — so it's off by default.
const allowVercelPreviews =
  String(process.env.ALLOW_VERCEL_PREVIEWS ?? "").toLowerCase() === "true";

function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true; // non-browser / same-origin without Origin header

  // Same-origin: the request's Origin host matches the Host it was sent to
  // (single-origin deploy behind Caddy — works for localhost and any prod domain/IP).
  try {
    if (hostHeader && new URL(origin).host === hostHeader) return true;
  } catch {
    // malformed origin → fall through to the explicit checks
  }

  if (allowedOrigins.includes(origin)) return true;
  if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
}

// Request-aware CORS so we can allow same-origin requests (Origin host === Host)
// in addition to the explicit FRONTEND_ORIGIN whitelist.
const corsMiddleware = cors((req, cb) => {
  const allowed = isOriginAllowed(req.headers.origin, req.headers.host);
  cb(null, { origin: allowed, credentials: true });
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

  // Make a misconfigured push setup visible at boot: without VAPID keys,
  // web-push silently no-ops (SSE + polling still work) and staff get no
  // lock-screen notifications. Better to flag it loudly than debug "no pushes".
  if (!env.VAPID_SUBJECT || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn(
      "⚠️  Web push DISABLED: set VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable staff push notifications."
    );
  }
  if (env.NODE_ENV === "production" && !(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)) {
    console.warn(
      "⚠️  SMTP not fully configured in production: OTP/password-reset e-mails cannot be delivered (codes are NOT exposed in the API)."
    );
  }
});
