"use client";

import { useEffect } from "react";
import { fireInAppAlert, type StaffAlertKind } from "@/lib/staffAlerts";
import { getStaffVenueSlug, resolveVenueSlug } from "@/lib/venue";

export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
  kind?: StaffAlertKind;
  tableCode?: string | null;
  venueId?: number | null;
  venueSlug?: string | null;
};

/**
 * `inAppAlert: false` leaves the sound to the caller (the station screen
 * dedupes push, live channel and its own polling in one place).
 */
export function useStaffPushEvents(
  onEvent?: (p: StaffPushPayload) => void,
  opts?: { inAppAlert?: boolean }
) {
  const inAppAlert = opts?.inAppAlert ?? true;
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

      if (inAppAlert && document.visibilityState === "visible") {
        fireInAppAlert(payload);
      }

      onEvent?.(payload);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [onEvent, inAppAlert]);
}
