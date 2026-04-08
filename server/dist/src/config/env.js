"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const EnvSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "test", "production"]).default("development"),
    PORT: zod_1.z.coerce.number().default(4000),
    FRONTEND_ORIGIN: zod_1.z.string().default("http://localhost:3000"),
    DATABASE_URL: zod_1.z.string().min(1),
    JWT_GUEST_SESSION_SECRET: zod_1.z.string().min(20),
    JWT_USER_SECRET: zod_1.z.string().min(20),
    JWT_STAFF_SECRET: zod_1.z.string().min(20),
    COOKIE_DOMAIN: zod_1.z.string().optional().or(zod_1.z.literal("")).optional(),
    //Web Push
    VAPID_SUBJECT: zod_1.z.string().optional(),
    VAPID_PUBLIC_KEY: zod_1.z.string().optional(),
    VAPID_PRIVATE_KEY: zod_1.z.string().optional(),
});
exports.env = EnvSchema.parse(process.env);
