"use client";

import { useEffect, useRef } from "react";
import type { GuestFeed } from "@/providers/guestFeed";

/**
 * In-app notifications for the guest, derived from feed changes.
 *
 * Works on every platform while the app is open (the feed is refreshed by SSE
 * the instant staff act). Complements web push, which reaches the lock screen
 * only where the platform allows it.
 *
 * Only real transitions notify: the first feed of a session and a switch to a
 * new session never replay history.
 */

export type GuestNotice = { kind: "success" | "info"; title: string; message?: string };

// The cart marks its own payment request so the "bill is ready" notice is
// reserved for bills issued by the waiter.
let ownPaymentRequestAt = 0;
const OWN_REQUEST_WINDOW_MS = 15_000;

export function noteOwnPaymentRequest() {
  ownPaymentRequestAt = Date.now();
}

function vibrate() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([80, 40, 80]);
  } catch {
    // ignore
  }
}

function qtyOf(order: GuestFeed["orders"][number]) {
  return order.items.reduce((sum, item) => sum + item.qty, 0);
}

function diffFeed(prev: GuestFeed, next: GuestFeed, isCz: boolean): GuestNotice[] {
  const out: GuestNotice[] = [];

  // ---- orders (shared per table) ----
  const prevOrders = new Map(prev.orders.map((order) => [order.id, order]));
  for (const order of next.orders) {
    const before = prevOrders.get(order.id);

    if (!before) {
      if (order.status !== "CANCELLED") {
        out.push({
          kind: "success",
          title: isCz ? "Objednávka přijata" : "Order received",
          message: isCz ? "Připravujeme ji." : "We're preparing it.",
        });
      }
      continue;
    }

    if (before.status !== order.status) {
      if (order.status === "DELIVERED") {
        out.push({
          kind: "success",
          title: isCz ? "Objednávka je hotová" : "Order is ready",
          message: isCz ? "Můžete zaplatit." : "You can pay now.",
        });
      } else if (order.status === "CANCELLED") {
        out.push({
          kind: "info",
          title: isCz ? "Objednávka byla zrušena" : "Order cancelled",
          message: isCz ? "Pokud to není správně, obraťte se na obsluhu." : "Talk to the staff if this isn't right.",
        });
      } else if (order.status === "ACCEPTED" || order.status === "IN_PROGRESS") {
        if (qtyOf(order) > qtyOf(before)) {
          out.push({
            kind: "success",
            title: isCz ? "Objednávka doplněna" : "Order updated",
            message: isCz ? "Nové položky se připravují." : "New items are being prepared.",
          });
        } else {
          out.push({
            kind: "info",
            title: isCz ? "Objednávka se připravuje" : "Order is being prepared",
          });
        }
      }
      continue;
    }

    const beforeQty = qtyOf(before);
    const afterQty = qtyOf(order);
    if (afterQty > beforeQty) {
      out.push({
        kind: "success",
        title: isCz ? "Objednávka doplněna" : "Order updated",
        message: isCz ? "Nové položky se připravují." : "New items are being prepared.",
      });
    } else if (afterQty < beforeQty && order.status !== "DELIVERED") {
      // A drop after DELIVERED means part of it was paid, not removed.
      out.push({
        kind: "info",
        title: isCz ? "Objednávka byla upravena" : "Order updated",
        message: isCz ? "Jedna položka byla odebrána." : "One item was removed.",
      });
    }
  }

  // ---- this guest's calls ----
  const prevCalls = new Map(prev.calls.map((call) => [call.id, call]));
  for (const call of next.calls) {
    const before = prevCalls.get(call.id);
    if (!before || before.status !== "NEW" || call.status === "NEW") continue;

    if (call.type === "WAITER") {
      out.push({
        kind: "success",
        title: isCz ? "Číšník je na cestě" : "Waiter is on the way",
        message: isCz ? "Přijde k vašemu stolu." : "Coming to your table.",
      });
    } else if (call.type === "HOOKAH") {
      out.push({
        kind: "success",
        title: isCz ? "Kalianér je na cestě" : "Hookah master is on the way",
        message: isCz ? "Přijde k vašemu stolu." : "Coming to your table.",
      });
    } else if (call.type === "BILL") {
      out.push({
        kind: "success",
        title: isCz ? "Žádost o platbu přijata" : "Payment request accepted",
      });
    } else {
      out.push({
        kind: "success",
        title: isCz ? "Zpráva přijata" : "Message received",
        message: isCz ? "Obsluha váš požadavek zpracovává." : "The staff is handling your request.",
      });
    }
  }

  // ---- this guest's payments ----
  const prevPayments = new Map(prev.payments.map((payment) => [payment.id, payment]));
  for (const payment of next.payments) {
    if (!payment.isMine) continue;
    const before = prevPayments.get(payment.id);

    if (!before) {
      if (payment.status === "PENDING" && Date.now() - ownPaymentRequestAt > OWN_REQUEST_WINDOW_MS) {
        const amount = payment.billTotalCzk ?? 0;
        out.push({
          kind: "info",
          title: isCz ? "Účet je připraven" : "Your bill is ready",
          message: amount
            ? isCz
              ? `${amount} Kč · zaplatit můžete zde.`
              : `${amount} Kč · you can pay here.`
            : undefined,
        });
      }
      continue;
    }

    if (before.status === "PENDING" && payment.status === "CONFIRMED") {
      out.push({
        kind: "success",
        title: isCz ? "Platba potvrzena" : "Payment confirmed",
        message: isCz ? "Děkujeme! Účet je uhrazen." : "Thank you! Your bill is settled.",
      });
    } else if (before.status === "PENDING" && payment.status === "CANCELLED") {
      out.push({
        kind: "info",
        title: isCz ? "Žádost o platbu zrušena" : "Payment request cancelled",
        message: isCz ? "Zvolte prosím způsob platby znovu." : "Please choose the payment method again.",
      });
    }
  }

  return out;
}

export function useGuestNotifications(
  feed: GuestFeed | null,
  isCz: boolean,
  notify: (notice: GuestNotice) => void
) {
  const prevRef = useRef<GuestFeed | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = feed;

    if (!feed) return;
    // First load of a session, or a brand-new session: nothing to compare with.
    if (!prev || prev.currentSessionId !== feed.currentSessionId) return;

    const notices = diffFeed(prev, feed, isCz);
    if (!notices.length) return;

    vibrate();
    for (const notice of notices) notifyRef.current(notice);
    // isCz only changes the wording; a language switch must not replay anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);
}
