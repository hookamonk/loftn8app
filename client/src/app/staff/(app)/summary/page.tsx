"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getCurrentShift,
  openShift,
  joinShift,
  closeShift,
  type ActiveShift,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useStaffSession } from "@/providers/staffSession";
import { useToast } from "@/providers/toast";
import { NotificationSetup } from "@/components/staff/NotificationSetup";

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl";
const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.99] disabled:opacity-50";
const btnGhost =
  "h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50";

function roleLabel(role?: string) {
  if (role === "WAITER") return "Официант";
  if (role === "HOOKAH") return "Кальянщик";
  if (role === "MANAGER") return "Менеджер";
  if (role === "ADMIN") return "Администратор";
  return role ?? "Персонал";
}

export default function StaffShiftPage() {
  const { staff } = useStaffSession();
  const { push } = useToast();

  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = staff?.role === "ADMIN";
  const isManager = staff?.role === "MANAGER";

  const load = async () => {
    const r = await getCurrentShift();
    if (!r.ok) {
      if (r.status === 401) setErr("Нужен вход");
      return;
    }
    setShift(r.data.shift);
  };

  usePolling(() => load(), {
    activeMs: 15000,
    idleMs: 45000,
    immediate: false,
    enabled: !isAdmin,
  });

  useEffect(() => {
    void load();
  }, []);

  type ShiftAction = () => Promise<{ ok: true } | { ok: false; error: string }>;

  const run = async (action: ShiftAction, okTitle: string) => {
    setBusy(true);
    setErr(null);
    const r = await action();
    setBusy(false);

    if (!r.ok) {
      setErr(r.error || "Не удалось выполнить действие");
      return;
    }

    push({ kind: "success", title: okTitle });
    await load();
  };

  const participants = shift?.participants ?? [];
  const isInShift = !!staff && participants.some((p) => p.staffId === staff.id);

  if (isAdmin) {
    return (
      <div className={card}>
        <div className="text-lg font-semibold text-white">Режим администратора</div>
        <div className="mt-2 text-sm text-white/60">
          Ваш раздел — консоль: статистика по точкам, редактор меню и список гостей с бонусами.
        </div>
        <Link
          href="/staff/admin"
          className="mt-4 inline-flex rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black"
        >
          Открыть
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-white">Смена</div>
            <div className="mt-1 text-xs text-white/50">{roleLabel(staff?.role)}</div>
          </div>

          {shift ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Открыта с {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Не открыта
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-2">
          {!shift && isManager ? (
            <button className={btnPrimary} disabled={busy} onClick={() => void run(openShift, "Смена открыта")}>
              Открыть смену
            </button>
          ) : null}

          {!shift && !isManager ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/55">
              Дождитесь, пока менеджер откроет смену.
            </div>
          ) : null}

          {shift && !isInShift ? (
            <button className={btnPrimary} disabled={busy} onClick={() => void run(joinShift, "Вы вошли в смену")}>
              Войти в смену
            </button>
          ) : null}

          {shift && isManager ? (
            <button
              className={btnGhost}
              disabled={busy}
              onClick={() => {
                if (!confirm("Закрыть смену? Все столы будут отключены.")) return;
                void run(closeShift, "Смена закрыта");
              }}
            >
              Закрыть смену
            </button>
          ) : null}
        </div>

        {participants.length ? (
          <div className="mt-4 border-t border-white/8 pt-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">В смене</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {participants.map((p) => (
                <span
                  key={p.id}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80"
                >
                  {p.staff?.username ?? p.staffId} · {roleLabel(p.role)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {err ? (
          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      <NotificationSetup />
    </div>
  );
}
