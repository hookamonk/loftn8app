"use client";

import { useEffect, useRef } from "react";

/**
 * Realtime channel for the guest via Server-Sent Events. While the cart/call
 * screen is open, the guest gets an instant "refresh now" ping the moment staff
 * change an order/payment/call (or a co-guest at the table acts) — no polling
 * delay, no page reload. Polling stays only as a fallback if the connection drops.
 */
export function useGuestEvents(onPing: () => void, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const onRef = useRef(onPing);
  onRef.current = onPing;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let closed = false;
    let attempts = 0;
    let reconnectTimer: number | null = null;

    const ping = () => {
      attempts = 0;
      onRef.current?.();
    };

    const scheduleReconnect = () => {
      if (closed) return;
      attempts += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    function connect() {
      if (closed) return;

      es = new EventSource("/api/guest/events", { withCredentials: true });

      es.addEventListener("guest", ping);
      es.addEventListener("ready", () => {
        attempts = 0;
      });
      es.onopen = () => {
        attempts = 0;
      };
      es.onerror = () => {
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