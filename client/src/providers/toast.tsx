"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

export type ToastKind = "success" | "error" | "info";

export type ToastAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: ToastAction;
};

type ToastCtx = {
  push: (t: Omit<ToastItem, "id">, ttlMs?: number) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push: ToastCtx["push"] = (t, ttlMs = 2400) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const toast: ToastItem = { id, ...t };
    setItems((prev) => [...prev, toast]);

    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, ttlMs);
  };

  const value = useMemo(() => ({ push }), []);

  const borderByKind =
    (k: ToastKind) =>
      k === "success"
        ? "border-emerald-400/25"
        : k === "error"
        ? "border-red-400/25"
        : "border-white/10";

  return (
    <Ctx.Provider value={value}>
      {children}

      <div className="fixed bottom-28 left-0 right-0 z-[100] mx-auto flex max-w-md flex-col gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={[
              "rounded-3xl border bg-white/8 p-3 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.45)]",
              borderByKind(t.kind),
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{t.title}</div>
                {t.message ? (
                  <div className="mt-0.5 line-clamp-2 text-xs text-white/70">{t.message}</div>
                ) : null}
              </div>

              {t.action ? (
                <button
                  className="shrink-0 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                  onClick={() => {
                    if (t.action?.onClick) t.action.onClick();
                    if (t.action?.href) window.location.href = t.action.href;
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
