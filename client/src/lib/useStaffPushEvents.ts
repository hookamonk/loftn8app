"use client";

import { useEffect } from "react";
import { fireInAppAlert } from "@/lib/staffAlerts";
import { getStaffVenueSlug, resolveVenueSlug } from "@/lib/venue";

export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
  kind?: "ORDER_CREATED" | "CALL_CREATED" | "GUEST_MESSAGE" | "PAYMENT_REQUESTED";
  venueId?: number | null;
  venueSlug?: string | null;
};

export function useStaffPushEvents(onEvent?: (p: StaffPushPayload) => void) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== "STAFF_PUSH") return;

      const payload = (data.payload ?? {}) as StaffPushPayload;
      const payloadVenue = resolveVenueSlug(payload.venueSlug ?? null);
      if (payloadVenue && payloadVenue !== getStaffVenueSlug()) {
        return;
      }

      if (document.visibilityState === "visible") {
        fireInAppAlert(payload);
      }

      onEvent?.(payload);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [onEvent]);
}
