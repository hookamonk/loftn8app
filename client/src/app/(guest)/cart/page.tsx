"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { storage } from "@/lib/storage";
import { getVenueName } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useGuestFeed } from "@/providers/guestFeed";
import { PaymentSheet } from "@/components/PaymentSheet";

type OrderStatus = "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
type ItemVisualState = "preparing" | "ready";
type PayableSource = { orderItemId: string; qty: number };
type PendingPaymentMarker = {
  method: "CARD" | "CASH";
  selectedQtyByKey: Record<string, number>;
  requestedAt: number;
};
type PayableItem = {
  key: string;
  name: string;
  comment?: string;
  availableQty: number;
  unitPriceCzk: number;
  totalCzk: number;
  sources: PayableSource[];
};

function stageClass(tone: "success" | "info" | "error") {
  if (tone === "success") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
  if (tone === "error") return "border-red-400/20 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/8 text-white/80";
}

function progressBarClass(tone: "success" | "info" | "error") {
  if (tone === "success") return "bg-emerald-300";
  if (tone === "error") return "bg-red-400";
  return "bg-white";
}

function progressStepClass(
  state: "idle" | "done" | "active" | "error",
  variant: "accepted" | "preparing" | "ready"
) {
  if (state === "error") return "bg-red-400/85";
  if (state === "done") return "bg-emerald-400";
  if (state === "active") {
    return variant === "preparing"
      ? "animate-pulse bg-emerald-300 shadow-[0_0_16px_rgba(74,222,128,0.45)]"
      : "bg-emerald-300";
  }
  return "bg-white/10";
}

function openTabStage(statuses: OrderStatus[]) {
  const active = statuses.filter((status) => status !== "CANCELLED");
  const allReady = active.length > 0 && active.every((status) => status === "DELIVERED");
  const hasPreparing = active.some((status) => status === "IN_PROGRESS");

  if (!active.length) return { label: "Cancelled", tone: "error" as const, phase: "cancelled" as const };
  if (allReady) return { label: "Ready", tone: "success" as const, phase: "ready" as const };
  if (hasPreparing) return { label: "Preparing", tone: "success" as const, phase: "preparing" as const };
  return { label: "Accepted", tone: "success" as const, phase: "accepted" as const };
}

function buildOpenTab(orders: NonNullable<ReturnType<typeof useGuestFeed>["feed"]>["orders"]) {
  const activeOrders = orders.filter((order) => order.status !== "CANCELLED");
  if (!activeOrders.length) return null;

  const itemMap = new Map<
    string,
    {
      key: string;
      name: string;
      qty: number;
      totalCzk: number;
      comment?: string;
      state: ItemVisualState;
    }
  >();
  const payableMap = new Map<string, PayableItem>();

  for (const order of activeOrders) {
    for (const item of order.items) {
      const itemState: ItemVisualState =
        order.status === "DELIVERED" ? "ready" : "preparing";
      const key = `${item.menuItem.id}:${item.comment ?? ""}:${itemState}`;
      const existing = itemMap.get(key);

      if (existing) {
        existing.qty += item.qty;
        existing.totalCzk += item.totalCzk;
        continue;
      }

      itemMap.set(key, {
        key,
        name: item.menuItem.name,
        qty: item.qty,
        totalCzk: item.totalCzk,
        comment: item.comment ?? undefined,
        state: itemState,
      });

      const payableKey = `${item.menuItem.id}:${item.comment ?? ""}:${item.priceCzk}`;
      const payableExisting = payableMap.get(payableKey);
      if (payableExisting) {
        payableExisting.availableQty += item.qty;
        payableExisting.totalCzk += item.totalCzk;
        payableExisting.sources.push({ orderItemId: item.id, qty: item.qty });
      } else {
        payableMap.set(payableKey, {
          key: payableKey,
          name: item.menuItem.name,
          comment: item.comment ?? undefined,
          availableQty: item.qty,
          unitPriceCzk: item.priceCzk,
          totalCzk: item.totalCzk,
          sources: [{ orderItemId: item.id, qty: item.qty }],
        });
      }
    }
  }

  const firstCreatedAt = Math.min(...activeOrders.map((order) => new Date(order.createdAt).getTime()));
  const cancelledCount = orders.filter((order) => order.status === "CANCELLED").length;

  return {
    firstCreatedAt,
    stage: openTabStage(activeOrders.map((order) => order.status)),
    totalCzk: activeOrders.reduce((sum, order) => sum + order.totalCzk, 0),
    items: Array.from(itemMap.values()).sort((a, b) => {
      if (a.state === b.state) return a.name.localeCompare(b.name);
      return a.state === "preparing" ? -1 : 1;
    }),
    payableItems: Array.from(payableMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    cancelledCount,
  };
}

export default function CartPage() {
  const venueName = getVenueName();
  const { feed, refresh } = useGuestFeed();
  const { push } = useToast();

  const [payOpen, setPayOpen] = useState(false);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [selectedQtyByKey, setSelectedQtyByKey] = useState<Record<string, number>>({});
  const [localPendingMarker, setLocalPendingMarker] = useState<PendingPaymentMarker | null>(null);
  const latestPaymentSnapshotRef = useRef<{ id: string; status: "PENDING" | "CONFIRMED" | "CANCELLED" } | null>(null);

  const openTab = useMemo(() => buildOpenTab(feed?.orders ?? []), [feed]);
  const pendingMarkerStorageKey = useMemo(
    () =>
      feed?.table && feed?.currentSessionId
        ? `pendingPaymentSelection:${feed.table.id}:${feed.currentSessionId}`
        : null,
    [feed?.currentSessionId, feed?.table]
  );
  const latestPendingPayment = useMemo(
    () => (feed?.payments ?? []).find((payment) => payment.status === "PENDING") ?? null,
    [feed]
  );
  const myPendingPayment = useMemo(
    () =>
      (feed?.payments ?? []).find(
        (payment) =>
          payment.status === "PENDING" &&
          payment.sessionId &&
          payment.sessionId === feed?.currentSessionId
      ) ?? null,
    [feed]
  );
  const activeOrderRequest =
    feed?.orderRequest && (feed.orderRequest.status === "NEW" || feed.orderRequest.status === "ACKED")
      ? feed.orderRequest
      : null;
  const availablePointsCzk = feed?.loyalty?.availableCzk ?? 0;
  const showOpenTab = Boolean(openTab);
  const serverPendingSelectionQtyByKey = useMemo(() => {
    if (!myPendingPayment?.items?.length) return {};
    return myPendingPayment.items.reduce<Record<string, number>>((acc, item) => {
      const key = `${item.menuItemId}:${item.comment ?? ""}:${item.unitPriceCzk}`;
      acc[key] = (acc[key] ?? 0) + item.qty;
      return acc;
    }, {});
  }, [myPendingPayment]);
  const effectivePendingPayment =
    myPendingPayment ??
    (latestPendingPayment && localPendingMarker
      ? {
          ...latestPendingPayment,
          isMine: true,
          method: localPendingMarker.method,
          methodLabel: localPendingMarker.method === "CARD" ? "Card" : "Cash",
        }
      : null);
  const pendingSelectionQtyByKey = myPendingPayment
    ? serverPendingSelectionQtyByKey
    : localPendingMarker?.selectedQtyByKey ?? {};
  const activeSelectionQtyByKey = effectivePendingPayment ? pendingSelectionQtyByKey : selectedQtyByKey;
  const selectedTotalCzk = useMemo(() => {
    if (!openTab) return 0;
    return openTab.payableItems.reduce((sum, item) => {
      const qty = Math.max(0, Math.min(activeSelectionQtyByKey[item.key] ?? 0, item.availableQty));
      return sum + qty * item.unitPriceCzk;
    }, 0);
  }, [openTab, activeSelectionQtyByKey]);
  const cashbackAppliedCzk = useLoyalty ? Math.min(availablePointsCzk, selectedTotalCzk) : 0;
  const finalPayableCzk = Math.max(selectedTotalCzk - cashbackAppliedCzk, 0);
  const selectedPayableItems = useMemo(() => {
    if (!openTab) return [];
    return openTab.payableItems
      .map((item) => {
        const selectedQty = Math.max(0, Math.min(activeSelectionQtyByKey[item.key] ?? 0, item.availableQty));
        return {
          ...item,
          selectedQty,
          selectedTotalCzk: selectedQty * item.unitPriceCzk,
        };
      })
      .filter((item) => item.selectedQty > 0);
  }, [openTab, activeSelectionQtyByKey]);
  const paymentSelectionActive = Boolean(effectivePendingPayment) || (payOpen && selectedPayableItems.length > 0);
  const hasLiveOrderState = Boolean(
    activeOrderRequest ||
      openTab ||
      latestPendingPayment ||
      (feed?.payments ?? []).some((payment) => payment.status === "CONFIRMED")
  );

  useEffect(() => {
    if (!pendingMarkerStorageKey) {
      setLocalPendingMarker(null);
      return;
    }
    setLocalPendingMarker(storage.get<PendingPaymentMarker | null>(pendingMarkerStorageKey, null));
  }, [pendingMarkerStorageKey]);

  useEffect(() => {
    if (!pendingMarkerStorageKey) return;
    if (localPendingMarker) storage.set(pendingMarkerStorageKey, localPendingMarker);
    else storage.del(pendingMarkerStorageKey);
  }, [localPendingMarker, pendingMarkerStorageKey]);

  useEffect(() => {
    if (!availablePointsCzk && useLoyalty) {
      setUseLoyalty(false);
    }
  }, [availablePointsCzk, useLoyalty]);

  useEffect(() => {
    const latestPayment =
      (feed?.payments ?? []).find(
        (payment) => payment.sessionId && payment.sessionId === feed?.currentSessionId
      ) ?? null;
    if (!latestPayment) {
      latestPaymentSnapshotRef.current = null;
      return;
    }

    const prev = latestPaymentSnapshotRef.current;
    if (prev && prev.id === latestPayment.id && prev.status === "PENDING" && latestPayment.status === "CANCELLED") {
      push({
        kind: "info",
        title: "Payment request cancelled",
        message: "Please choose the payment method again and send a new request.",
      });
      setUseLoyalty(false);
    }
    if (prev && prev.id === latestPayment.id && prev.status === "PENDING" && latestPayment.status === "CONFIRMED") {
      push({
        kind: "success",
        title: "Payment confirmed",
        message: "Your payment was confirmed.",
      });
    }

    latestPaymentSnapshotRef.current = {
      id: latestPayment.id,
      status: latestPayment.status,
    };
  }, [feed?.payments, push]);

  useEffect(() => {
    if (!latestPendingPayment && localPendingMarker) {
      setLocalPendingMarker(null);
    }
  }, [latestPendingPayment, localPendingMarker]);

  useEffect(() => {
    if (!hasLiveOrderState) return;

    let cancelled = false;
    let timer: number | null = null;

    const run = async () => {
      if (document.visibilityState !== "visible") return;
      await refresh().catch(() => {});
      if (cancelled) return;
      timer = window.setTimeout(run, 1200);
    };

    timer = window.setTimeout(run, 1200);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [hasLiveOrderState, refresh]);

  const requestPayment = async (method: "CARD" | "CASH") => {
    if (latestPendingPayment || !showOpenTab || !openTab) return;
    setPayOpen(false);

    const selectedItems = openTab.payableItems.flatMap((item) => {
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

    if (!selectedItems.length) {
      push({
        kind: "info",
        title: "Select items",
        message: "Choose at least one position for this payment.",
      });
      return;
    }

    try {
      const marker: PendingPaymentMarker = {
        method,
        selectedQtyByKey: Object.fromEntries(
          Object.entries(selectedQtyByKey).filter(([, qty]) => qty > 0)
        ),
        requestedAt: Date.now(),
      };
      setLocalPendingMarker(marker);
      await api("/payments/request", {
        method: "POST",
        body: JSON.stringify({
          method,
          useLoyalty: availablePointsCzk > 0 ? useLoyalty : false,
          items: selectedItems,
        }),
      });

      await refresh();
      setSelectedQtyByKey({});
      setUseLoyalty(false);

      push({
        kind: "success",
        title: "Payment requested",
        message:
          method === "CARD"
            ? `A staff member will come with the terminal for ${finalPayableCzk} Kč.`
            : `A staff member will come for cash payment of ${finalPayableCzk} Kč.`,
      });
    } catch (e: any) {
      setLocalPendingMarker(null);
      push({ kind: "error", title: "Payment error", message: e?.message ?? "Failed" });
    }
  };

  const openPaymentSheet = () => {
    if (!openTab || latestPendingPayment) return;
    setSelectedQtyByKey({});
    setPayOpen(true);
  };

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] tracking-[0.28em] text-white/55">{venueName}</div>
            <h1 className="mt-1 text-2xl font-bold text-white">Cart</h1>
            <div className="mt-1 text-xs text-white/60">
              {showOpenTab ? "Your current order" : "Nothing active right now"}
            </div>
          </div>

          {showOpenTab || activeOrderRequest ? (
            <Link
              href="/menu"
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
            >
              Menu
            </Link>
          ) : null}
        </div>

        <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Your bill</div>
            </div>

            <button
              disabled={!showOpenTab || !!latestPendingPayment}
              className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              onClick={openPaymentSheet}
            >
              {latestPendingPayment ? "Requested" : "Pay"}
            </button>
          </div>

          {showOpenTab && openTab ? (
            <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {paymentSelectionActive ? "Payment selection" : "Current order"}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {new Date(openTab.firstCreatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {paymentSelectionActive ? (
                  <div className="rounded-full border border-sky-400/20 bg-sky-500/12 px-2.5 py-1 text-[11px] font-semibold text-sky-100">
                    Awaiting confirmation
                  </div>
                ) : (
                  <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stageClass(openTab.stage.tone)}`}>
                    {openTab.stage.label}
                  </div>
                )}
              </div>

              {paymentSelectionActive ? (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="h-1.5 rounded-full bg-sky-400" />
                    <div className="h-1.5 rounded-full animate-pulse bg-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.45)]" />
                    <div className={`h-1.5 rounded-full ${effectivePendingPayment ? "animate-pulse bg-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.45)]" : "bg-white/10"}`} />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/38">
                    <span className="text-sky-200">Selected</span>
                    <span className="animate-pulse text-sky-200">{effectivePendingPayment ? "Processing" : "Awaiting method"}</span>
                    <span className={effectivePendingPayment ? "animate-pulse text-sky-200" : undefined}>Confirmation</span>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {openTab.payableItems.map((item) => {
                      const selected = Math.max(0, Math.min(activeSelectionQtyByKey[item.key] ?? 0, item.availableQty));
                      const isSelected = selected > 0;
                      return (
                        <div
                          key={item.key}
                          className={[
                            "flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 text-sm transition",
                            isSelected
                              ? "border border-sky-400/20 bg-sky-500/10 text-sky-50"
                              : "bg-white/[0.03] text-white/70",
                          ].join(" ")}
                        >
                          <div className="min-w-0">
                            {item.name} × {isSelected ? selected : item.availableQty}
                            {item.comment ? <div className="mt-0.5 text-[11px] text-white/42">{item.comment}</div> : null}
                            <div
                              className={[
                                "mt-1 text-[10px] uppercase tracking-[0.16em]",
                                isSelected ? "text-sky-200/90" : "text-white/35",
                              ].join(" ")}
                            >
                              {isSelected ? "Selected for payment" : "Not selected"}
                            </div>
                          </div>
                          <div className="shrink-0">{(isSelected ? selected : item.availableQty) * item.unitPriceCzk} Kč</div>
                        </div>
                      );
                    })}
                  </div>

                  {effectivePendingPayment ? (
                    <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/8 px-3 py-2 text-[11px] text-sky-100/90">
                      Your payment request: {effectivePendingPayment.methodLabel === "Card" ? "card" : "cash"}, has been accepted. The waiter is on the way.
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-500/8 px-3 py-2 text-[11px] text-sky-100/90">
                      Select the items you want to pay for and choose the payment method.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div
                      className={`h-1.5 rounded-full ${progressStepClass(
                        openTab.stage.phase === "cancelled"
                          ? "error"
                          : openTab.stage.phase === "accepted" ||
                            openTab.stage.phase === "preparing" ||
                            openTab.stage.phase === "ready"
                          ? openTab.stage.phase === "accepted"
                            ? "active"
                            : "done"
                          : "idle",
                        "accepted"
                      )}`}
                    />
                    <div
                      className={`h-1.5 rounded-full ${progressStepClass(
                        openTab.stage.phase === "cancelled"
                          ? "error"
                          : openTab.stage.phase === "preparing"
                          ? "active"
                          : openTab.stage.phase === "ready"
                          ? "done"
                          : "idle",
                        "preparing"
                      )}`}
                    />
                    <div
                      className={`h-1.5 rounded-full ${progressStepClass(
                        openTab.stage.phase === "cancelled"
                          ? "error"
                          : openTab.stage.phase === "ready"
                          ? "active"
                          : "idle",
                        "ready"
                      )}`}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/38">
                    <span
                      className={
                        openTab.stage.phase === "accepted" ||
                        openTab.stage.phase === "preparing" ||
                        openTab.stage.phase === "ready"
                          ? "text-emerald-300"
                          : undefined
                      }
                    >
                      Accepted
                    </span>
                    <span
                      className={
                        openTab.stage.phase === "preparing"
                          ? "animate-pulse text-emerald-300"
                          : openTab.stage.phase === "ready"
                          ? "text-emerald-300"
                          : undefined
                      }
                    >
                      Preparing
                    </span>
                    <span className={openTab.stage.phase === "ready" ? "text-emerald-300" : undefined}>Ready</span>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {openTab.items.map((item) => (
                      <div
                        key={item.key}
                        className={[
                          "flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 text-sm transition",
                          item.state === "preparing"
                            ? "animate-pulse bg-emerald-500/8 text-emerald-100"
                            : "bg-emerald-500/5 text-emerald-100/85",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          {item.name} × {item.qty}
                          {item.comment ? <div className="mt-0.5 text-[11px] text-white/42">{item.comment}</div> : null}
                          <div
                            className={[
                              "mt-1 text-[10px] uppercase tracking-[0.16em]",
                              item.state === "preparing" ? "text-emerald-200/85" : "text-emerald-200/65",
                            ].join(" ")}
                          >
                            {item.state === "preparing" ? "Preparing" : "Ready"}
                          </div>
                        </div>
                        <div className="shrink-0">{item.totalCzk} Kč</div>
                      </div>
                    ))}
                  </div>

                  {openTab.stage.phase === "ready" ? (
                    <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/90">
                      Your order is ready. The waiter is bringing it to your table.
                    </div>
                  ) : null}
                </>
              )}

              {openTab.cancelledCount > 0 ? (
                <div className="mt-3 rounded-xl border border-red-400/15 bg-red-500/6 px-3 py-2 text-[11px] text-red-200/85">
                  {openTab.cancelledCount} cancelled {openTab.cancelledCount === 1 ? "group" : "groups"} not included
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">Due now</div>
                <div className="text-sm font-semibold text-white">{feed?.totals.dueCzk ?? openTab.totalCzk} Kč</div>
              </div>

              {!effectivePendingPayment && latestPendingPayment ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/65">
                  Another guest at the table is currently handling a payment request.
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={[
                "mt-4 rounded-2xl border p-3 text-sm",
                activeOrderRequest
                  ? "border-emerald-400/15 bg-emerald-500/8 text-emerald-100/90"
                  : "border-white/10 bg-black/20 text-white/60",
              ].join(" ")}
            >
              {activeOrderRequest ? (
                <>
                  <div className="font-semibold">
                    {activeOrderRequest.status === "ACKED" ? "Your order request has been accepted" : "Your order request has been accepted"}
                  </div>
                  <div className="mt-1 text-xs text-emerald-100/75">
                    Your order request has been accepted. The waiter is on the way.
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 py-2 text-center">
                  <div>Your order will appear here.</div>
                  <Link
                    href="/menu"
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-white px-6 text-sm font-semibold text-black"
                  >
                    Go to menu
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

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
          onChangeSelectedQty={(key, qty) =>
            setSelectedQtyByKey((current) => ({ ...current, [key]: qty }))
          }
        />
      </main>
    </RequireTable>
  );
}
