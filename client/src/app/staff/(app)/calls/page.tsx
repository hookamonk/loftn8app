"use client";

import { useEffect, useState } from "react";
import { listCalls, updateCallStatus, type StaffCall, type CallStatus } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { attachStaffRealtime } from "@/lib/staffRealtime";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";

const STATUSES: CallStatus[] = ["NEW", "ACKED", "DONE"];

function nextStatus(s: CallStatus): CallStatus | null {
  if (s === "NEW") return "ACKED";
  if (s === "ACKED") return "DONE";
  return null;
}

const glassCard =
  "rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 hover:bg-white/10 active:scale-[0.99] transition";
const pill =
  "rounded-full border border-white/10 px-3 py-1 text-sm transition";
const pillActive = "bg-white/15 text-white";
const pillIdle = "bg-white/5 text-white/70 hover:bg-white/10";

export default function StaffCallsPage() {
  const [status, setStatus] = useState<CallStatus>("NEW");
  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

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
    activeMs: 5000,
    idleMs: 15000,
    immediate: true,
    enabled: true,
  });

  // ✅ мгновенный refresh по Web Push / SW postMessage
  useEffect(() => {
    const off = attachStaffRealtime(() => {
      void tick();
    });
    return off;
  }, [tick]);

  useEffect(() => {
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useStaffPushEvents(() => {
    void tick();
  });

  const setTo = async (id: string, st: CallStatus) => {
    const r = await updateCallStatus(id, st);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    await load({ silent: false });
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">Вызовы</div>
          <div className="text-xs text-white/50">
            Auto-refresh: {isRunning ? "ON" : "OFF"}
            {last ? ` • обновлено ${new Date(last).toLocaleTimeString()}` : ""}
          </div>
        </div>

        <button className={btn} onClick={() => void tick()}>
          Обновить
        </button>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`${pill} ${s === status ? pillActive : pillIdle}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {err ? (
        <div className="mt-3 rounded-3xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading ? <div className="mt-3 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-3 space-y-3">
        {calls.map((c) => {
          const ns = nextStatus(c.status);
          return (
            <div key={c.id} className={`${glassCard} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-white/50">
                    {new Date(c.createdAt).toLocaleString()} • {c.status} • {c.type}
                  </div>

                  <div className="mt-1 font-semibold text-white">
                    Стол: {c.table.code}
                    {c.table.label ? ` (${c.table.label})` : ""}
                  </div>

                  {c.session?.user ? (
                    <div className="mt-1 text-xs text-white/60">
                      Гость: {c.session.user.name} • {c.session.user.phone}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-white/60">Гость: без аккаунта</div>
                  )}

                  {c.message ? (
                    <div className="mt-2 text-sm text-white/80">
                      Сообщение: <span className="text-white">{c.message}</span>
                    </div>
                  ) : null}
                </div>

                {ns ? (
                  <button
                    className="shrink-0 rounded-xl border border-white/10 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
                    onClick={() => void setTo(c.id, ns)}
                  >
                    {ns}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {calls.length === 0 ? (
          <div className={`${glassCard} p-4 text-sm text-white/60`}>Нет вызовов.</div>
        ) : null}
      </div>
    </div>
  );
}
