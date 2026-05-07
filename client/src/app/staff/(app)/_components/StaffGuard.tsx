"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/providers/staffSession";
import { getStaffMe } from "@/lib/staffApi";
import { rebindPushIfPossible } from "@/lib/staffPush";

export function StaffGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { clear, setStaff } = useStaffSession();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    async function run() {
      const r = await getStaffMe();

      if (!r.ok) {
        clear();
        router.replace("/staff/login");
        return;
      }

      setStaff(r.data.staff);

      try {
        await rebindPushIfPossible();
      } catch {
        // ignore
      }

      if (!cancelled) setReady(true);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, clear, setStaff]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
          <div className="text-base font-semibold text-white">Персонал</div>
          <div className="mt-2 text-sm text-white/60">Проверяем доступ…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
} 
