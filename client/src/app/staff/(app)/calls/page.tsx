"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listCalls, updateCallStatus, type StaffCall } from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useToast } from "@/providers/toast";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { emitStaffLiveSync } from "@/lib/staffLiveSync";
import { WaitBadge, TONE_BORDER, waitInfo, queueCardBase } from "@/lib/staffQueue";

/**
 * Service calls only — hookah, free-text messages and "bring me the bill".
 * A guest asking to ORDER is not a call: it lands in the Orders tab instead.
 *
 * One list, one button: tap «Принять» and the card is gone.
 */

const TYPE_CHIP: Record<StaffCall["type"], string> = {
  WAITER: "bg-sky-500/20 text-sky-200",
  HOOKAH: "bg-fuchsia-500/20 text-fuchsia-200",
  BILL: "bg-emerald-500/20 text-emerald-200",
  HELP: "bg-amber-500/20 text-amber-200",
};

function typeLabel(type: StaffCall["type"]) {
  if (type === "HOOKAH") return "Кальян";
  if (type === "BILL") return "Оплата";
  if (type === "WAITER") return "Официант";
  return "Сообщение";
}

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";

export default function StaffCallsPage() {
  const { push } = useToast();

  const [calls, setCalls] = useState<StaffCall[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);

    const result = await listCalls("NEW");

    if (!silent) setLoading(false);

    if (!result.ok) {
      setErr(result.error);
      return;
    }

    setErr(null);
    setCalls(result.data.calls);
  }, []);

  const { tick } = usePolling(() => load({ silent: true }), {
    activeMs: 8000,
    idleMs: 20000,
    immediate: false,
    enabled: true,
  });

  useEffect(() => {
    void load({ silent: false });
  }, [load]);

  useStaffPushEvents((payload) => {
    if (payload.kind === "CALL_CREATED" || payload.kind === "GUEST_MESSAGE") void tick();
  });

  useStaffEvents((e) => {
    if (e.kind === "CALL_CREATED" || e.kind === "GUEST_MESSAGE" || e.kind === "DATA_CHANGED") void tick();
  });

  // Longest wait on top.
  const sorted = useMemo(
    () => [...calls].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [calls]
  );

  const accept = async (call: StaffCall) => {
    setBusyId(call.id);
    // Optimistic: the card disappears immediately, the poll confirms it.
    setCalls((current) => current.filter((c) => c.id !== call.id));

    const result = await updateCallStatus(call.id, "DONE");
    setBusyId(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      await load({ silent: true });
      return;
    }

    emitStaffLiveSync("call-accepted");
    await load({ silent: true });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-xl font-semibold text-white">Вызовы</div>
          {calls.length > 0 ? (
            <span className="shrink-0 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-black">
              {calls.length}
            </span>
          ) : null}
        </div>

        {err ? (
          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      <div className="mt-4 space-y-3">
        {sorted.map((call) => (
          <div
            key={call.id}
            className={`${queueCardBase} ${TONE_BORDER[waitInfo(call.createdAt, now).tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-lg font-semibold text-white">Стол {call.table.code}</div>
                  <WaitBadge createdAt={call.createdAt} now={now} />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TYPE_CHIP[call.type]}`}
                  >
                    {typeLabel(call.type)}
                  </span>
                  <span className="text-sm text-white/55">
                    {call.session?.user ? call.session.user.name : "Гость без аккаунта"}
                  </span>
                </div>
              </div>
            </div>

            {call.message ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/85">
                {call.message}
              </div>
            ) : null}

            <button
              className={`${btnPrimary} mt-4`}
              disabled={busyId === call.id}
              onClick={() => void accept(call)}
            >
              Принять
            </button>
          </div>
        ))}

        {!loading && sorted.length === 0 ? (
          <div className={`${card} text-sm text-white/60`}>Новых вызовов нет.</div>
        ) : null}
      </div>
    </div>
  );
}
