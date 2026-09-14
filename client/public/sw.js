/**
 * LOFT№8 staff service worker.
 *
 * Handles web push for the staff dashboard on every platform that supports it:
 *   • Android: Chrome, Edge, Samsung Internet, Brave, Opera, Firefox — works in
 *     a normal browser tab, no install needed.
 *   • iOS / iPadOS 16.4+: works ONLY when the app was added to the Home Screen
 *     (Apple restriction — Safari tabs cannot receive web push at all).
 *   • Desktop: all Chromium browsers, Firefox, Safari 16+.
 */

const VAPID_ENDPOINT = "/api/staff/push/vapid-public-key";
const SUBSCRIBE_ENDPOINT = "/api/staff/push/subscribe";

// Notification icons MUST be PNG — Chrome on Android silently ignores SVG and
// falls back to the generic browser logo.
const ICON = "/icon-192.png";
const BADGE = "/icon-192.png";
const DEFAULT_VIBRATE = [320, 140, 320, 140, 420];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function readPayload(event) {
  const fallback = {
    title: "LOFT№8",
    body: "Новое событие",
    url: "/staff/summary",
    kind: "CALL_CREATED",
  };

  if (!event.data) return fallback;

  try {
    return event.data.json();
  } catch {
    // Some providers deliver plain text — never drop the notification for it.
    try {
      return { ...fallback, body: event.data.text() || fallback.body };
    } catch {
      return fallback;
    }
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);

  const title = payload.title || "LOFT№8";
  const tag = payload.tag || `evt:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const ts = payload.ts || Date.now();
  const url = payload.url || "/staff/summary";
  const vibrate =
    Array.isArray(payload.vibrate) && payload.vibrate.length > 0 ? payload.vibrate : DEFAULT_VIBRATE;

  const data = {
    url,
    tag,
    ts,
    kind: payload.kind || "CALL_CREATED",
    message: payload.message || null,
    tableCode: payload.tableCode || null,
    venueId: payload.venueId || null,
    venueSlug: payload.venueSlug || null,
    vibrate,
  };

  const options = {
    body: payload.body || "",
    data,
    tag,
    // renotify + a stable tag: the same event never double-alerts, but a NEW
    // event with a different tag always beeps again.
    renotify: payload.renotify !== false,
    requireInteraction: payload.requireInteraction !== false,
    vibrate,
    silent: false,
    timestamp: ts,
    badge: BADGE,
    icon: ICON,
    actions: [{ action: "open", title: "Открыть" }],
  };

  event.waitUntil(
    (async () => {
      // Showing a notification is mandatory: a push handler that stays silent
      // makes the browser display "site updated in background" and can revoke
      // the push permission after repeated offences.
      await self.registration.showNotification(title, options);

      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "STAFF_PUSH", payload: { ...data, title: payload.title, body: payload.body } });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const url = data.url || "/staff/summary";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "STAFF_PUSH", payload: { ...data, ts: Date.now() } });
          if ("navigate" in client && url) {
            try {
              await client.navigate(url);
            } catch {
              // cross-origin or unsupported — focusing is enough
            }
          }
          return;
        }
      }

      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});

/**
 * The browser may rotate a push subscription at any time (key rotation, storage
 * pressure, long inactivity). Without re-subscribing here the device silently
 * stops receiving notifications FOREVER — the single most common cause of
 * "push worked yesterday, not today".
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let subscription = event.newSubscription ?? null;

        if (!subscription) {
          const res = await fetch(VAPID_ENDPOINT, { credentials: "include" });
          if (!res.ok) return;
          const { publicKey } = await res.json();
          if (!publicKey) return;

          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }

        const json = subscription.toJSON();
        await fetch(SUBSCRIBE_ENDPOINT, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      } catch {
        // Best effort — the app re-validates the subscription on every launch.
      }
    })()
  );
});
