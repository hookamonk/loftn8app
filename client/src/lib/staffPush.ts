import type { ApiResult } from "@/lib/staffApi";
import { primeAlerts } from "@/lib/staffAlerts";
import { getStaffVenueSlug } from "@/lib/venue";

const API_BASE = "/api";
const SW_URL = "/sw.js";

/**
 * Where the staff member is running the dashboard. Web push support differs a
 * lot per platform, and the difference is NOT something a library can paper
 * over — so we detect it explicitly and guide the user instead of failing.
 */
export type PushPlatform = "android" | "ios" | "desktop" | "unknown";

export type PushState =
  /** Browser has no Push API at all (very old browser, or iOS < 16.4). */
  | { status: "unsupported"; platform: PushPlatform; reason: string }
  /** iOS/iPadOS in a Safari tab — Apple only allows push from a Home Screen app. */
  | { status: "ios-needs-install"; platform: "ios"; inSafari: boolean }
  /** The user (or the browser) blocked notifications. */
  | { status: "denied"; platform: PushPlatform }
  /** Server has no VAPID keys — push is disabled backend-side. */
  | { status: "server-not-configured"; platform: PushPlatform }
  /** Supported and allowed, but not subscribed yet. */
  | { status: "off"; platform: PushPlatform }
  /** Fully working. */
  | { status: "on"; platform: PushPlatform };

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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const venueSlug = typeof window !== "undefined" ? getStaffVenueSlug() : undefined;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
        ...(init?.headers || {}),
      },
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON response
    }

    if (!res.ok) {
      const msg = (json && (json.message || json.error)) || `HTTP_${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }

    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "NETWORK_ERROR", status: 0 };
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

let cachedVapidKey: string | null = null;

export async function getVapidKey(): Promise<ApiResult<{ publicKey: string }>> {
  if (cachedVapidKey) return { ok: true, data: { publicKey: cachedVapidKey } };

  const result = await apiFetch<{ publicKey: string }>("/staff/push/vapid-public-key");
  if (result.ok && result.data?.publicKey) cachedVapidKey = result.data.publicKey;
  return result;
}

export async function subscribePush(sub: PushSubscription): Promise<ApiResult<{ ok: true }>> {
  const json = sub.toJSON() as any;

  return apiFetch<{ ok: true }>("/staff/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

function hasPushApi() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
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

/**
 * Current, truthful push state for this device — drives the whole UI. Checks
 * the browser capability, the permission, the live subscription AND that the
 * server actually knows about it.
 */
export async function getPushState(): Promise<PushState> {
  const platform = detectPlatform();

  if (typeof window === "undefined") {
    return { status: "unsupported", platform, reason: "NO_WINDOW" };
  }

  // iOS refuses push outside a Home Screen app — check this BEFORE the generic
  // capability test, because iOS Safari does expose a (useless) PushManager.
  if (isAppleMobile() && !isStandaloneMode()) {
    return { status: "ios-needs-install", platform: "ios", inSafari: !isIosThirdPartyBrowser() };
  }

  if (!hasPushApi()) {
    return { status: "unsupported", platform, reason: "NO_PUSH_API" };
  }

  if (Notification.permission === "denied") {
    return { status: "denied", platform };
  }

  const key = await getVapidKey();
  if (!key.ok) {
    // 500 = keys missing on the server; anything else is a transient network
    // issue and shouldn't be reported as a misconfiguration.
    if (key.status === 500) return { status: "server-not-configured", platform };
    return { status: "off", platform };
  }

  if (Notification.permission !== "granted") {
    return { status: "off", platform };
  }

  const reg = await ensureServiceWorker();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return { status: "off", platform };

  const known = await apiFetch<{ ok: true; subscribed: boolean; count: number }>("/staff/push/me");
  if (known.ok && !known.data.subscribed) {
    // The browser has a subscription the server lost (DB reset, endpoint
    // pruned…) — re-register it silently instead of showing "off".
    await subscribePush(sub);
  }

  return { status: "on", platform };
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; state: PushState }
  | { ok: false; error: string };

/**
 * Full opt-in flow. MUST be called directly from a user gesture (click/tap).
 *
 * Order matters: every synchronous capability check happens first, then the
 * permission prompt and the audio unlock are started BEFORE any await that
 * could outlive the gesture — Safari (and iOS in particular) drops the
 * "user activation" flag after the first awaited network call, which silently
 * turns requestPermission() into a no-op.
 */
export async function enablePush(): Promise<EnablePushResult> {
  const platform = detectPlatform();

  if (typeof window === "undefined") {
    return { ok: false, error: "NO_WINDOW" };
  }

  if (isAppleMobile() && !isStandaloneMode()) {
    return {
      ok: false,
      state: { status: "ios-needs-install", platform: "ios", inSafari: !isIosThirdPartyBrowser() },
    };
  }

  if (!hasPushApi()) {
    return { ok: false, state: { status: "unsupported", platform, reason: "NO_PUSH_API" } };
  }

  if (Notification.permission === "denied") {
    return { ok: false, state: { status: "denied", platform } };
  }

  // Both of these must START synchronously, while the gesture is still valid.
  const audioUnlock = primeAlerts();
  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();

  await audioUnlock.catch(() => {});

  if (permission !== "granted") {
    return {
      ok: false,
      state: { status: permission === "denied" ? "denied" : "off", platform },
    };
  }

  const reg = await ensureServiceWorker();
  if (!reg) return { ok: false, error: "SW_REGISTRATION_FAILED" };

  let sub = await reg.pushManager.getSubscription().catch(() => null);

  if (!sub) {
    const keyRes = await getVapidKey();
    if (!keyRes.ok) {
      if (keyRes.status === 500) {
        return { ok: false, state: { status: "server-not-configured", platform } };
      }
      return { ok: false, error: keyRes.error };
    }

    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey),
      });
    } catch (e: any) {
      return { ok: false, error: e?.message || "SUBSCRIBE_FAILED" };
    }
  }

  const saveRes = await subscribePush(sub);
  if (!saveRes.ok) return { ok: false, error: saveRes.error };

  return { ok: true };
}

/** Ask the server to push a notification back to this staff member's devices. */
export async function sendTestPush(): Promise<ApiResult<{ sent: number; failed: number; removed: number }>> {
  return apiFetch<{ ok: true; sent: number; failed: number; removed: number }>("/staff/push/test-send", {
    method: "POST",
    body: JSON.stringify({}),
  }).then((r) =>
    r.ok ? { ok: true, data: { sent: r.data.sent, failed: r.data.failed, removed: r.data.removed } } : r
  );
}

export async function unsubscribePushOnLogout(): Promise<void> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const reg =
      (await navigator.serviceWorker.getRegistration(SW_URL)) ||
      (await navigator.serviceWorker.getRegistration());
    if (!reg) return;

    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    const endpoint = (sub.toJSON() as any).endpoint as string | undefined;
    await sub.unsubscribe().catch(() => {});
    if (endpoint) {
      await apiFetch("/staff/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  } catch {
    // ignore — logout proceeds regardless
  }
}

/**
 * Re-attach the existing browser subscription to the current staff account.
 * Run on every dashboard launch: it repairs the common silent-failure cases
 * (shared phone, rotated subscription, server-side row pruned).
 */
export async function rebindPushIfPossible(): Promise<void> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (isAppleMobile() && !isStandaloneMode()) return;
    if (!hasPushApi() || Notification.permission !== "granted") return;

    const reg = await ensureServiceWorker();
    if (!reg) return;

    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    await subscribePush(sub);
  } catch {
    // ignore
  }
}
