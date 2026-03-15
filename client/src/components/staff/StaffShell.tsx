"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { staffLogout } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import StaffNav from "@/app/staff/(app)/_components/StaffNav";

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

  const title = isAdmin ? "Админ-панель" : "Панель персонала";
  const subtitle = staff ? `${staff.username} • ${staff.role} • venue #${staff.venueId}` : null;

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-md p-4 pb-10">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-white/50">Loft N8 • Staff</div>
              <div className="mt-1 text-lg font-semibold">{title}</div>
              {subtitle ? <div className="mt-1 text-xs text-white/60">{subtitle}</div> : null}
            </div>

            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition"
              onClick={onLogout}
            >
              Выйти
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {!isAdmin ? (
              <div className="min-w-0 flex-1">
                <StaffNav />
              </div>
            ) : null}

            {(isAdmin || isManager) ? (
              <Link
                href="/staff/admin"
                className={[
                  "rounded-2xl border px-3 py-2 text-sm transition",
                  pathname === "/staff/admin"
                    ? "border-white/20 bg-white/15 text-white"
                    : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                Admin
              </Link>
            ) : null}

            {isAdmin ? (
              <Link
                href="/staff/summary"
                className={[
                  "rounded-2xl border px-3 py-2 text-sm transition",
                  pathname === "/staff/summary"
                    ? "border-white/20 bg-white/15 text-white"
                    : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                Staff view
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}