import type { Request, RequestHandler } from "express";
import { HttpError } from "../utils/httpError";

/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 * Suitable for a single-instance deployment (Docker). Keyed by client IP +
 * a per-route prefix. Protects auth/OTP endpoints from brute-force and spam.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let sweepTimer: NodeJS.Timeout | null = null;

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  sweepTimer.unref?.();
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  /**
   * What to count per, instead of the client IP.
   *
   * Every guest in the venue shares one Wi-Fi address, so an IP-based limit on
   * sign-up would lock the whole room out after a handful of registrations.
   * Those routes count per e-mail instead — which is also the thing actually
   * worth protecting (one inbox, one account) — and keep a separate, much
   * higher IP ceiling for real abuse.
   *
   * Return an empty string to skip the limit for this request.
   */
  key?: (req: Request) => string;
}): RequestHandler {
  ensureSweep();

  return (req, _res, next) => {
    const identity = opts.key
      ? opts.key(req)
      : req.ip || req.socket.remoteAddress || "unknown";

    if (!identity) return next();

    const key = `${opts.keyPrefix}:${identity}`;
    const now = Date.now();

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      _res.setHeader("Retry-After", String(retryAfter));
      return next(
        new HttpError(429, "RATE_LIMITED", opts.message ?? "Too many requests, please try again later")
      );
    }

    return next();
  };
}