"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  listOrders,
  listOrderRequests,
  connectOrderRequest,
  updateOrderStatus,
  type StaffOrder,
  type StaffOrderRequest,
  type OrderStatus,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { emitStaffLiveSync } from "@/lib/staffLiveSync";

const STATUSES: OrderStatus[] = ["IN_PROGRESS", "DELIVERED", "CANCELLED"];

function statusLabel(s: OrderStatus) {
  if (s === "NEW") return "Preparing";
  if (s === "IN_PROGRESS") return "Preparing";
  if (s === "DELIVERED") return "Ready";
  return "Cancelled";
}

function nextAction(s: OrderStatus) {
  if (s === "IN_PROGRESS") return { status: "DELIVERED" as OrderStatus, label: "Mark as ready" };
  return null;
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
  const searchParams = useSearchParams();
  const initialStatus = (() => {
    const raw = searchParams.get("status");
    return STATUSES.includes(raw as OrderStatus) ? (raw as OrderStatus) : "IN_PROGRESS";
  })();
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [requests, setRequests] = useState<StaffOrderRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const [ordersResult, requestsResult] = await Promise.all([listOrders(status), listOrderRequests()]);

    if (!silent) setLoading(false);

    if (!ordersResult.ok) {
      setErr(ordersResult.error);
      return;
    }

    setOrders(ordersResult.data.orders);
    setRequests(requestsResult.ok ? requestsResult.data.requests : []);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 15000,
    idleMs: 45000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useStaffPushEvents((payload) => {
    if (payload.kind === "ORDER_CREATED") {
      void tick();
    }
  });

  useEffect(() => {
    const raw = searchParams.get("status");
    if (raw && STATUSES.includes(raw as OrderStatus) && raw !== status) {
      setStatus(raw as OrderStatus);
    } else if (raw === "NEW" && status !== "IN_PROGRESS") {
      setStatus("IN_PROGRESS");
      router.replace("/staff/orders?status=IN_PROGRESS");
    }
  }, [searchParams, status, router]);

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
    emitStaffLiveSync("order-status-updated");
    await load({ silent: false });
  };

  const connectToTable = async (request: StaffOrderRequest) => {
    setBusyId(request.id);
    const result = await connectOrderRequest(request.id);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Error", message: result.error });
      return;
    }

    const connected = result.data.request;
    emitStaffLiveSync("order-request-connected");
    router.push(
      `/staff/orders/create?requestId=${encodeURIComponent(connected.id)}&tableId=${connected.table.id}&tableCode=${encodeURIComponent(
        connected.table.code
      )}&sessionId=${encodeURIComponent(connected.session.id)}`
    );
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Orders</div>
            <div className="mt-1 text-xs text-white/50">
              Auto refresh: {isRunning ? "on" : "off"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">
              Orders: {orders.length} • Items: {totalItems}
            </div>
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
              onClick={() => {
                setStatus(s);
                router.replace(`/staff/orders?status=${s}`);
              }}
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

      <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Order requests</div>
            <div className="mt-1 text-xs text-white/55">Tables waiting for a staff member to take the order</div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-semibold text-white/75">
            {requests.length}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {requests.map((request) => (
            <div
              key={request.id}
              className="rounded-2xl border border-white/10 bg-black/20 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Table {request.table.code}
                    {request.table.label ? ` • ${request.table.label}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    {new Date(request.createdAt).toLocaleTimeString()} • {request.status === "ACKED" ? "On the way" : "Requested"}
                  </div>
                  <div className="mt-2 text-sm text-white/70">
                    {request.session.user
                      ? `${request.session.user.name} • ${request.session.user.phone}`
                      : "Guest without account"}
                  </div>
                </div>

                <button
                  className={btnPrimary}
                  disabled={busyId === request.id}
                  onClick={() => void connectToTable(request)}
                >
                  {busyId === request.id ? "Connecting…" : "Connect to table"}
                </button>
              </div>
            </div>
          ))}

          {!loading && requests.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
              No active order requests right now.
            </div>
          ) : null}
        </div>
      </div>

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
                    Table {o.table.code}
                    {o.table.label ? ` • ${o.table.label}` : ""}
                  </div>

                  <div className="mt-1 text-sm text-white/70">
                    {o.session?.user
                      ? `${o.session.user.name} • ${o.session.user.phone}`
                      : "Guest without account"}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-white/50">Amount</div>
                  <div className="mt-1 text-lg font-semibold text-white">{sum} Kč</div>
                </div>
              </div>

              {o.comment ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/85">
                  Order comment: {o.comment}
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
                        <div className="mt-1 text-xs text-white/60">Comment: {it.comment}</div>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-sm font-semibold text-white">
                      {it.priceCzk * it.qty} Kč
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2">
                {action ? (
                  <button
                    className={action.status === "IN_PROGRESS" ? btnPrimary : btn}
                    disabled={busyId === o.id}
                    onClick={() =>
                      void setTo(
                        o.id,
                        action.status,
                        action.status === "IN_PROGRESS" ? "Order moved to preparing" : "Order marked as ready"
                      )
                    }
                  >
                    {busyId === o.id ? "Saving…" : action.label}
                  </button>
                ) : null}

                {o.status !== "CANCELLED" && o.status !== "DELIVERED" ? (
                  <button
                    className={btnGhost}
                    disabled={busyId === o.id}
                    onClick={() => void setTo(o.id, "CANCELLED", "Order cancelled")}
                  >
                    Cancel order
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && orders.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>No orders in this section.</div>
        ) : null}
      </div>
    </div>
  );
}
