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
    <main className="mx-auto max-w-md px-4 pb-10 pt-5">
      <div className="pr-24">
        <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">
          {isCz ? "Osobní účet" : "Personal account"}
        </div>
      </div>

      <div className="mt-4">
        <GuestAccount />
      </div>
    </main>
  );
}
