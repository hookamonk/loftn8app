import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { requireStaffAuth } from "./staff.middleware";
import { HttpError } from "../../utils/httpError";
import { pushToStaff } from "./push.service";
import { env } from "../../config/env";
import { rateLimit } from "../../middleware/rateLimit";

export const staffPushRouter = Router();

// public key
staffPushRouter.get(
  "/vapid-public-key",
  asyncHandler(async (_req, res) => {
    const key = env.VAPID_PUBLIC_KEY;
    if (!key) throw new HttpError(500, "VAPID_NOT_CONFIGURED", "VAPID_PUBLIC_KEY missing");
    res.json({ publicKey: key });
  })
);

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
});

staffPushRouter.post(
  "/subscribe",
  requireStaffAuth,
  validate(SubscribeSchema),
  asyncHandler(async (req, res) => {
    const sub = req.body as z.infer<typeof SubscribeSchema>;
    const staffId = req.staff!.staffId;
    const venueId = req.staff!.venueId;
    const ua = String(req.headers["user-agent"] ?? "");

    await prisma.staffPushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: {
        staffId,
        venueId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: ua,
      },
      create: {
        staffId,
        venueId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: ua,
      },
    });

    res.json({ ok: true });
  })
);

const UnsubscribeSchema = z.object({ endpoint: z.string().url() });

staffPushRouter.post(
  "/unsubscribe",
  requireStaffAuth,
  validate(UnsubscribeSchema),
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body as z.infer<typeof UnsubscribeSchema>;
    // Only the owner may remove their own subscription — don't let one staff
    // member delete another's by guessing/replaying an endpoint value.
    await prisma.staffPushSubscription
      .deleteMany({ where: { endpoint, staffId: req.staff!.staffId } })
      .catch(() => {});
    res.json({ ok: true });
  })
);

// status
staffPushRouter.get(
  "/me",
  requireStaffAuth,
  asyncHandler(async (req, res) => {
    const staffId = req.staff!.staffId;
    const count = await prisma.staffPushSubscription.count({ where: { staffId } });
    res.json({ ok: true, subscribed: count > 0, count });
  })
);

const TestSendSchema = z.object({
  title: z.string().max(60).optional(),
  body: z.string().max(200).optional(),
  url: z.string().max(200).optional(),
});

// Staff must be able to verify on their OWN phone that notifications really
// arrive — including in production. Safe by construction: it requires a valid
// staff session and only ever pushes to that same staff member's devices.
const testSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyPrefix: "push-test",
  message: "Слишком часто. Подождите минуту и попробуйте снова.",
});

const testSendHandler = asyncHandler(async (req, res) => {
  const staffId = req.staff!.staffId;

  const title = (req.body as any)?.title ?? "LOFT№8 — проверка";
  const body =
    (req.body as any)?.body ??
    `Уведомления работают. ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  const url = (req.body as any)?.url ?? "/staff/summary";

  const { sent, failed, removed } = await pushToStaff(staffId, {
    title,
    body,
    url,
    tag: `push_test:${Date.now()}`,
    ts: Date.now(),
    kind: "CALL_CREATED",
    vibrate: [200, 100, 200],
  });

  res.json({ ok: true, sent, failed, removed });
});

staffPushRouter.post("/test-send", requireStaffAuth, testSendLimiter, validate(TestSendSchema), testSendHandler);
staffPushRouter.post("/dev/send-test", requireStaffAuth, testSendLimiter, validate(TestSendSchema), testSendHandler);
