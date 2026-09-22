import type { CallStatus, CallType, OrderStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { isWebPushConfigured, sendWebPush, type WebPushSubscriptionRow } from "../push/webPushSender";

/**
 * Web push to GUESTS: order progress, accepted calls, payment outcome.
 *
 * Best-effort by design. Every function loads what it needs by id, resolves
 * the registered guests concerned, and sends one localized notification per
 * subscribed device. Failures are logged and never surface to the caller —
 * the in-app feed (SSE + polling) remains the source of truth.
 *
 * Recipients:
 *   • order events   → every registered guest with an open session at the
 *                       table in the same shift (the bill is shared)
 *   • call events    → the guest who made the call
 *   • payment events → the guest whose payment it is; a bill issued by staff
 *                       goes to everyone at the table
 */

type GuestLang = "cs" | "en";

type GuestPushKind =
  | "ORDER_CREATED"
  | "ORDER_PREPARING"
  | "ORDER_READY"
  | "ORDER_CANCELLED"
  | "ORDER_ITEM_CANCELLED"
  | "WAITER_ON_THE_WAY"
  | "HOOKAH_ON_THE_WAY"
  | "MESSAGE_HANDLED"
  | "BILL_CALL_ACCEPTED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_CANCELLED"
  | "BILL_ISSUED";

type Text = { title: string; body: string };

const GUEST_URL = "/cart";
const GUEST_VIBRATE = [120, 60, 120];

function normalizeLang(raw: string | null | undefined): GuestLang {
  return String(raw ?? "").toLowerCase().startsWith("en") ? "en" : "cs";
}

function textFor(kind: GuestPushKind, lang: GuestLang, amountCzk?: number): Text {
  const cs = lang === "cs";

  switch (kind) {
    case "ORDER_CREATED":
      return cs
        ? { title: "Objednávka přijata", body: "Připravujeme ji. Stav sledujte v záložce Účet." }
        : { title: "Order received", body: "We're preparing it. Track it in the Bill tab." };
    case "ORDER_PREPARING":
      return cs
        ? { title: "Objednávka se připravuje", body: "Dáme vědět, až bude hotová." }
        : { title: "Order is being prepared", body: "We'll let you know when it's ready." };
    case "ORDER_READY":
      return cs
        ? { title: "Objednávka je hotová", body: "Zaplatit můžete v záložce Účet." }
        : { title: "Order is ready", body: "You can pay in the Bill tab." };
    case "ORDER_CANCELLED":
      return cs
        ? { title: "Objednávka byla zrušena", body: "Pokud to není správně, obraťte se na obsluhu." }
        : { title: "Order cancelled", body: "Talk to the staff if this isn't right." };
    case "ORDER_ITEM_CANCELLED":
      return cs
        ? { title: "Objednávka byla upravena", body: "Jedna položka byla odebrána." }
        : { title: "Order updated", body: "One item was removed." };
    case "WAITER_ON_THE_WAY":
      return cs
        ? { title: "Číšník je na cestě", body: "Přijde k vašemu stolu přijmout objednávku." }
        : { title: "Waiter is on the way", body: "Coming to your table to take the order." };
    case "HOOKAH_ON_THE_WAY":
      return cs
        ? { title: "Kalianér je na cestě", body: "Přijde k vašemu stolu." }
        : { title: "Hookah master is on the way", body: "Coming to your table." };
    case "MESSAGE_HANDLED":
      return cs
        ? { title: "Zpráva přijata", body: "Obsluha váš požadavek zpracovává." }
        : { title: "Message received", body: "The staff is handling your request." };
    case "BILL_CALL_ACCEPTED":
      return cs
        ? { title: "Žádost o platbu přijata", body: "Obsluha je na cestě." }
        : { title: "Payment request accepted", body: "A staff member is on the way." };
    case "PAYMENT_CONFIRMED":
      return cs
        ? { title: "Platba potvrzena", body: "Děkujeme! Účet je uhrazen." }
        : { title: "Payment confirmed", body: "Thank you! Your bill is settled." };
    case "PAYMENT_CANCELLED":
      return cs
        ? { title: "Žádost o platbu zrušena", body: "Zvolte prosím způsob platby znovu." }
        : { title: "Payment request cancelled", body: "Please choose the payment method again." };
    case "BILL_ISSUED":
      return cs
        ? {
            title: "Účet je připraven",
            body: amountCzk ? `${amountCzk} Kč · zaplatit můžete v záložce Účet.` : "Zaplatit můžete v záložce Účet.",
          }
        : {
            title: "Your bill is ready",
            body: amountCzk ? `${amountCzk} Kč · pay in the Bill tab.` : "Pay in the Bill tab.",
          };
  }
}

async function dropSubscription(sub: WebPushSubscriptionRow) {
  await prisma.guestPushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
}

/** Send one localized notification to every device of the given guests. */
async function pushToUsers(
  userIds: string[],
  kind: GuestPushKind,
  tag: string,
  amountCzk?: number
) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0 || !isWebPushConfigured()) return;

  const subs = await prisma.guestPushSubscription.findMany({
    where: { userId: { in: ids } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, lang: true },
  });
  if (subs.length === 0) return;

  // One payload per language, so a Czech and an English phone at the same
  // table each get their own text.
  const byLang = new Map<GuestLang, WebPushSubscriptionRow[]>();
  for (const sub of subs) {
    const lang = normalizeLang(sub.lang);
    const list = byLang.get(lang) ?? [];
    list.push({ id: sub.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
    byLang.set(lang, list);
  }

  const ts = Date.now();
  await Promise.all(
    Array.from(byLang.entries()).map(([lang, list]) => {
      const text = textFor(kind, lang, amountCzk);
      return sendWebPush(
        list,
        {
          audience: "guest",
          title: text.title,
          body: text.body,
          url: GUEST_URL,
          tag,
          ts,
          kind,
          lang,
          vibrate: GUEST_VIBRATE,
          // Guests get a normal notification that goes away on its own.
          requireInteraction: false,
          renotify: true,
        },
        { onGone: dropSubscription }
      );
    })
  );
}

/** Registered guests currently sitting at the table (same shift when known). */
async function userIdsAtTable(tableId: number, shiftId: string | null | undefined) {
  const sessions = await prisma.guestSession.findMany({
    where: {
      tableId,
      endedAt: null,
      userId: { not: null },
      ...(shiftId ? { shiftId } : {}),
    },
    select: { userId: true },
  });
  return sessions.map((s) => s.userId).filter((id): id is string => Boolean(id));
}

async function loadOrder(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tableId: true,
      status: true,
      session: { select: { shiftId: true } },
    },
  });
}

export async function notifyGuestsOrderCreated(orderId: string) {
  const order = await loadOrder(orderId);
  if (!order) return;

  const users = await userIdsAtTable(order.tableId, order.session.shiftId);
  await pushToUsers(users, "ORDER_CREATED", `guest_order:${order.id}:created:${order.status}`);
}

export async function notifyGuestsOrderStatus(orderId: string, status: OrderStatus) {
  const order = await loadOrder(orderId);
  if (!order) return;

  const kind: GuestPushKind | null =
    status === "DELIVERED"
      ? "ORDER_READY"
      : status === "CANCELLED"
      ? "ORDER_CANCELLED"
      : status === "ACCEPTED" || status === "IN_PROGRESS"
      ? "ORDER_PREPARING"
      : null;
  if (!kind) return;

  const users = await userIdsAtTable(order.tableId, order.session.shiftId);
  await pushToUsers(users, kind, `guest_order:${order.id}:${status}`);
}

export async function notifyGuestsOrderItemCancelled(orderId: string, orderCancelled: boolean) {
  const order = await loadOrder(orderId);
  if (!order) return;

  const users = await userIdsAtTable(order.tableId, order.session.shiftId);
  await pushToUsers(
    users,
    orderCancelled ? "ORDER_CANCELLED" : "ORDER_ITEM_CANCELLED",
    orderCancelled ? `guest_order:${order.id}:CANCELLED` : `guest_order:${order.id}:item:${Date.now()}`
  );
}

/** A call moved out of NEW: tell the guest who made it. */
export async function notifyGuestCallUpdated(callId: string) {
  const call = await prisma.staffCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      type: true,
      status: true,
      session: { select: { userId: true } },
    },
  });
  if (!call || !call.session.userId) return;
  if (call.status === "NEW") return;

  const kind = kindForCall(call.type, call.status);
  if (!kind) return;

  await pushToUsers([call.session.userId], kind, `guest_call:${call.id}:${call.status}`);
}

function kindForCall(type: CallType, status: CallStatus): GuestPushKind | null {
  if (status === "NEW") return null;
  if (type === "WAITER") return "WAITER_ON_THE_WAY";
  if (type === "HOOKAH") return "HOOKAH_ON_THE_WAY";
  if (type === "BILL") return "BILL_CALL_ACCEPTED";
  return "MESSAGE_HANDLED";
}

export async function notifyGuestPayment(paymentRequestId: string, outcome: "confirmed" | "cancelled") {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: {
      id: true,
      session: { select: { userId: true } },
    },
  });
  if (!pr?.session.userId) return;

  await pushToUsers(
    [pr.session.userId],
    outcome === "confirmed" ? "PAYMENT_CONFIRMED" : "PAYMENT_CANCELLED",
    `guest_payment:${pr.id}:${outcome}`
  );
}

/** Staff issued the bill from their side — everyone at the table can pay it. */
export async function notifyGuestsBillIssued(paymentRequestId: string) {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: {
      id: true,
      tableId: true,
      billTotalCzk: true,
      tipCzk: true,
      session: { select: { shiftId: true } },
    },
  });
  if (!pr) return;

  const users = await userIdsAtTable(pr.tableId, pr.session.shiftId);
  await pushToUsers(users, "BILL_ISSUED", `guest_payment:${pr.id}:issued`, pr.billTotalCzk);
}
