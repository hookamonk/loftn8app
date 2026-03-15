"use client";

import { useEffect, useState } from "react";
import {
  getStaffSummary,
  type StaffSummary,
  getCurrentShift,
  openShift,
  joinShift,
  closeShift,
  type ActiveShift,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { ensurePushSubscribed } from "@/lib/staffPush";
import { armAudio } from "@/lib/staffAlerts";
import { useStaffSession } from "@/providers/staffSession";

function StatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-xs text-white/40">{hint}</div>
    </div>
  );
}

const btn =
  "rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 transition disabled:opacity-50";

export default function StaffSummaryPage() {
  const { staff } = useStaffSession();

  const [data, setData] = useState<StaffSummary | null>(null);
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadShift = async () => {
    const r = await getCurrentShift();
    if (!r.ok) {
      if (r.status === 401) {
        setErr("Staff auth required");
      }
      return;
    }
    setShift(r.data.shift);
  };

  const loadSummary = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setErr(null);

    const r = await getStaffSummary();

    if (!r.ok) {
      if (r.status === 409) {
        setData({
          newOrders: 0,
          newCalls: 0,
          pendingPayments: 0,
        });
        return;
      }

      if (!silent) setErr(r.error || "Something went wrong");
      return;
    }

    setData(r.data);
    setLast(Date.now());
  };

  const loadAll = async (opts?: { silent?: boolean }) => {
    await Promise.all([loadShift(), loadSummary(opts)]);
  };

  const { tick, isRunning } = usePolling(() => loadAll({ silent: true }), {
    activeMs: 5000,
    idleMs: 15000,
    immediate: true,
    enabled: true,
  });

  useEffect(() => {
    const off = attachStaffRealtime(() => void tick());
    return off;
  }, [tick]);

  const onEnableNotifications = async () => {
    setPushStatus(null);
    setErr(null);

    const r = await ensurePushSubscribed();
    if (!r.ok) {
      setErr(r.error || "Не удалось включить уведомления");
      return;
    }

    await armAudio();
    setPushStatus("✅ Уведомления включены");
  };

  const onOpenShift = async () => {
    setBusy(true);
    setErr(null);

    const r = await openShift();
    setBusy(false);

    if (!r.ok) {
      setErr(r.error || "Не удалось открыть смену");
      return;
    }

    await loadAll({ silent: false });
  };

  const onJoinShift = async () => {
    setBusy(true);
    setErr(null);

    const r = await joinShift();
    setBusy(false);

    if (!r.ok) {
      setErr(r.error || "Не удалось войти в смену");
      return;
    }

    await loadAll({ silent: false });
  };

  const onCloseShift = async () => {
    if (!confirm("Закрыть текущую смену?")) return;

    setBusy(true);
    setErr(null);

    const r = await closeShift();
    setBusy(false);

    if (!r.ok) {
      setErr(r.error || "Не удалось закрыть смену");
      return;
    }

    await loadAll({ silent: false });
  };

  const isManager = staff?.role === "MANAGER";
  const participants = shift?.participants ?? [];
  const isInShift = !!staff && participants.some((p) => p.staffId === staff.id && p.role === staff.role);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Сводка</div>
              <div className="mt-1 text-xs text-white/50">
                Auto-refresh: {isRunning ? "ON" : "OFF"}
                {last ? ` • обновлено ${new Date(last).toLocaleTimeString()}` : ""}
              </div>
              <div className="mt-2 text-xs text-white/60">
                {shift
                  ? `Смена открыта • ${new Date(shift.openedAt).toLocaleString()}`
                  : "Активной смены нет"}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button className={btn} onClick={onEnableNotifications}>
                🔔 Уведомления
              </button>
              <button className={btn} onClick={() => void tick()}>
                ↻ Обновить
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2">
            {!shift && isManager ? (
              <button className={btn} disabled={busy} onClick={onOpenShift}>
                Открыть смену
              </button>
            ) : null}

            {shift && !isInShift ? (
              <button className={btn} disabled={busy} onClick={onJoinShift}>
                Войти в смену
              </button>
            ) : null}

            {shift && isManager ? (
              <button className={btn} disabled={busy} onClick={onCloseShift}>
                Закрыть смену
              </button>
            ) : null}
          </div>

          {shift?.participants?.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-white/50">Участники активной смены</div>
              <div className="mt-2 space-y-2">
                {shift.participants.map((p) => (
                  <div key={p.id} className="text-sm text-white/85">
                    {p.staff?.username ?? p.staffId} • {p.role}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {pushStatus ? (
            <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">
              {pushStatus}
            </div>
          ) : null}

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard title="Новые заказы" value={data?.newOrders ?? 0} hint="ожидают принятия" />
          <StatCard title="Вызовы" value={data?.newCalls ?? 0} hint="официант / кальян / счёт" />
          <StatCard title="Оплаты" value={data?.pendingPayments ?? 0} hint="ожидают обработки" />
        </div>
      </div>
    </main>
  );
}