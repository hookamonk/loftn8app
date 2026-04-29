"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listActiveTables, type StaffActiveTable } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { subscribeStaffLiveSync } from "@/lib/staffLiveSync";

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString();
}

export default function StaffTablesPage() {
  const [tables, setTables] = useState<StaffActiveTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const result = await listActiveTables();

    if (!silent) setLoading(false);

    if (!result.ok) {
      setErr(result.error);
      return;
    }

    setTables(result.data.tables);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 5000,
    idleMs: 12000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useStaffPushEvents((payload) => {
    if (
      payload.kind === "ORDER_CREATED" ||
      payload.kind === "CALL_CREATED" ||
      payload.kind === "PAYMENT_REQUESTED" ||
      payload.kind === "GUEST_MESSAGE"
    ) {
      void tick();
    }
  });

  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Столы</div>
            <div className="mt-1 text-xs text-white/50">
              Автообновление: {isRunning ? "включено" : "выключено"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">Активных столов: {tables.length}</div>
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

      <div className="mt-4 space-y-3">
        {tables.map((entry) => (
          <div key={entry.session.id} className={card}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(74,222,128,0.14)]" />
                  <div className="text-lg font-semibold text-white">
                    Стол {entry.table.code}
                    {entry.table.label ? ` • ${entry.table.label}` : ""}
                  </div>
                </div>

                <div className="mt-2 text-sm text-white/65">
                  {entry.session.user
                    ? `${entry.session.user.name} • ${entry.session.user.phone}`
                    : "Гость без аккаунта"}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/70">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Заказов: {entry.openItemsCount}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Вызовов: {entry.activeCallsCount}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    Оплат: {entry.pendingPaymentsCount}
                  </span>
                </div>

                <div className="mt-3 text-xs text-white/45">
                  Последняя активность: {formatTime(entry.lastActivityAt)}
                </div>
              </div>

              <Link href={`/staff/tables/${entry.table.id}`} className={btnPrimary}>
                Просмотр
              </Link>
            </div>
          </div>
        ))}

        {!loading && tables.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>Сейчас нет активных столов.</div>
        ) : null}
      </div>
    </div>
  );
}
