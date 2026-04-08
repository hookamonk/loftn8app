import webpush from "web-push";
import { prisma } from "../../db/prisma";
import type { StaffRole, MenuSection } from "@prisma/client";
import { env } from "../../config/env";
import { isOrderRequestMessage } from "../orders/orderRequest";
import { publicTableCode } from "../../config/venues";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  ts?: number;
  kind?:
    | "ORDER_CREATED"
    | "CALL_CREATED"
    | "GUEST_MESSAGE"
    | "PAYMENT_REQUESTED";
  message?: string;
  tableCode?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  renotify?: boolean;
};

let configured = false;

function ensureConfiguredOrThrow() {
  if (configured) return;

  const subject = env.VAPID_SUBJECT;
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;

  if (!subject || !pub || !priv) {
    throw new Error("WebPush not configured: set VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY");
  }

  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

function uniq(base: string) {
  return `${base}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
}

function trimMessage(message?: string | null, max = 120) {
  const normalized = String(message ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return null;
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function normalizeCallMessage(type: "WAITER" | "HOOKAH" | "BILL" | "HELP", message?: string | null) {
  const trimmed = trimMessage(message, 110);
  if (!trimmed) return null;

  if (type === "BILL" && trimmed.startsWith("PAYMENT_METHOD:")) {
    const method = trimmed.slice("PAYMENT_METHOD:".length).trim().toUpperCase();
    if (method === "CARD") return "Карта";
    if (method === "CASH") return "Наличные";
  }

  return trimmed;
}

async function sendToSubscriptions(
  subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
) {
  ensureConfiguredOrThrow();

  const safePayload: PushPayload = {
    ...payload,
    ts: payload.ts ?? Date.now(),
    tag: payload.tag ?? uniq("evt"),
    renotify: payload.renotify ?? true,
    requireInteraction: payload.requireInteraction ?? true,
    vibrate: payload.vibrate ?? [320, 140, 320, 140, 420],
  };

  const json = JSON.stringify(safePayload);

  let ok = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          {
            TTL: 60 * 60 * 4,
            urgency: "high" as any,
          }
        );
        ok += 1;
      } catch (e: any) {
        failed += 1;

        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          removed += 1;
          await prisma.staffPushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        }

        console.warn("webpush failed", {
          status,
          endpoint: s.endpoint?.slice(0, 60) + "...",
          msg: e?.message,
        });
      }
    })
  );

  return { ok, failed, removed };
}

export async function pushToStaff(staffId: string, payload: PushPayload) {
  const subs = await prisma.staffPushSubscription.findMany({
    where: { staffId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const r = await sendToSubscriptions(subs, payload);
  return { sent: r.ok, failed: r.failed, removed: r.removed };
}

export async function pushToVenueRoles(venueId: number, roles: StaffRole[], payload: PushPayload) {
  const staff = await prisma.staffUser.findMany({
    where: { venueId, isActive: true, role: { in: roles } },
    select: { id: true },
  });

  const staffIds = staff.map((x) => x.id);
  if (staffIds.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const subs = await prisma.staffPushSubscription.findMany({
    where: { venueId, staffId: { in: staffIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const r = await sendToSubscriptions(subs, payload);
  return { sent: r.ok, failed: r.failed, removed: r.removed };
}

export async function notifyOrderCreated(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      table: { select: { venueId: true, code: true } },
      items: {
        select: {
          menuItem: {
            select: {
              category: { select: { section: true } },
            },
          },
        },
      },
    },
  });
  if (!order) return;

  const venueId = order.table.venueId;
  const tableCode = publicTableCode(order.table.code);

  const sections = order.items.map((it) => it.menuItem.category.section as MenuSection);
  const hasHookah = sections.includes("HOOKAH");
  const hasNonHookah = sections.some((s) => s !== "HOOKAH");

  const roles: StaffRole[] = ["MANAGER"];
  if (hasHookah) roles.push("HOOKAH");
  if (hasNonHookah) roles.push("WAITER");

  await pushToVenueRoles(venueId, Array.from(new Set(roles)), {
    title: "Новый заказ",
    body: `Стол ${tableCode}`,
    url: "/staff/orders",
    tag: `order_new:${order.id}`,
    ts: Date.now(),
    kind: "ORDER_CREATED",
    tableCode,
    vibrate: [240, 120, 240, 120, 360],
  });
}

export async function notifyCallCreated(callId: string) {
  const call = await prisma.staffCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      type: true,
      message: true,
      table: { select: { venueId: true, code: true } },
    },
  });
  if (!call) return;

  const venueId = call.table.venueId;
  const tableCode = publicTableCode(call.table.code);
  const isOrderRequest = call.type === "HELP" && isOrderRequestMessage(call.message);

  const roles: StaffRole[] = ["MANAGER"];
  if (call.type === "HOOKAH") roles.push("HOOKAH");
  if (call.type === "WAITER") roles.push("WAITER");
  if (call.type === "HELP") roles.push(isOrderRequest ? "WAITER" : "WAITER", isOrderRequest ? "MANAGER" : "HOOKAH");
  if (call.type === "BILL") roles.push("WAITER");

  const kind =
    call.type === "HOOKAH"
      ? "Нужен кальянщик"
      : call.type === "WAITER"
      ? "Нужен официант"
      : call.type === "BILL"
      ? "Запрос оплаты"
      : "Нужна помощь";

  const messagePreview = normalizeCallMessage(call.type, call.message);
  const isMessageOnly = call.type === "HELP" && !!messagePreview;
  const title = isOrderRequest ? "Order requested" : isMessageOnly ? "Новое сообщение от гостя" : "Новый вызов";
  const body = isOrderRequest
    ? `Table ${tableCode} wants to place an order`
    : isMessageOnly
    ? `Стол ${tableCode} • ${messagePreview}`
    : messagePreview
    ? `${kind} • Стол ${tableCode} • ${messagePreview}`
    : `${kind} • Стол ${tableCode}`;

  await pushToVenueRoles(venueId, Array.from(new Set(roles)), {
    title,
    body,
    url: "/staff/calls",
    tag: `call_new:${call.id}`,
    ts: Date.now(),
    kind: isMessageOnly ? "GUEST_MESSAGE" : "CALL_CREATED",
    message: messagePreview ?? undefined,
    tableCode,
    vibrate: isMessageOnly ? [420, 140, 420, 140, 560] : [320, 140, 320, 140, 420],
  });
}

export async function notifyPaymentRequested(paymentRequestId: string) {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: { id: true, status: true, method: true, table: { select: { venueId: true, code: true } } },
  });
  if (!pr) return;
  if (pr.status !== "PENDING") return;

  await pushToVenueRoles(pr.table.venueId, ["WAITER", "MANAGER"], {
    title: "Запрос оплаты",
    body: `${pr.method === "CARD" ? "Карта" : "Наличные"} • Стол ${publicTableCode(pr.table.code)}`,
    url: "/staff/payments",
    tag: `payment_pending:${pr.id}`,
    ts: Date.now(),
    kind: "PAYMENT_REQUESTED",
    tableCode: publicTableCode(pr.table.code),
    vibrate: [280, 120, 280, 120, 460],
  });
}
