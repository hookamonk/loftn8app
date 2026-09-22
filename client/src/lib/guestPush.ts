"use client";

import {
  SW_URL,
  ensureServiceWorker,
  hasPushApi,
  isAppleMobile,
  isStandaloneMode,
  urlBase64ToUint8Array,
} from "@/lib/pushPlatform";

/**
 * Web push for GUESTS — order progress, accepted calls, payment outcome.
 *
 * Design constraints:
 *   • The browser shows its own permission dialog and only from a user tap, so
 *     the prompt is armed inside the tap that signs the guest in (or their
 *     first "call the waiter"), never from a button of our own.
 *   • Asked at most once per device. A dismissed or blocked prompt is never
 *     repeated — that is the guest's (and the browser's) decision.
 *   • iPhone in a Safari tab cannot receive web push at all (Apple allows it
 *     only for Home-Screen apps), so the whole flow is skipped there. In-app
 *     toasts still cover those guests while the app is open.
 */

const API_BASE = "/api";
const ASKED_KEY = "loftn8GuestPushAsked";

type Permission = NotificationPermission | "unsupported";

export type GuestPushOptIn = { permission: Promise<Permission> };

function normalizeLang(lang: string | null | undefined): "cs" | "en" {
  return String(lang ?? "").toLowerCase().startsWith("en") ? "en" : "cs";
}

export function guestPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (isAppleMobile() && !isStandaloneMode()) return false;
  return hasPushApi();
}

function wasAsked(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // ignore storage failures
  }
}

/**
 * Arm the permission prompt. MUST be called synchronously inside a tap handler,
 * before the first `await` — Safari drops the user-activation flag after an
 * awaited call and then silently refuses to show its dialog.
 */
export function beginGuestPushOptIn(): GuestPushOptIn {
  if (!guestPushSupported()) return { permission: Promise.resolve("unsupported") };

  const current = Notification.permission;
  if (current !== "default") return { permission: Promise.resolve(current) };
  if (wasAsked()) return { permission: Promise.resolve(current) };

  markAsked();

  try {
    return {
      permission: Promise.resolve(Notification.requestPermission()).catch(
        () => "default" as NotificationPermission
      ),
    };
  } catch {
    return { permission: Promise.resolve("default") };
  }
}

let cachedVapidKey: string | null = null;

async function fetchVapidKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;

  try {
    const res = await fetch(`${API_BASE}/guest/push/vapid-public-key`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: string };
    cachedVapidKey = data.publicKey || null;
    return cachedVapidKey;
  } catch {
    return null;
  }
}

/** Subscribe this browser (or reuse its subscription) and bind it to the account. */
async function subscribeAndRegister(lang: string): Promise<boolean> {
  const reg = await ensureServiceWorker();
  if (!reg) return false;

  let sub = await reg.pushManager.getSubscription().catch(() => null);

  if (!sub) {
    const key = await fetchVapidKey();
    if (!key) return false;

    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch {
      return false;
    }
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys) return false;

  try {
    const res = await fetch(`${API_BASE}/guest/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, lang: normalizeLang(lang) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Finish the flow once the guest is signed in. Waits for the dialog the guest
 * may still be looking at; safe to call without awaiting.
 */
export async function completeGuestPushOptIn(optIn: GuestPushOptIn, lang: string): Promise<void> {
  try {
    const permission = await optIn.permission;
    if (permission !== "granted") return;
    await subscribeAndRegister(lang);
  } catch {
    // best effort — the in-app feed keeps working regardless
  }
}

/**
 * Keep the device bound to the signed-in guest with the current language.
 * Runs on every app open for a signed-in guest who already granted permission;
 * never prompts.
 */
export async function rebindGuestPush(lang: string): Promise<void> {
  try {
    if (!guestPushSupported()) return;
    if (Notification.permission !== "granted") return;
    await subscribeAndRegister(lang);
  } catch {
    // ignore
  }
}

/**
 * Detach this device from the account on sign-out, so a shared phone stops
 * receiving the previous guest's updates. The browser subscription itself is
 * kept: the next guest to sign in simply re-binds it to their account.
 */
export async function disableGuestPushOnLogout(): Promise<void> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const reg =
      (await navigator.serviceWorker.getRegistration(SW_URL)) ||
      (await navigator.serviceWorker.getRegistration());
    if (!reg) return;

    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.toJSON().endpoint;
    if (!endpoint) return;

    await fetch(`${API_BASE}/guest/push/unsubscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  } catch {
    // ignore — sign-out proceeds regardless
  }
}
