import type { Request } from "express";

/**
 * The browser a staff request comes from (a random id the app keeps in the
 * browser). Whoever does something gets no alert about it on that device —
 * while the colleagues on the same shared login still do.
 */
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function cleanDeviceId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && DEVICE_ID.test(raw) ? raw : null;
}

export function staffDeviceOf(req: Request): string | null {
  return cleanDeviceId(req.header("x-staff-device"));
}
