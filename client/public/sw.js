self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Loft N8",
    body: "Новое событие",
    url: "/staff/summary",
    tag: null,
    ts: null,
  };

  try {
    payload = event.data ? event.data.json() : payload;
  } catch {}

  const title = payload.title || "Loft N8";
  const tag = payload.tag || `evt:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const ts = payload.ts || Date.now();
  const url = payload.url || "/staff/summary";

  const options = {
    body: payload.body || "",
    data: { url, tag, ts },
    tag,
    renotify: true,
    requireInteraction: false,
    vibrate: [160, 80, 160],
    timestamp: ts,
    badge: "/icon.png",
    icon: "/icon.png",
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      const clientsArr = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const c of clientsArr) {
        c.postMessage({
          type: "STAFF_PUSH",
          payload: {
            title: payload.title,
            body: payload.body,
            url,
            tag,
            ts,
          },
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/staff/summary";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if ("focus" in c) {
          c.focus();
          c.postMessage({
            type: "STAFF_PUSH",
            payload: {
              url,
              ts: Date.now(),
            },
          });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});