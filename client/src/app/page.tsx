"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/providers/i18n";
import { useAuth } from "@/providers/auth";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isCz } = useI18n();
  const { me } = useAuth();

  // QR links of the form `…/?table=5` go straight to the table entry.
  useEffect(() => {
    const table = (searchParams.get("table") ?? "").trim();
    if (table) router.replace(`/t/${encodeURIComponent(table)}`);
  }, [router, searchParams]);

  const authenticated = Boolean(me?.authenticated);

  return (
    <main className="min-h-screen w-full bg-[#050508] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[380px] w-[380px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl backdrop-blur">
          <img src="/logo.svg" alt="LOFT№8" className="mx-auto h-12 w-12 opacity-90" />
          <div className="mt-4 text-lg font-semibold text-white">
            {isCz ? "Naskenujte QR kód na stole" : "Scan the QR code on your table"}
          </div>
          <div className="mt-2 text-sm text-white/70">
            {isCz
              ? "Pro objednávku nebo přivolání obsluhy naskenujte QR kód na vašem stole telefonem."
              : "To order or call staff, scan the QR code on your table with your phone."}
          </div>

          {authenticated ? (
            <button
              type="button"
              onClick={() => router.push("/cabinet")}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-6 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              {isCz ? "Můj účet a bonusy" : "My account & bonuses"}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}