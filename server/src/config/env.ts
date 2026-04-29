import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  JWT_GUEST_SESSION_SECRET: z.string().min(20),
  JWT_USER_SECRET: z.string().min(20),
  JWT_STAFF_SECRET: z.string().min(20),
  GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES: z.coerce.number().int().positive().default(30),

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

  //Web Push
  VAPID_SUBJECT: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
