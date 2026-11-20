"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listTableChoices, openTable, type TableChoice } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * «Открыть стол»: guests sat down without scanning the QR code. Tap a free
 * table — it opens and its card comes up (add the order, attach a regular).
 * A busy table (green dot) just opens its card.
 */
export function OpenTableSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return <Sheet onClose={onClose} />;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [tables, setTables] = useState<TableChoice[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void listTableChoices().then((r) => {
      if (!alive) return;
      if (r.ok) setTables(r.data.tables);
      else push({ kind: "error", title: "Столы не загрузились", message: r.error });
    });
    return () => {
      alive = false;
    };
  }, [push]);

  const choose = async (table: TableChoice) => {
    if (busyId !== null) return;
    if (table.busy) {
      router.push(`/staff/tables/${table.id}`);
      return;
    }
    setBusyId(table.id);
    const r = await openTable(table.id);
    setBusyId(null);
    if (!r.ok) return push({ kind: "error", title: "Стол не открылся", message: r.error });
    push({ kind: "success", title: `Стол ${table.code} открыт` });
    router.push(`/staff/tables/${table.id}`);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom">
        <div className="text-lg font-semibold text-white">Открыть стол</div>
        <div className="mt-1 text-xs text-white/45">Гости не сканировали QR. Зелёная точка — стол уже открыт.</div>

        {tables === null ? (
          <div className="mt-3 text-sm text-white/50">Загружаем столы…</div>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {tables.map((table) => (
              <button
                key={table.id}
                type="button"
                disabled={busyId !== null}
                onClick={() => void choose(table)}
                className={[
                  "relative h-12 rounded-xl text-sm font-bold transition active:scale-[0.98] disabled:opacity-60",
                  table.busy ? "border border-white/10 bg-white/[0.03] text-white/50" : "border border-white/15 bg-white/10 text-white",
                ].join(" ")}
              >
                {busyId === table.id ? "…" : table.code}
                {table.busy ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-label="открыт" />
                ) : null}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
