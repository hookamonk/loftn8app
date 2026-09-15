"use client";

import { GuestAccount } from "@/components/GuestAccount";
import { useI18n } from "@/providers/i18n";

/**
 * Same account screen as the "Profile" tab, reachable without a table session
 * (from the landing page or a direct link). No sign-out guard here: a guest
 * opening their account outside the venue has nothing in flight to protect.
 */
export default function CabinetPage() {
  const { isCz } = useI18n();

  return (
    <main className="mx-auto max-w-md px-4 pb-10 pt-4">
      <div className="pr-24">
        <h1 className="text-xl font-semibold text-white">
          {isCz ? "Osobní účet" : "Personal account"}
        </h1>
        <div className="mt-0.5 text-[11px] tracking-[0.18em] text-white/35">LOFT№8</div>
      </div>

      <div className="mt-3.5">
        <GuestAccount />
      </div>
    </main>
  );
}
