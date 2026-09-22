import webpush from "web-push";
import { env } from "../../config/env";

/**
 * Shared web-push transport for staff AND guest notifications.
 *
 * Owns the VAPID setup, the per-send timeout, the single retry on transient
 * errors and the detection of dead endpoints (404 / 410). Who the recipients
 * are and what to do with a dead endpoint is decided by the caller.
 */

export type WebPushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  ts?: number;
  vibrate?: number[];
  requireInteraction?: boolean;
  renotify?: boolean;
  /** Tells the service worker which UI to use. Missing = staff (legacy). */
  audience?: "staff" | "guest";
  [key: string]: unknown;
};

export type WebPushResult = { ok: number; failed: number; removed: number };

const SEND_TIMEOUT_MS = 10_000;
// Push providers occasionally return transient errors; one quick retry covers
// the common case without blocking the request.
const RETRYABLE_PUSH_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_VIBRATE = [320, 140, 320, 140, 420];

let configured = false;

export function isWebPushConfigured() {
  return Boolean(env.VAPID_SUBJECT && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function ensureConfiguredOrThrow() {
  if (configured) return;

  const subject = env.VAPID_SUBJECT;
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;

  if (!subject || !pub || !priv) {
    throw new Error("WebPush not configured: set VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY");
  }

  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export function uniqueTag(base: string) {
  return `${base}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function sendOnce(s: WebPushSubscriptionRow, json: string) {
  await Promise.race([
    webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      json,
      {
        TTL: 60 * 60 * 4,
        urgency: "high" as any,
      }
    ),
    sleep(SEND_TIMEOUT_MS).then(() => {
      throw new Error("PUSH_TIMEOUT");
    }),
  ]);
}

export async function sendWebPush(
  subs: WebPushSubscriptionRow[],
  payload: WebPushPayload,
  opts: {
    /** Called for endpoints the provider reports as gone (404 / 410). */
    onGone: (sub: WebPushSubscriptionRow) => Promise<void>;
  }
): Promise<WebPushResult> {
  if (subs.length === 0) return { ok: 0, failed: 0, removed: 0 };

  ensureConfiguredOrThrow();

  const safePayload: WebPushPayload = {
    ...payload,
    ts: payload.ts ?? Date.now(),
    tag: payload.tag ?? uniqueTag("evt"),
    renotify: payload.renotify ?? true,
    requireInteraction: payload.requireInteraction ?? true,
    vibrate: payload.vibrate ?? DEFAULT_VIBRATE,
  };

  const json = JSON.stringify(safePayload);

  let ok = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendOnce(s, json);
        ok += 1;
      } catch (e: any) {
        const status = e?.statusCode;

        // Endpoint gone — drop it and don't retry.
        if (status === 404 || status === 410) {
          failed += 1;
          removed += 1;
          await opts.onGone(s).catch(() => {});
          console.warn("webpush dropped expired subscription", {
            status,
            endpoint: `${s.endpoint?.slice(0, 60)}...`,
          });
          return;
        }

        // Transient error or timeout — retry once after a short delay.
        if (status === undefined || RETRYABLE_PUSH_STATUS.has(status)) {
          try {
            await sleep(800);
            await sendOnce(s, json);
            ok += 1;
            return;
          } catch (e2: any) {
            failed += 1;
            console.warn("webpush failed after retry", {
              status: e2?.statusCode,
              endpoint: `${s.endpoint?.slice(0, 60)}...`,
              msg: e2?.message,
            });
            return;
          }
        }

        failed += 1;
        console.warn("webpush failed", {
          status,
          endpoint: `${s.endpoint?.slice(0, 60)}...`,
          msg: e?.message,
        });
      }
    })
  );

  return { ok, failed, removed };
}
