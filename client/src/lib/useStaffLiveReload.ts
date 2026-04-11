"use client";

import { useEffect, useRef } from "react";
import { fireInAppAlert, type StaffPushPayload } from "@/lib/staffAlerts";
import { getStaffVenueSlug, resolveVenueSlug } from "@/lib/venue";

type Msg =
  | { type: "STAFF_PUSH"; payload?: StaffPushPayload }
  | { type: "STAFF_OPEN_URL"; payload?: { url?: string } };

export function useStaffLiveReload(load: () => void | Promise<void>, intervalMs = 8000) {
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;

    const safeLoad = () => {
      if (!alive) return;
      void loadRef.current();
    };

    // polling fallback
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") safeLoad();
    }, intervalMs);

    // обновить при возвращении
    const onFocus = () => {
      if (document.visibilityState === "visible") safeLoad();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    // push -> auto-refresh + звук/вибро
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data as Msg | undefined;
      if (!data || typeof data !== "object") return;

      if (data.type === "STAFF_PUSH") {
        const payloadVenue = resolveVenueSlug(data.payload?.venueSlug ?? null);
        if (payloadVenue && payloadVenue !== getStaffVenueSlug()) {
          return;
        }
        fireInAppAlert(data.payload);
        safeLoad();
      }

      if (data.type === "STAFF_OPEN_URL") {
        const url = data.payload?.url;
        if (url && typeof window !== "undefined") {
          // мягко открываем нужную страницу
          window.location.href = url;
        }
      }
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, [intervalMs]);
}
