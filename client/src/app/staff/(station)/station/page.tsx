"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listCalls,
  listTickets,
  moveTicket,
  staffLogout,
  updateCallStatus,
  type StaffCall,
  type StationTicket,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { useToast } from "@/providers/toast";
import { usePolling } from "@/lib/usePolling";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { armAudio, fireInAppAlert, isAlertKind, isAudioArmed } from "@/lib/staffAlerts";
import { unsubscribePushOnLogout } from "@/lib/staffPush";
import { stationScreenTitle } from "@/lib/staffRoles";
import { TicketCard } from "@/components/staff/TicketCard";
import { NotificationSetup } from "@/components/staff/NotificationSetup";

/**
 * Station iPad: kitchen, bar or hookah zone. Only this station's tickets,
 * oldest first, one big button each:
 *
 *   new ticket  →  «Принять»  (stops the reminder chime)
 *   accepted    →  «Готово»   (the waiter / hookah master is notified)
 *
 * A ticket nobody accepted re-alerts every couple of minutes until someone
 * does. The screen is kept awake and asks for one tap if sound is blocked.
 * The hookah zone also gets the guests' hookah calls (coals, too harsh…).
 */

type WakeLockSentinelLike = { release: () => Promise<void> };

function useScreenWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await nav.wakeLock!.request("screen");
        if (cancelled) void next.release().catch(() => {});
        else sentinel = next;
      } catch {
        // not allowed right now (battery saver, no gesture) — the next
        // visibility change tries again
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}

function sortForStation(tickets: StationTicket[]) {
  const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
  const rank = { NEW: 0, ACCEPTED: 1, CANCELLED: 2 } as Record<string, number>;
  return tickets
    // READY / SERVED tickets are done as far as the station is concerned.
    .filter((ticket) => ticket.status === "NEW" || ticket.status === "ACCEPTED" || ticket.status === "CANCELLED")
    .sort((a, b) => {
      const r = rank[a.status] - rank[b.status];
      if (r !== 0) return r;
      if (a.status === "CANCELLED") return time(b.cancelledAt) - time(a.cancelledAt);
      return time(a.createdAt) - time(b.createdAt);
    });
}

export default function StaffStationPage() {
  const router = useRouter();
  const { staff, clear } = useStaffSession();
  const { push } = useToast();

  const [tickets, setTickets] = useState<StationTicket[]>([]);
  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [noShift, setNoShift] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(() => isAudioArmed());
  const [now, setNow] = useState(() => Date.now());

  useScreenWakeLock();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setSoundOn(isAudioArmed());
    }, 3000);
    // Any tap re-arms sound (iOS suspends it after the app was in background).
    const prime = () => void armAudio().then(() => setSoundOn(isAudioArmed()));
    window.addEventListener("pointerdown", prime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", prime);
    };
  }, []);

  const answersCalls = staff?.role === "HOOKAH_ZONE";

  const load = useCallback(async () => {
    const [result, callsResult] = await Promise.all([
      listTickets("active"),
      answersCalls ? listCalls("NEW") : Promise.resolve(null),
    ]);
    setLoaded(true);
    if (callsResult?.ok) setCalls(callsResult.data.calls);

    if (!result.ok) {
      if (result.status === 409) {
        setNoShift(true);
        setTickets([]);
        setErr(null);
        return;
      }
      setErr(result.error);
      if (result.status === 0 || result.status >= 500) throw new Error(result.error);
      return;
    }

    setNoShift(false);
    setErr(null);
    setTickets(result.data.tickets);
  }, [answersCalls]);

  const { tick } = usePolling(() => load(), {
    activeMs: 5000,
    idleMs: 15000,
    immediate: true,
    enabled: !!staff,
  });

  // Alerts arrive role-filtered from the server: new ticket, reminder, cancel.
  useStaffEvents((e) => {
    if (document.visibilityState === "visible" && isAlertKind(e.kind)) {
      fireInAppAlert({ kind: e.kind, tableCode: e.tableCode ?? null, tag: e.tag ?? undefined });
    }
    void tick();
  });
  useStaffPushEvents(() => void tick());

  const visible = useMemo(() => sortForStation(tickets), [tickets]);
  const waiting = visible.filter((ticket) => ticket.status === "NEW").length;
  const cooking = visible.filter((ticket) => ticket.status === "ACCEPTED").length;

  const run = async (ticket: StationTicket, action: "accept" | "ready") => {
    setBusyId(ticket.id);
    const result = await moveTicket(ticket.id, action);
    setBusyId(null);
    if (!result.ok) push({ kind: "error", title: "Ошибка", message: result.error });
    await load().catch(() => {});
  };

  const acceptCall = async (call: StaffCall) => {
    setBusyId(call.id);
    setCalls((current) => current.filter((c) => c.id !== call.id));
    const result = await updateCallStatus(call.id, "DONE");
    setBusyId(null);
    if (!result.ok) push({ kind: "error", title: "Ошибка", message: result.error });
    await load().catch(() => {});
  };

  const sortedCalls = [...calls].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const logout = async () => {
    if (!window.confirm("Выйти из аккаунта станции? Заказы перестанут приходить на этот экран.")) return;
    await unsubscribePushOnLogout();
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <div className="mx-auto max-w-[1400px] p-4 pb-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.18em] text-white/40">
              LOFT№8 · {staff?.venueName?.replace(/^LOFT№8\s*/i, "") ?? ""}
            </div>
            <h1 className="text-2xl font-bold">{stationScreenTitle(staff?.role)}</h1>
          </div>

          <div className="flex items-center gap-2">
            {waiting > 0 ? (
              <span className="animate-pulse rounded-full bg-red-500/25 px-3 py-1 text-sm font-semibold text-red-100">
                Не приняты: {waiting}
              </span>
            ) : null}
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/75">
              Готовятся: {cooking}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="h-9 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/60"
            >
              Выйти
            </button>
          </div>
        </header>

        {!soundOn ? (
          <button
            type="button"
            onClick={() => void armAudio().then(() => setSoundOn(isAudioArmed()))}
            className="mt-3 h-12 w-full rounded-xl bg-amber-400 text-base font-semibold text-black"
          >
            Звук выключен — нажмите, чтобы включить
          </button>
        ) : null}

        <div className="mt-3">
          <NotificationSetup />
        </div>

        {noShift ? (
          <div className="mt-6 rounded-3xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
            Смена не открыта. Заказы появятся, когда менеджер откроет смену.
          </div>
        ) : null}

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
        ) : null}

        {sortedCalls.length > 0 ? (
          <section className="mt-4">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Вызовы · {sortedCalls.length}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortedCalls.map((call) => {
                const mins = Math.max(0, Math.floor((now - new Date(call.createdAt).getTime()) / 60000));
                return (
                  <div key={call.id} className="flex flex-col rounded-3xl border border-amber-400/50 bg-amber-400/[0.07] p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-2xl font-bold text-white">Стол {call.table.code}</span>
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-sm font-semibold text-white/70">
                        {mins < 1 ? "сейчас" : `${mins} мин`}
                      </span>
                    </div>
                    <div className="mt-2 text-lg font-semibold text-amber-100">{call.message || "Нужен кальянщик"}</div>
                    <div className="mt-auto pt-3">
                      <button
                        type="button"
                        disabled={busyId === call.id}
                        onClick={() => void acceptCall(call)}
                        className="h-14 w-full rounded-xl bg-white text-lg font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
                      >
                        Принять
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {loaded && !noShift && !err && visible.length === 0 && sortedCalls.length === 0 ? (
          <div className="mt-16 text-center text-lg text-white/40">Заказов нет</div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              size="lg"
              action={
                ticket.status === "NEW"
                  ? {
                      label: "Принять",
                      tone: "primary",
                      busy: busyId === ticket.id,
                      onClick: () => void run(ticket, "accept"),
                    }
                  : ticket.status === "ACCEPTED"
                  ? {
                      label: "Готово",
                      tone: "accent",
                      busy: busyId === ticket.id,
                      onClick: () => void run(ticket, "ready"),
                    }
                  : null
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
