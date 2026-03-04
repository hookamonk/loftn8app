import { ApiResult } from "@/lib/staffApi";
import { primeAlerts } from "@/lib/staffAlerts"; // ✅ add (звук/вибро разблок)

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4000";

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

export async function getVapidKey(): Promise<ApiResult<{ publicKey: string }>> {
  return apiFetch<{ ok: true; publicKey: string }>("/staff/push/vapid-public-key").then((r) =>
    r.ok ? { ok: true, data: { publicKey: (r.data as any).publicKey } } : r
  );
}

export async function subscribePush(sub: PushSubscription): Promise<ApiResult<{ ok: true }>> {
  const json = sub.toJSON() as any;
  return apiFetch<{ ok: true }>("/staff/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
}

export async function sendTestPush(): Promise<ApiResult<{ ok: true; sent?: number }>> {
  // ✅ правильный endpoint из backend: POST /staff/push/test-send
  return apiFetch<{ ok: true; sent?: number }>("/staff/push/test-send", { method: "POST" });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export async function ensurePushSubscribed(): Promise<ApiResult<{ ok: true }>> {
  if (!("serviceWorker" in navigator)) return { ok: false, error: "NO_SW", status: 400 };
  if (!("PushManager" in window)) return { ok: false, error: "NO_PUSH", status: 400 };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "NOT_ALLOWED", status: 403 };

  // ✅ важно: вызвать из user gesture (кнопка) — разблокирует звук/вибро
  await primeAlerts();

  const reg = await navigator.serviceWorker.register("/sw.js");
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const r = await subscribePush(existing);
    return r.ok ? { ok: true, data: { ok: true } } : r;
  }

  const keyRes = await getVapidKey();
  if (!keyRes.ok) return keyRes as any;

  const appServerKey = urlBase64ToUint8Array(keyRes.data.publicKey);

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: appServerKey,
  });

  const r = await subscribePush(sub);
  return r.ok ? { ok: true, data: { ok: true } } : r;
}
