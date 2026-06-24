import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/httpError";

export function errorHandler(
	err: unknown,
	_req: Request,
	res: Response,
	_next: NextFunction,
) {
	if (err instanceof HttpError) {
		return res
			.status(err.status)
			.json({ error: err.code, message: err.message });
	}

	console.error("Unhandled error:", err);
	return res
		.status(500)
		.json({ error: "INTERNAL_SERVER_ERROR", message: "Something went wrong" });
}
