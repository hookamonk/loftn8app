"use client";

import { useEffect, useState } from "react";
import { listPayments, confirmPayment, cancelPayment, type StaffPayment, type PaymentStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useToast } from "@/providers/toast";

const STATUSES: PaymentStatus[] = ["PENDING", "CONFIRMED", "CANCELLED"];

function statusLabel(s: PaymentStatus) {
  if (s === "PENDING") return "Pending";
  if (s === "CONFIRMED") return "Confirmed";
  return "Cancelled";
}

function methodLabel(m: StaffPayment["method"]) {
  return m === "CARD" ? "Card" : "Cash";
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffPaymentsPage() {
  const [status, setStatus] = useState<PaymentStatus>("PENDING");
  const [payments, setPayments] = useState<StaffPayment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"confirm" | "cancel" | null>(null);
  const { push } = useToast();

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const r = await listPayments(status);

    if (!silent) setLoading(false);

    if (!r.ok) {
      setErr(r.error);
      return;
    }

    setPayments(r.data.payments);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 8000,
    idleMs: 30000,
    immediate: true,
    enabled: true,
  });

  useEffect(() => {
    const off = attachStaffRealtime(() => void tick());
    return off;
  }, [tick]);

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useStaffPushEvents(() => {
    void tick();
  });

  const onConfirm = async (id: string) => {
    setBusyId(id);
    setBusyAction("confirm");
    const r = await confirmPayment(id);
    setBusyId(null);
    setBusyAction(null);

    if (!r.ok) {
      push({ kind: "error", title: "Error", message: r.error });
      return;
    }

    push({
      kind: "success",
      title: "Payment confirmed",
      message: "The bill was closed successfully.",
    });

    await load({ silent: false });
  };

  const onCancel = async (id: string) => {
    setBusyId(id);
    setBusyAction("cancel");
    const r = await cancelPayment(id);
    setBusyId(null);
    setBusyAction(null);

    if (!r.ok) {
      push({ kind: "error", title: "Error", message: r.error });
      return;
    }

    push({
      kind: "info",
      title: "Request cancelled",
      message: "The guest can now choose the payment method again.",
    });

    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Payments</div>
            <div className="mt-1 text-xs text-white/50">
              Auto refresh: {isRunning ? "on" : "off"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">Requests: {payments.length}</div>
          </div>

          <button className={btnGhost} onClick={() => void tick()}>
            Refresh
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={[
                "whitespace-nowrap rounded-2xl border px-4 py-2 text-sm transition",
                s === status
                  ? "border-white/20 bg-white text-black"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
              ].join(" ")}
              onClick={() => setStatus(s)}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Loading…</div> : null}

      <div className="mt-4 space-y-3">
        {payments.map((p) => (
          <div key={p.id} className={card}>
            <div className="text-xs text-white/45">
              {new Date(p.createdAt).toLocaleString()} • {statusLabel(p.status)}
            </div>

            <div className="mt-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-white">
                  Table {p.table.code}
                  {p.table.label ? ` • ${p.table.label}` : ""}
                </div>

                <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-sm font-bold text-white">
                  {methodLabel(p.method)}
                </div>

                <div className="mt-2 text-sm text-white/60">
                  {p.session?.user
                    ? `${p.session.user.name} • ${p.session.user.phone}`
                    : "Guest without account"}
                </div>
              </div>
            </div>

            {p.items.length ? (
              <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] p-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-sky-100/60">Selected items</div>
                <div className="mt-3 space-y-2">
                  {p.items.map((item) => (
                    <div
                      key={`${p.id}:${item.orderItemId}`}
                      className="flex items-start justify-between gap-3 rounded-xl border border-sky-400/10 bg-black/20 px-3 py-2 text-sm text-white/85"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-sky-50">
                          {item.name} × {item.qty}
                        </div>
                        {item.comment ? (
                          <div className="mt-0.5 text-[11px] text-sky-100/55">{item.comment}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 font-medium text-white">{item.totalCzk} Kč</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-white/70">
                <span>Bill total</span>
                <span className="font-semibold text-white">{p.billTotalCzk} Kč</span>
              </div>
              {p.useLoyalty && p.loyaltyAppliedCzk > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-sky-100/90">
                  <span>Cashback used</span>
                  <span className="font-semibold">{p.loyaltyAppliedCzk} Kč</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/15 bg-emerald-500/8 px-3 py-2 text-emerald-100/90">
                <span>{p.status === "CONFIRMED" ? "Paid" : "To pay"}</span>
                <span className="font-semibold text-white">{p.requestedAmountCzk} Kč</span>
              </div>
            </div>

            {p.status === "PENDING" ? (
              <div className="mt-4 flex gap-2">
                <button
                  className={`${btnPrimary} flex-1`}
                  disabled={busyId === p.id}
                  onClick={() => void onConfirm(p.id)}
                >
                  {busyId === p.id && busyAction === "confirm" ? "Saving…" : "Confirm payment"}
                </button>
                <button
                  className={`${btn} flex-1`}
                  disabled={busyId === p.id}
                  onClick={() => void onCancel(p.id)}
                >
                  {busyId === p.id && busyAction === "cancel" ? "Cancelling…" : "Cancel request"}
                </button>
              </div>
            ) : null}
          </div>
        ))}

        {!loading && payments.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>No payments in this section.</div>
        ) : null}
      </div>
    </div>
  );
}
