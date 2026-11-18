"use client";

import { useEffect, useState } from "react";
import {
  cancelTableItems,
  listTableChoices,
  moveTableItems,
  type TableChoice,
  type TableLineChoice,
} from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * Manager: «Удалить» or «Перенести» the lines chosen on a table. One sheet,
 * always asks before doing anything.
 */

export type TableItemsTarget = {
  mode: "delete" | "move";
  tableId: number;
  tableCode: string;
  lines: Array<TableLineChoice & { name: string }>;
};

export function TableItemsSheet({
  target,
  onClose,
  onDone,
}: {
  target: TableItemsTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  return <Sheet key={`${target.mode}:${target.tableId}`} target={target} onClose={onClose} onDone={onDone} />;
}

function Sheet({ target, onClose, onDone }: { target: TableItemsTarget; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [tables, setTables] = useState<TableChoice[] | null>(null);
  const [toTable, setToTable] = useState<TableChoice | null>(null);
  const count = target.lines.reduce((sum, line) => sum + line.qty, 0);
  const lines = target.lines.map(({ orderItemId, qty }) => ({ orderItemId, qty }));

  useEffect(() => {
    if (target.mode !== "move") return;
    let alive = true;
    void listTableChoices().then((r) => {
      if (!alive) return;
      if (r.ok) setTables(r.data.tables.filter((table) => table.id !== target.tableId));
      else push({ kind: "error", title: "Столы не загрузились", message: r.error });
    });
    return () => {
      alive = false;
    };
  }, [target.mode, target.tableId, push]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    if (target.mode === "delete") {
      const r = await cancelTableItems(target.tableId, lines, reason.trim() || undefined);
      setBusy(false);
      if (!r.ok) return push({ kind: "error", title: "Не удалилось", message: r.error });
      push({ kind: "info", title: "Позиции удалены", message: `Стол ${target.tableCode} · ${count} шт.` });
    } else {
      if (!toTable) return setBusy(false);
      const r = await moveTableItems(target.tableId, toTable.id, lines);
      setBusy(false);
      if (!r.ok) return push({ kind: "error", title: "Не перенеслось", message: r.error });
      push({ kind: "success", title: "Перенесено", message: `Стол ${target.tableCode} → стол ${r.data.toTable} · ${count} шт.` });
    }
    onDone();
  };

  const del = target.mode === "delete";

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {del ? "Удалить позиции?" : "Перенести на стол"}
        </div>

        <div className="mt-3 space-y-1 rounded-xl bg-black/30 px-3 py-2 text-sm text-white/85">
          {target.lines.map((line) => (
            <div key={line.orderItemId}>
              <span className="font-bold tabular-nums">{line.qty} ×</span> {line.name}
            </div>
          ))}
        </div>

        {del ? (
          <input
            className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/25"
            placeholder="Причина (необязательно)"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : tables === null ? (
          <div className="mt-3 text-sm text-white/50">Загружаем столы…</div>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {tables.map((table) => (
              <button
                key={table.id}
                type="button"
                onClick={() => setToTable(table)}
                className={[
                  "relative h-12 rounded-xl text-sm font-bold transition active:scale-[0.98]",
                  toTable?.id === table.id ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white",
                ].join(" ")}
              >
                {table.code}
                {table.busy ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-label="занят" />
                ) : null}
              </button>
            ))}
          </div>
        )}

        {!del && toTable?.guests.length ? (
          <div className="mt-2 text-xs text-white/50">За столом {toTable.code}: {toTable.guests.join(", ")}</div>
        ) : null}

        <button
          type="button"
          disabled={busy || (!del && !toTable)}
          onClick={() => void submit()}
          className={[
            "mt-4 h-11 w-full rounded-xl text-sm font-semibold transition active:scale-[0.99] disabled:opacity-40",
            del ? "bg-red-500 text-white" : "bg-white text-black",
          ].join(" ")}
        >
          {busy ? "…" : del ? `Удалить ${count} шт.` : toTable ? `Перенести на стол ${toTable.code}` : "Выберите стол"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
