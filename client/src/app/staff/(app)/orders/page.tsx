"use client";

import { useEffect, useState } from "react";
import {
  listOrders,
  updateOrderStatus,
  cancelOrderItem,
  type StaffOrder,
  type OrderStatus,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { emitStaffLiveSync } from "@/lib/staffLiveSync";
import { WaitBadge, TONE_BORDER, waitInfo, queueCardBase } from "@/lib/staffQueue";

type OrdersTab = "IN_PROGRESS" | "DELIVERED" | "CANCELLED";

const TABS: Array<{ key: OrdersTab; label: string }> = [
  { key: "IN_PROGRESS", label: "Готовятся" },
  { key: "DELIVERED", label: "Готовые" },
  { key: "CANCELLED", label: "Отменённые" },
];

function statusLabel(s: OrderStatus) {
  if (s === "DELIVERED") return "Готов";
  if (s === "CANCELLED") return "Отменён";
  return "Готовится";
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const cardBase = queueCardBase;
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffOrdersPage() {
  const [tab, setTab] = useState<OrdersTab>("IN_PROGRESS");
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();
  // Live "now" so the wait timers tick even between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // For "Готовятся" the timer measures time IN THIS STAGE — count from the last
  // status/append change (updatedAt), oldest first.
  const sortedOrders =
    tab === "IN_PROGRESS"
      ? [...orders].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      : orders;

  const load = async (opts?: { silent?: boolean; activeTab?: OrdersTab }) => {
    const silent = opts?.silent ?? false;
    const current = opts?.activeTab ?? tab;
    if (!silent) setLoading(true);
    setErr(null);

    const ordersResult = await listOrders(current);
    if (!ordersResult.ok) {
      if (!silent) setLoading(false);
      setErr(ordersResult.error);
      return;
    }
    setOrders(ordersResult.data.orders);

    if (!silent) setLoading(false);
    setLast(Date.now());
  };

  const { tick } = usePolling(() => load({ silent: true }), {
    activeMs: 8000,
    idleMs: 20000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useStaffPushEvents((payload) => {
    if (payload.kind === "ORDER_CREATED") void tick();
  });

  useStaffEvents((e) => {
    if (e.kind === "ORDER_CREATED" || e.kind === "DATA_CHANGED") {
      void tick();
    }
  });

  const setTo = async (id: string, st: OrderStatus, okText: string) => {
    setBusyId(id);
    const r = await updateOrderStatus(id, st);
    setBusyId(null);

    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }

    push({ kind: "success", title: "Готово", message: okText });
    emitStaffLiveSync("order-status-updated");
    await load({ silent: false });
  };

  // Отменить отдельную позицию из заказа (гость передумал). Если это была
  // последняя позиция — заказ отменяется целиком.
  const cancelItem = async (orderId: string, itemId: string) => {
    setBusyId(itemId);
    const r = await cancelOrderItem(orderId, itemId);
    setBusyId(null);

    if (!r.ok) {
      push({ kind: "error", title: "Не удалось отменить", message: r.error });
      return;
    }

    push({
      kind: "success",
      title: r.data.orderCancelled ? "Заказ отменён" : "Позиция отменена",
      message: r.data.orderCancelled ? "В заказе не осталось позиций." : "Позиция убрана из заказа.",
    });
    emitStaffLiveSync("order-item-cancelled");
    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Заказы</div>
            <div className="mt-1.5 text-xs text-white/55">
              {`Заказов: ${orders.length}`}
              {last ? ` • обновлено ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
          </div>

          <button className={btnGhost} onClick={() => void tick()}>
            Обновить
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {TABS.map((t) => {
            const activeTab = t.key === tab;
            return (
              <button
                key={t.key}
                className={[
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-2xl border px-4 py-2 text-sm transition",
                  activeTab
                    ? "border-white/20 bg-white text-black"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
                ].join(" ")}
                onClick={() => setTab(t.key)}
              >
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/55">
          Новый заказ пробивается на странице «Столы» → выберите стол → «Добавить позиции».
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-4 space-y-3">
        {sortedOrders.map((o) => {
          const sum = o.items.reduce((acc, it) => acc + it.priceCzk * it.qty, 0);
          const urgent = o.status === "IN_PROGRESS";

          return (
            <div
              key={o.id}
              className={urgent ? `${cardBase} ${TONE_BORDER[waitInfo(o.updatedAt, now).tone]}` : card}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/45">
                    {new Date(o.createdAt).toLocaleString()} • {statusLabel(o.status)}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold text-white">
                      Стол {o.table.code}
                      {o.table.label ? ` • ${o.table.label}` : ""}
                    </div>
                    {urgent ? <WaitBadge createdAt={o.updatedAt} now={now} /> : null}
                  </div>

                  <div className="mt-1 text-sm text-white/70">
                    {o.session?.user
                      ? `${o.session.user.name} • ${o.session.user.phone}`
                      : "Гость без аккаунта"}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-white/50">Сумма</div>
                  <div className="mt-1 text-lg font-semibold text-white">{sum} Kč</div>
                </div>
              </div>

              {o.comment ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/85">
                  Комментарий: {o.comment}
                </div>
              ) : null}

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

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="text-sm font-semibold text-white">{it.priceCzk * it.qty} Kč</div>
                      {o.status === "IN_PROGRESS" ? (
                        <button
                          className="rounded-xl border border-red-400/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                          disabled={busyId !== null}
                          onClick={() => void cancelItem(o.id, it.id)}
                        >
                          {busyId === it.id ? "…" : "Убрать"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {o.status === "IN_PROGRESS" ? (
                <div className="mt-4 grid grid-cols-1 gap-2">
                  <button
                    className={btnPrimary}
                    disabled={busyId !== null}
                    onClick={() => void setTo(o.id, "DELIVERED", "Заказ отмечен как готовый.")}
                  >
                    {busyId === o.id ? "Сохраняем…" : "Отметить готовым"}
                  </button>
                  <button
                    className={btnGhost}
                    disabled={busyId !== null}
                    onClick={() => void setTo(o.id, "CANCELLED", "Заказ отменён.")}
                  >
                    Отменить заказ
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        {!loading && orders.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>
            {tab === "IN_PROGRESS"
              ? "Сейчас ничего не готовится."
              : tab === "DELIVERED"
                ? "Готовых заказов пока нет."
                : "Отменённых заказов нет."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
