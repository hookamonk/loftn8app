"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

const TABLE_STORAGE_KEY = "loft_table_code";

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

      // 1) если уже есть активная guest session — пропускаем
      try {
        await api("/guest/me");
        if (!cancelled) setReady(true);
        return;
      } catch {
        // ignore
      }

      // 2) ищем tableCode: query -> path -> localStorage
      let tableCode =
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
            setErr(e?.message ?? "Не удалось создать сессию стола");
          }

          // если стол битый — отправляем на выбор стола
          setTimeout(() => {
            router.replace("/table");
          }, 700);

          return;
        }
      }

      // 3) если стола нет вообще — сразу ведём на экран выбора
      if (!cancelled) {
        setErr("Не выбран стол. Перенаправляем на экран выбора…");
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
          <div className="text-sm font-semibold text-white">Нужен стол</div>
          <div className="mt-2 text-xs text-white/70">{err ?? "Подключаем стол…"}</div>

          <button
            className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black"
            onClick={() => router.replace("/table")}
          >
            Выбрать стол
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}