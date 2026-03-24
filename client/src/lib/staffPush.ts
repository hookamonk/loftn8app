import type { ApiResult } from "@/lib/staffApi";
import { primeAlerts } from "@/lib/staffAlerts";

const API_BASE = "/api";

function isAppleMobile() {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchMac = platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return /iPhone|iPad|iPod/i.test(ua) || touchMac;
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || `HTTP_${res.status}`;
    return { ok: false, error: msg, status: res.status };
  }

  return { ok: true, data: json as T };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export async function getVapidKey(): Promise<ApiResult<{ publicKey: string }>> {
  return apiFetch<{ publicKey: string }>("/staff/push/vapid-public-key");
}

export async function subscribePush(sub: PushSubscription): Promise<ApiResult<{ ok: true }>> {
  const json = sub.toJSON() as any;

  return apiFetch<{ ok: true }>("/staff/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
}

export async function ensurePushSubscribed(): Promise<ApiResult<{ ok: true }>> {
  if (typeof window === "undefined") return { ok: false, error: "NO_WINDOW", status: 400 };
  if (!("Notification" in window)) return { ok: false, error: "NO_NOTIFICATION_API", status: 400 };
  if (!("serviceWorker" in navigator)) return { ok: false, error: "NO_SW", status: 400 };
  if (!("PushManager" in window)) return { ok: false, error: "NO_PUSH", status: 400 };
  if (isAppleMobile() && !isStandaloneMode()) {
    return { ok: false, error: "IOS_HOME_SCREEN_REQUIRED", status: 400 };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "NOT_ALLOWED", status: 403 };
  }

  await primeAlerts();

  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await reg.update().catch(() => {});
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    const keyRes = await getVapidKey();
    if (!keyRes.ok) return keyRes as any;

    const appServerKey = urlBase64ToUint8Array(keyRes.data.publicKey);

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  const saveRes = await subscribePush(sub);
  if (!saveRes.ok) return saveRes;

  return { ok: true, data: { ok: true } };
}

export async function rebindPushIfPossible(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ||
      (await navigator.serviceWorker.getRegistration());

    if (!reg) return;

    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    await subscribePush(sub);
  } catch {
    // ignore
  }
} 
