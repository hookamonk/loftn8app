"use client";

import { getStaffVenueSlug, resolveVenueSlug } from "@/lib/venue";

export type StaffPushEvent = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
  venueId?: number | null;
  venueSlug?: string | null;
};

type Handler = (e: StaffPushEvent) => void;

export function attachStaffRealtime(handler: Handler) {
  if (typeof window === "undefined") return () => {};
  if (!("serviceWorker" in navigator)) return () => {};

  const onMessage = (evt: MessageEvent) => {
    const msg = evt.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "STAFF_PUSH") {
      const payload = (msg.payload || {}) as StaffPushEvent;
      const payloadVenue = resolveVenueSlug(payload.venueSlug ?? null);
      if (payloadVenue && payloadVenue !== getStaffVenueSlug()) {
        return;
      }
      handler(payload);
    }
  };

  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
