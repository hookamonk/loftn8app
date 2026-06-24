"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PollingOptions = {
  enabled?: boolean;
  activeMs?: number; // когда вкладка видима + онлайн
  idleMs?: number;   // когда вкладка скрыта или офлайн
  immediate?: boolean;
  jitterMs?: number; // небольшой рандом, чтобы не было "шипов" запросов
};

export function usePolling(
  fn: () => Promise<void> | void,
  opts: PollingOptions = {}
) {
  const {
    enabled = true,
    activeMs = 5000,
    idleMs = 15000,
    immediate = true,
    jitterMs = 250,
  } = opts;

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const lastTickAtRef = useRef(0);
  const failuresRef = useRef(0);
  const [isRunning, setIsRunning] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getNextDelay = useCallback(() => {
    const visible = typeof document !== "undefined" ? document.visibilityState === "visible" : true;
    const online = typeof navigator !== "undefined" ? navigator.onLine : true;
    const base = visible && online ? activeMs : idleMs;

    // Exponential backoff while the poll keeps failing (e.g. server/network
    // down) so we don't hammer a dead endpoint. Resets on the first success.
    const fails = failuresRef.current;
    if (fails > 0) {
      const factor = 2 ** Math.min(fails, 4);
      return Math.min(60_000, base * factor);
    }

    return base;
  }, [activeMs, idleMs]);

  const schedule = useCallback((ms: number) => {
    clear();
    const jitter = Math.floor(Math.random() * jitterMs);
    timerRef.current = window.setTimeout(() => {
      void tick();
    }, ms + jitter);
  }, [clear, jitterMs]);

  const tick = useCallback(async () => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastTickAtRef.current < 1200) return;
    if (inFlightRef.current) {
      rerunRequestedRef.current = true;
      return;
    }

    inFlightRef.current = true;
    lastTickAtRef.current = now;

    try {
      await fnRef.current();
      failuresRef.current = 0;
    } catch {
      // Treat a thrown poll as a transient failure and back off (see getNextDelay).
      failuresRef.current += 1;
    } finally {
      inFlightRef.current = false;

      if (!enabled) return;

      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        schedule(150);
        return;
      }

      schedule(getNextDelay());
    }
  }, [enabled, getNextDelay, schedule]);

  useEffect(() => {
    if (!enabled) return;

    setIsRunning(true);

    if (immediate) void tick();
    else schedule(activeMs);

    const onVis = () => {
      // как только вернулись во вкладку — сразу подтянуть
      if (document.visibilityState === "visible") void tick();
    };
    const onFocus = () => void tick();
    const onOnline = () => void tick();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      setIsRunning(false);
      clear();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeMs, idleMs, immediate, tick, clear]);

  return { tick, isRunning, stop: clear };
}
