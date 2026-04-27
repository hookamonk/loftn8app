"use client";

const STAFF_LIVE_SYNC_EVENT = "loftn8:staff-live-sync";

export function emitStaffLiveSync(reason: string) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(STAFF_LIVE_SYNC_EVENT, {
      detail: {
        reason,
        at: Date.now(),
      },
    })
  );
}

export function subscribeStaffLiveSync(listener: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => listener();
  window.addEventListener(STAFF_LIVE_SYNC_EVENT, handler);
  return () => window.removeEventListener(STAFF_LIVE_SYNC_EVENT, handler);
}
