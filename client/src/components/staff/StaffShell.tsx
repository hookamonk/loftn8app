"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { staffLogout, getStaffSummary, type StaffSummary } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";

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
  return role ?? "Staff";
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { staff, clear } = useStaffSession();

  const [summary, setSummary] = useState<StaffSummary | null>(null);

  const onLogout = async () => {
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";
  const isAdminPage = pathname.startsWith("/staff/admin");

  const loadSummary = async (opts?: { silent?: boolean }) => {
    if (isAdmin) return;

    const r = await getStaffSummary();
    if (!r.ok) {
      if (r.status === 409) {
        setSummary({
          newOrders: 0,
          newCalls: 0,
          pendingPayments: 0,
        });
      }
      return;
    }

    setSummary(r.data);
  };

  const { tick } = usePolling(() => loadSummary({ silent: true }), {
    activeMs: 4000,
    idleMs: 12000,
    immediate: true,
    enabled: !isAdmin,
  });

  useEffect(() => {
    if (isAdmin) return;
    void loadSummary({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, staff?.role]);

  useEffect(() => {
    if (isAdmin) return;
    const off = attachStaffRealtime(() => {
      void tick();
    });
    return off;
  }, [tick, isAdmin]);

  useStaffPushEvents(() => {
    if (isAdmin) return;
    void tick();
  });

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
                <div className="text-[11px] tracking-[0.24em] text-white/45">LOFT №8 • STAFF</div>
                <div className="mt-2 text-xl font-semibold">
                  {isAdminPage ? "Админ-панель" : "Рабочая панель"}
                </div>

                {staff ? (
                  <div className="mt-1 text-sm text-white/60">
                    {staff.username} • {roleLabel(staff.role)} • {staff.venueName ?? `venue #${staff.venueId}`}
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
                    label="Сводка"
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
                    label="Оплаты"
                    active={pathname.startsWith("/staff/payments")}
                    badge={summary?.pendingPayments ?? 0}
                  />
                </>
              )}

              {(isAdmin || isManager) && (
                <NavLink href="/staff/admin" label="Админ" active={pathname.startsWith("/staff/admin")} />
              )}

              {isAdmin && (
                <NavLink href="/staff/summary" label="Staff view" active={pathname === "/staff/summary"} />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
