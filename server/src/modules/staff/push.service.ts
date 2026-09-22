import { prisma } from "../../db/prisma";
import type { StaffRole, MenuSection } from "@prisma/client";
import { isOrderRequestMessage } from "../orders/orderRequest";
import { publicTableCode, publicVenueSlug } from "../../config/venues";
import { emitStaffEvent } from "./staffEvents";
import { sendWebPush, type WebPushSubscriptionRow } from "../push/webPushSender";

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
  venueId?: number;
  venueSlug?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  renotify?: boolean;
};

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

// Staff payloads are explicitly tagged so the shared service worker (which
// also serves guests) keeps rendering them exactly as before.
async function sendToSubscriptions(subs: WebPushSubscriptionRow[], payload: PushPayload) {
  return sendWebPush(
    subs,
    { ...payload, audience: "staff" },
    {
      onGone: async (s) => {
        await prisma.staffPushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      },
    }
  );
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
      table: { select: { venueId: true, code: true, venue: { select: { slug: true } } } },
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
  if (!order) {
    console.warn("notifyOrderCreated: order not found", { orderId });
    return;
  }

  const venueId = order.table.venueId;
  const tableCode = publicTableCode(order.table.code);
  const venueSlug = publicVenueSlug(order.table.venue.slug);

  emitStaffEvent(venueId, { kind: "ORDER_CREATED", tableCode, tag: `order_new:${order.id}` });

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
    venueId,
    venueSlug,
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
      table: { select: { venueId: true, code: true, venue: { select: { slug: true } } } },
    },
  });
  if (!call) {
    console.warn("notifyCallCreated: call not found", { callId });
    return;
  }

  const venueId = call.table.venueId;
  const tableCode = publicTableCode(call.table.code);
  const venueSlug = publicVenueSlug(call.table.venue.slug);
  // "Call the waiter" from the guest menu IS the request to order.
  const isOrderRequest = call.type === "WAITER" || isOrderRequestMessage(call.message);

  const messagePreview = normalizeCallMessage(call.type, call.message);
  const isMessageOnly = call.type === "HELP" && !!messagePreview;

  // Emit SSE with the SAME kind the push uses, so the in-app alert plays the
  // right tone (a guest message sounds different from a service call).
  emitStaffEvent(venueId, {
    kind: isOrderRequest ? "ORDER_CREATED" : isMessageOnly ? "GUEST_MESSAGE" : "CALL_CREATED",
    tableCode,
    tag: `call_new:${call.id}`,
  });

  // An order request is taken by a waiter (manager is always notified too); a
  // plain guest message goes to waiter + hookah.
  const roles: StaffRole[] = ["MANAGER"];
  if (isOrderRequest) roles.push("WAITER");
  else if (call.type === "HOOKAH") roles.push("HOOKAH");
  else if (call.type === "BILL") roles.push("WAITER");
  else roles.push("WAITER", "HOOKAH");

  const kind =
    call.type === "HOOKAH"
      ? "Нужен кальянщик"
      : call.type === "BILL"
      ? "Запрос оплаты"
      : "Нужна помощь";
  const title = isOrderRequest
    ? "Новый заказ"
    : isMessageOnly
    ? "Сообщение от гостя"
    : "Новый вызов";
  const body = isOrderRequest
    ? `Стол ${tableCode} готов заказать`
    : isMessageOnly
    ? `Стол ${tableCode} • ${messagePreview}`
    : messagePreview
    ? `${kind} • Стол ${tableCode} • ${messagePreview}`
    : `${kind} • Стол ${tableCode}`;

  await pushToVenueRoles(venueId, Array.from(new Set(roles)), {
    title,
    body,
    url: isOrderRequest ? "/staff/orders" : "/staff/calls",
    tag: `call_new:${call.id}`,
    ts: Date.now(),
    kind: isOrderRequest ? "ORDER_CREATED" : isMessageOnly ? "GUEST_MESSAGE" : "CALL_CREATED",
    message: messagePreview ?? undefined,
    tableCode,
    venueId,
    venueSlug,
    vibrate: isMessageOnly ? [420, 140, 420, 140, 560] : [320, 140, 320, 140, 420],
  });
}

export async function notifyPaymentRequested(paymentRequestId: string) {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: {
      id: true,
      status: true,
      method: true,
      tableId: true,
      table: { select: { venueId: true, code: true, venue: { select: { slug: true } } } },
    },
  });
  if (!pr) {
    console.warn("notifyPaymentRequested: payment request not found", { paymentRequestId });
    return;
  }
  if (pr.status !== "PENDING") return;
  const venueSlug = publicVenueSlug(pr.table.venue.slug);

  emitStaffEvent(pr.table.venueId, {
    kind: "PAYMENT_REQUESTED",
    tableCode: publicTableCode(pr.table.code),
    tag: `payment_pending:${pr.id}`,
  });

  await pushToVenueRoles(pr.table.venueId, ["WAITER", "MANAGER"], {
    title: "Запрос оплаты",
    body: `${pr.method === "CARD" ? "Карта" : "Наличные"} • Стол ${publicTableCode(pr.table.code)}`,
    url: `/staff/tables/${pr.tableId}`,
    tag: `payment_pending:${pr.id}`,
    ts: Date.now(),
    kind: "PAYMENT_REQUESTED",
    tableCode: publicTableCode(pr.table.code),
    venueId: pr.table.venueId,
    venueSlug,
    vibrate: [280, 120, 280, 120, 460],
  });
}

// The guest switched card ↔ cash on an in-flight payment — let the team know so
// whoever's heading over brings the right thing (terminal vs. cash).
export async function notifyPaymentMethodChanged(paymentRequestId: string) {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: {
      id: true,
      status: true,
      method: true,
      tableId: true,
      table: { select: { venueId: true, code: true, venue: { select: { slug: true } } } },
    },
  });
  if (!pr || pr.status !== "PENDING") return;

  const tableCode = publicTableCode(pr.table.code);
  const venueSlug = publicVenueSlug(pr.table.venue.slug);

  emitStaffEvent(pr.table.venueId, {
    kind: "PAYMENT_REQUESTED",
    tableCode,
    tag: `payment_method:${pr.id}`,
  });

  await pushToVenueRoles(pr.table.venueId, ["WAITER", "MANAGER"], {
    title: "Способ оплаты изменён",
    body: `Стол ${tableCode} • теперь ${pr.method === "CARD" ? "Карта" : "Наличные"}`,
    url: `/staff/tables/${pr.tableId}`,
    tag: `payment_method:${pr.id}`,
    ts: Date.now(),
    kind: "PAYMENT_REQUESTED",
    tableCode,
    venueId: pr.table.venueId,
    venueSlug,
    vibrate: [200, 100, 200],
  });
}
