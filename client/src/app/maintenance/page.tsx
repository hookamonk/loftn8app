"use client";

import { MAINTENANCE_MENU_URL } from "@/lib/maintenance";
import { useI18n } from "@/providers/i18n";

export default function MaintenancePage() {
  const { isCz } = useI18n();

  return (
    <main className="min-h-dvh bg-[radial-gradient(80%_60%_at_50%_0%,rgba(212,175,110,0.10),transparent_60%)]">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-12 text-center">
        <div className="mb-6 grid h-20 w-20 place-items-center rounded-3xl border border-gold/25 bg-gold/10">
          <span className="text-3xl">🛠️</span>
        </div>

        <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">LOFT№8</div>

        <h1 className="mt-3 text-2xl font-bold leading-tight text-white">
          {isCz ? "Technická údržba" : "Under maintenance"}
        </h1>

        <p className="mt-4 text-sm leading-6 text-white/70">
          {isCz
            ? "Aplikace je dočasně v technické údržbě. Omlouváme se za nepříjemnosti. Naše menu si můžete prohlédnout tlačítkem níže."
            : "The app is temporarily under maintenance. We're sorry for the inconvenience. You can view our menu using the button below."}
        </p>

        <a
          href={MAINTENANCE_MENU_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex h-14 w-full items-center justify-center rounded-2xl bg-white text-base font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
        >
          {isCz ? "Otevřít menu" : "Open menu"}
        </a>

        <div className="mt-4 text-xs text-white/40">
          {isCz ? "Děkujeme za pochopení." : "Thank you for your understanding."}
        </div>
      </div>
    </main>
  );
}
