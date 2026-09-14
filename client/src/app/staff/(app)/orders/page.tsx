"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectOrderRequest,
  dismissOrderRequest,
  listOrderRequests,
  listOrders,
  updateOrderStatus,
  type StaffOrder,
  type StaffOrderRequest,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { emitStaffLiveSync } from "@/lib/staffLiveSync";
import { WaitBadge, TONE_BORDER, waitInfo, queueCardBase } from "@/lib/staffQueue";
import { OrderComposer } from "@/components/staff/OrderComposer";

/**
 * The whole order lifecycle lives on this one screen, two taps end to end:
 *
 *   Новые    →  «Принять»  (guest sees "waiter is on the way")
 *            →  «Подключиться к столу» → sheet → «Сохранить заказ»
 *   Принятые →  «Готово»   (guest can now pay)
 */

type Tab = "new" | "accepted";

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";
const btnAccent =
  "h-12 w-full rounded-2xl bg-emerald-400 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";

type ComposerTarget = {
  tableId: number;
  tableCode: string;
  sessionId: string;
  requestId: string;
};

export default function StaffOrdersPage() {
  const { push } = useToast();

  const [tab, setTab] = useState<Tab>("new");
  const [requests, setRequests] = useState<StaffOrderRequest[]>([]);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);

  // Live clock so the waiting badges tick between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    const [requestsResult, ordersResult] = await Promise.all([
      listOrderRequests(),
      listOrders("IN_PROGRESS"),
    ]);

    if (!silent) setLoading(false);

    if (!requestsResult.ok) {
      setErr(requestsResult.error);
      return;
    }
    setErr(null);
    setRequests(requestsResult.data.requests);
    if (ordersResult.ok) setOrders(ordersResult.data.orders);
  }, []);

  const { tick } = usePolling(() => load({ silent: true }), {
    activeMs: 8000,
    idleMs: 20000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
  }, [load]);

  useStaffPushEvents((payload) => {
    if (payload.kind === "ORDER_CREATED" || payload.kind === "CALL_CREATED") void tick();
  });

  useStaffEvents((e) => {
    if (e.kind === "ORDER_CREATED" || e.kind === "CALL_CREATED" || e.kind === "DATA_CHANGED") void tick();
  });

  // Oldest first — whoever waited longest is served first.
  const sortedRequests = useMemo(
    () => [...requests].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [requests]
  );
  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()),
    [orders]
  );

  const accept = async (request: StaffOrderRequest) => {
    setBusyId(request.id);
    const result = await connectOrderRequest(request.id);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    // Guest instantly sees "waiter is on the way"; the card stays put and now
    // offers the next step.
    emitStaffLiveSync("order-request-accepted");
    await load({ silent: true });
  };

  const dismiss = async (request: StaffOrderRequest) => {
    setBusyId(request.id);
    const result = await dismissOrderRequest(request.id);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    emitStaffLiveSync("order-request-dismissed");
    await load({ silent: true });
  };

  const markReady = async (order: StaffOrder) => {
    setBusyId(order.id);
    const result = await updateOrderStatus(order.id, "DELIVERED");
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    push({ kind: "success", title: "Готово", message: `Стол ${order.table.code} — гость может оплатить.` });
    emitStaffLiveSync("order-delivered");
    await load({ silent: true });
  };

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "new", label: "Новые", count: requests.length },
    { key: "accepted", label: "Принятые", count: orders.length },
  ];

  return (
    <div>
      <div className={card}>
        <div className="text-xl font-semibold text-white">Заказы</div>

        <div className="mt-3 flex gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
                t.key === tab ? "bg-white text-black" : "text-white/65",
              ].join(" ")}
            >
              {t.label}
              {t.count > 0 ? (
                <span
                  className={[
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none",
                    t.key === tab ? "bg-black/15 text-black" : "bg-white text-black",
                  ].join(" ")}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {err ? (
          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      {tab === "new" ? (
        <div className="mt-4 space-y-3">
          {sortedRequests.map((request) => {
            const accepted = request.status === "ACKED";
            const busy = busyId === request.id;

            return (
              <div
                key={request.id}
                className={`${queueCardBase} ${TONE_BORDER[waitInfo(request.createdAt, now).tone]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">Стол {request.table.code}</div>
                      <WaitBadge createdAt={request.createdAt} now={now} />
                    </div>
                    <div className="mt-1 text-sm text-white/60">
                      {request.session?.user ? request.session.user.name : "Гость без аккаунта"}
                    </div>
                  </div>

                  {accepted ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
                      Принят
                    </span>
                  ) : null}
                </div>

                {request.items && request.items.length > 0 ? (
                  <div className="mt-3 space-y-1 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Гость выбрал</div>
                    {request.items.map((item) => (
                      <div key={item.menuItemId} className="flex justify-between gap-3 text-sm text-white/85">
                        <span className="min-w-0 truncate">
                          {item.name} × {item.qty}
                        </span>
                        <span className="shrink-0 text-white/55">{item.qty * item.priceCzk} Kč</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4">
                  {accepted ? (
                    <>
                      <button
                        className={btnAccent}
                        disabled={busy}
                        onClick={() =>
                          setComposer({
                            tableId: request.table.id,
                            tableCode: request.table.code,
                            sessionId: request.session.id,
                            requestId: request.id,
                          })
                        }
                      >
                        Подключиться к столу
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void dismiss(request)}
                        className="mt-2 w-full text-xs text-white/40 underline underline-offset-4 disabled:opacity-50"
                      >
                        {busy ? "…" : "Закрыть заявку без заказа"}
                      </button>
                    </>
                  ) : (
                    <button className={btnPrimary} disabled={busy} onClick={() => void accept(request)}>
                      {busy ? "…" : "Принять"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && sortedRequests.length === 0 ? (
            <div className={`${card} text-sm text-white/60`}>Новых заявок нет.</div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {sortedOrders.map((order) => {
            const sum = order.items.reduce((acc, item) => acc + item.priceCzk * item.qty, 0);
            const busy = busyId === order.id;

            return (
              <div
                key={order.id}
                className={`${queueCardBase} ${TONE_BORDER[waitInfo(order.updatedAt, now).tone]}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">Стол {order.table.code}</div>
                      <WaitBadge createdAt={order.updatedAt} now={now} />
                    </div>
                    <div className="mt-1 text-sm text-white/60">
                      {order.session?.user ? order.session.user.name : "Гость без аккаунта"}
                    </div>
                  </div>
                  <div className="shrink-0 text-lg font-semibold text-white">{sum} Kč</div>
                </div>

                <div className="mt-3 space-y-1 rounded-2xl border border-white/10 bg-black/20 p-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3 text-sm text-white/85">
                      <span className="min-w-0 truncate">
                        {item.menuItem.name} × {item.qty}
                      </span>
                      <span className="shrink-0 text-white/55">{item.priceCzk * item.qty} Kč</span>
                    </div>
                  ))}
                </div>

                {order.comment ? (
                  <div className="mt-2 text-xs text-white/55">Комментарий: {order.comment}</div>
                ) : null}

                <button
                  className={`${btnPrimary} mt-4`}
                  disabled={busy}
                  onClick={() => void markReady(order)}
                >
                  {busy ? "Сохраняем…" : "Готово"}
                </button>
              </div>
            );
          })}

          {!loading && sortedOrders.length === 0 ? (
            <div className={`${card} text-sm text-white/60`}>Сейчас ничего не готовится.</div>
          ) : null}
        </div>
      )}

      {composer ? (
        <OrderComposer
          open
          tableId={composer.tableId}
          tableCode={composer.tableCode}
          sessionId={composer.sessionId}
          requestId={composer.requestId}
          onClose={() => setComposer(null)}
          onSaved={async () => {
            setComposer(null);
            setTab("accepted");
            emitStaffLiveSync("order-created");
            await load({ silent: true });
          }}
        />
      ) : null}
    </div>
  );
}
