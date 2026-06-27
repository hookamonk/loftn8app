"use client";

import { useEffect, useRef } from "react";

export type StaffRealtimeEvent = {
  kind: "CALL_CREATED" | "ORDER_CREATED" | "PAYMENT_REQUESTED" | "DATA_CHANGED";
  venueId: number;
  at: number;
  tableCode?: string | null;
  // Stable per-entity tag (e.g. `call_new:<id>`), shared with the web-push
  // payload so alerts dedupe across channels without merging distinct events.
  tag?: string | null;
};

type Listener = (e: StaffRealtimeEvent) => void;

/**
 * Single, shared realtime channel for the whole staff dashboard via SSE.
 *
 * Every component that calls useStaffEvents subscribes to ONE module-level
 * EventSource (refcounted), instead of opening its own — multiple connections
 * per tab waste server fan-out and risk the browser's 6-connection-per-origin
 * cap (after which new SSE silently fails to connect). The connection opens on
 * the first subscriber and closes when the last one unmounts.
 *
 * The stream is already venue-scoped on the server (the SSE connection is bound
 * to the staff member's venue via their session cookie), so only this branch's
 * events arrive here.
 */
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let attempts = 0;
let reconnectTimer: number | null = null;

function handleFrame(ev: MessageEvent) {
  attempts = 0;
  try {
    const data = JSON.parse(ev.data) as StaffRealtimeEvent;
    if (data && typeof data.kind === "string") {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch {
          // one bad listener must not break the others
        }
      }
    }
  } catch {
    // ignore malformed frame
  }
}

function scheduleReconnect() {
  if (listeners.size === 0) return;
  attempts += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
  reconnectTimer = window.setTimeout(connect, delay);
}

function connect() {
  if (listeners.size === 0 || es) return;

  es = new EventSource("/api/staff/dashboard/events", { withCredentials: true });
  es.addEventListener("staff", handleFrame as EventListener);
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

function teardownIfIdle() {
  if (listeners.size > 0) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  attempts = 0;
}

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

    const listener: Listener = (e) => onRef.current?.(e);
    listeners.add(listener);
    connect();

    return () => {
      listeners.delete(listener);
      teardownIfIdle();
    };
  }, [enabled]);
}
