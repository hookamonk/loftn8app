"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getStoredVenueSlug,
  getVenueCatalog,
  refreshVenueCatalog,
  setVenueSlug,
  type VenueOption,
  type VenueSlug,
} from "@/lib/venue";

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [venues, setVenues] = useState<VenueOption[]>(() => getVenueCatalog());
  const [selectedVenue, setSelectedVenue] = useState<VenueSlug>(() => getStoredVenueSlug() ?? "loft-zizkov");

  useEffect(() => {
    const table = (searchParams.get("table") ?? "").trim();
    if (table) {
      router.replace(`/t/${encodeURIComponent(table)}`);
    }
  }, [router, searchParams]);

  useEffect(() => {
    let mounted = true;

    void refreshVenueCatalog().then((catalog) => {
      if (!mounted) return;
      setVenues(catalog);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!venues.some((venue) => venue.slug === selectedVenue)) {
      setSelectedVenue(venues[0]?.slug ?? "loft-zizkov");
    }
  }, [selectedVenue, venues]);

  const onContinue = async () => {
    const previousVenue = getStoredVenueSlug();

    if (previousVenue && previousVenue !== selectedVenue) {
      try {
        await fetch("/api/guest/session/disconnect", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // ignore disconnect failures, venue switch should still continue
      }
    }

    setVenueSlug(selectedVenue);
    router.push("/auth");
  };

  return (
    <main className="min-h-screen w-full bg-[#050508] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[380px] w-[380px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
          <div className="text-xs tracking-[0.22em] text-white/45">LOFT №8</div>
          <h1 className="mt-3 text-2xl font-semibold">Choose branch</h1>

          <div className="mt-5 space-y-3">
            {venues.map((venue) => {
              const active = selectedVenue === venue.slug;
              return (
                <button
                  key={venue.slug}
                  type="button"
                  onClick={() => setSelectedVenue(venue.slug)}
                  className={[
                    "w-full rounded-[24px] border px-4 py-4 text-left transition",
                    active
                      ? "border-white/20 bg-white text-black shadow-[0_8px_30px_rgba(255,255,255,0.12)]"
                      : "border-white/10 bg-black/30 text-white/85 hover:bg-white/10",
                  ].join(" ")}
                >
                  <div className="text-base font-semibold">{venue.shortName}</div>
                  <div className={["mt-1 text-xs", active ? "text-black/65" : "text-white/45"].join(" ")}>
                    {venue.name}
                  </div>
                </button>
              );
            })}
          </div>

          <button
            className="mt-5 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
