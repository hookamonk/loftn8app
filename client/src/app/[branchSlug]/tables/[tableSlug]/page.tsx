"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { refreshVenueCatalog, resolveVenueSlug, setVenueSlug } from "@/lib/venue";
import { useSession } from "@/providers/session";
import type { AuthMeResponse } from "@/types";

function normalizeSlug(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[.]/g, "-");
}

export default function BranchTableEntryPage() {
  const params = useParams<{ branchSlug: string; tableSlug: string }>();
  const router = useRouter();
  const { setTableCode, restoreSession } = useSession();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        await refreshVenueCatalog();

        const venueSlug = resolveVenueSlug(params.branchSlug);
        if (!venueSlug) {
          router.replace("/");
          return;
        }

        const tableSlug = normalizeSlug(decodeURIComponent(params.tableSlug));
        setVenueSlug(venueSlug);

        const created = await api<{
          ok: true;
          session: {
            table: { code: string };
            venue?: { slug: string | null } | null;
          };
        }>("/guest/session", {
          method: "POST",
          body: JSON.stringify({ tableCode: tableSlug, venueSlug }),
        });

        if (created.session.venue?.slug) {
          setVenueSlug(created.session.venue.slug);
        }

        setTableCode(created.session.table.code);
        await restoreSession();

        const me = await api<AuthMeResponse>("/auth/guest/me").catch(() => ({
          authenticated: false,
        } as AuthMeResponse));

        router.replace(me.authenticated ? "/menu" : "/auth");
      } catch (e: any) {
        setErr(e?.message ?? "Failed to create session");
      }
    };

    void run();
  }, [params.branchSlug, params.tableSlug, restoreSession, router, setTableCode]);

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-5">
      <div className="flex min-h-[40vh] items-start justify-center pt-10">
        <div className="flex flex-col items-center">
          <img src="/logo.svg" alt="Loft N8" className="h-12 w-12 animate-pulse opacity-90" />
          <div className="mt-3 text-sm font-medium text-white/85">Loading</div>
          <div className="mt-1 text-xs text-white/50">Starting your table session…</div>
          {err ? (
            <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
