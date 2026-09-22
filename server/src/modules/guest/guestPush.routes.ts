import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { userAuth } from "../../middleware/auth/userAuth";

/**
 * Web-push subscriptions for registered guests. Mounted under /guest/push.
 * Only the account cookie is required — a guest may (re)subscribe from the
 * cabinet without an open table session.
 */
export const guestPushRouter = Router();

guestPushRouter.get(
  "/vapid-public-key",
  asyncHandler(async (_req, res) => {
    const key = env.VAPID_PUBLIC_KEY;
    if (!key) throw new HttpError(500, "VAPID_NOT_CONFIGURED", "VAPID_PUBLIC_KEY missing");
    res.json({ publicKey: key });
  })
);

const LangSchema = z.enum(["cs", "en"]);

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
  // Optional so the service worker can re-register a rotated subscription
  // without knowing the guest's language; the app fixes it on next launch.
  lang: LangSchema.optional(),
});

guestPushRouter.post(
  "/subscribe",
  userAuth,
  validate(SubscribeSchema),
  asyncHandler(async (req, res) => {
    const sub = req.body as z.infer<typeof SubscribeSchema>;
    const userId = req.user!.id;
    const userAgent = String(req.headers["user-agent"] ?? "");

    await prisma.guestPushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: {
        userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
        ...(sub.lang ? { lang: sub.lang } : {}),
      },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
        lang: sub.lang ?? "cs",
      },
    });

    res.json({ ok: true });
  })
);

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

guestPushRouter.post(
  "/unsubscribe",
  userAuth,
  validate(UnsubscribeSchema),
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body as z.infer<typeof UnsubscribeSchema>;
    // Only the owner may remove their own device.
    await prisma.guestPushSubscription
      .deleteMany({ where: { endpoint, userId: req.user!.id } })
      .catch(() => {});
    res.json({ ok: true });
  })
);
