"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { listActiveTables, type StaffActiveTable } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useScreenRefresh } from "@/lib/staffScreenRefresh";
import { CloseTableSheet, type CloseTableTarget } from "@/components/staff/CloseTableSheet";
import { emitStaffLiveSync, subscribeStaffLiveSync } from "@/lib/staffLiveSync";

const card =
  "rounded-3xl border border-white/10 bg-white/[0.05] p-3.5";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

// Priority status of an active table, most attention-worthy first.
function tableStatus(entry: StaffActiveTable) {
  if (entry.pendingPaymentsCount > 0)
    return { key: "pay", label: "Ждёт оплату", dot: "bg-sky-400", ring: "border-sky-400/45", chip: "bg-sky-500/20 text-sky-200", rank: 0 };
  if (entry.activeCallsCount > 0)
    return { key: "call", label: "Вызов", dot: "bg-amber-400", ring: "border-amber-400/45", chip: "bg-amber-400/20 text-amber-200", rank: 1 };
  if (entry.openItemsCount > 0)
    return { key: "order", label: "Заказ", dot: "bg-emerald-400", ring: "border-emerald-400/45", chip: "bg-emerald-500/20 text-emerald-200", rank: 2 };
  // Active but nothing pending — still "alive", shown with a calm green accent.
  return { key: "idle", label: "Активен", dot: "bg-emerald-400", ring: "border-emerald-400/30", chip: "bg-emerald-500/12 text-emerald-200/90", rank: 3 };
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function StaffTablesPage() {
  const [tables, setTables] = useState<StaffActiveTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<CloseTableTarget | null>(null);

  // A slower, older answer never overwrites a newer one.
  const loadSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const load = async (opts?: { silent?: boolean; fresh?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const seq = ++loadSeqRef.current;
    const result = await listActiveTables(opts?.fresh ? { fresh: true } : undefined);

    if (!silent) setLoading(false);
    if (seq < appliedSeqRef.current) return;
    appliedSeqRef.current = seq;

    if (!result.ok) {
      setErr(result.error);
      return;
    }

    setTables(result.data.tables);
    setLast(Date.now());
  };

  const { tick } = usePolling(() => load({ silent: true }), {
    activeMs: 5000,
    idleMs: 12000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
  }, []);

  // Alerts and every change at any table: the shell refreshes this board
  // with fresh data, then sounds.
  useScreenRefresh(() => load({ silent: true, fresh: true }));

  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

  // Surface the tables that need attention first.
  const sorted = [...tables].sort((a, b) => {
    const r = tableStatus(a).rank - tableStatus(b).rank;
    if (r !== 0) return r;
    return a.table.code.localeCompare(b.table.code, undefined, { numeric: true });
  });

  const attention = tables.filter((t) => t.pendingPaymentsCount > 0 || t.activeCallsCount > 0).length;

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Столы</div>
            <div className="mt-1.5 text-xs text-white/55">
              Активных: {tables.length}
              {attention > 0 ? ` • требуют внимания: ${attention}` : ""}
              {last ? ` • ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </div>
          </div>

          <button className={btnGhost} onClick={() => void tick()}>
            Обновить
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        {sorted.map((entry) => {
          const s = tableStatus(entry);
          return (
            <div key={entry.session.id} className={`flex flex-col rounded-3xl border bg-white/[0.05] ${s.ring}`}>
            <Link
              href={`/staff/tables/${entry.table.id}`}
              className="rounded-3xl p-3.5 transition active:scale-[0.98] hover:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-lg font-bold text-white">
                  {entry.table.code}
                </div>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
              </div>

              <div className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.chip}`}>
                {s.label}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-white/70">
                {entry.openItemsCount > 0 ? (
                  <span className="rounded-md bg-white/8 px-1.5 py-0.5">🍽 {entry.openItemsCount}</span>
                ) : null}
                {entry.activeCallsCount > 0 ? (
                  <span className="rounded-md bg-white/8 px-1.5 py-0.5">🔔 {entry.activeCallsCount}</span>
                ) : null}
                {entry.pendingPaymentsCount > 0 ? (
                  <span className="rounded-md bg-white/8 px-1.5 py-0.5">💳 {entry.pendingPaymentsCount}</span>
                ) : null}
              </div>

              <div className="mt-2 truncate text-[11px] text-white/45">
                {entry.guests?.length
                  ? entry.guests.length > 2
                    ? `${entry.guests.slice(0, 2).join(", ")} +${entry.guests.length - 2}`
                    : entry.guests.join(", ")
                  : entry.session.user
                  ? entry.session.user.name?.trim() || "Гость с аккаунтом"
                  : "Гость"}{" "}
                ·{" "}
                {formatTime(entry.lastActivityAt)}
              </div>
            </Link>
            {/* Paid and gone: free the table right from the list. */}
            {entry.capabilities?.canDisconnect ? (
              <div className="px-3.5 pb-3.5">
                <button
                  type="button"
                  onClick={() =>
                    setCloseTarget({
                      tableId: entry.table.id,
                      tableCode: entry.table.code,
                      canClose: true,
                      unpaidCzk: 0,
                      waitingPayment: false,
                    })
                  }
                  className="h-9 w-full rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-white/80 active:bg-white/10"
                >
                  Закрыть стол
                </button>
              </div>
            ) : null}
            </div>
          );
        })}
      </div>

      <CloseTableSheet
        target={closeTarget}
        onClose={() => setCloseTarget(null)}
        onDone={() => {
          setCloseTarget(null);
          emitStaffLiveSync("table-closed");
          void load({ silent: true, fresh: true });
        }}
      />

      {!loading && tables.length === 0 ? (
        <div className={`${card} mt-4 text-sm text-white/60`}>Сейчас нет активных столов.</div>
      ) : null}
    </div>
  );
}
