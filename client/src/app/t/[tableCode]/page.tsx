"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { consumeAnonBypassAuthOnce } from "@/lib/guestFlow";
import { getVenueSlug, setVenueSlug } from "@/lib/venue";
import { useSession } from "@/providers/session";
import type { AuthMeResponse } from "@/types";

function normalizeToTableSlug(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return value;

  if (/^\d+$/.test(value)) return String(Number(value));
  if (/^T\d+$/i.test(value)) return String(Number(value.slice(1)));

  const composite = value.match(/^(\d+)[.,](\d+)$/);
  if (composite) {
    return `${Number(composite[1])}-${Number(composite[2])}`;
  }

  const vip = value.match(/^vip(?:[\s-]?(\d+))?$/i);
  if (vip) {
    return `vip-${Number(vip[1] || "1")}`;
  }

  return value
    .toLowerCase()
    .replace(/[.]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function TableEntry() {
  const params = useParams<{ tableCode: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setTableCode, restoreSession } = useSession();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const raw = decodeURIComponent(params.tableCode);
        const tableCode = normalizeToTableSlug(raw);

        const created = await api<{
          ok: true;
          session: {
            venue?: { slug: string | null } | null;
          };
        }>("/guest/session", {
          method: "POST",
          body: JSON.stringify({ tableCode, venueSlug: getVenueSlug() }),
        });

        if (created.session.venue?.slug) {
          setVenueSlug(created.session.venue.slug);
        }

        setTableCode(tableCode);
        await restoreSession();

        const me = await api<AuthMeResponse>("/auth/guest/me").catch(() => ({
          authenticated: false,
        } as AuthMeResponse));

        const bypassFromQuery = searchParams.get("guest") === "1";
        const bypassFromStorage = consumeAnonBypassAuthOnce();

        if (me.authenticated || bypassFromQuery || bypassFromStorage) {
          router.replace("/menu");
          return;
        }

        router.replace("/auth");
      } catch (e: any) {
        setErr(e?.message ?? "Failed to create session");
      }
    };

    void run();
  }, [params.tableCode, restoreSession, router, searchParams, setTableCode]);

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-5">
      <div className="flex min-h-[40vh] items-start justify-center pt-10">
        <div className="flex flex-col items-center">
          <img
            src="/logo.svg"
            alt="Loft N8"
            className="h-12 w-12 animate-pulse opacity-90"
          />
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
