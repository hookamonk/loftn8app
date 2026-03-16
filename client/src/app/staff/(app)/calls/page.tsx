"use client";

import { useEffect, useState } from "react";
import { listCalls, updateCallStatus, type StaffCall, type CallStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useToast } from "@/providers/toast";

const STATUSES: CallStatus[] = ["NEW", "ACKED", "DONE"];

function statusLabel(s: CallStatus) {
  if (s === "NEW") return "Новые";
  if (s === "ACKED") return "Взяты";
  return "Завершены";
}

function typeLabel(t: StaffCall["type"]) {
  if (t === "WAITER") return "Официант";
  if (t === "HOOKAH") return "Кальянщик";
  if (t === "BILL") return "Оплата";
  return "Помощь";
}

function nextAction(s: CallStatus) {
  if (s === "NEW") return { status: "ACKED" as CallStatus, label: "Взять" };
  if (s === "ACKED") return { status: "DONE" as CallStatus, label: "Завершить" };
  return null;
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

export default function StaffCallsPage() {
  const [status, setStatus] = useState<CallStatus>("NEW");
  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const r = await listCalls(status);

    if (!silent) setLoading(false);

    if (!r.ok) {
      setErr(r.error);
      return;
    }

    setCalls(r.data.calls);
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

  const setTo = async (id: string, st: CallStatus, okText: string) => {
    setBusyId(id);
    const r = await updateCallStatus(id, st);
    setBusyId(null);

    if (!r.ok) {
      push({ kind: "error", title: "Ошибка", message: r.error });
      return;
    }

    push({ kind: "success", title: "Готово", message: okText });
    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-white">Вызовы</div>
            <div className="mt-1 text-xs text-white/50">
              Автообновление: {isRunning ? "включено" : "выключено"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            <div className="mt-2 text-xs text-white/60">Вызовов: {calls.length}</div>
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
        {calls.map((c) => {
          const action = nextAction(c.status);

          return (
            <div key={c.id} className={card}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/45">
                    {new Date(c.createdAt).toLocaleString()} • {statusLabel(c.status)}
                  </div>

                  <div className="mt-1 text-lg font-semibold text-white">
                    Стол {c.table.code}
                    {c.table.label ? ` • ${c.table.label}` : ""}
                  </div>

                  <div className="mt-1 text-sm text-white/70">{typeLabel(c.type)}</div>

                  <div className="mt-1 text-sm text-white/60">
                    {c.session?.user
                      ? `${c.session.user.name} • ${c.session.user.phone}`
                      : "Гость без аккаунта"}
                  </div>

                  {c.message ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/85">
                      Сообщение: {c.message}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                {action ? (
                  <button
                    className={btn}
                    disabled={busyId === c.id}
                    onClick={() =>
                      void setTo(
                        c.id,
                        action.status,
                        action.status === "ACKED" ? "Вызов взят в работу" : "Вызов завершён"
                      )
                    }
                  >
                    {busyId === c.id ? "Сохраняем…" : action.label}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && calls.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>Нет вызовов в этом разделе.</div>
        ) : null}
      </div>
    </div>
  );
}