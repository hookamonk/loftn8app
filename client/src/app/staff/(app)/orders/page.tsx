"use client";

import { useEffect, useState } from "react";
import { listOrders, updateOrderStatus, type StaffOrder, type OrderStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";

const STATUSES: OrderStatus[] = ["NEW", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "CANCELLED"];

function nextStatus(s: OrderStatus): OrderStatus | null {
  if (s === "NEW") return "ACCEPTED";
  if (s === "ACCEPTED") return "IN_PROGRESS";
  if (s === "IN_PROGRESS") return "DELIVERED";
  return null;
}

const glassCard =
  "rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10 active:scale-[0.99] transition";
const pill =
  "rounded-full border border-white/10 px-3 py-1 text-sm transition";
const pillActive = "bg-white/15 text-white";
const pillIdle = "bg-white/5 text-white/70 hover:bg-white/10";

export default function StaffOrdersPage() {
  const [status, setStatus] = useState<OrderStatus>("NEW");
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;

    if (!silent) setLoading(true);
    setErr(null);

    const r = await listOrders(status);

    if (!silent) setLoading(false);

    if (!r.ok) {
      setErr(r.error);
      return;
    }

    setOrders(r.data.orders);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 5000,
    idleMs: 15000,
    immediate: true,
    enabled: true,
  });

  useEffect(() => {
    const off = attachStaffRealtime(() => {
      void tick();
    });
    return off;
  }, [tick]);

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useStaffPushEvents(() => {
    void tick();
  });

  const setTo = async (id: string, st: OrderStatus) => {
    const r = await updateOrderStatus(id, st);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    await load({ silent: false });
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Заказы</div>
          <div className="text-xs text-white/50">
            Auto-refresh: {isRunning ? "ON" : "OFF"}
            {last ? ` • обновлено ${new Date(last).toLocaleTimeString()}` : ""}
          </div>
        </div>

        <button className={btn} onClick={() => void tick()}>
          Обновить
        </button>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`${pill} ${s === status ? pillActive : pillIdle}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {err ? (
        <div className="mt-3 rounded-3xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading ? <div className="mt-3 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-3 space-y-3">
        {orders.map((o) => {
          const ns = nextStatus(o.status);
          return (
            <div key={o.id} className={`${glassCard} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/50">
                    {new Date(o.createdAt).toLocaleString()} • {o.status}
                  </div>

                  <div className="mt-1 font-semibold text-white">
                    Стол: {o.table.code}
                    {o.table.label ? ` (${o.table.label})` : ""}
                  </div>

                  {o.session?.user ? (
                    <div className="mt-1 text-xs text-white/60">
                      Гость: {o.session.user.name} • {o.session.user.phone}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-white/60">Гость: без аккаунта</div>
                  )}

                  {o.comment ? (
                    <div className="mt-2 text-sm text-white/80">
                      Комментарий: <span className="text-white">{o.comment}</span>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 flex flex-col gap-2">
                  {ns ? (
                    <button
                      className="rounded-xl border border-white/10 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
                      onClick={() => void setTo(o.id, ns)}
                    >
                      {ns}
                    </button>
                  ) : null}

                  {o.status !== "CANCELLED" && o.status !== "DELIVERED" ? (
                    <button
                      className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition"
                      onClick={() => void setTo(o.id, "CANCELLED")}
                    >
                      CANCEL
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                {o.items.map((it) => (
                  <div key={it.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-white">
                        {it.menuItem.name} × {it.qty}
                      </div>
                      {it.comment ? (
                        <div className="text-xs text-white/60">Комментарий: {it.comment}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 font-semibold text-white">
                      {it.priceCzk * it.qty} Kč
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {orders.length === 0 ? (
          <div className={`${glassCard} p-4 text-sm text-white/60`}>Нет заказов.</div>
        ) : null}
      </div>
    </div>
  );
}
