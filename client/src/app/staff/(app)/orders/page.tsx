"use client";

import { useEffect, useMemo, useState } from "react";
import { listOrders, updateOrderStatus, type StaffOrder, type OrderStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useToast } from "@/providers/toast";

const STATUSES: OrderStatus[] = ["NEW", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "CANCELLED"];

function statusLabel(s: OrderStatus) {
  if (s === "NEW") return "Новые";
  if (s === "ACCEPTED") return "Приняты";
  if (s === "IN_PROGRESS") return "Готовятся";
  if (s === "DELIVERED") return "Готово";
  return "Отменены";
}

function nextAction(s: OrderStatus) {
  if (s === "NEW") return { status: "ACCEPTED" as OrderStatus, label: "Принять" };
  if (s === "ACCEPTED") return { status: "IN_PROGRESS" as OrderStatus, label: "Готовится" };
  if (s === "IN_PROGRESS") return { status: "DELIVERED" as OrderStatus, label: "Готово" };
  return null;
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffOrdersPage() {
  const [status, setStatus] = useState<OrderStatus>("NEW");
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

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
    activeMs: 4000,
    idleMs: 12000,
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

  const totalItems = useMemo(
    () => orders.reduce((acc, o) => acc + o.items.reduce((s, it) => s + it.qty, 0), 0),
    [orders]
  );

  const setTo = async (id: string, st: OrderStatus, okText: string) => {
    setBusyId(id);
    const r = await updateOrderStatus(id, st);
    setBusyId(null);

    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }

    push({ kind: "success", title: "Готово", message: okText });
    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-white">Заказы</div>
            <div className="mt-1 text-xs text-white/50">
              Автообновление: {isRunning ? "включено" : "выключено"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">
              Заказов: {orders.length} • Позиции: {totalItems}
            </div>
          </div>

          <button className={btnGhost} onClick={() => void tick()}>
            Обновить
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={[
                "rounded-2xl border px-4 py-2 text-sm transition whitespace-nowrap",
                s === status
                  ? "border-white/20 bg-white/15 text-white"
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

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-4 space-y-3">
        {orders.map((o) => {
          const action = nextAction(o.status);
          const sum = o.items.reduce((acc, it) => acc + it.priceCzk * it.qty, 0);

          return (
            <div key={o.id} className={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/45">
                    {new Date(o.createdAt).toLocaleString()} • {statusLabel(o.status)}
                  </div>

                  <div className="mt-1 text-lg font-semibold text-white">
                    Стол {o.table.code}
                    {o.table.label ? ` • ${o.table.label}` : ""}
                  </div>

                  <div className="mt-1 text-sm text-white/70">
                    {o.session?.user
                      ? `${o.session.user.name} • ${o.session.user.phone}`
                      : "Гость без аккаунта"}
                  </div>

                  {o.comment ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/85">
                      Комментарий к заказу: {o.comment}
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-white/50">Сумма</div>
                  <div className="mt-1 text-lg font-semibold text-white">{sum} Kč</div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                {o.items.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-white">
                        {it.menuItem.name} × {it.qty}
                      </div>
                      {it.comment ? (
                        <div className="mt-1 text-xs text-white/60">Комментарий: {it.comment}</div>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-sm font-semibold text-white">
                      {it.priceCzk * it.qty} Kč
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {action ? (
                  <button
                    className={btn}
                    disabled={busyId === o.id}
                    onClick={() =>
                      void setTo(
                        o.id,
                        action.status,
                        action.status === "ACCEPTED"
                          ? "Заказ принят"
                          : action.status === "IN_PROGRESS"
                          ? "Заказ переведён в готовку"
                          : "Заказ отмечен как готовый"
                      )
                    }
                  >
                    {busyId === o.id ? "Сохраняем…" : action.label}
                  </button>
                ) : null}

                {o.status !== "CANCELLED" && o.status !== "DELIVERED" ? (
                  <button
                    className={btnGhost}
                    disabled={busyId === o.id}
                    onClick={() => void setTo(o.id, "CANCELLED", "Заказ отменён")}
                  >
                    Отменить
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && orders.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>Нет заказов в этом разделе.</div>
        ) : null}
      </div>
    </div>
  );
}