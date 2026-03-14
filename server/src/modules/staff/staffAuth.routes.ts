import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { clearStaffCookie, requireStaffAuth, setStaffCookie } from "./staff.middleware";

export const staffAuthRouter = Router();

const LoginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(4),
});

const JWT_STAFF_SECRET = process.env.JWT_STAFF_SECRET || "dev_staff_secret";

staffAuthRouter.post(
  "/login",
  validate(LoginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as any;

    const staff = await prisma.staffUser.findUnique({ where: { username } });
    if (!staff || !staff.isActive) throw new HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");

    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) throw new HttpError(401, "STAFF_LOGIN_FAILED", "Invalid credentials");

    const token = jwt.sign({ staffId: staff.id, venueId: staff.venueId, role: staff.role }, JWT_STAFF_SECRET, { expiresIn: "7d" });
    setStaffCookie(res, token, 60 * 60 * 24 * 7);

    res.json({ ok: true, staff: { id: staff.id, role: staff.role, venueId: staff.venueId, username: staff.username } });
  })
);

staffAuthRouter.get(
  "/me",
  requireStaffAuth,
  asyncHandler(async (req, res) => {
    const staff = await prisma.staffUser.findUnique({ where: { id: req.staff!.staffId } });
    res.json({ ok: true, staff: staff ? { id: staff.id, role: staff.role, venueId: staff.venueId, username: staff.username } : null });
  })
);

staffAuthRouter.post( 
  "/logout",
  asyncHandler(async (_req, res) => {
    clearStaffCookie(res);
    res.json({ ok: true });
  })
);
