"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { ensurePushSubscribed, rebindPushIfPossible } from "@/lib/staffPush";
import { armAudio } from "@/lib/staffAlerts";
import { useStaffSession } from "@/providers/staffSession";
import { useToast } from "@/providers/toast";

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
    <div className="rounded-[24px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="text-xs text-white/55">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-xs text-white/40">{hint}</div>
    </div>
  );
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

function roleLabel(role?: string) {
  if (role === "WAITER") return "Официант";
  if (role === "HOOKAH") return "Кальянщик";
  if (role === "MANAGER") return "Менеджер";
  if (role === "ADMIN") return "Администратор";
  return role ?? "Staff";
}

function humanizePushError(error?: string | null) {
  if (!error) return "Не удалось включить уведомления";
  if (error.includes("IOS_HOME_SCREEN_REQUIRED")) {
    return "На iPhone/iPad откройте приложение с экрана Домой: обычная вкладка браузера не может держать боевые web push на заблокированном экране.";
  }
  if (error.includes("NOT_ALLOWED")) {
    return "Разрешение на уведомления не выдано.";
  }
  return error;
}

export default function StaffSummaryPage() {
  const { staff } = useStaffSession();
  const { push } = useToast();

  const [data, setData] = useState<StaffSummary | null>(null);
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";

  const loadShift = async () => {
    const r = await getCurrentShift();
    if (!r.ok) {
      if (r.status === 401) setErr("Нужен вход");
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
        setData({ newOrders: 0, newCalls: 0, pendingPayments: 0 });
        return;
      }

      if (!silent) setErr(r.error || "Ошибка");
      return;
    }

    setData(r.data);
    setLast(Date.now());
  };

  const loadAll = async (opts?: { silent?: boolean }) => {
    await Promise.all([loadShift(), loadSummary(opts)]);
  };

  const { tick, isRunning } = usePolling(() => loadAll({ silent: true }), {
    activeMs: 8000,
    idleMs: 30000,
    immediate: true,
    enabled: !isAdmin,
  });

  useEffect(() => {
    if (isAdmin) return;
    const off = attachStaffRealtime(() => void tick());
    return off;
  }, [tick, isAdmin]);

  useEffect(() => {
    async function boot() {
      await loadAll({ silent: false });
      await rebindPushIfPossible();
    }
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEnableNotifications = async () => {
    setPushStatus(null);
    setErr(null);

    const r = await ensurePushSubscribed();
    if (!r.ok) {
      const message = humanizePushError(r.error);
      setErr(message);
      push({
        kind: "error",
        title: "Ошибка",
        message,
      });
      return;
    }

    await armAudio();
    setPushStatus("Уведомления включены");
    push({ kind: "success", title: "Готово", message: "Уведомления включены" });
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

    push({ kind: "success", title: "Смена открыта" });
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

    push({ kind: "success", title: "Вы вошли в смену" });
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

    push({ kind: "success", title: "Смена закрыта" });
    await loadAll({ silent: false });
  };

  const participants = shift?.participants ?? [];
  const isInShift = !!staff && participants.some((p) => p.staffId === staff.id && p.role === staff.role);

  if (isAdmin) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className={card}>
            <div className="text-lg font-semibold">Режим администратора</div>
            <div className="mt-2 text-sm text-white/60">
              Основная рабочая область для вас — админ-панель.
            </div>

            <div className="mt-4">
              <Link
                href="/staff/admin"
                className="inline-flex rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"
              >
                Открыть админ-панель
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-md px-4 py-6">
        <div className={card}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xl font-semibold">Сводка смены</div>
              <div className="mt-1 text-xs text-white/50">
                {roleLabel(staff?.role)} • автообновление: {isRunning ? "включено" : "выключено"}
                {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
              </div>
              <div className="mt-2 text-sm text-white/65">
                {shift
                  ? `Смена открыта • ${new Date(shift.openedAt).toLocaleString()}`
                  : "Смена сейчас не открыта"}
              </div>
            </div>

            <button className={btnGhost} onClick={() => void tick()}>
              Обновить
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            <button className={btn} onClick={onEnableNotifications}>
              Включить уведомления
            </button>

            {!shift && isManager ? (
              <button className={btnPrimary} disabled={busy} onClick={onOpenShift}>
                Открыть смену
              </button>
            ) : null}

            {shift && !isInShift ? (
              <button className={btnPrimary} disabled={busy} onClick={onJoinShift}>
                Войти в смену
              </button>
            ) : null}

            {shift && isManager ? (
              <button className={btnGhost} disabled={busy} onClick={onCloseShift}>
                Закрыть смену
              </button>
            ) : null}
          </div>

          {shift?.participants?.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-white/50">Кто сейчас в смене</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {shift.participants.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85"
                  >
                    {p.staff?.username ?? p.staffId} • {roleLabel(p.role)}
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
          <StatCard title="Новые заказы" value={data?.newOrders ?? 0} hint="Принять" />
          <StatCard title="Вызовы" value={data?.newCalls ?? 0} hint="Подойти" />
          <StatCard title="Оплаты" value={data?.pendingPayments ?? 0} hint="Рассчитать" />
        </div>
      </div>
    </main>
  );
}
