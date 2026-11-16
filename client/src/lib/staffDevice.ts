"use client";

/**
 * A random id for this browser, sent with every staff request. Whoever does
 * something here gets no alert about it on this device; colleagues on the
 * same shared login still do.
 */
const KEY = "staff_device_id";
let cached: string | null = null;

function makeId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function getStaffDeviceId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return (cached = stored);
    const id = makeId();
    window.localStorage.setItem(KEY, id);
    return (cached = id);
  } catch {
    return (cached = makeId());
  }
}
