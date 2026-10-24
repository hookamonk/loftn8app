import { Router } from "express";
import type { Request } from "express";
import { randomInt } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { sendGuestOtpEmail, isEmailConfigured, missingEmailSettings } from "../../utils/mailer";
import { rateLimit } from "../../middleware/rateLimit";
import { socialProvidersConfig, verifyAppleIdToken, verifyGoogleCredential, type SocialIdentity } from "./socialAuth";

/**
 * Guest identity is an e-mail address and a password, or a Google / Apple
 * account. Registration with e-mail confirms the address with a one-time code;
 * signing in needs nothing else.
 */
export const authRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Guests come back every few weeks; the session slides forward on every
// visit (see /guest/me), so a regular is practically never signed out.
const USER_TOKEN_TTL_SEC = 60 * 60 * 24 * 180;
const USER_TOKEN_REFRESH_AFTER_SEC = 60 * 60 * 24;

// SECURITY: the raw code may only ever be handed back to the caller outside
// production. In production a missing SMTP config must NEVER leak codes in the
// response — otherwise anyone could request a code for any address and take
// over the account. It fails loudly instead.
const exposeDevCode = env.NODE_ENV !== "production";

function normalizeEmail(raw?: unknown) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value.length ? value : null;
}

function assertEmail(email: string | null) {
  if (!email) throw new HttpError(400, "EMAIL_REQUIRED", "Email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "EMAIL_INVALID", "Email is invalid");
  }
  return email;
}

function assertEmailDeliverable() {
  if (isEmailConfigured()) return;

  if (!exposeDevCode) {
    // Silently "succeeding" here is what makes registration look broken with no
    // trace: the guest waits for a code that was never sent.
    throw new HttpError(
      503,
      "EMAIL_NOT_CONFIGURED",
      `Email delivery is not configured on the server (missing: ${missingEmailSettings().join(", ")})`
    );
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// Counted per E-MAIL, not per IP: every guest in the venue shares one Wi-Fi
// address, so an IP budget would lock the whole room out after a few sign-ups.
// The address is also the thing worth protecting — one inbox, one account. A
// separate, far higher IP ceiling still catches genuine abuse. It must stay
// high: requests arrive through the site's proxy, so many guests (every venue)
// can share one address.
// ---------------------------------------------------------------------------
const emailKey = (req: Request) => normalizeEmail((req.body as { email?: unknown } | undefined)?.email) ?? "";

const TOO_MANY_CODES = "Too many codes requested for this email. Please wait a few minutes.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes.";

const otpRequestByEmail = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  keyPrefix: "otp-req-email",
  key: emailKey,
  message: TOO_MANY_CODES,
});
const otpRequestByIp = rateLimit({
  windowMs: 15 * 60_000,
  max: 600,
  keyPrefix: "otp-req-ip",
  message: TOO_MANY_CODES,
});

const otpVerifyByEmail = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  keyPrefix: "otp-verify-email",
  key: emailKey,
  message: TOO_MANY_ATTEMPTS,
});
const otpVerifyByIp = rateLimit({
  windowMs: 15 * 60_000,
  max: 1200,
  keyPrefix: "otp-verify-ip",
  message: TOO_MANY_ATTEMPTS,
});

const passwordByEmail = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  keyPrefix: "auth-pw-email",
  key: emailKey,
  message: TOO_MANY_ATTEMPTS,
});
const passwordByIp = rateLimit({
  windowMs: 15 * 60_000,
  max: 1200,
  keyPrefix: "auth-pw-ip",
  message: TOO_MANY_ATTEMPTS,
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const RequestOtpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().min(3).max(200),
});

const VerifyOtpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().min(3).max(200),
  password: z.string().min(6).max(200),
  code: z.string().trim().min(4).max(10),
  consent: z.boolean(),
});

const PasswordLoginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

const RequestPasswordResetSchema = z.object({
  email: z.string().trim().min(3).max(200),
});

const SocialSignInSchema = z.object({
  token: z.string().min(20).max(8000),
  // Only for a brand-new account: the guest ticked the data-processing consent.
  consent: z.boolean().optional(),
  // Apple sends the name to the browser once, on the very first sign-in.
  name: z.string().trim().max(120).optional(),
});

const ConfirmPasswordResetSchema = z.object({
  email: z.string().trim().min(3).max(200),
  code: z.string().trim().min(4).max(10),
  password: z.string().min(6).max(200),
});

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
function setCookie(res: any, name: string, value: string, maxAgeSeconds: number) {
  const isProd = env.NODE_ENV === "production";

  res.cookie(name, value, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

function clearCookie(res: any, name: string) {
  const isProd = env.NODE_ENV === "production";

  res.clearCookie(name, {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/",
  });
}

type PublicUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cardNumber: string;
  role: string;
  privacyAcceptedAt: Date | null;
};

function serializeUser(user: PublicUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    cardNumber: user.cardNumber,
    role: user.role,
    privacyAcceptedAt: user.privacyAcceptedAt,
  };
}

function issueUserCookie(res: any, user: { id: string; role: string }) {
  const token = jwt.sign({ userId: user.id, role: user.role }, env.JWT_USER_SECRET, {
    expiresIn: USER_TOKEN_TTL_SEC,
  });
  setCookie(res, "uid", token, USER_TOKEN_TTL_SEC);
}

/** Sign the guest in and attach the table session they already opened, if any. */
async function completeSignIn(req: Request, res: any, user: PublicUser) {
  issueUserCookie(res, user);

  // The guest scanned the QR before registering, so a table session already
  // exists — bind it to the account now, otherwise their bill and cashback
  // would stay anonymous.
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (gsid) {
    try {
      const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
      await prisma.guestSession.updateMany({
        where: { id: payload.sessionId, endedAt: null },
        data: { userId: user.id },
      });
    } catch {
      // stale or foreign cookie — signing in still succeeds
    }
  }

  return { ok: true as const, user: serializeUser(user) };
}

// ---------------------------------------------------------------------------
// One-time codes
// ---------------------------------------------------------------------------
function generateOtpCode() {
  // Cryptographically secure 6-digit code (Math.random is predictable).
  return String(randomInt(100_000, 1_000_000));
}

async function issueOtp(email: string) {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Opportunistic cleanup: drop this address's used/expired codes so the table
  // can't grow unbounded and only the freshest code stays active.
  await prisma.otpCode
    .deleteMany({
      where: { email, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }] },
    })
    .catch(() => {});

  await prisma.otpCode.create({ data: { email, codeHash, expiresAt } });
  return { code, expiresInSec: Math.floor(OTP_TTL_MS / 1000) };
}

/**
 * Check a submitted code against the freshest active one, counting failures so
 * a 6-digit code cannot be brute-forced. Returns on success, throws otherwise.
 */
async function consumeOtpOrThrow(email: string, code: string) {
  const otp = await prisma.otpCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) throw new HttpError(400, "OTP_NOT_FOUND", "Code not found or expired");

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    // Burn it so a fresh code has to be requested.
    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } }).catch(() => {});
    throw new HttpError(429, "OTP_TOO_MANY_ATTEMPTS", "Too many attempts. Request a new code.");
  }

  const ok = await bcrypt.compare(String(code), otp.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } }).catch(() => {});
    throw new HttpError(400, "OTP_INVALID", "Code is invalid");
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
}

/**
 * The password as typed now, plus the two slips phones make: a stray space at
 * the end, and the first letter capitalised (or not) by the keyboard. The
 * same leniency big sites use; it does not weaken a real password.
 */
function passwordCandidates(raw: string) {
  const flipFirst = (value: string) => {
    const first = value.charAt(0);
    const flipped = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
    return flipped + value.slice(1);
  };
  const out = new Set<string>([raw]);
  const trimmed = raw.trim();
  if (trimmed) out.add(trimmed);
  for (const value of [raw, trimmed]) if (value) out.add(flipFirst(value));
  return Array.from(out);
}

async function passwordMatches(raw: string, hash: string) {
  for (const candidate of passwordCandidates(raw)) {
    if (await bcrypt.compare(candidate, hash)) return true;
  }
  return false;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Registration — step 1: send the code
// ---------------------------------------------------------------------------
authRouter.post(
  "/guest/request-otp",
  otpRequestByEmail,
  otpRequestByIp,
  validate(RequestOtpSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof RequestOtpSchema>;
    const email = assertEmail(normalizeEmail(body.email));
    const name = body.name.trim();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
    }

    assertEmailDeliverable();

    const { code, expiresInSec } = await issueOtp(email);

    if (!isEmailConfigured()) {
      // Development only — assertEmailDeliverable() already refused in prod.
      console.log(`[DEV OTP] register ${email} → ${code}`);
      return res.json({ ok: true, expiresInSec, delivery: "none", devCode: code });
    }

    await sendGuestOtpEmail({ to: email, guestName: name, code, purpose: "verification" });
    res.json({ ok: true, expiresInSec, delivery: "email" });
  })
);

// ---------------------------------------------------------------------------
// Registration — step 2: confirm the code and create the account
// ---------------------------------------------------------------------------
authRouter.post(
  "/guest/verify-otp",
  otpVerifyByEmail,
  otpVerifyByIp,
  validate(VerifyOtpSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof VerifyOtpSchema>;
    const email = assertEmail(normalizeEmail(body.email));
    const name = body.name.trim();

    if (!body.consent) {
      throw new HttpError(400, "CONSENT_REQUIRED", "Consent is required");
    }

    // Check before burning the code, so a guest who already has an account
    // doesn't lose a freshly requested one.
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
    }

    await consumeOtpOrThrow(email, body.code);

    const passwordHash = await bcrypt.hash(body.password, 10);

    let user;
    try {
      user = await prisma.user.create({
        data: { name, email, passwordHash, privacyAcceptedAt: new Date() },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          cardNumber: true,
          role: true,
          privacyAcceptedAt: true,
        },
      });
    } catch (error) {
      // Two devices confirming the same address at once — the unique index is
      // the real guard, not the check above.
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
      }
      throw error;
    }

    res.json(await completeSignIn(req, res, user));
  })
);

// ---------------------------------------------------------------------------
// Sign in — e-mail + password, nothing else
// ---------------------------------------------------------------------------
authRouter.post(
  "/guest/login-password",
  passwordByEmail,
  passwordByIp,
  validate(PasswordLoginSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof PasswordLoginSchema>;
    const email = assertEmail(normalizeEmail(body.email));

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cardNumber: true,
        role: true,
        privacyAcceptedAt: true,
        passwordHash: true,
      },
    });

    if (!user) throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
    if (!user.passwordHash) {
      // Created with Google / Apple (or before passwords existed).
      throw new HttpError(400, "PASSWORD_NOT_SET", "Password is not set for this account");
    }

    const ok = await passwordMatches(body.password, user.passwordHash);
    if (!ok) throw new HttpError(400, "PASSWORD_INVALID", "Password is invalid");

    res.json(await completeSignIn(req, res, user));
  })
);

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
authRouter.post(
  "/guest/request-password-reset",
  otpRequestByEmail,
  otpRequestByIp,
  validate(RequestPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof RequestPasswordResetSchema>;
    const email = assertEmail(normalizeEmail(body.email));

    const user = await prisma.user.findUnique({ where: { email }, select: { name: true } });
    if (!user) throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");

    assertEmailDeliverable();

    const { code, expiresInSec } = await issueOtp(email);

    if (!isEmailConfigured()) {
      console.log(`[DEV OTP] reset ${email} → ${code}`);
      return res.json({ ok: true, expiresInSec, delivery: "none", devCode: code });
    }

    await sendGuestOtpEmail({ to: email, guestName: user.name, code, purpose: "password-reset" });
    res.json({ ok: true, expiresInSec, delivery: "email" });
  })
);

authRouter.post(
  "/guest/reset-password",
  otpVerifyByEmail,
  otpVerifyByIp,
  validate(ConfirmPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof ConfirmPasswordResetSchema>;
    const email = assertEmail(normalizeEmail(body.email));

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");

    await consumeOtpOrThrow(email, body.code);

    const passwordHash = await bcrypt.hash(body.password, 10);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cardNumber: true,
        role: true,
        privacyAcceptedAt: true,
      },
    });

    res.json(await completeSignIn(req, res, updated));
  })
);

// ---------------------------------------------------------------------------
// Sign in with Google / Apple
//
//   1. the provider account is already linked      → sign in
//   2. its verified e-mail matches an account      → link it, sign in
//   3. otherwise                                   → new account (needs consent)
// ---------------------------------------------------------------------------
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  cardNumber: true,
  role: true,
  privacyAcceptedAt: true,
} as const;

async function findBySocial(identity: SocialIdentity) {
  return identity.provider === "google"
    ? prisma.user.findUnique({ where: { googleSub: identity.sub }, select: publicUserSelect })
    : prisma.user.findUnique({ where: { appleSub: identity.sub }, select: publicUserSelect });
}

async function socialSignIn(
  req: Request,
  res: any,
  identity: SocialIdentity,
  opts: { consent: boolean; name?: string }
) {
  const linked = await findBySocial(identity);
  if (linked) return completeSignIn(req, res, linked);

  const email = identity.emailVerified ? normalizeEmail(identity.email) : null;
  const link = identity.provider === "google" ? { googleSub: identity.sub } : { appleSub: identity.sub };

  if (email) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, googleSub: true, appleSub: true },
    });
    if (existing) {
      const current = identity.provider === "google" ? existing.googleSub : existing.appleSub;
      if (current && current !== identity.sub) {
        throw new HttpError(409, "SOCIAL_CONFLICT", "This e-mail is linked to another account of the provider");
      }
      const user = await prisma.user.update({ where: { id: existing.id }, data: link, select: publicUserSelect });
      return completeSignIn(req, res, user);
    }
  }

  // A brand-new guest: same consent as the e-mail registration.
  if (!opts.consent) {
    throw new HttpError(400, "CONSENT_REQUIRED", "Consent is required");
  }

  const name =
    identity.name?.trim() ||
    opts.name?.trim() ||
    (email ? email.split("@")[0] : "") ||
    "Host";

  try {
    const user = await prisma.user.create({
      data: { name: name.slice(0, 120), email, privacyAcceptedAt: new Date(), ...link },
      select: publicUserSelect,
    });
    return completeSignIn(req, res, user);
  } catch (error) {
    // The same account signing in from two devices at the same moment.
    if (isUniqueViolation(error)) {
      const again = await findBySocial(identity);
      if (again) return completeSignIn(req, res, again);
      throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
    }
    throw error;
  }
}

/** Which sign-in buttons the guest app should show. */
authRouter.get(
  "/guest/providers",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, ...socialProvidersConfig() });
  })
);

authRouter.post(
  "/guest/google",
  passwordByIp,
  validate(SocialSignInSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof SocialSignInSchema>;
    const identity = await verifyGoogleCredential(body.token);
    res.json(await socialSignIn(req, res, identity, { consent: !!body.consent }));
  })
);

authRouter.post(
  "/guest/apple",
  passwordByIp,
  validate(SocialSignInSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof SocialSignInSchema>;
    const identity = await verifyAppleIdToken(body.token);
    res.json(await socialSignIn(req, res, identity, { consent: !!body.consent, name: body.name }));
  })
);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
authRouter.get(
  "/guest/me",
  asyncHandler(async (req, res) => {
    const uid = (req.cookies?.uid as string | undefined) ?? undefined;
    if (!uid) return res.json({ authenticated: false });

    try {
      const payload = jwt.verify(uid, env.JWT_USER_SECRET) as { userId: string; iat?: number };
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          cardNumber: true,
          role: true,
          privacyAcceptedAt: true,
        },
      });
      if (!user) return res.json({ authenticated: false });

      // Slide the session forward (at most once a day), so a guest who keeps
      // coming back is never signed out.
      const ageSec = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);
      if (ageSec > USER_TOKEN_REFRESH_AFTER_SEC) issueUserCookie(res, user);

      return res.json({ authenticated: true, user: serializeUser(user) });
    } catch {
      return res.json({ authenticated: false });
    }
  })
);

authRouter.post(
  "/guest/logout",
  asyncHandler(async (_req, res) => {
    clearCookie(res, "uid");
    clearCookie(res, "gsid");
    res.json({ ok: true });
  })
);
