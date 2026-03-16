"use client";

import { useEffect } from "react";
import { fireInAppAlert } from "@/lib/staffAlerts";

export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
};

export function useStaffPushEvents(onEvent?: (p: StaffPushPayload) => void) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== "STAFF_PUSH") return;

      const payload = (data.payload ?? {}) as StaffPushPayload;

      if (document.visibilityState === "visible") {
        fireInAppAlert(payload);
      }

      onEvent?.(payload);
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [onEvent]);
}