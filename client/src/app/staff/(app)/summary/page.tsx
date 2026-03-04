"use client";

import { useEffect, useState } from "react";
import { getStaffSummary, type StaffSummary } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";

import { ensurePushSubscribed } from "@/lib/staffPush";
import { armAudio } from "@/lib/staffAlerts";

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

export default function StaffSummaryPage() {
  const [data, setData] = useState<StaffSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setErr(null);

    const r = await getStaffSummary();
    if (!r.ok) {
      if (!silent) setErr(r.error || "Something went wrong");
      return;
    }

    setData(r.data);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
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
            </div>

            <div className="flex flex-col gap-2">
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                onClick={onEnableNotifications}
              >
                🔔 Уведомления
              </button>
              <button
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                onClick={() => void tick()}
              >
                ↻ Обновить
              </button>
            </div>
          </div>

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
