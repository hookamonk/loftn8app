"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/providers/staffSession";
import { getStaffMe } from "@/lib/staffApi";

export function StaffGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { staff, clear, setStaff } = useStaffSession();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!staff) {
        router.replace("/staff/login");
        return;
      }

      const r = await getStaffMe();
      if (!r.ok) {
        clear();
        router.replace("/staff/login");
        return;
      }

      setStaff(r.data.staff);

      if (!cancelled) setReady(true);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [staff, router, clear, setStaff]);

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