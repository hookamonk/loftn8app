import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	PORT: z.coerce.number().default(4000),
	FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),

	DATABASE_URL: z.string().min(1),

	JWT_GUEST_SESSION_SECRET: z.string().min(20),
	JWT_USER_SECRET: z.string().min(20),
	JWT_STAFF_SECRET: z.string().min(20),
	// After the bill is fully paid the guest is prompted to stay or leave; if
	// they make no choice the session auto-ends this many minutes later.
	GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES: z.coerce
		.number()
		.int()
		.positive()
		.default(5),
	// If the guest chose "stay & order more" but then places no new order, the
	// session still auto-ends this many minutes after the last activity, so a
	// guest who stayed and quietly left doesn't keep the table occupied forever.
	GUEST_SESSION_STAY_GRACE_MINUTES: z.coerce
		.number()
		.int()
		.positive()
		.default(20),

	COOKIE_DOMAIN: z.string().optional().or(z.literal("")).optional(),

	SMTP_HOST: z.string().optional(),
	SMTP_PORT: z.coerce.number().optional(),
	SMTP_SECURE: z
		.union([z.string(), z.boolean()])
		.optional()
		.transform((value) => {
			if (typeof value === "boolean") return value;
			if (typeof value === "string") return value === "true" || value === "1";
			return undefined;
		}),
	SMTP_USER: z.string().optional(),
	SMTP_PASS: z.string().optional(),
	SMTP_FROM_EMAIL: z.string().optional(),
	SMTP_FROM_NAME: z.string().optional(),

	// A station ticket nobody has accepted re-alerts the station (and the
	// manager) every this many minutes until someone taps «Принять».
	TICKET_REMINDER_MINUTES: z.coerce.number().positive().default(2),

	// Hookah station (hookah-zone tablet + hookah masters confirming orders).
	// Off for now: a hookah punched in by a waiter or manager just goes on the
	// table's bill — no «Принять / Готово / Выдано», no alerts, no reminders.
	// Set to "on" once the station works.
	HOOKAH_STATION: z
		.string()
		.optional()
		.transform((v) => ["on", "true", "1", "yes"].includes(String(v ?? "").trim().toLowerCase())),

	// "Sign in with Google": the OAuth Web client ID from Google Cloud Console.
	// "Sign in with Apple": the Services ID from the Apple Developer account.
	// Each button appears in the guest app only when its ID is set.
	GOOGLE_CLIENT_ID: z.string().trim().optional().or(z.literal("")),
	APPLE_CLIENT_ID: z.string().trim().optional().or(z.literal("")),
	// Key sets the sign-in tokens are checked against. Only overridden in tests.
	GOOGLE_JWKS_URL: z.string().url().default("https://www.googleapis.com/oauth2/v3/certs"),
	APPLE_JWKS_URL: z.string().url().default("https://appleid.apple.com/auth/keys"),

	//Web Push
	VAPID_SUBJECT: z.string().optional(),
	VAPID_PUBLIC_KEY: z.string().optional(),
	VAPID_PRIVATE_KEY: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
