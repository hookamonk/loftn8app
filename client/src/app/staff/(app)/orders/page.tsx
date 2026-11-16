"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectOrderRequest,
  dismissOrderRequest,
  listOrderRequests,
  listTickets,
  moveTicket,
  type StaffOrderRequest,
  type StationTicket,
  type TicketAction,
} from "@/lib/staffApi";
import type { StaffRole } from "@/providers/staffSession";
import { useStaffSession } from "@/providers/staffSession";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useScreenRefresh } from "@/lib/staffScreenRefresh";
import { emitStaffLiveSync, subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { WaitBadge, TONE_BORDER, waitInfo } from "@/lib/staffQueue";
import { canCancelItems, canDeliver, canPrepare, canTakeOrderRequests } from "@/lib/staffRoles";
import { OrderComposer } from "@/components/staff/OrderComposer";
import { TicketCard } from "@/components/staff/TicketCard";
import { CancelItemSheet, type CancelTarget } from "@/components/staff/CancelItemSheet";
import { EtaSheet, type EtaTarget } from "@/components/staff/EtaSheet";

/**
 * Everything about orders on one screen, most urgent first, one button per card:
 *
 *   Официант    К выдаче («Выдано») → Заявки гостей → Готовится (только статус)
 *   Кальянщик   Новые («Принять») → К выдаче («Выдано») → Готовится («Готово»)
 *   Менеджер    Заявки → Не приняты → Готовится → К выдаче → Выданы; ✕ = отмена
 */

const ACTION_LABEL: Record<TicketAction, string> = {
  accept: "Принять",
  ready: "Готово",
  served: "Выдано",
};

function nextAction(role: StaffRole | undefined, ticket: StationTicket): TicketAction | null {
  if (ticket.status === "NEW") return canPrepare(role, ticket.station) ? "accept" : null;
  if (ticket.status === "ACCEPTED") return canPrepare(role, ticket.station) ? "ready" : null;
  if (ticket.status === "READY") return canDeliver(role, ticket.station) ? "served" : null;
  return null;
}

const byTime = (field: "createdAt" | "readyAt") => (a: StationTicket, b: StationTicket) =>
  new Date(a[field] ?? a.createdAt).getTime() - new Date(b[field] ?? b.createdAt).getTime();

type Block = { kind: "tickets"; key: string; title: string; tickets: StationTicket[] } | { kind: "requests" };

function layoutFor(role: StaffRole | undefined, tickets: StationTicket[]): Block[] {
  const of = (status: StationTicket["status"]) => tickets.filter((ticket) => ticket.status === status);
  const fresh = of("NEW").sort(byTime("createdAt"));
  const cooking = of("ACCEPTED").sort(byTime("createdAt"));
  const ready = of("READY").sort(byTime("readyAt"));

  if (role === "WAITER") {
    return [
      { kind: "tickets", key: "ready", title: "К выдаче", tickets: ready },
      { kind: "requests" },
      { kind: "tickets", key: "cooking", title: "Готовится", tickets: [...fresh, ...cooking].sort(byTime("createdAt")) },
    ];
  }

  if (role === "HOOKAH") {
    return [
      { kind: "tickets", key: "new", title: "Новые", tickets: fresh },
      { kind: "tickets", key: "ready", title: "К выдаче", tickets: ready },
      { kind: "tickets", key: "cooking", title: "Готовится", tickets: cooking },
      { kind: "tickets", key: "cancelled", title: "Отменены", tickets: of("CANCELLED") },
    ];
  }

  return [
    { kind: "requests" },
    { kind: "tickets", key: "new", title: "Не приняты", tickets: fresh },
    { kind: "tickets", key: "cooking", title: "Готовится", tickets: cooking },
    { kind: "tickets", key: "ready", title: "К выдаче", tickets: ready },
  ];
}

type ComposerTarget = {
  tableId: number;
  tableCode: string;
  sessionId: string;
  requestId: string;
};

const sectionTitle = "px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45";

export default function StaffOrdersPage() {
  const { push } = useToast();
  const { staff } = useStaffSession();
  const role = staff?.role;
  const takesRequests = canTakeOrderRequests(role);
  const isManager = canCancelItems(role);

  const [requests, setRequests] = useState<StaffOrderRequest[]>([]);
  const [tickets, setTickets] = useState<StationTicket[]>([]);
  const [served, setServed] = useState<StationTicket[] | null>(null);
  const [showServed, setShowServed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [etaTarget, setEtaTarget] = useState<EtaTarget | null>(null);

  // Live clock so the waiting times tick between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  // A slower, older answer never overwrites a newer one.
  const loadSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    const seq = ++loadSeqRef.current;
    const fetchOpts = opts?.fresh ? { fresh: true } : undefined;
    const [requestsResult, ticketsResult, servedResult] = await Promise.all([
      takesRequests ? listOrderRequests(fetchOpts) : Promise.resolve(null),
      listTickets("active", fetchOpts),
      showServed ? listTickets("served", fetchOpts) : Promise.resolve(null),
    ]);
    if (seq < appliedSeqRef.current) return;
    appliedSeqRef.current = seq;

    setLoaded(true);

    if (!ticketsResult.ok) {
      setErr(ticketsResult.status === 409 ? null : ticketsResult.error);
      if (ticketsResult.status === 409) {
        setTickets([]);
        setRequests([]);
      }
      return;
    }

    setErr(null);
    setTickets(ticketsResult.data.tickets);
    if (requestsResult?.ok) setRequests(requestsResult.data.requests);
    if (servedResult?.ok) setServed(servedResult.data.tickets);
  }, [takesRequests, showServed]);

  const { tick } = usePolling(() => load(), {
    activeMs: 8000,
    idleMs: 20000,
    immediate: false,
    enabled: !!staff,
  });

  useEffect(() => {
    if (staff) void load();
  }, [staff, load]);

  // Alerts: the shell refreshes this screen with fresh data, then sounds.
  useScreenRefresh(() => load({ fresh: true }), !!staff);
  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

  const run = async (ticket: StationTicket, action: TicketAction) => {
    setBusyId(ticket.id);
    const result = await moveTicket(ticket.id, action);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
    } else {
      emitStaffLiveSync(`ticket-${action}`);
    }
    await load();
  };

  const accept = async (request: StaffOrderRequest) => {
    setBusyId(request.id);
    const result = await connectOrderRequest(request.id);
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    // The guest instantly sees "waiter is on the way"; the card stays and now
    // offers the next step.
    emitStaffLiveSync("order-request-accepted");
    await load();
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
    await load();
  };

  const sortedRequests = [...requests].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const ticketCard = (ticket: StationTicket) => {
    const action = nextAction(role, ticket);
    return (
      <TicketCard
        key={ticket.id}
        ticket={ticket}
        now={now}
        showStation={role !== "HOOKAH"}
        showStatus={!action}
        action={
          action
            ? {
                label: ACTION_LABEL[action],
                tone: action === "accept" ? "primary" : "accent",
                busy: busyId === ticket.id,
                onClick: () => void run(ticket, action),
              }
            : null
        }
        onCancelLine={
          isManager
            ? (line) =>
                setCancelTarget({
                  orderId: line.orderId,
                  itemId: line.id,
                  name: line.name,
                  qty: line.qty,
                  tableCode: ticket.table.code,
                })
            : undefined
        }
        // Whoever prepares it (manager, hookah master for hookahs) may set the
        // ready time; the waiter only sees it.
        onEta={
          canPrepare(role, ticket.station)
            ? () =>
                setEtaTarget({ ticketId: ticket.id, tableCode: ticket.table.code, current: ticket.etaMinutes ?? null })
            : undefined
        }
      />
    );
  };

  const blocks = layoutFor(role, tickets);
  const nothing = loaded && !err && tickets.length === 0 && (!takesRequests || requests.length === 0);

  return (
    <div className="space-y-4">
      {err ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      ) : null}

      {!loaded ? <div className="text-sm text-white/60">Загрузка…</div> : null}

      {nothing ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-3.5 text-sm text-white/60">
          Сейчас заказов нет.
        </div>
      ) : null}

      {blocks.map((block) => {
        if (block.kind === "requests") {
          if (!takesRequests || sortedRequests.length === 0) return null;
          return (
            <section key="requests" className="space-y-2">
              <div className={sectionTitle}>Заявки гостей · {sortedRequests.length}</div>
              {sortedRequests.map((request) => {
                const taken = request.status === "ACKED";
                const busy = busyId === request.id;
                return (
                  <div
                    key={request.id}
                    className={`rounded-3xl border bg-white/[0.05] p-3.5 ${TONE_BORDER[waitInfo(request.createdAt, now).tone]}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-lg font-bold text-white">Стол {request.table.code}</span>
                        <WaitBadge createdAt={request.createdAt} now={now} />
                      </div>
                      {taken ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                          Вы идёте
                        </span>
                      ) : null}
                    </div>

                    {request.items && request.items.length > 0 ? (
                      <div className="mt-2 space-y-0.5 text-sm text-white/80">
                        {request.items.map((item) => (
                          <div key={item.menuItemId}>
                            <span className="font-bold tabular-nums">{item.qty} ×</span> {item.name}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {taken ? (
                      <>
                        <button
                          className="mt-3 h-11 w-full rounded-xl bg-emerald-400 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
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
                          Пробить заказ
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void dismiss(request)}
                          className="mt-2 w-full text-xs text-white/40 underline underline-offset-4 disabled:opacity-50"
                        >
                          {busy ? "…" : "Закрыть без заказа"}
                        </button>
                      </>
                    ) : (
                      <button
                        className="mt-3 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void accept(request)}
                      >
                        {busy ? "…" : "Иду к столу"}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        }

        if (block.tickets.length === 0) return null;
        return (
          <section key={block.key} className="space-y-2">
            <div className={sectionTitle}>
              {block.title} · {block.tickets.length}
            </div>
            {block.tickets.map(ticketCard)}
          </section>
        );
      })}

      {isManager && loaded ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setShowServed((value) => !value);
              if (showServed) setServed(null);
            }}
            className="h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/70"
          >
            {showServed ? "Скрыть выданные" : "Выданные за смену"}
          </button>
          {showServed && served
            ? served.length
              ? served.map(ticketCard)
              : <div className="px-1 text-sm text-white/50">Пока ничего не выдано.</div>
            : null}
        </section>
      ) : null}

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
            emitStaffLiveSync("order-created");
            await load();
          }}
        />
      ) : null}

      <EtaSheet
        target={etaTarget}
        onClose={() => setEtaTarget(null)}
        onDone={async () => {
          setEtaTarget(null);
          await load({ fresh: true });
        }}
      />

      <CancelItemSheet
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={async () => {
          setCancelTarget(null);
          emitStaffLiveSync("order-item-cancelled");
          await load();
        }}
      />
    </div>
  );
}
