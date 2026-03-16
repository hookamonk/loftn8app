"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { staffLogout } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-2xl border px-4 py-3 text-sm font-semibold transition whitespace-nowrap",
        active
          ? "border-white/20 bg-white/15 text-white"
          : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}

export function StaffShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { staff, clear } = useStaffSession();

  const onLogout = async () => {
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";
  const isAdminPage = pathname.startsWith("/staff/admin");

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className={`relative mx-auto p-4 pb-10 ${isAdminPage ? "max-w-7xl" : "max-w-md"}`}>
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs tracking-[0.2em] text-white/45">LOFT №8 • STAFF</div>
              <div className="mt-2 text-xl font-semibold">
                {isAdminPage ? "Админ-панель" : "Рабочая панель"}
              </div>

              {staff ? (
                <div className="mt-1 text-sm text-white/60">
                  {staff.username} • {staff.role} • venue #{staff.venueId}
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

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {!isAdmin && (
              <>
                <NavLink href="/staff/summary" label="Сводка" active={pathname.startsWith("/staff/summary")} />
                <NavLink href="/staff/orders" label="Заказы" active={pathname.startsWith("/staff/orders")} />
                <NavLink href="/staff/calls" label="Вызовы" active={pathname.startsWith("/staff/calls")} />
                <NavLink href="/staff/payments" label="Оплаты" active={pathname.startsWith("/staff/payments")} />
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

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}