import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { sendGuestOtpEmail } from "../../utils/mailer";

export const authRouter = Router();

type Intent = "login" | "register";

const RequestOtpSchema = z.object({
  phone: z.string().min(6),
  intent: z.enum(["register"]).optional(),
  name: z.string().min(1),
  email: z.string().min(3),
});

const VerifyOtpSchema = z.object({
  phone: z.string().min(6),
  code: z.string().min(4),
  intent: z.enum(["register"]).optional(),
  name: z.string().min(1),
  email: z.string().min(3),
  password: z.string().min(6),
  consent: z.boolean(),
});

const PasswordLoginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(6),
});

const RequestPasswordResetSchema = z.object({
  email: z.string().min(3),
});

const ConfirmPasswordResetSchema = z.object({
  email: z.string().min(3),
  code: z.string().min(4),
  password: z.string().min(6),
});

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

function normalizePhone(phone: string) {
  const compact = phone.replace(/\s+/g, "").trim();
  if (!compact) return "";
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (/^\d+$/.test(compact)) {
    if (compact.startsWith("420")) return `+${compact}`;
    return `+420${compact}`;
  }
  return compact;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeEmail(raw?: string | null) {
  const v = String(raw ?? "").trim().toLowerCase();
  return v.length ? v : null;
}

function assertEmailOrNull(email: string | null) {
  if (!email) return null;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!ok) throw new HttpError(400, "EMAIL_INVALID", "Email is invalid");
  return email;
}

function assertEmail(email: string | null) {
  const normalized = assertEmailOrNull(email);
  if (!normalized) {
    throw new HttpError(400, "EMAIL_REQUIRED", "Email is required");
  }
  return normalized;
}

function genOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function assertRegisterAllowed(existingUser: { id: string } | null) {
  if (existingUser) {
    throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
  }
}

async function issueOtpForPhone(phone: string) {
  const code = genOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.otpCode.create({ data: { phone, codeHash, expiresAt } });
  return { code, expiresInSec: 600 };
}

// POST /auth/guest/request-otp
authRouter.post(
  "/guest/request-otp",
  validate(RequestOtpSchema),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone((req.body as any).phone);
    const intent: Intent = "register";
    const nameRaw = String((req.body as any).name ?? "").trim();
    const email = assertEmail(normalizeEmail((req.body as any).email));
    const user = await prisma.user.findUnique({ where: { phone } });
    const existingEmailUser = await prisma.user.findUnique({ where: { email } }).catch(() => null);

    assertRegisterAllowed(user);
    if (existingEmailUser) {
      throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
    }

    const { code, expiresInSec } = await issueOtpForPhone(phone);
    await sendGuestOtpEmail({
      to: email,
      guestName: nameRaw || user?.name || null,
      code,
      purpose: "verification",
    });
    return res.json({
      ok: true,
      expiresInSec,
      delivery: "email",
    });
  })
);

// POST /auth/guest/verify-otp
authRouter.post(
  "/guest/verify-otp",
  validate(VerifyOtpSchema),
  asyncHandler(async (req, res) => {
    const { phone: rawPhone, code } = req.body as any;
    const intent: Intent = "register";
    const nameRaw = String((req.body as any).name ?? "").trim();
    const consent = Boolean((req.body as any).consent);
    const passwordRaw = String((req.body as any).password ?? "");

    const phone = normalizePhone(rawPhone);
    const email = assertEmail(normalizeEmail((req.body as any).email));

    const otp = await prisma.otpCode.findFirst({
      where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) throw new HttpError(400, "OTP_NOT_FOUND", "OTP code not found or expired");

    const ok = await bcrypt.compare(String(code), otp.codeHash);
    if (!ok) throw new HttpError(400, "OTP_INVALID", "OTP code is invalid");

    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

    let user = await prisma.user.findUnique({ where: { phone } });

    if (!nameRaw) throw new HttpError(400, "NAME_REQUIRED", "Name is required");
    if (!consent) throw new HttpError(400, "CONSENT_REQUIRED", "Consent is required");
    if (passwordRaw.length < 6) throw new HttpError(400, "PASSWORD_TOO_SHORT", "Password is too short");
    assertRegisterAllowed(user);
    const existingEmailUser = await prisma.user.findUnique({ where: { email } }).catch(() => null);
    if (existingEmailUser) {
      throw new HttpError(409, "ACCOUNT_EXISTS", "Account already exists. Please sign in.");
    }

    const passwordHash = await bcrypt.hash(passwordRaw, 10);

    user = await prisma.user.create({
      data: {
        phone,
        name: nameRaw,
        email,
        passwordHash,
        privacyAcceptedAt: new Date(),
      },
    });

    const uidToken = jwt.sign(
      { userId: user!.id, role: user!.role },
      env.JWT_USER_SECRET,
      { expiresIn: "30d" }
    );

    setCookie(res, "uid", uidToken, 60 * 60 * 24 * 30);

    const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
    if (gsid) {
      try {
        const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
        await prisma.guestSession.update({
          where: { id: payload.sessionId },
          data: { userId: user!.id },
        });
      } catch {
        // ignore
      }
    }

    res.json({
      ok: true,
      user: {
        id: user!.id,
        name: user!.name,
        phone: user!.phone,
        email: user!.email,
        role: user!.role,
        privacyAcceptedAt: (user as any).privacyAcceptedAt ?? null,
      },
    });
  })
);

const guestPasswordLoginHandler = asyncHandler(async (req, res) => {
    const email = assertEmail(normalizeEmail((req.body as any).email));
    const password = String((req.body as any).password ?? "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
    }

    if (!user.passwordHash) {
      throw new HttpError(400, "PASSWORD_NOT_SET", "Password is not set for this account");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new HttpError(400, "PASSWORD_INVALID", "Password is invalid");
    }

    const uidToken = jwt.sign(
      { userId: user.id, role: user.role },
      env.JWT_USER_SECRET,
      { expiresIn: "30d" }
    );

    setCookie(res, "uid", uidToken, 60 * 60 * 24 * 30);

    const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
    if (gsid) {
      try {
        const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
        await prisma.guestSession.update({
          where: { id: payload.sessionId },
          data: { userId: user.id },
        });
      } catch {
        // ignore
      }
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        privacyAcceptedAt: (user as any).privacyAcceptedAt ?? null,
      },
    });
  });

authRouter.post("/guest/login-password", validate(PasswordLoginSchema), guestPasswordLoginHandler);
authRouter.post("/guest/password-login", validate(PasswordLoginSchema), guestPasswordLoginHandler);
authRouter.post("/guest/login", validate(PasswordLoginSchema), guestPasswordLoginHandler);

authRouter.post(
  "/guest/request-password-reset",
  validate(RequestPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const email = assertEmail(normalizeEmail((req.body as any).email));
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
    }

    const { code, expiresInSec } = await issueOtpForPhone(user.phone);
    await sendGuestOtpEmail({
      to: email,
      guestName: user.name,
      code,
      purpose: "password-reset",
    });

    res.json({
      ok: true,
      expiresInSec,
      delivery: "email",
    });
  })
);

authRouter.post(
  "/guest/reset-password",
  validate(ConfirmPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const email = assertEmail(normalizeEmail((req.body as any).email));
    const code = String((req.body as any).code ?? "").trim();
    const passwordRaw = String((req.body as any).password ?? "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new HttpError(404, "NO_ACCOUNT", "Account not found. Please register.");
    }

    const otp = await prisma.otpCode.findFirst({
      where: { phone: user.phone, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) throw new HttpError(400, "OTP_NOT_FOUND", "OTP code not found or expired");

    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) throw new HttpError(400, "OTP_INVALID", "OTP code is invalid");

    await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

    const passwordHash = await bcrypt.hash(passwordRaw, 10);
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    const uidToken = jwt.sign(
      { userId: updatedUser.id, role: updatedUser.role },
      env.JWT_USER_SECRET,
      { expiresIn: "30d" }
    );

    setCookie(res, "uid", uidToken, 60 * 60 * 24 * 30);

    const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
    if (gsid) {
      try {
        const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
        await prisma.guestSession.update({
          where: { id: payload.sessionId },
          data: { userId: updatedUser.id },
        });
      } catch {
        // ignore
      }
    }

    res.json({
      ok: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        phone: updatedUser.phone,
        email: updatedUser.email,
        role: updatedUser.role,
        privacyAcceptedAt: (updatedUser as any).privacyAcceptedAt ?? null,
      },
    });
  })
);

authRouter.get(
  "/guest/me",
  asyncHandler(async (req, res) => {
    const uid = (req.cookies?.uid as string | undefined) ?? undefined;
    if (!uid) return res.json({ authenticated: false });

    try {
      const payload = jwt.verify(uid, env.JWT_USER_SECRET) as { userId: string; role: string };
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return res.json({ authenticated: false });

      return res.json({
        authenticated: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          role: user.role,
          privacyAcceptedAt: (user as any).privacyAcceptedAt ?? null,
        },
      });
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
