"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/providers/session";

function normalizeToCode(raw: string) {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!v) return v;

  if (/^\d+$/.test(v)) return `T${v}`;
  if (/^T\d+$/.test(v)) return v;

  if (v === "VIP") return "VIP";
  if (v === "TVIP" || v === "T-VIP") return "VIP";

  return v;
}

export default function TableEntry() {
  const params = useParams<{ tableCode: string }>();
  const router = useRouter();
  const { setTableCode } = useSession();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const raw = decodeURIComponent(params.tableCode);
        const tableCode = normalizeToCode(raw);

        await api("/guest/session", {
          method: "POST",
          body: JSON.stringify({ tableCode }),
        });

        setTableCode(tableCode);
        router.replace("/menu");
      } catch (e: any) {
        setErr(e?.message ?? "Failed to create session");
      }
    };

    void run();
  }, [params.tableCode, router, setTableCode]);

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