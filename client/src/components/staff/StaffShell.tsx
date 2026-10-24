"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { staffLogout, getStaffSummary, type StaffSummary } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { fireInAppAlert, armAudio, isAlertKind } from "@/lib/staffAlerts";
import { unsubscribePushOnLogout } from "@/lib/staffPush";
import { subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { roleLabel } from "@/lib/staffRoles";

type NavItem = { href: string; label: string; badge?: number; exact?: boolean };

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

  // Prime the alert audio on the first interaction with the dashboard, so new
  // orders/calls beep even for staff who didn't enable push notifications.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prime = () => void armAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";
  const isAdminPage = pathname.startsWith("/staff/admin");
  // Poll the summary on every non-admin screen so the nav badges are always
  // live — SSE ticks are no-ops when polling is disabled.
  const shouldPollSummary = !isAdmin;

  const loadSummary = async () => {
    if (isAdmin) return;

    const r = await getStaffSummary();
    if (!r.ok) {
      if (r.status === 409) {
        // No open shift — surface it instead of silently showing zeros, so
        // staff understand why nothing appears.
        setNoShift(true);
        setSummary({ newOrders: 0, newCalls: 0, pendingPayments: 0 });
      }
      // Network/server failure — signal the poller so it backs off.
      if (r.status === undefined || r.status >= 500) {
        throw new Error(r.error || "SUMMARY_FAILED");
      }
      return;
    }

    setNoShift(false);
    setSummary(r.data);
  };

  const { tick } = usePolling(() => loadSummary(), {
    activeMs: 4000,
    idleMs: 12000,
    immediate: false,
    enabled: shouldPollSummary,
  });

  useStaffPushEvents((payload) => {
    if (isAlertKind(payload.kind)) void tick();
  });

  // Realtime SSE channel — the reliable in-app signal while the dashboard is
  // open, independent of (flaky) web-push. The server already sends each alert
  // only to the roles it concerns.
  useStaffEvents(
    (e) => {
      if (document.visibilityState === "visible" && isAlertKind(e.kind)) {
        fireInAppAlert({ kind: e.kind, tableCode: e.tableCode ?? null, tag: e.tag ?? undefined });
      }
      void tick();
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
      <div className={`mx-auto p-4 pb-10 ${isAdminPage ? "max-w-7xl" : "max-w-md"}`}>
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
