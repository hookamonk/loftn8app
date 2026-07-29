import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../../utils/httpError";

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new HttpError(401, "AUTH_REQUIRED", "User authentication required"));
  }
  next();
}