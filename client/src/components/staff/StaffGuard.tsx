"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffSession } from "@/providers/staffSession";
import { getStaffMe } from "@/lib/staffApi";
import { ensureServiceWorker, rebindPushIfPossible } from "@/lib/staffPush";
import { setStaffVenueSlug } from "@/lib/venue";

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

      if (r.data.staff.venueSlug) {
        setStaffVenueSlug(r.data.staff.venueSlug);
      }
      setStaff(r.data.staff);

      try {
        // Register the SW on every launch (not only when the user taps
        // "enable"): without an active registration a rotated subscription can
        // never be repaired and push dies silently.
        await ensureServiceWorker();
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
      <div className="min-h-dvh bg-[#07070a] p-4">
        <div className="mx-auto max-w-md rounded-[28px] border border-white/10 bg-white/6 p-4 text-sm text-white">
          <div className="font-semibold">Персонал</div>
          <div className="mt-2 text-white/60">Проверяем доступ…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
