"use client";

import { useEffect, useRef } from "react";
import type { StaffAlertKind } from "@/lib/staffAlerts";
import type { MenuSection } from "@/types";
import { getStaffDeviceId } from "@/lib/staffDevice";

export type StaffRealtimeEvent = {
  kind: StaffAlertKind | "DATA_CHANGED";
  venueId: number;
  at: number;
  tableCode?: string | null;
  // Stable per-entity tag (e.g. `call_new:<id>`), shared with the web-push
  // payload so alerts dedupe across channels without merging distinct events.
  tag?: string | null;
  /** Hookah or drinks / food — the bar tablet sounds a hookah differently. */
  station?: MenuSection | null;
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
 * The stream is already venue- and role-scoped on the server (the SSE
 * connection is bound to the staff member's venue and role via their session
 * cookie), so only this branch's events meant for this account arrive here.
 */
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let attempts = 0;
let reconnectTimer: number | null = null;

// The server sends a ping every 25 s. A connection that stays silent much
// longer is dead (Wi-Fi switched, tablet slept) even if the browser still
// calls it open — drop it and connect again.
const SILENT_LIMIT_MS = 70_000;
// After the screen was off / the app in background this long, start a fresh
// connection instead of trusting the old one.
const RESUME_RECONNECT_MS = 15_000;
let lastFrameAt = 0;
// Only a server that sends visible pings can be judged by silence.
let pingSeen = false;
let hiddenAt = 0;
let watchdog: number | null = null;
let lifecycleBound = false;

function restart() {
  if (listeners.size === 0) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
  attempts = 0;
  connect();
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    return;
  }
  const wasHidden = hiddenAt;
  hiddenAt = 0;
  if (wasHidden && Date.now() - wasHidden >= RESUME_RECONNECT_MS) restart();
}

function onOnline() {
  restart();
}

function bindLifecycle() {
  if (lifecycleBound) return;
  lifecycleBound = true;
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  watchdog = window.setInterval(() => {
    if (!es || !pingSeen || document.visibilityState !== "visible") return;
    if (Date.now() - lastFrameAt > SILENT_LIMIT_MS) restart();
  }, 10_000);
}

function unbindLifecycle() {
  if (!lifecycleBound) return;
  lifecycleBound = false;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("online", onOnline);
  if (watchdog !== null) window.clearInterval(watchdog);
  watchdog = null;
}

function handleFrame(ev: MessageEvent) {
  attempts = 0;
  lastFrameAt = Date.now();
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

  bindLifecycle();
  lastFrameAt = Date.now();
  pingSeen = false;
  // The device id: the server leaves this device out of alerts it caused itself.
  es = new EventSource(`/api/staff/dashboard/events?device=${encodeURIComponent(getStaffDeviceId())}`, {
    withCredentials: true,
  });
  es.addEventListener("staff", handleFrame as EventListener);
  es.addEventListener("ready", () => {
    attempts = 0;
    lastFrameAt = Date.now();
  });
  es.addEventListener("ping", () => {
    pingSeen = true;
    lastFrameAt = Date.now();
  });
  es.onopen = () => {
    attempts = 0;
    lastFrameAt = Date.now();
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
  unbindLifecycle();
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
