"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/providers/staffSession";
import { getStaffSummary } from "@/lib/staffApi";

export function StaffGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { staff, clear } = useStaffSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // нет локальной сессии → на логин
      if (!staff) {
        router.replace("/staff/login");
        return;
      }

      // проверим, что cookie staff реально валидна (иначе будет "тихий" разлогин)
      const r = await getStaffSummary();
      if (!r.ok && (r.status === 401 || r.status === 403)) {
        clear();
        router.replace("/staff/login");
        return;
      }

      if (!cancelled) setReady(true);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [staff, router, clear]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-2xl border bg-white p-4 text-sm">
          <div className="font-semibold">Staff</div>
          <div className="mt-2 text-gray-600">Проверяем доступ…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>; 
}
