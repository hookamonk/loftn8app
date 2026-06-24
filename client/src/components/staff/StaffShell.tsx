"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { staffLogout, getStaffSummary, type StaffSummary } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { fireInAppAlert } from "@/lib/staffAlerts";
import { subscribeStaffLiveSync } from "@/lib/staffLiveSync";

function Badge({ value }: { value?: number }) {
  if (!value || value <= 0) return null;

  return (
    <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold leading-none text-black">
      {value}
    </span>
  );
}

function NavLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={[
        "whitespace-nowrap rounded-2xl border px-4 py-3 text-sm font-semibold transition",
        "inline-flex items-center justify-center",
        active
          ? "border-white/20 bg-white text-black shadow-[0_8px_30px_rgba(255,255,255,0.12)]"
          : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      <span>{label}</span>
      {!active ? <Badge value={badge} /> : null}
      {active && badge && badge > 0 ? (
        <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-black/15 px-1.5 py-0.5 text-[11px] font-bold leading-none text-black">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function roleLabel(role?: string) {
  if (role === "WAITER") return "Официант";
  if (role === "HOOKAH") return "Кальянщик";
  if (role === "MANAGER") return "Менеджер";
  if (role === "ADMIN") return "Администратор";
  return role ?? "Персонал";
}

function normalizeVenueName(name?: string | null, venueId?: number) {
  if (!name) return venueId ? `Точка #${venueId}` : "Точка";

  return name
    .replace(/LoftN8/gi, "LOFT№8")
    .replace(/Loft N8/gi, "LOFT№8")
    .replace(/LOFT N8/gi, "LOFT№8")
    .replace(/LOFT №8/gi, "LOFT№8");
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { staff, clear } = useStaffSession();

  const [summary, setSummary] = useState<StaffSummary | null>(null);
  const [noShift, setNoShift] = useState(false);

  const onLogout = async () => {
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";
  const isAdminPage = pathname.startsWith("/staff/admin");
  // Poll the summary on every non-admin screen (including «Сводка») so the nav
  // badges are always live — SSE ticks are no-ops when polling is disabled, and
  // disabling it on the summary page made badges update only «через раз».
  const shouldPollSummary = !isAdmin;

  const loadSummary = async (opts?: { silent?: boolean }) => {
    if (isAdmin) return;

    const r = await getStaffSummary();
    if (!r.ok) {
      if (r.status === 409) {
        // No open shift — surface it instead of silently showing zeros, so
        // staff understand why nothing appears.
        setNoShift(true);
        setSummary({
          newOrders: 0,
          newCalls: 0,
          pendingPayments: 0,
        });
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

  const { tick } = usePolling(() => loadSummary({ silent: true }), {
    activeMs: 4000,
    idleMs: 12000,
    immediate: false,
    enabled: shouldPollSummary,
  });

  useStaffPushEvents((payload) => {
    if (
      payload.kind === "CALL_CREATED" ||
      payload.kind === "GUEST_MESSAGE" ||
      payload.kind === "ORDER_CREATED" ||
      payload.kind === "PAYMENT_REQUESTED"
    ) {
      void tick();
    }
  });

  // Realtime SSE channel — the reliable in-app signal while the dashboard is
  // open, independent of (flaky) web-push. Refresh badges and beep on visible.
  useStaffEvents(
    (e) => {
      if (
        document.visibilityState === "visible" &&
        (e.kind === "CALL_CREATED" ||
          e.kind === "ORDER_CREATED" ||
          e.kind === "PAYMENT_REQUESTED")
      ) {
        fireInAppAlert({ kind: e.kind, tableCode: e.tableCode ?? null });
      }
      void tick();
    },
    { enabled: !isAdmin }
  );

  useEffect(() => {
    if (!shouldPollSummary) return;
    void loadSummary({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPollSummary, staff?.role]);

  useEffect(() => {
    if (!shouldPollSummary) return;
    return subscribeStaffLiveSync(() => {
      void tick();
    });
  }, [shouldPollSummary, tick]);

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className={`relative mx-auto p-4 pb-10 ${isAdminPage ? "max-w-7xl" : "max-w-md"}`}>
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] tracking-[0.24em] text-white/45">LOFT№8 • ПЕРСОНАЛ</div>
                <div className="mt-2 text-xl font-semibold">
                  {isAdminPage ? "Гости" : "Рабочая панель"}
                </div>

                {staff ? (
                  <div className="mt-2 space-y-1">
                    <div className="text-sm text-white/60">
                      {staff.username} • {roleLabel(staff.role)}
                    </div>
                    <div className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/85">
                      Текущая точка: {normalizeVenueName(staff.venueName, staff.venueId)}
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
                onClick={onLogout}
              >
                Выйти
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {!isAdmin && (
                <>
                  <NavLink
                    href="/staff/summary"
                    label="Главная"
                    active={pathname.startsWith("/staff/summary")}
                  />
                  <NavLink
                    href="/staff/orders"
                    label="Заказы"
                    active={pathname.startsWith("/staff/orders")}
                    badge={summary?.newOrders ?? 0}
                  />
                  <NavLink
                    href="/staff/calls"
                    label="Вызовы"
                    active={pathname.startsWith("/staff/calls")}
                    badge={summary?.newCalls ?? 0}
                  />
                  <NavLink
                    href="/staff/payments"
                    label="Оплата"
                    active={pathname.startsWith("/staff/payments")}
                    badge={summary?.pendingPayments ?? 0}
                  />
                  <NavLink
                    href="/staff/tables"
                    label="Столы"
                    active={pathname.startsWith("/staff/tables")}
                  />
                </>
              )}

              {(isAdmin || isManager) && (
                <NavLink href="/staff/admin" label="Гости" active={pathname.startsWith("/staff/admin")} />
              )}
            </div>
          </div>
        </div>

        {!isAdmin && noShift ? (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            <div className="font-semibold">Смена не открыта</div>
            <div className="mt-1 text-amber-100/80">
              {isManager
                ? "Откройте смену в разделе «Сводка», иначе новые вызовы, заказы и оплаты не отображаются."
                : "Дождитесь, пока менеджер откроет смену — до этого новые вызовы, заказы и оплаты не отображаются."}
            </div>
          </div>
        ) : null}

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
