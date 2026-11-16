"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  staffLogout,
  getStaffSummary,
  type FetchOpts,
  type StaffOpenAlert,
  type StaffSummary,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { fireInAppAlert, armAudio, isAlertKind, isAudioArmed, type StaffAlertKind } from "@/lib/staffAlerts";
import { refreshScreens } from "@/lib/staffScreenRefresh";
import { isOwnAlert } from "@/lib/staffOwnAlerts";
import { unsubscribePushOnLogout } from "@/lib/staffPush";
import { subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { roleLabel } from "@/lib/staffRoles";

type NavItem = { href: string; label: string; badge?: number; exact?: boolean };

// The same event by live channel and by push: one sound.
const SAME_EVENT_MS = 15_000;
// Two "not accepted" reminders closer than this: one sound.
const REMINDER_MERGE_MS = 45_000;
// An alert waits for its order / call / bill to be on screen at most this
// long; if the data can't be fetched, it sounds anyway.
const SOUND_WAIT_MAX_MS = 3000;
const HEARD_TTL_MS = 15 * 60_000;

type PendingSound = { kind: StaffAlertKind; tag: string | undefined; table: string | null; at: number; timer: number };

function NavTab({ item, active }: { item: NavItem; active: boolean }) {
  const badge = item.badge ?? 0;
  return (
    <Link
      href={item.href}
      className={[
        "relative inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl px-1 text-sm font-semibold transition",
        active ? "bg-white text-black" : "text-white/65 active:bg-white/10",
      ].join(" ")}
    >
      <span className="truncate">{item.label}</span>
      {badge > 0 ? (
        <span className="absolute -right-0.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-[#07070a]">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function shortVenueName(name?: string | null) {
  if (!name) return "";
  return name.replace(/^(LOFT\s*№\s*8|LoftN8|Loft N8|LOFT N8)\s*/i, "").trim();
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { staff, clear } = useStaffSession();

  const [summary, setSummary] = useState<StaffSummary | null>(null);
  const [noShift, setNoShift] = useState(false);

  const onLogout = async () => {
    // Drop this device's push subscription so a shared phone doesn't keep
    // receiving this venue's notifications after sign-out.
    await unsubscribePushOnLogout();
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  // Sound: on right away where the browser allows it (installed app on
  // Android), otherwise at the next tap. iPhone switches it off whenever the
  // app goes to the background, so every tap and every return re-arms it, and
  // a bar says so while it is off.
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    const sync = () => setSoundOn(isAudioArmed());
    const prime = () => void armAudio().then(sync);
    const onVisible = () => {
      if (document.visibilityState === "visible") prime();
    };
    window.addEventListener("pointerdown", prime);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(sync, 3000);
    prime();
    return () => {
      window.removeEventListener("pointerdown", prime);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";
  const isAdminPage = pathname.startsWith("/staff/admin");
  // A shift report opened from the manager's or the admin's list.
  const isReportPage = pathname.startsWith("/staff/reports");
  // Poll the summary on every non-admin screen so the nav badges are always
  // live — SSE ticks are no-ops when polling is disabled.
  const shouldPollSummary = !isAdmin;

  /* ---- one gate for every sound: live channel, push and the summary ---- */

  // tag → when it last sounded (or was found already handled).
  const heardRef = useRef(new Map<string, number>());
  const lastReminderRef = useRef(0);
  // Open alerts the previous summary listed; null until the first one.
  const knownAlertsRef = useRef<Set<string> | null>(null);
  const pendingRef = useRef<PendingSound[]>([]);
  const refreshNowRef = useRef<() => void>(() => {});

  // While the screen is off the lock-screen notification does the job.
  // Nothing sounds for what this device did itself (my own order, my own bill,
  // my own «Готово») — except the "not accepted yet" reminder, which is about
  // the kitchen, not about me.
  const sound = useCallback((kind: StaffAlertKind, tag: string | undefined, table: string | null) => {
    if (document.visibilityState !== "visible") return;
    if (kind !== "TICKET_REMINDER" && isOwnAlert(tag)) return;
    fireInAppAlert({ kind, tag, tableCode: table });
  }, []);

  const queueSound = useCallback(
    (kind: StaffAlertKind, tag: string | undefined, table: string | null) => {
      if (document.visibilityState !== "visible") return;
      const entry: PendingSound = { kind, tag, table, at: Date.now(), timer: 0 };
      entry.timer = window.setTimeout(() => {
        pendingRef.current = pendingRef.current.filter((p) => p !== entry);
        sound(kind, tag, table);
      }, SOUND_WAIT_MAX_MS);
      pendingRef.current.push(entry);
    },
    [sound]
  );

  /** Sound the alerts that a refresh started at `startedAt` has put on screen. */
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
  }, []);

  // Live channel and push: the same event twice is one sound; a guest
  // calling again later sounds again.
  const onServerAlert = useCallback(
    (kind: string | null | undefined, tag: string | null | undefined, tableCode: string | null | undefined) => {
      if (!isAlertKind(kind)) return;
      const at = Date.now();
      pruneHeard(at);
      const table = tableCode ?? null;

      if (kind === "TICKET_REMINDER") {
        if (at - lastReminderRef.current < REMINDER_MERGE_MS) return;
        lastReminderRef.current = at;
        sound(kind, tag ?? undefined, table);
        return;
      }

      if (tag) {
        const last = heardRef.current.get(tag);
        heardRef.current.set(tag, at);
        if (last !== undefined && at - last < SAME_EVENT_MS) return;
      }
      queueSound(kind, tag ?? undefined, table);
    },
    [pruneHeard, queueSound, sound]
  );

  // The summary lists what is still waiting for this account: anything new
  // there that no alert announced (connection dropped, push lost) sounds now.
  const noticeAlerts = useCallback(
    (alerts: StaffOpenAlert[] | undefined) => {
      if (!alerts) return;
      const prev = knownAlertsRef.current;
      knownAlertsRef.current = new Set(alerts.map((a) => a.tag));
      if (!prev) return;

      const at = Date.now();
      pruneHeard(at);
      let found = false;
      for (const alert of alerts) {
        if (prev.has(alert.tag) || heardRef.current.has(alert.tag)) continue;
        heardRef.current.set(alert.tag, at);
        if (!isAlertKind(alert.kind)) continue;
        queueSound(alert.kind, alert.tag, alert.tableCode);
        found = true;
      }
      if (found) refreshNowRef.current();
    },
    [pruneHeard, queueSound]
  );

  const loadSummary = useCallback(
    async (opts?: FetchOpts) => {
      if (isAdmin) return;

      const r = await getStaffSummary(opts);
      if (!r.ok) {
        if (r.status === 409) {
          // No open shift — surface it instead of silently showing zeros, so
          // staff understand why nothing appears.
          setNoShift(true);
          setSummary({ newOrders: 0, newCalls: 0, pendingPayments: 0 });
          // Whatever shows up once the shift opens is new.
          if (!knownAlertsRef.current) knownAlertsRef.current = new Set();
        }
        // Network/server failure — signal the poller so it backs off.
        if (r.status === undefined || r.status >= 500) {
          throw new Error(r.error || "SUMMARY_FAILED");
        }
        return;
      }

      setNoShift(false);
      setSummary(r.data);
      noticeAlerts(r.data.alerts);
    },
    [isAdmin, noticeAlerts]
  );

  const { tick } = usePolling(() => loadSummary(), {
    activeMs: 4000,
    idleMs: 12000,
    immediate: false,
    enabled: shouldPollSummary,
  });

  // After an alert: fresh badges and a fresh open screen (never a request that
  // left before the change), then the sound — together with the data.
  const refreshBusyRef = useRef(false);
  const refreshAgainRef = useRef(false);
  const refreshNow = useCallback(
    function refresh() {
      if (refreshBusyRef.current) {
        refreshAgainRef.current = true;
        return;
      }
      refreshBusyRef.current = true;
      const startedAt = Date.now();
      void Promise.all([loadSummary({ fresh: true }).catch(() => {}), refreshScreens()]).finally(() => {
        refreshBusyRef.current = false;
        flushSounds(startedAt);
        if (refreshAgainRef.current) {
          refreshAgainRef.current = false;
          refresh();
        }
      });
    },
    [flushSounds, loadSummary]
  );
  useEffect(() => {
    refreshNowRef.current = refreshNow;
  }, [refreshNow]);

  // Back on screen after sleep / another app: fresh data at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshNow]);

  const onPush = useCallback(
    (payload: { kind?: string; tag?: string; tableCode?: string | null; opened?: boolean }) => {
      if (!payload.opened) onServerAlert(payload.kind, payload.tag, payload.tableCode);
      refreshNow();
    },
    [onServerAlert, refreshNow]
  );
  useStaffPushEvents(onPush, { inAppAlert: false });

  // Realtime SSE channel — the reliable in-app signal while the dashboard is
  // open, independent of (flaky) web-push. The server already sends each alert
  // only to the roles it concerns.
  useStaffEvents(
    (e) => {
      onServerAlert(e.kind, e.tag, e.tableCode);
      refreshNow();
    },
    { enabled: !isAdmin }
  );

  useEffect(() => {
    if (!shouldPollSummary) return;
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPollSummary, staff?.role]);

  useEffect(() => {
    if (!shouldPollSummary) return;
    return subscribeStaffLiveSync(() => {
      void tick();
    });
  }, [shouldPollSummary, tick]);

  const nav: NavItem[] = isAdmin
    ? [
        { href: "/staff/admin", label: "Статистика", exact: true },
        { href: "/staff/admin/shifts", label: "Смены" },
        { href: "/staff/admin/menu", label: "Меню" },
        { href: "/staff/admin/guests", label: "Гости" },
      ]
    : [
        { href: "/staff/summary", label: "Смена" },
        { href: "/staff/orders", label: "Заказы", badge: summary?.newOrders ?? 0 },
        { href: "/staff/calls", label: "Вызовы", badge: summary?.newCalls ?? 0 },
        { href: "/staff/tables", label: "Столы", badge: summary?.pendingPayments ?? 0 },
      ];

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <div className={`staff-safe mx-auto ${isAdminPage ? "max-w-7xl" : isReportPage ? "max-w-xl" : "max-w-md"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] tracking-[0.18em] text-white/40">
              LOFT№8{staff?.venueName ? ` · ${shortVenueName(staff.venueName)}` : ""}
            </div>
            <div className="text-xl font-semibold">{roleLabel(staff?.role)}</div>
          </div>

          <button
            className="h-9 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/65 active:bg-white/10"
            onClick={onLogout}
          >
            Выйти
          </button>
        </div>

        <nav className="mt-3 flex gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
          {nav.map((item) => (
            <NavTab
              key={item.href}
              item={item}
              active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
            />
          ))}
        </nav>

        {!isAdmin && !soundOn ? (
          <button
            type="button"
            onClick={() => void armAudio().then(() => setSoundOn(isAudioArmed()))}
            className="mt-3 h-9 w-full rounded-xl bg-amber-400 text-sm font-semibold text-black"
          >
            Звук выключен — коснитесь, чтобы включить
          </button>
        ) : null}

        {!isAdmin && noShift ? (
          <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <span className="font-semibold">Смена не открыта.</span>{" "}
            {isManager ? "Откройте её в разделе «Смена»." : "Дождитесь, пока менеджер откроет смену."}
          </div>
        ) : null}

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
