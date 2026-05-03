import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";

export async function userAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const uid = (req.cookies?.uid as string | undefined) ?? undefined;
    if (!uid) {
      throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required");
    }

    const payload = jwt.verify(uid, env.JWT_USER_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required");
    }

    req.user = user;
    next();
  } catch (error) {
    next(
      error instanceof HttpError
        ? error
        : new HttpError(401, "AUTH_REQUIRED", "Authentication is required")
    );
  }
}
