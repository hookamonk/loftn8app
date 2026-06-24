"use client";

import React from "react";
import { useSession } from "@/providers/session";
import { useI18n } from "@/providers/i18n";

export function RequireTable({ children }: { children: React.ReactNode }) {
  const { isCz } = useI18n();

  const { tableCode, sessionReady, sessionError } = useSession();

  if (sessionReady) {
    return <>{children}</>;
  }

  // Нет стола/сессии — показываем подсказку отсканировать QR (вход только по QR).
  if (!tableCode && sessionError) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-[28px] border border-white/10 bg-white/6 p-4 text-center backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
          <div className="text-sm font-semibold text-white">
            {isCz ? "Naskenujte QR kód na stole" : "Scan the QR code on your table"}
          </div>
          <div className="mt-2 text-xs text-white/70">
            {isCz
              ? "Aplikace se otevře po naskenování QR kódu u vás na stole."
              : "The app opens after you scan the QR code at your table."}
          </div>
        </div>
      </div>
    );
  }

  // во время обычного перехода между вкладками ничего не мигает
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      <div className="flex min-h-[40vh] items-start justify-center pt-10">
        <div className="flex flex-col items-center">
          <img
            src="/logo.svg"
            alt="LOFT№8"
            className="h-12 w-12 animate-pulse opacity-90"
          />
          <div className="mt-3 text-sm font-medium text-white/85">{isCz ? "Načítání" : "Loading"}</div>
          <div className="mt-1 text-xs text-white/50">
            {isCz ? "Obnovujeme relaci vašeho stolu…" : "Restoring your table session…"}
          </div>
        </div>
      </div>
    </div>
  );
} 
