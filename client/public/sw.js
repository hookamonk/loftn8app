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
    kind: "CALL_CREATED",
    message: null,
    tableCode: null,
    vibrate: [320, 140, 320, 140, 420],
    requireInteraction: true,
    renotify: true,
  };

  try {  
    payload = event.data ? event.data.json() : payload;
  } catch {}

  const title = payload.title || "Loft N8";
  const tag = payload.tag || `evt:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const ts = payload.ts || Date.now();
  const url = payload.url || "/staff/summary";
  const vibrate =
    Array.isArray(payload.vibrate) && payload.vibrate.length > 0
      ? payload.vibrate
      : [320, 140, 320, 140, 420];

  const options = {
    body: payload.body || "",
    data: {
      url,
      tag,
      ts,
      kind: payload.kind || "CALL_CREATED",
      message: payload.message || null,
      tableCode: payload.tableCode || null,
      vibrate,
    },
    tag,
    renotify: payload.renotify !== false,
    requireInteraction: payload.requireInteraction !== false,
    vibrate,
    silent: false,
    timestamp: ts,
    badge: "/logo.svg",
    icon: "/logo.svg",
    actions: [{ action: "open", title: "Open" }],
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
            kind: payload.kind || "CALL_CREATED",
            message: payload.message || null,
            tableCode: payload.tableCode || null,
            vibrate,
          },
        });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/staff/summary";
  const payload = {
    url,
    tag: event.notification.data?.tag || null,
    ts: Date.now(),
    kind: event.notification.data?.kind || "CALL_CREATED",
    message: event.notification.data?.message || null,
    tableCode: event.notification.data?.tableCode || null,
    vibrate: event.notification.data?.vibrate || [320, 140, 320, 140, 420],
  };

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const c of clientsArr) {
        if ("focus" in c) {
          c.focus();
          c.postMessage({
            type: "STAFF_PUSH",
            payload,
          });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
