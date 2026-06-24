import type { RequestHandler } from "express";
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
}): RequestHandler {
  ensureSweep();

  return (req, _res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${opts.keyPrefix}:${ip}`;
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