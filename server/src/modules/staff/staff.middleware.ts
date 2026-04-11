import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { env } from "../../config/env";
import type { StaffRole } from "@prisma/client";
import { normalizeVenueSlug, resolveVenueSlug } from "../../config/venues";

declare global {
  namespace Express {
    interface Request {
      staff?: { staffId: string; venueId: number; role: StaffRole };
    }
  }
}

export const STAFF_COOKIE_NAME = "sid";

const JWT_STAFF_SECRET = process.env.JWT_STAFF_SECRET || "dev_staff_secret";

export function setStaffCookie(res: any, token: string, maxAgeSeconds: number) {
  const isProd = env.NODE_ENV === "production";

  res.cookie(STAFF_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

export function clearStaffCookie(res: any) {
  const isProd = env.NODE_ENV === "production";

  res.clearCookie(STAFF_COOKIE_NAME, {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/",
  });
}

export const requireStaffAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = (req.cookies?.[STAFF_COOKIE_NAME] as string | undefined) ?? undefined;
    if (!token) throw new HttpError(401, "STAFF_UNAUTH", "Staff auth required");

    const payload = jwt.verify(token, JWT_STAFF_SECRET) as {
      staffId: string;
      venueId: number;
      role: StaffRole;
    };

    const staff = await prisma.staffUser.findUnique({
      where: { id: payload.staffId },
      include: {
        venue: {
          select: { slug: true },
        },
      },
    });
    if (!staff || !staff.isActive) {
      clearStaffCookie(res);
      throw new HttpError(401, "STAFF_INVALID", "Staff session invalid");
    }

    const requestedVenueSlug = String(req.headers["x-venue-slug"] ?? "").trim();
    if (requestedVenueSlug) {
      const requestedVenue = resolveVenueSlug(requestedVenueSlug);
      if (!requestedVenue) {
        clearStaffCookie(res);
        throw new HttpError(400, "INVALID_BRANCH", "Invalid branch");
      }
      const staffVenueSlug = normalizeVenueSlug(staff.venue?.slug ?? null);
      if (staffVenueSlug !== requestedVenue) {
        clearStaffCookie(res);
        throw new HttpError(409, "STAFF_BRANCH_MISMATCH", "Staff session belongs to another branch");
      }
    }

    req.staff = { staffId: staff.id, venueId: staff.venueId, role: staff.role };
    next();
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
      clearStaffCookie(res);
    }
    next(e);
  }
};

export function requireStaffRole(roles: StaffRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.staff) return next(new HttpError(401, "STAFF_UNAUTH", "Staff auth required"));
    if (!roles.includes(req.staff.role)) return next(new HttpError(403, "STAFF_FORBIDDEN", "Forbidden"));
    next();
  };
}

export const requireManagerOnly = requireStaffRole(["MANAGER"]);
export const requireAdminOnly = requireStaffRole(["ADMIN"]);
export const requireAdminOrManager = requireStaffRole(["ADMIN", "MANAGER"]);
