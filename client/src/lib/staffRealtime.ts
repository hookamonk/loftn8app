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

    if (msg.type === "STAFF_PUSH") {
      handler((msg.payload || {}) as StaffPushEvent);
    }
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}