"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  listOrders,
  listOrderRequests,
  connectOrderRequest,
  createTableOrder,
  updateOrderStatus,
  type StaffOrder,
  type StaffOrderRequest,
  type OrderStatus,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { emitStaffLiveSync } from "@/lib/staffLiveSync";

type OrdersTab = "accept" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";

const TABS: Array<{ key: OrdersTab; label: string }> = [
  { key: "accept", label: "Принять" },
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
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffOrdersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<OrdersTab>("accept");
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [requests, setRequests] = useState<StaffOrderRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

  const load = async (opts?: { silent?: boolean; activeTab?: OrdersTab }) => {
    const silent = opts?.silent ?? false;
    const current = opts?.activeTab ?? tab;
    if (!silent) setLoading(true);
    setErr(null);

    // Requests power the "Принять" tab and its badge — always refresh them.
    const requestsResult = await listOrderRequests();
    setRequests(requestsResult.ok ? requestsResult.data.requests : []);

    if (current !== "accept") {
      const ordersResult = await listOrders(current);
      if (!ordersResult.ok) {
        if (!silent) setLoading(false);
        setErr(ordersResult.error);
        return;
      }
      setOrders(ordersResult.data.orders);
    } else {
      setOrders([]);
    }

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
    if (e.kind === "ORDER_CREATED" || e.kind === "CALL_CREATED" || e.kind === "DATA_CHANGED") {
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

  // "Принять" — создать заказ сразу из того, что выбрал гость, и закрыть запрос.
  const acceptRequest = async (request: StaffOrderRequest) => {
    if (!request.items || request.items.length === 0) return;
    setBusyId(request.id);
    const result = await createTableOrder({
      tableId: request.table.id,
      sessionId: request.session.id,
      requestId: request.id,
      items: request.items.map((it) => ({ menuItemId: it.menuItemId, qty: it.qty })),
    });
    setBusyId(null);

    if (!result.ok) {
      push({
        kind: "error",
        title: "Не удалось принять",
        message: result.error || "Проверьте позиции (возможно, не ваша секция) — используйте «Дополнить».",
      });
      return;
    }

    push({ kind: "success", title: "Заказ принят", message: `Стол ${request.table.code} — готовится.` });
    emitStaffLiveSync("order-accepted");
    await load({ silent: false });
  };

  // "Дополнить" / "Собрать" — открыть форму, предзаполнив выбором гостя.
  const connectToTable = async (request: StaffOrderRequest) => {
    setBusyId(request.id);
    const result = await connectOrderRequest(request.id);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    const connected = result.data.request;
    try {
      if (request.items && request.items.length > 0) {
        sessionStorage.setItem(`orderPrefill:${connected.id}`, JSON.stringify(request.items));
      }
    } catch {}

    emitStaffLiveSync("order-request-connected");
    router.push(
      `/staff/orders/create?requestId=${encodeURIComponent(connected.id)}&tableId=${connected.table.id}&tableCode=${encodeURIComponent(
        connected.table.code
      )}&sessionId=${encodeURIComponent(connected.session.id)}`
    );
  };

  const subtitle =
    tab === "accept"
      ? `К принятию: ${requests.length}`
      : `Заказов: ${orders.length}`;

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Заказы</div>
            <div className="mt-1.5 text-xs text-white/55">
              {subtitle}
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
            const count = t.key === "accept" ? requests.length : 0;
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
                {count > 0 ? (
                  <span
                    className={[
                      "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none",
                      activeTab ? "bg-black/15 text-black" : "bg-white text-black",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      {/* ПРИНЯТЬ — запросы гостей на заказ */}
      {tab === "accept" ? (
        <div className="mt-4 space-y-3">
          {requests.map((request) => (
            <div key={request.id} className={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-white">
                    Стол {request.table.code}
                    {request.table.label ? ` • ${request.table.label}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    {new Date(request.createdAt).toLocaleTimeString()} •{" "}
                    {request.status === "ACKED" ? "В работе" : "Новый запрос"}
                  </div>
                  <div className="mt-1 text-sm text-white/70">
                    {request.session.user
                      ? `${request.session.user.name} • ${request.session.user.phone}`
                      : "Гость без аккаунта"}
                  </div>
                </div>

                {request.items && request.items.length > 0 ? (
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      className={btnPrimary}
                      disabled={busyId === request.id}
                      onClick={() => void acceptRequest(request)}
                    >
                      {busyId === request.id ? "…" : "Принять"}
                    </button>
                    <button
                      className={btnGhost}
                      disabled={busyId === request.id}
                      onClick={() => void connectToTable(request)}
                    >
                      Дополнить
                    </button>
                  </div>
                ) : (
                  <button
                    className={btnPrimary}
                    disabled={busyId === request.id}
                    onClick={() => void connectToTable(request)}
                  >
                    {busyId === request.id ? "…" : "Собрать заказ"}
                  </button>
                )}
              </div>

              {request.items && request.items.length > 0 ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/50">Гость выбрал</div>
                  <div className="mt-2 space-y-1">
                    {request.items.map((it) => (
                      <div key={it.menuItemId} className="flex items-center justify-between text-sm text-white/85">
                        <span className="min-w-0 truncate">
                          {it.name} × {it.qty}
                        </span>
                        <span className="shrink-0 text-white/55">{it.qty * it.priceCzk} Kč</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {!loading && requests.length === 0 ? (
            <div className={`${card} text-sm text-white/60`}>Сейчас нет заказов для принятия.</div>
          ) : null}
        </div>
      ) : (
        /* ГОТОВЯТСЯ / ГОТОВЫЕ / ОТМЕНЁННЫЕ — заказы по статусу */
        <div className="mt-4 space-y-3">
          {orders.map((o) => {
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

                      <div className="shrink-0 text-sm font-semibold text-white">
                        {it.priceCzk * it.qty} Kč
                      </div>
                    </div>
                  ))}
                </div>

                {o.status === "IN_PROGRESS" ? (
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <button
                      className={btnPrimary}
                      disabled={busyId === o.id}
                      onClick={() => void setTo(o.id, "DELIVERED", "Заказ отмечен как готовый.")}
                    >
                      {busyId === o.id ? "Сохраняем…" : "Отметить готовым"}
                    </button>
                    <button
                      className={btnGhost}
                      disabled={busyId === o.id}
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
      )}
    </div>
  );
}