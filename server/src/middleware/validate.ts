import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";

type Where = "body" | "query" | "params";

export function validate(schema: ZodSchema, where: Where = "body") {
	return (req: Request, res: Response, next: NextFunction) => {
		const data = (req as any)[where];
		const parsed = schema.safeParse(data);
		if (!parsed.success) {
			return res.status(400).json({
				error: "VALIDATION_ERROR",
				issues: parsed.error.issues,
			});
		}
		(req as any)[where] = parsed.data;
		next();
	};
}
