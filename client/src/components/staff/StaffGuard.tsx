"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStaffSession } from "@/providers/staffSession";
import { homeForRole, isStationRole } from "@/lib/staffRoles";
import { getStaffMe } from "@/lib/staffApi";
import { ensureServiceWorker, rebindPushIfPossible } from "@/lib/staffPush";
import { setStaffVenueSlug } from "@/lib/venue";

export function StaffGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const { clear, setStaff } = useStaffSession();
  const [ready, setReady] = useState(false);

  // Each run is cancelled by its own cleanup. A run-once ref here left the
  // screen on «Проверяем доступ…» whenever the effect was re-run (React
  // re-mount right after the login redirect): the first run was cancelled and
  // the second never started.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const r = await getStaffMe();
      if (cancelled) return;

      if (!r.ok) {
        clear();
        router.replace("/staff/login");
        return;
      }

      if (r.data.staff.venueSlug) {
        setStaffVenueSlug(r.data.staff.venueSlug);
      }
      setStaff(r.data.staff);

      // A station iPad lives on its station screen; everyone else never sees it.
      const onStationScreen = pathnameRef.current.startsWith("/staff/station");
      if (isStationRole(r.data.staff.role) !== onStationScreen) {
        router.replace(homeForRole(r.data.staff.role));
        return;
      }

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
      <div className="staff-safe min-h-dvh bg-[#07070a]">
        <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-white/[0.05] p-3.5 text-sm text-white">
          <div className="font-semibold">Персонал</div>
          <div className="mt-2 text-white/60">Проверяем доступ…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
