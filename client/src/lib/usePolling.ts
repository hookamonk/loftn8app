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
    return visible && online ? activeMs : idleMs;
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
    if (inFlightRef.current) {
      rerunRequestedRef.current = true;
      return;
    }

    inFlightRef.current = true;

    try {
      await fnRef.current();
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
