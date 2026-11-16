"use client";

import { useEffect, useRef } from "react";

/**
 * The open staff screen registers how to refresh itself with fresh data.
 * After an alert the shell refreshes every registered screen at once and
 * sounds the alert when they are done — the order / call / bill is on screen
 * together with its sound.
 */
type Refresher = () => Promise<unknown>;

const refreshers = new Set<Refresher>();

export function useScreenRefresh(refresh: Refresher, enabled = true) {
  const ref = useRef(refresh);
  useEffect(() => {
    ref.current = refresh;
  });

  useEffect(() => {
    if (!enabled) return;
    const run: Refresher = () => ref.current();
    refreshers.add(run);
    return () => {
      refreshers.delete(run);
    };
  }, [enabled]);
}

/** Refresh every open screen; resolves when all of them are done (errors ignored). */
export async function refreshScreens(): Promise<void> {
  await Promise.all(Array.from(refreshers).map((run) => run().catch(() => {})));
}
