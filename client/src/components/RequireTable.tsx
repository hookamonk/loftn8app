"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export function RequireTable({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const table = sp.get("table");

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

      if (table) {
        try {
          await api("/guest/session", {
            method: "POST",
            body: JSON.stringify({ tableCode: table }),
          });
          if (!cancelled) setReady(true);
          return;
        } catch (e: any) {
          if (!cancelled) setErr(e?.message ?? "Не удалось создать сессию стола");
          return;
        }
      }

      if (!cancelled) setErr("Сканируй QR стола (нужен параметр ?table=CODE, например ?table=T1)");
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [table]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          <div className="text-sm font-semibold text-white">Нужен стол</div>
          <div className="mt-2 text-xs text-white/70">{err ?? "Подключаем стол…"} </div>

          <button
            className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black"
            onClick={() => window.location.reload()}
          >
            Обновить
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
