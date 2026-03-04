"use client";

export type StaffPushEvent = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
};

type Handler = (e: StaffPushEvent) => void;

export function attachStaffRealtime(handler: Handler) {
  if (typeof window === "undefined") return () => {};
  if (!("serviceWorker" in navigator)) return () => {};

  const onMessage = (evt: MessageEvent) => {
    const msg = evt.data;
    if (!msg || typeof msg !== "object") return;

    // ✅ принимаем оба варианта (на случай старого/нового sw.js)
    if (msg.type === "STAFF_PUSH" || msg.type === "STAFF_PUSH_EVENT") {
      handler((msg.payload || {}) as StaffPushEvent);
      return;
    }

    // optional: если захочешь навигацию по клику
    if (msg.type === "STAFF_NAVIGATE") {
      // тут можно делать router.push(msg.url) — но это уже в компоненте, не здесь
      return;
    }
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
