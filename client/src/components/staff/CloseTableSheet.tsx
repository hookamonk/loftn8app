"use client";

import { useState } from "react";
import { disconnectTable } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * «Закрыть стол»: the guests have paid and left — free the table. Asks first.
 * A table that still owes money can't be closed (the server refuses too):
 * then the sheet just says why.
 */

export type CloseTableTarget = {
  tableId: number;
  tableCode: string;
  canClose: boolean;
  unpaidCzk: number;
  waitingPayment: boolean;
};

export function CloseTableSheet({
  target,
  onClose,
  onDone,
}: {
  target: CloseTableTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  return <CloseTableForm key={target.tableId} target={target} onClose={onClose} onDone={onDone} />;
}

function CloseTableForm({
  target,
  onClose,
  onDone,
}: {
  target: CloseTableTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const result = await disconnectTable(target.tableId);
    setBusy(false);
    if (!result.ok) {
      push({ kind: "error", title: "Стол не закрыт", message: result.error });
      onClose();
      return;
    }
    push({ kind: "success", title: `Стол ${target.tableCode} закрыт`, message: "Стол свободен." });
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>

        {target.canClose ? (
          <>
            <div className="mt-1 text-lg font-semibold text-white">Закрыть стол?</div>
            <div className="mt-1 text-sm text-white/60">Гости ушли и всё оплачено — стол освободится.</div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
              className="mt-4 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? "Закрываем…" : "Да, закрыть"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
            >
              Нет
            </button>
          </>
        ) : (
          <>
            <div className="mt-1 text-lg font-semibold text-white">Стол пока не закрыть</div>
            <div className="mt-1 text-sm text-white/60">
              {target.waitingPayment
                ? "Гость ждёт оплату — сначала примите её."
                : `Не оплачено: ${target.unpaidCzk.toLocaleString("cs-CZ")} Kč. Сначала примите оплату.`}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
            >
              Понятно
            </button>
          </>
        )}
      </div>
    </div>
  );
}
