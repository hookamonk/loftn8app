"use client";

/**
 * Platform detection and service-worker plumbing shared by the staff and the
 * guest push flows. Web push support differs a lot per platform and the
 * difference is NOT something a library can paper over, so it is detected
 * explicitly here and both flows guide the user instead of failing silently.
 */

export type PushPlatform = "android" | "ios" | "desktop" | "unknown";

export const SW_URL = "/sw.js";

function ua() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
}

export function isAppleMobile() {
  if (typeof navigator === "undefined") return false;

  const agent = ua();
  // iPadOS 13+ reports itself as a Mac — the touch-point count gives it away.
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(agent) || touchMac;
}

/**
 * On iOS every browser (Chrome, Firefox, Edge, Opera…) is Safari underneath,
 * but only real Safari can "Add to Home Screen". Detect the third-party skins
 * so we can tell the user to reopen the page in Safari.
 */
export function isIosThirdPartyBrowser() {
  if (!isAppleMobile()) return false;
  return /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua());
}

export function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectPlatform(): PushPlatform {
  if (isAppleMobile()) return "ios";
  if (/Android/i.test(ua())) return "android";
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)")?.matches) return "desktop";
  return "unknown";
}

export function hasPushApi() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/** Register (or reuse) the service worker. Safe to call repeatedly. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    const reg = existing ?? (await navigator.serviceWorker.register(SW_URL, { scope: "/" }));
    await reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}
