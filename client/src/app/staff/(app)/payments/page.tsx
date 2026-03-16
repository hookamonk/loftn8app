"use client";

import { useEffect, useState } from "react";
import { listPayments, confirmPayment, type StaffPayment, type PaymentStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useToast } from "@/providers/toast";

const STATUSES: PaymentStatus[] = ["PENDING", "CONFIRMED", "CANCELLED"];

function statusLabel(s: PaymentStatus) {
  if (s === "PENDING") return "Ожидают";
  if (s === "CONFIRMED") return "Подтверждены";
  return "Отменены";
}

function methodLabel(m: StaffPayment["method"]) {
  return m === "CARD" ? "Карта" : "Наличные";
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffPaymentsPage() {
  const [status, setStatus] = useState<PaymentStatus>("PENDING");
  const [payments, setPayments] = useState<StaffPayment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const r = await listPayments(status);

    if (!silent) setLoading(false);

    if (!r.ok) {
      setErr(r.error);
      return;
    }

    setPayments(r.data.payments);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 4000,
    idleMs: 12000,
    immediate: true,
    enabled: true,
  });

  useEffect(() => {
    const off = attachStaffRealtime(() => void tick());
    return off;
  }, [tick]);

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useStaffPushEvents(() => {
    void tick();
  });

  const onConfirm = async (id: string) => {
    const raw = prompt("Введите сумму в Kč");
    if (!raw) return;

    const amount = Number(raw.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      push({ kind: "error", title: "Ошибка", message: "Неверная сумма" });
      return;
    }

    setBusyId(id);
    const r = await confirmPayment(id, Math.floor(amount));
    setBusyId(null);

    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }

    push({ kind: "success", title: "Оплата подтверждена", message: `${Math.floor(amount)} Kč` });
    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-white">Оплаты</div>
            <div className="mt-1 text-xs text-white/50">
              Автообновление: {isRunning ? "включено" : "выключено"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">Запросов: {payments.length}</div>
          </div>

          <button className={btnGhost} onClick={() => void tick()}>
            Обновить
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={[
                "rounded-2xl border px-4 py-2 text-sm transition whitespace-nowrap",
                s === status
                  ? "border-white/20 bg-white/15 text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
              ].join(" ")}
              onClick={() => setStatus(s)}
            >
              {statusLabel(s)}
            </button>
          ))}
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-4 space-y-3">
        {payments.map((p) => (
          <div key={p.id} className={card}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-white/45">
                  {new Date(p.createdAt).toLocaleString()} • {statusLabel(p.status)}
                </div>

                <div className="mt-1 text-lg font-semibold text-white">
                  Стол {p.table.code}
                  {p.table.label ? ` • ${p.table.label}` : ""}
                </div>

                <div className="mt-1 text-sm text-white/70">{methodLabel(p.method)}</div>

                <div className="mt-1 text-sm text-white/60">
                  {p.session?.user
                    ? `${p.session.user.name} • ${p.session.user.phone}`
                    : "Гость без аккаунта"}
                </div>
              </div>

              {p.status === "PENDING" ? (
                <button
                  className={btn}
                  disabled={busyId === p.id}
                  onClick={() => void onConfirm(p.id)}
                >
                  {busyId === p.id ? "Сохраняем…" : "Подтвердить"}
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {!loading && payments.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>Нет оплат в этом разделе.</div>
        ) : null}
      </div>
    </div>
  );
}