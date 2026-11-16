"use client";

import { useState } from "react";
import { setTicketEta } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * Busy hours: the station says when the order will be ready (10–40 min). The
 * waiter sees the same countdown and can tell the guest. Ready earlier — just
 * «Готово» as usual; nothing happens if it runs late.
 */

export const ETA_CHOICES = [10, 15, 20, 25, 30, 35, 40] as const;

export type EtaTarget = { ticketId: string; tableCode: string; current: number | null };

export function EtaSheet({
  target,
  large = false,
  onClose,
  onDone,
}: {
  target: EtaTarget | null;
  /** Station tablets: bigger buttons. */
  large?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  return <EtaForm key={target.ticketId} target={target} large={large} onClose={onClose} onDone={onDone} />;
}

function EtaForm({
  target,
  large,
  onClose,
  onDone,
}: {
  target: EtaTarget;
  large: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState<number | "clear" | null>(null);

  const choose = async (minutes: number | null) => {
    if (busy !== null) return;
    setBusy(minutes ?? "clear");
    const result = await setTicketEta(target.ticketId, minutes);
    setBusy(null);
    if (!result.ok) {
      push({ kind: "error", title: "Не сохранилось", message: result.error });
      return;
    }
    onDone();
  };

  const btn = large ? "h-16 text-xl" : "h-12 text-base";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom sm:rounded-3xl sm:pb-4">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>
        <div className={`mt-1 font-semibold text-white ${large ? "text-2xl" : "text-lg"}`}>Выдача через</div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          {ETA_CHOICES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={busy !== null}
              onClick={() => void choose(minutes)}
              className={[
                "rounded-xl font-bold tabular-nums transition active:scale-[0.98] disabled:opacity-50",
                btn,
                target.current === minutes ? "bg-amber-400 text-black" : "border border-white/10 bg-white/5 text-white",
              ].join(" ")}
            >
              {busy === minutes ? "…" : minutes}
              <span className={`ml-0.5 font-medium ${large ? "text-sm" : "text-xs"} opacity-70`}>мин</span>
            </button>
          ))}
        </div>

        {target.current !== null ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void choose(null)}
            className={`mt-3 w-full rounded-xl border border-white/10 font-semibold text-white/80 disabled:opacity-50 ${large ? "h-14 text-base" : "h-11 text-sm"}`}
          >
            {busy === "clear" ? "…" : "Убрать время"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className={`mt-2 w-full rounded-xl font-semibold text-white/60 ${large ? "h-14 text-base" : "h-11 text-sm"}`}
        >
          Назад
        </button>
      </div>
    </div>
  );
}
