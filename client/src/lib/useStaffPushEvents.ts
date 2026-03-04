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
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      if (data.type === "STAFF_PUSH") {
        const p = (data.payload ?? {}) as StaffPushPayload;

        // звук/вибро имеет смысл только когда вкладка открыта
        if (document.visibilityState === "visible") {
          fireInAppAlert(p);
        }

        onEvent?.(p);
      }
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [onEvent]);
}
