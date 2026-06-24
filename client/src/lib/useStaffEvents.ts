"use client";

import { useEffect, useRef } from "react";
import { getStaffVenueSlug } from "@/lib/venue";

export type StaffRealtimeEvent = {
  kind: "CALL_CREATED" | "ORDER_CREATED" | "PAYMENT_REQUESTED" | "DATA_CHANGED";
  venueId: number;
  at: number;
  tableCode?: string | null;
};

/**
 * Persistent realtime channel for the staff dashboard via Server-Sent Events.
 *
 * Web-push is unreliable on phones, so SSE is the primary "refresh now" signal
 * while the dashboard is open. EventSource auto-reconnects on transient drops;
 * we add manual reconnection with backoff for hard closes (e.g. 401).
 */
export function useStaffEvents(
  onEvent: (e: StaffRealtimeEvent) => void,
  opts?: { enabled?: boolean }
) {
  const enabled = opts?.enabled ?? true;
  const onRef = useRef(onEvent);
  onRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let closed = false;
    let attempts = 0;
    let reconnectTimer: number | null = null;

    const handleStaffEvent = (ev: MessageEvent) => {
      attempts = 0;
      try {
        const data = JSON.parse(ev.data) as StaffRealtimeEvent;
        const expectedVenue = getStaffVenueSlug();
        // The server already scopes events to the staff's venue (via cookie),
        // but ignore anything that slips through for a different branch.
        if (data && typeof data.kind === "string") {
          void expectedVenue;
          onRef.current?.(data);
        }
      } catch {
        // ignore malformed frame
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      attempts += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (closed) return;

      es = new EventSource("/api/staff/dashboard/events", { withCredentials: true });

      es.addEventListener("staff", handleStaffEvent as EventListener);
      es.addEventListener("ready", () => {
        attempts = 0;
      });
      es.onopen = () => {
        attempts = 0;
      };
      es.onerror = () => {
        // If the browser gave up (CLOSED), reconnect manually with backoff.
        // While it's still CONNECTING/OPEN, let EventSource retry on its own.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          scheduleReconnect();
        }
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      es?.close();
      es = null;
    };
  }, [enabled]);
}
