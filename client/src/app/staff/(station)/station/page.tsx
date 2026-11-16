"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  joinShift,
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
import {
  armAudio,
  fireInAppAlert,
  isAlertKind,
  isAudioArmed,
  setStationAlertProfile,
  type StaffAlertKind,
} from "@/lib/staffAlerts";
import { unsubscribePushOnLogout } from "@/lib/staffPush";
import { stationScreenTitle } from "@/lib/staffRoles";
import { TicketCard } from "@/components/staff/TicketCard";
import { EtaSheet, type EtaTarget } from "@/components/staff/EtaSheet";
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
 *
 * Sound does not depend on one channel: the live channel and web push alert
 * right away, and the 5-second refresh beeps by itself for anything they
 * missed (new ticket, cancellation, hookah call), plus its own reminder while
 * a ticket waits. One gate below makes sure each event beeps once.
 *
 * The order and its sound arrive together: an alert from the server fetches
 * fresh data at once and sounds when the order is on screen (or after 3 s at
 * the latest, if the data can't be fetched).
 */

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

// The server reminds every TICKET_REMINDER_MINUTES (2). The screen's own
// reminder is the fallback for when that reminder does not arrive, so it
// waits a bit longer and never doubles a server reminder.
const FALLBACK_REMINDER_MS = 165_000;
// Two reminders closer than this make one sound.
const REMINDER_MERGE_MS = 45_000;
// A cancellation heard from the server covers what the refresh sees this long.
const CANCEL_MATCH_MS = 30_000;
const HEARD_TTL_MS = 15 * 60_000;
// A server alert waits for its order to be on screen; if the data can't be
// fetched this fast, it sounds anyway — an order must never go unheard.
const SOUND_WAIT_MAX_MS = 3000;

/** The ticket / call id inside a server alert tag. */
function idFromTag(tag: string | null | undefined, prefix: string) {
  if (!tag || !tag.startsWith(prefix)) return null;
  return tag.slice(prefix.length).split(":")[0] || null;
}

function useScreenWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let pending = false;
    let cancelled = false;
    let retryTimer: number | null = null;

    const acquire = async () => {
      if (cancelled || pending || sentinel || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
        // Android drops the lock on its own (battery saver, a system dialog):
        // take it back as soon as the screen is ours again.
        next.addEventListener?.("release", () => {
          if (sentinel === next) sentinel = null;
          if (cancelled) return;
          if (retryTimer !== null) window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(() => void acquire(), 3000);
        });
      } catch {
        // not allowed right now (battery saver, no gesture) — the next
        // visibility change or tap tries again
      } finally {
        pending = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    const onTap = () => void acquire();

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onTap);
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onTap);
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
  const [etaTarget, setEtaTarget] = useState<EtaTarget | null>(null);
  const [soundOn, setSoundOn] = useState(() => isAudioArmed());
  const [now, setNow] = useState(() => Date.now());

  useScreenWakeLock();

  // Louder, longer alerts — on this screen only, waiter phones keep theirs.
  useEffect(() => {
    setStationAlertProfile(true);
    return () => setStationAlertProfile(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setSoundOn(isAudioArmed());
    }, 3000);
    // Any tap re-arms sound (iOS suspends it after the app was in background).
    const prime = () => void armAudio().then(() => setSoundOn(isAudioArmed()));
    // Back on screen after sleep or another app: re-arm right away, Android
    // allows it without a tap once the app has been tapped before.
    const onVisible = () => {
      if (document.visibilityState === "visible") prime();
    };
    window.addEventListener("pointerdown", prime);
    document.addEventListener("visibilitychange", onVisible);
    // Try right away too: where the browser allows sound without a tap (an
    // installed app, a site used every day) the banner never shows up.
    prime();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", prime);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /* ---- one gate for every sound: live channel, push and the refresh ---- */

  // What already beeped: new:<ticket>, cancel:<ticket>, call:<call>, tag:<server tag>.
  const heardRef = useRef(new Map<string, number>());
  // Cancellations the refresh found before the server's alert arrived.
  const polledCancelRef = useRef(new Map<string, number>());
  const lastReminderRef = useRef(0);

  // While the screen is off the lock-screen notification does the job.
  const sound = useCallback((kind: StaffAlertKind, tag: string | undefined, tableCode: string | null) => {
    if (document.visibilityState !== "visible") return;
    fireInAppAlert({ kind, tag, tableCode });
  }, []);

  // Server alerts waiting for the refresh that puts their order on screen.
  const pendingRef = useRef<
    Array<{ kind: StaffAlertKind; tag: string | undefined; table: string | null; at: number; timer: number }>
  >([]);

  const queueSound = useCallback(
    (kind: StaffAlertKind, tag: string | undefined, table: string | null) => {
      if (document.visibilityState !== "visible") return;
      const at = Date.now();
      const entry = { kind, tag, table, at, timer: 0 };
      entry.timer = window.setTimeout(() => {
        pendingRef.current = pendingRef.current.filter((p) => p !== entry);
        sound(kind, tag, table);
      }, SOUND_WAIT_MAX_MS);
      pendingRef.current.push(entry);
    },
    [sound]
  );

  /** Sound the alerts that this refresh (started at `startedAt`) has put on screen. */
  const flushSounds = useCallback(
    (startedAt: number) => {
      const due = pendingRef.current.filter((p) => p.at <= startedAt);
      if (due.length === 0) return;
      pendingRef.current = pendingRef.current.filter((p) => p.at > startedAt);
      for (const p of due) {
        window.clearTimeout(p.timer);
        sound(p.kind, p.tag, p.table);
      }
    },
    [sound]
  );

  useEffect(
    () => () => {
      for (const p of pendingRef.current) window.clearTimeout(p.timer);
      pendingRef.current = [];
    },
    []
  );

  const pruneHeard = useCallback((at: number) => {
    for (const [key, ts] of heardRef.current) if (at - ts > HEARD_TTL_MS) heardRef.current.delete(key);
    for (const [key, ts] of polledCancelRef.current) if (at - ts > CANCEL_MATCH_MS) polledCancelRef.current.delete(key);
  }, []);

  const onServerAlert = useCallback(
    (kind: string | null | undefined, tag: string | null | undefined, tableCode: string | null | undefined) => {
      if (!isAlertKind(kind)) return;
      const at = Date.now();
      pruneHeard(at);
      const heard = heardRef.current;
      const table = tableCode ?? null;

      if (kind === "TICKET_REMINDER") {
        if (at - lastReminderRef.current < REMINDER_MERGE_MS) return;
        lastReminderRef.current = at;
        sound(kind, tag ?? `station-reminder:${at}`, table);
        return;
      }

      if (kind === "TICKET_CANCELLED") {
        // Live channel and push carry the same tag: one sound for both.
        if (tag) {
          if (heard.has(`tag:${tag}`)) return;
          heard.set(`tag:${tag}`, at);
        }
        const ticketId = idFromTag(tag, "ticket_cancel:");
        if (ticketId) {
          heard.set(`cancel:${ticketId}`, at);
          const polled = polledCancelRef.current.get(ticketId);
          if (polled !== undefined && at - polled < CANCEL_MATCH_MS) {
            polledCancelRef.current.delete(ticketId);
            return;
          }
        }
        queueSound(kind, tag ?? `ticket_cancel:${at}`, table);
        return;
      }

      const ticketId = kind === "TICKET_NEW" ? idFromTag(tag, "ticket:") : null;
      const callId = idFromTag(tag, "call_new:");
      const key = ticketId ? `new:${ticketId}` : callId ? `call:${callId}` : tag ? `tag:${tag}` : null;
      if (key) {
        if (heard.has(key)) return;
        heard.set(key, at);
      }
      queueSound(kind, tag ?? undefined, table);
    },
    [pruneHeard, queueSound, sound]
  );

  // What the previous refresh saw; null until the first one (nothing to
  // compare with yet — tickets already waiting get the reminder).
  const snapshotRef = useRef<Map<string, { status: string; cancels: number }> | null>(null);
  const callIdsRef = useRef<Set<string> | null>(null);
  const ticketsRef = useRef<StationTicket[]>([]);

  const noticeTickets = useCallback(
    (next: StationTicket[]) => {
      const prev = snapshotRef.current;
      snapshotRef.current = new Map(next.map((t) => [t.id, { status: t.status, cancels: t.cancellations.length }]));
      ticketsRef.current = next;
      if (!prev) return;

      const at = Date.now();
      pruneHeard(at);
      const heard = heardRef.current;

      for (const ticket of next) {
        const before = prev.get(ticket.id);
        const table = ticket.table.code;

        if (!before && ticket.status === "NEW") {
          const key = `new:${ticket.id}`;
          if (heard.has(key)) continue;
          heard.set(key, at);
          sound("TICKET_NEW", `ticket:${ticket.id}`, table);
          continue;
        }

        const cancelled = before
          ? ticket.cancellations.length > before.cancels || (ticket.status === "CANCELLED" && before.status !== "CANCELLED")
          : ticket.status === "CANCELLED";
        if (!cancelled) continue;

        const last = heard.get(`cancel:${ticket.id}`);
        if (last !== undefined && at - last < CANCEL_MATCH_MS) continue;
        heard.set(`cancel:${ticket.id}`, at);
        polledCancelRef.current.set(ticket.id, at);
        sound("TICKET_CANCELLED", `poll_cancel:${ticket.id}:${ticket.cancellations.length}`, table);
      }
    },
    [pruneHeard, sound]
  );

  const noticeCalls = useCallback(
    (next: StaffCall[]) => {
      const prev = callIdsRef.current;
      callIdsRef.current = new Set(next.map((call) => call.id));
      if (!prev) return;

      const at = Date.now();
      for (const call of next) {
        if (prev.has(call.id)) continue;
        const key = `call:${call.id}`;
        if (heardRef.current.has(key)) continue;
        heardRef.current.set(key, at);
        sound("CALL_CREATED", `call_new:${call.id}`, call.table.code);
      }
    },
    [sound]
  );

  // Fallback reminder: the server's reminder normally comes every 2 minutes
  // and keeps this one quiet; if it stops arriving, the screen reminds itself.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const at = Date.now();
      const overdue = ticketsRef.current.some(
        (ticket) => ticket.status === "NEW" && at - new Date(ticket.createdAt).getTime() >= FALLBACK_REMINDER_MS
      );
      if (!overdue || at - lastReminderRef.current < FALLBACK_REMINDER_MS) return;
      lastReminderRef.current = at;
      sound("TICKET_REMINDER", `station-reminder:${at}`, null);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [sound]);

  const answersCalls = staff?.role === "HOOKAH_ZONE";
  // The station joins the open shift by itself, so the manager sees the
  // kitchen / bar / hookah-zone iPads in «В смене».
  const joinedRef = useRef(false);

  // Refreshes may overlap (regular poll + one right after an alert): a slower,
  // older answer never overwrites a newer one.
  const loadSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const load = useCallback(async (opts?: { fresh?: boolean }) => {
    const seq = ++loadSeqRef.current;
    const startedAt = Date.now();
    const fetchOpts = opts?.fresh ? { fresh: true } : undefined;
    const [result, callsResult] = await Promise.all([
      listTickets("active", fetchOpts),
      answersCalls ? listCalls("NEW", fetchOpts) : Promise.resolve(null),
    ]);
    if (seq < appliedSeqRef.current) return;
    appliedSeqRef.current = seq;
    setLoaded(true);
    if (callsResult?.ok) {
      noticeCalls(callsResult.data.calls);
      setCalls(callsResult.data.calls);
    }

    if (!result.ok) {
      if (result.status === 409) {
        joinedRef.current = false;
        // No shift yet: whatever shows up once it opens is new.
        noticeTickets([]);
        if (answersCalls && !callIdsRef.current) callIdsRef.current = new Set();
        setNoShift(true);
        setTickets([]);
        setErr(null);
        flushSounds(startedAt);
        return;
      }
      setErr(result.error);
      if (result.status === 0 || result.status >= 500) throw new Error(result.error);
      return;
    }

    setNoShift(false);
    setErr(null);
    noticeTickets(result.data.tickets);
    setTickets(result.data.tickets);
    // The order is on screen now — and its alert sounds with it.
    flushSounds(startedAt);

    if (!joinedRef.current) {
      joinedRef.current = true;
      void joinShift().then((r) => {
        if (!r.ok) joinedRef.current = false;
      });
    }
  }, [answersCalls, flushSounds, noticeCalls, noticeTickets]);

  usePolling(() => load(), {
    activeMs: 5000,
    idleMs: 15000,
    immediate: true,
    enabled: !!staff,
  });

  // Right after an alert: a new request (never one that left before the
  // change, never stuck behind a hung one). One at a time, plus one queued.
  const freshBusyRef = useRef(false);
  const freshAgainRef = useRef(false);
  const refreshNow = useCallback(
    function refresh() {
      if (freshBusyRef.current) {
        freshAgainRef.current = true;
        return;
      }
      freshBusyRef.current = true;
      void load({ fresh: true })
        .catch(() => {})
        .finally(() => {
          freshBusyRef.current = false;
          if (freshAgainRef.current) {
            freshAgainRef.current = false;
            refresh();
          }
        });
    },
    [load]
  );

  // Back on screen after sleep: fresh data at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshNow]);

  // Alerts arrive role-filtered from the server: new ticket, reminder, cancel.
  useStaffEvents((e) => {
    onServerAlert(e.kind, e.tag, e.tableCode);
    refreshNow();
  });
  const onPush = useCallback(
    (p: { kind?: string; tag?: string; tableCode?: string | null; opened?: boolean }) => {
      if (!p.opened) onServerAlert(p.kind, p.tag, p.tableCode);
      refreshNow();
    },
    [onServerAlert, refreshNow]
  );
  useStaffPushEvents(onPush, { inAppAlert: false });

  const visible = useMemo(() => sortForStation(tickets), [tickets]);
  const waiting = visible.filter((ticket) => ticket.status === "NEW").length;
  const cooking = visible.filter((ticket) => ticket.status === "ACCEPTED").length;

  const run = async (ticket: StationTicket, action: "accept" | "ready") => {
    setBusyId(ticket.id);
    const result = await moveTicket(ticket.id, action);
    setBusyId(null);
    if (!result.ok) push({ kind: "error", title: "Ошибка", message: result.error });
    await load({ fresh: true }).catch(() => {});
  };

  const acceptCall = async (call: StaffCall) => {
    setBusyId(call.id);
    setCalls((current) => current.filter((c) => c.id !== call.id));
    const result = await updateCallStatus(call.id, "DONE");
    setBusyId(null);
    if (!result.ok) push({ kind: "error", title: "Ошибка", message: result.error });
    await load({ fresh: true }).catch(() => {});
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
      <div className="staff-safe mx-auto max-w-[1400px]">
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
            Коснитесь экрана, чтобы включить звук
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
              // The kitchen reads dish names in Czech; the bar and the hookah zone as before.
              czechNames={staff?.role === "KITCHEN"}
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
              // Busy hours: «Выдача через 10–40 мин», the waiter sees it too.
              onEta={() =>
                setEtaTarget({ ticketId: ticket.id, tableCode: ticket.table.code, current: ticket.etaMinutes ?? null })
              }
            />
          ))}
        </div>

        <EtaSheet
          target={etaTarget}
          large
          onClose={() => setEtaTarget(null)}
          onDone={() => {
            setEtaTarget(null);
            void load({ fresh: true }).catch(() => {});
          }}
        />
      </div>
    </div>
  );
}
