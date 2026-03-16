"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

const TABLE_STORAGE_KEY = "tableCode";

export function RequireTable({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const queryTable = sp.get("table");

  const pathTable = useMemo(() => {
    const m = pathname.match(/^\/t\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setErr(null);
      setReady(false);

      try {
        await api("/guest/me");
        if (!cancelled) setReady(true);
        return;
      } catch {}

      const tableCode =
        queryTable ||
        pathTable ||
        (typeof window !== "undefined" ? localStorage.getItem(TABLE_STORAGE_KEY) : null);

      if (tableCode) {
        try {
          await api("/guest/session", {
            method: "POST",
            body: JSON.stringify({ tableCode }),
          });

          if (typeof window !== "undefined") {
            localStorage.setItem(TABLE_STORAGE_KEY, tableCode);
          }

          if (!cancelled) setReady(true);
          return;
        } catch (e: any) {
          if (typeof window !== "undefined") {
            localStorage.removeItem(TABLE_STORAGE_KEY);
          }

          if (!cancelled) {
            setErr(e?.message ?? "Failed to create table session");
          }

          setTimeout(() => {
            router.replace("/table");
          }, 700);

          return;
        }
      }

      if (!cancelled) {
        setErr("No table selected. Redirecting to table selection…");
      }

      setTimeout(() => {
        router.replace("/table");
      }, 700);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [queryTable, pathTable, router]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          <div className="text-sm font-semibold text-white">Table required</div>
          <div className="mt-2 text-xs text-white/70">{err ?? "Connecting table…"}</div>

          <button
            className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black"
            onClick={() => router.replace("/table")}
          >
            Select table
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}  