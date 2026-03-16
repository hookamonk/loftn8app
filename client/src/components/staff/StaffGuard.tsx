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
        <div className="rounded-2xl border bg-white p-4 text-sm">
          <div className="font-semibold">Staff</div>
          <div className="mt-2 text-gray-600">Проверяем доступ…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}