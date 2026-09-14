"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getVenueName } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useGuestFeed } from "@/providers/guestFeed";
import { useAuth } from "@/providers/auth";
import { PaymentSheet } from "@/components/PaymentSheet";
import { useI18n } from "@/providers/i18n";

/**
 * The guest never builds an order here — a waiter punches it in at the table.
 * So this screen has exactly three states:
 *
 *   1. nothing yet   → the live status of the "waiter, please" request
 *   2. order placed  → dishes + cooking status + total + "Pay"
 *   3. paying        → what was selected, how, and by whom
 */

type OrderStatus = "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
type ItemState = "preparing" | "ready";

type PayableItem = {
  key: string;
  name: string;
  comment?: string;
  availableQty: number;
  unitPriceCzk: number;
  totalCzk: number;
  sources: Array<{ orderItemId: string; qty: number }>;
};

type Stage = {
  label: string;
  tone: "info" | "success" | "error";
  phase: "accepted" | "preparing" | "ready" | "cancelled";
};

function stageChipClass(tone: Stage["tone"]) {
  if (tone === "success") return "border-gold/20 bg-gold/10 text-gold";
  if (tone === "error") return "border-red-400/20 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/8 text-white/80";
}

function openTabStage(statuses: OrderStatus[], isCz: boolean): Stage {
  const active = statuses.filter((status) => status !== "CANCELLED");
  if (!active.length) return { label: isCz ? "Zrušeno" : "Cancelled", tone: "error", phase: "cancelled" };
  if (active.every((status) => status === "DELIVERED"))
    return { label: isCz ? "Připraveno" : "Ready", tone: "success", phase: "ready" };
  if (active.some((status) => status === "IN_PROGRESS"))
    return { label: isCz ? "Příprava" : "Preparing", tone: "success", phase: "preparing" };
  return { label: isCz ? "Přijato" : "Accepted", tone: "success", phase: "accepted" };
}

function buildOpenTab(orders: NonNullable<ReturnType<typeof useGuestFeed>["feed"]>["orders"], isCz: boolean) {
  const active = orders.filter((order) => order.status !== "CANCELLED");
  if (!active.length) return null;

  const itemMap = new Map<string, { key: string; name: string; qty: number; totalCzk: number; comment?: string; state: ItemState }>();
  const payableMap = new Map<string, PayableItem>();

  for (const order of active) {
    for (const item of order.items) {
      const name = isCz ? item.menuItem.nameCs || item.menuItem.name : item.menuItem.name;
      const state: ItemState = order.status === "DELIVERED" ? "ready" : "preparing";

      const displayKey = `${item.menuItem.id}:${item.comment ?? ""}:${state}`;
      const existing = itemMap.get(displayKey);
      if (existing) {
        existing.qty += item.qty;
        existing.totalCzk += item.totalCzk;
      } else {
        itemMap.set(displayKey, {
          key: displayKey,
          name,
          qty: item.qty,
          totalCzk: item.totalCzk,
          comment: item.comment ?? undefined,
          state,
        });
      }

      const payKey = `${item.menuItem.id}:${item.comment ?? ""}:${item.priceCzk}`;
      const payable = payableMap.get(payKey);
      if (payable) {
        payable.availableQty += item.qty;
        payable.totalCzk += item.totalCzk;
        payable.sources.push({ orderItemId: item.id, qty: item.qty });
      } else {
        payableMap.set(payKey, {
          key: payKey,
          name,
          comment: item.comment ?? undefined,
          availableQty: item.qty,
          unitPriceCzk: item.priceCzk,
          totalCzk: item.totalCzk,
          sources: [{ orderItemId: item.id, qty: item.qty }],
        });
      }
    }
  }

  return {
    stage: openTabStage(active.map((order) => order.status), isCz),
    totalCzk: active.reduce((sum, order) => sum + order.totalCzk, 0),
    items: Array.from(itemMap.values()).sort((a, b) =>
      a.state === b.state ? a.name.localeCompare(b.name) : a.state === "preparing" ? -1 : 1
    ),
    payableItems: Array.from(payableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]";

export default function CartPage() {
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { feed, refresh } = useGuestFeed();
  const { me } = useAuth();
  const { push } = useToast();

  const [payOpen, setPayOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [changingMethod, setChangingMethod] = useState(false);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [selectedQtyByKey, setSelectedQtyByKey] = useState<Record<string, number>>({});

  const openTab = useMemo(() => buildOpenTab(feed?.orders ?? [], isCz), [feed, isCz]);

  const request = feed?.orderRequest ?? null;
  const payments = useMemo(() => feed?.payments ?? [], [feed]);
  const tablePendingPayment = useMemo(
    () => payments.find((payment) => payment.status === "PENDING") ?? null,
    [payments]
  );
  const myPendingPayment = useMemo(
    () => payments.find((payment) => payment.status === "PENDING" && payment.isMine) ?? null,
    [payments]
  );
  const availablePointsCzk = feed?.loyalty?.availableCzk ?? 0;
  const cashbackPercent = feed?.loyalty?.cashbackPercent ?? 10;

  // Tell the guest the moment staff act on their payment.
  const lastPaymentRef = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const mine = payments.find((payment) => payment.isMine) ?? null;
    if (!mine) {
      lastPaymentRef.current = null;
      return;
    }

    const prev = lastPaymentRef.current;
    if (prev && prev.id === mine.id && prev.status === "PENDING") {
      if (mine.status === "CONFIRMED") {
        push({
          kind: "success",
          title: isCz ? "Platba potvrzena" : "Payment confirmed",
          message: isCz ? "Děkujeme! Účet je uhrazen." : "Thank you! Your bill is settled.",
        });
      }
      if (mine.status === "CANCELLED") {
        setUseLoyalty(false);
        push({
          kind: "info",
          title: isCz ? "Žádost o platbu zrušena" : "Payment request cancelled",
          message: isCz ? "Zvolte prosím způsob platby znovu." : "Please choose the payment method again.",
        });
      }
    }

    lastPaymentRef.current = { id: mine.id, status: mine.status };
  }, [payments, push, isCz]);

  useEffect(() => {
    if (!availablePointsCzk && useLoyalty) setUseLoyalty(false);
  }, [availablePointsCzk, useLoyalty]);

  const selectedTotalCzk = useMemo(() => {
    if (!openTab) return 0;
    return openTab.payableItems.reduce((sum, item) => {
      const qty = Math.max(0, Math.min(selectedQtyByKey[item.key] ?? 0, item.availableQty));
      return sum + qty * item.unitPriceCzk;
    }, 0);
  }, [openTab, selectedQtyByKey]);

  const cashbackAppliedCzk = useLoyalty ? Math.min(availablePointsCzk, selectedTotalCzk) : 0;
  const finalPayableCzk = Math.max(selectedTotalCzk - cashbackAppliedCzk, 0);

  const pendingBillCzk = myPendingPayment?.billTotalCzk ?? 0;
  const pendingCashbackCzk = myPendingPayment?.useLoyalty
    ? Math.min(availablePointsCzk, pendingBillCzk)
    : (myPendingPayment?.loyaltyAppliedCzk ?? 0);
  const pendingDueCzk = Math.max(pendingBillCzk - pendingCashbackCzk, 0);

  const isReady = openTab?.stage.phase === "ready";
  const dueCzk = feed?.totals.dueCzk ?? openTab?.totalCzk ?? 0;
  const earnCzk = Math.floor((dueCzk * cashbackPercent) / 100);

  const openPaymentSheet = () => {
    if (!openTab || tablePendingPayment || !isReady) return;

    if (!me?.authenticated) {
      push({
        kind: "info",
        title: isCz ? "Vyžaduje registraci" : "Registration required",
        message: isCz ? "Zaregistrujte se, abyste mohli zaplatit a získat cashback." : "Register to pay and earn cashback.",
        action: { label: isCz ? "Zaregistrovat se" : "Register", href: "/auth" },
      });
      return;
    }

    setSelectedQtyByKey({});
    setPayOpen(true);
  };

  const requestPayment = async (method: "CARD" | "CASH") => {
    if (!openTab || tablePendingPayment || submitting) return;

    const items = openTab.payableItems.flatMap((item) => {
      let remaining = Math.max(0, Math.min(selectedQtyByKey[item.key] ?? 0, item.availableQty));
      if (remaining <= 0) return [];

      const allocation: Array<{ orderItemId: string; qty: number }> = [];
      for (const source of item.sources) {
        if (remaining <= 0) break;
        const take = Math.min(source.qty, remaining);
        if (take > 0) {
          allocation.push({ orderItemId: source.orderItemId, qty: take });
          remaining -= take;
        }
      }
      return allocation;
    });

    if (!items.length) {
      push({
        kind: "info",
        title: isCz ? "Vyberte položky" : "Select items",
        message: isCz ? "Zvolte alespoň jednu položku." : "Choose at least one position.",
      });
      return;
    }

    setPayOpen(false);
    setSubmitting(true);

    try {
      await api("/payments/request", {
        method: "POST",
        body: JSON.stringify({
          method,
          useLoyalty: availablePointsCzk > 0 ? useLoyalty : false,
          items,
        }),
      });
      await refresh();

      setSelectedQtyByKey({});
      setUseLoyalty(false);
      push({
        kind: "success",
        title: isCz ? "Žádost odeslána" : "Payment requested",
        message:
          method === "CARD"
            ? isCz
              ? "Obsluha přijde s terminálem."
              : "A staff member will bring the terminal."
            : isCz
              ? "Obsluha přijde pro hotovost."
              : "A staff member will come for the cash.",
      });
    } catch (e: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba platby" : "Payment error",
        message: e instanceof Error ? e.message : isCz ? "Nepodařilo se odeslat" : "Failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const changeMethod = async (method: "CARD" | "CASH") => {
    if (changingMethod) return;
    setChangingMethod(true);
    try {
      await api("/payments/method", { method: "POST", body: JSON.stringify({ method }) });
      await refresh();
    } catch (e: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setChangingMethod(false);
    }
  };

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="pr-24">
          <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">{venueName}</div>
          <h1 className="mt-1 text-2xl font-bold text-white">{isCz ? "Účet" : "Bill"}</h1>
        </div>

        {/* 1 — nothing ordered yet */}
        {!openTab ? (
          <div className={`mt-4 ${card}`}>
            {request ? (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${request.status === "ACKED" ? "animate-pulse bg-emerald-400" : "bg-gold"}`}
                  />
                  <div className="text-sm font-semibold text-white">{request.statusTitle}</div>
                </div>
                <div className="mt-2 text-sm leading-6 text-white/65">{request.statusDescription}</div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-3 text-center">
                <div className="text-sm text-white/65">
                  {isCz ? "Vaše objednávka se zobrazí zde." : "Your order will appear here."}
                </div>
                <Link
                  href="/menu"
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-white px-6 text-sm font-semibold text-black"
                >
                  {isCz ? "Přejít do menu" : "Go to menu"}
                </Link>
              </div>
            )}
          </div>
        ) : null}

        {/* 2 — the order, with live cooking status */}
        {openTab ? (
          <div className={`mt-4 ${card}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-white">
                {isCz ? "Vaše objednávka" : "Your order"}
              </div>
              <div className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stageChipClass(openTab.stage.tone)}`}>
                {openTab.stage.label}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["accepted", "preparing", "ready"] as const).map((phase, index) => {
                const reached =
                  openTab.stage.phase === "ready" ||
                  (openTab.stage.phase === "preparing" && index <= 1) ||
                  (openTab.stage.phase === "accepted" && index === 0);
                const active = openTab.stage.phase === phase;
                return (
                  <div
                    key={phase}
                    className={[
                      "h-1.5 rounded-full",
                      openTab.stage.phase === "cancelled"
                        ? "bg-red-400/85"
                        : reached
                          ? active && phase === "preparing"
                            ? "animate-pulse bg-gold"
                            : "bg-gold"
                          : "bg-white/10",
                    ].join(" ")}
                  />
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/50">
              <span>{isCz ? "Přijato" : "Accepted"}</span>
              <span>{isCz ? "Příprava" : "Preparing"}</span>
              <span>{isCz ? "Hotovo" : "Ready"}</span>
            </div>

            <div className="mt-4 space-y-1.5">
              {openTab.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-3 rounded-xl bg-gold/[0.06] px-3 py-2 text-sm text-amber-50/90"
                >
                  <div className="min-w-0">
                    <div className="truncate">
                      {item.name} × {item.qty}
                    </div>
                    {item.comment ? (
                      <div className="mt-0.5 text-[11px] text-white/50">{item.comment}</div>
                    ) : null}
                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-gold/75">
                      {item.state === "preparing" ? (isCz ? "Připravuje se" : "Preparing") : isCz ? "Hotovo" : "Ready"}
                    </div>
                  </div>
                  <div className="shrink-0">{item.totalCzk} Kč</div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-white/8 pt-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">
                  {isCz ? "K úhradě" : "Due"}
                </div>
                {earnCzk > 0 ? (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-gold/12 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                    ✦ {isCz ? `Cashback +${earnCzk} Kč` : `Cashback +${earnCzk} Kč`}
                  </div>
                ) : null}
              </div>
              <div className="text-2xl font-bold text-white">{dueCzk} Kč</div>
            </div>

            {!tablePendingPayment ? (
              <>
                <button
                  type="button"
                  disabled={!isReady || submitting}
                  onClick={openPaymentSheet}
                  className="mt-4 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
                >
                  {submitting ? (isCz ? "Odesíláme…" : "Sending…") : isCz ? "Zaplatit" : "Pay"}
                </button>
                {!isReady ? (
                  <div className="mt-2 text-center text-[11px] leading-5 text-white/45">
                    {isCz
                      ? "Zaplatit půjde, jakmile bude objednávka hotová."
                      : "Payment unlocks once the order is ready."}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {/* 3 — a payment is in flight */}
        {tablePendingPayment ? (
          <div className="mt-4 rounded-[28px] border border-sky-400/25 bg-sky-500/10 p-4">
            {myPendingPayment ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />
                  <div className="text-sm font-semibold text-sky-50">
                    {isCz ? "Obsluha je na cestě" : "A staff member is on the way"}
                  </div>
                </div>

                <div className="mt-1 text-sm text-sky-100/80">
                  {myPendingPayment.method === "CARD"
                    ? isCz
                      ? "Přinese platební terminál."
                      : "Bringing the card terminal."
                    : isCz
                      ? "Přijde pro hotovost."
                      : "Coming for the cash."}
                </div>

                {myPendingPayment.items.length ? (
                  <div className="mt-3 space-y-1">
                    {myPendingPayment.items.map((item) => (
                      <div
                        key={item.orderItemId}
                        className="flex justify-between gap-3 text-sm text-sky-50/90"
                      >
                        <span className="min-w-0 truncate">
                          {item.name} × {item.qty}
                        </span>
                        <span className="shrink-0 text-sky-100/70">{item.totalCzk} Kč</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {pendingCashbackCzk > 0 ? (
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-gold">
                    <span>{isCz ? "Použitý cashback" : "Cashback used"}</span>
                    <span className="font-semibold">−{pendingCashbackCzk} Kč</span>
                  </div>
                ) : null}

                <div className="mt-3 flex items-end justify-between border-t border-sky-400/15 pt-3">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-sky-100/60">
                    {isCz ? "K úhradě" : "To pay"}
                  </div>
                  <div className="text-xl font-bold text-white">{pendingDueCzk} Kč</div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-sky-100/55">
                    {isCz ? "Způsob platby" : "Payment method"}
                  </div>
                  <div className="inline-flex rounded-2xl border border-white/10 bg-black/30 p-1">
                    {(["CARD", "CASH"] as const).map((method) => {
                      const active = myPendingPayment.method === method;
                      return (
                        <button
                          key={method}
                          type="button"
                          disabled={active || changingMethod}
                          onClick={() => void changeMethod(method)}
                          className={[
                            "rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-default",
                            active ? "bg-white text-black" : "text-white/60 hover:text-white",
                          ].join(" ")}
                        >
                          {method === "CARD" ? (isCz ? "Kartou" : "Card") : isCz ? "Hotově" : "Cash"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm leading-6 text-sky-50/90">
                {isCz
                  ? "Jiný host u stolu právě platí. Počkejte prosím chvíli."
                  : "Another guest at the table is paying right now. Please hold on."}
              </div>
            )}
          </div>
        ) : null}

        <PaymentSheet
          open={payOpen}
          onClose={() => setPayOpen(false)}
          onPick={requestPayment}
          onSelectAll={() =>
            setSelectedQtyByKey(
              Object.fromEntries((openTab?.payableItems ?? []).map((item) => [item.key, item.availableQty]))
            )
          }
          availablePointsCzk={availablePointsCzk}
          useLoyalty={useLoyalty}
          onToggleLoyalty={setUseLoyalty}
          items={openTab?.payableItems ?? []}
          selectedQtyByKey={selectedQtyByKey}
          selectedTotalCzk={selectedTotalCzk}
          cashbackAppliedCzk={cashbackAppliedCzk}
          finalPayableCzk={finalPayableCzk}
          onChangeSelectedQty={(key, qty) => setSelectedQtyByKey((current) => ({ ...current, [key]: qty }))}
        />
      </main>
    </RequireTable>
  );
}
