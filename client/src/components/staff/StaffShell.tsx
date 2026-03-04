"use client";

import { useRouter } from "next/navigation";
import { staffLogout } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import StaffNav from "@/app/staff/(app)/_components/StaffNav";


export function StaffShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { staff, clear } = useStaffSession();

  const onLogout = async () => {
    await staffLogout();
    clear();
    router.replace("/staff/login");
  };

  return (
    <div className="min-h-dvh bg-[#07070a] text-white">
      {/* лёгкий “дым/глоу” */}
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-md p-4 pb-10">
        {/* Header glass */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-white/50">Loft N8 • Staff</div>
              <div className="mt-1 text-lg font-semibold">Панель персонала</div>

              {staff ? (
                <div className="mt-1 text-xs text-white/60">
                  {staff.username} • {staff.role} • venue #{staff.venueId}
                </div>
              ) : null}
            </div>

            <button
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition"
              onClick={onLogout}
            >
              Выйти
            </button>
          </div>

          <div className="mt-3">
            <StaffNav />
          </div>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
