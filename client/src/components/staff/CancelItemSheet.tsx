"use client";

import { useState } from "react";
import { cancelOrderItem } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * Manager only: take a line (or part of it) off an order. One sheet over the
 * current screen — how many, an optional reason, confirm.
 */

export type CancelTarget = {
  orderId: string;
  itemId: string;
  name: string;
  qty: number;
  tableCode: string;
};

export function CancelItemSheet({
  target,
  onClose,
  onDone,
}: {
  target: CancelTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  // Keyed by the line, so every opening starts from a clean form.
  return <CancelForm key={target.itemId} target={target} onClose={onClose} onDone={onDone} />;
}

function CancelForm({
  target,
  onClose,
  onDone,
}: {
  target: CancelTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [qty, setQty] = useState(target.qty);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await cancelOrderItem(target.orderId, target.itemId, {
      qty,
      reason: reason.trim() || undefined,
    });
    setBusy(false);

    if (!result.ok) {
      push({ kind: "error", title: "Не отменилось", message: result.error });
      return;
    }

    push({ kind: "info", title: "Позиция отменена", message: `Стол ${target.tableCode} · ${target.name} ×${qty}` });
    onDone();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 pb-8">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>
        <div className="mt-1 text-lg font-semibold text-white">Отменить: {target.name}</div>

        {target.qty > 1 ? (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-white/60">Сколько</span>
            <div className="flex h-11 items-center gap-1 rounded-xl border border-white/10 bg-black/30 px-1">
              <button
                type="button"
                aria-label="Меньше"
                className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-lg text-white disabled:opacity-30"
                disabled={qty <= 1}
                onClick={() => setQty((value) => Math.max(1, value - 1))}
              >
                −
              </button>
              <span className="w-16 text-center text-sm font-semibold text-white tabular-nums">
                {qty} из {target.qty}
              </span>
              <button
                type="button"
                aria-label="Больше"
                className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-lg text-white disabled:opacity-30"
                disabled={qty >= target.qty}
                onClick={() => setQty((value) => Math.min(target.qty, value + 1))}
              >
                +
              </button>
            </div>
          </div>
        ) : null}

        <input
          className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
          placeholder="Причина (необязательно)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-4 h-11 w-full rounded-xl bg-red-500 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Отменяем…" : "Отменить позицию"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
        >
          Назад
        </button>
      </div>
    </div>
  );
}
