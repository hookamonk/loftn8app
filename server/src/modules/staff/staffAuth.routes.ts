import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { clearStaffCookie, requireStaffAuth, setStaffCookie } from "./staff.middleware";
import { publicVenueSlug, venueNameBySlug } from "../../config/venues";
import { env } from "../../config/env";
import { rateLimit } from "../../middleware/rateLimit";

export const staffAuthRouter = Router();

// Everyone at a venue shares its Wi-Fi address, and a shift starts with a
// dozen logins at once — so the address gets a generous ceiling, while
// password guessing is stopped per account (failed attempts only, below).
const staffLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 120,
  keyPrefix: "staff-login",
  message: "Слишком много попыток входа. Подождите 15 минут.",
});

const FAILED_WINDOW_MS = 15 * 60_000;
const FAILED_MAX = 10;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function failedKey(ip: string | undefined, username: string) {
  return `${ip ?? "unknown"}|${username.toLowerCase()}`;
}

function tooManyFailures(key: string) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= FAILED_MAX;
}

function noteFailure(key: string) {
  const now = Date.now();
  const entry = failedLogins.get(key);
  if (!entry || entry.resetAt <= now) {
    failedLogins.set(key, { count: 1, resetAt: now + FAILED_WINDOW_MS });
  } else {
    entry.count += 1;
  }
  // Keep the map from growing without bound.
  if (failedLogins.size > 5000) {
    for (const [k, v] of failedLogins) if (v.resetAt <= now) failedLogins.delete(k);
  }
}

const LoginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
});

const JWT_STAFF_SECRET = env.JWT_STAFF_SECRET;

staffAuthRouter.post(
  "/login",
  staffLoginLimiter,
  validate(LoginSchema),
  asyncHandler(async (req, res) => {
    const username = String((req.body as any).username ?? "").trim();
    const password = String((req.body as any).password ?? "");

    const attemptKey = failedKey(req.ip, username);
    if (tooManyFailures(attemptKey)) {
      throw new HttpError(429, "RATE_LIMITED", "Слишком много неудачных попыток. Подождите 15 минут.");
    }

    // Logins are typed on phones — ignore letter case.
    const staff = await prisma.staffUser.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    const ok = !!staff && staff.isActive && (await bcrypt.compare(password, staff.passwordHash));
    if (!staff || !ok) {
      noteFailure(attemptKey);
      throw new HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");
    }
    failedLogins.delete(attemptKey);

    // Every account belongs to exactly one venue. The venue picked on the
    // login screen is only a hint: with valid credentials the account signs in
    // to its own venue (the response tells the client which), instead of
    // failing because a different venue happened to be highlighted.
    const staffVenue = await prisma.venue.findUnique({
      where: { id: staff.venueId },
      select: { slug: true, name: true },
    });
    if (!staffVenue) throw new HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");

    const token = jwt.sign({ staffId: staff.id, venueId: staff.venueId, role: staff.role }, JWT_STAFF_SECRET, { expiresIn: "7d" });
    setStaffCookie(res, token, 60 * 60 * 24 * 7);

    res.json({
      ok: true,
      staff: {
        id: staff.id,
        role: staff.role,
        venueId: staff.venueId,
        venueSlug: publicVenueSlug(staffVenue.slug),
        venueName: venueNameBySlug(staffVenue.slug),
        username: staff.username,
      },
    });
  })
);

staffAuthRouter.get(
  "/me",
  requireStaffAuth,
  asyncHandler(async (req, res) => {
    const staff = await prisma.staffUser.findUnique({
      where: { id: req.staff!.staffId },
      include: { venue: { select: { slug: true, name: true } } },
    });
    res.json({
      ok: true,
      staff: staff
        ? {
            id: staff.id,
            role: staff.role,
            venueId: staff.venueId,
            venueSlug: publicVenueSlug(staff.venue.slug),
            venueName: venueNameBySlug(staff.venue.slug),
            username: staff.username,
          }
        : null,
    });
  })
);

staffAuthRouter.post( 
  "/logout",
  asyncHandler(async (_req, res) => {
    clearStaffCookie(res);
    res.json({ ok: true });
  })
);
