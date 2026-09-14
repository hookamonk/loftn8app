"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  cancelPayment,
  confirmPayment,
  getActiveTableDetails,
  requestTablePayment,
  type StaffActiveTableDetails,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { useStaffEvents } from "@/lib/useStaffEvents";
import { emitStaffLiveSync, subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { useToast } from "@/providers/toast";
import { OrderComposer } from "@/components/staff/OrderComposer";

/**
 * Everything a waiter needs at a table, on one screen: what is unpaid right
 * now, one button to settle it, and — when the guest started the payment from
 * their own phone — one button to confirm it.
 */

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btnPrimary =
  "h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";
const btnAccent =
  "h-12 w-full rounded-2xl bg-emerald-400 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";
const btnGhost =
  "h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50";

export default function StaffTableDetailsPage() {
  const params = useParams<{ tableId: string }>();
  const { push } = useToast();
  const tableId = Number(params.tableId);

  const [data, setData] = useState<StaffActiveTableDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askMethod, setAskMethod] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);

      const result = await getActiveTableDetails(tableId);

      if (!silent) setLoading(false);

      if (!result.ok) {
        setErr(result.error);
        return;
      }

      setErr(null);
      setData(result.data.table);
    },
    [tableId]
  );

  const { tick } = usePolling(() => load({ silent: true }), {
    activeMs: 5000,
    idleMs: 12000,
    immediate: false,
    enabled: Number.isFinite(tableId) && tableId > 0,
  });

  useEffect(() => {
    if (!Number.isFinite(tableId) || tableId <= 0) return;
    void load({ silent: false });
  }, [tableId, load]);

  useStaffPushEvents(() => void tick());
  useStaffEvents(() => void tick());
  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

  const settle = async (method: "CARD" | "CASH") => {
    if (!data || busy) return;

    setBusy(true);
    const result = await requestTablePayment(data.table.id, method);
    setBusy(false);
    setAskMethod(false);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    push({
      kind: "success",
      title: "Счёт выставлен",
      message: method === "CARD" ? "Картой — несите терминал." : "Наличными.",
    });
    emitStaffLiveSync("payment-request-created");
    await load({ silent: true });
  };

  const confirm = async () => {
    if (!data?.pendingPayment || busy) return;

    setBusy(true);
    const result = await confirmPayment(data.pendingPayment.id);
    setBusy(false);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    push({ kind: "success", title: "Оплата принята", message: "Счёт закрыт." });
    emitStaffLiveSync("payment-confirmed");
    await load({ silent: true });
  };

  const cancel = async () => {
    if (!data?.pendingPayment || busy) return;

    setBusy(true);
    const result = await cancelPayment(data.pendingPayment.id);
    setBusy(false);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    push({ kind: "info", title: "Счёт отменён" });
    emitStaffLiveSync("payment-cancelled");
    await load({ silent: true });
  };

  const pending = data?.pendingPayment ?? null;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.24em] text-white/45">СТОЛ</div>
            <div className="mt-1 text-2xl font-bold text-white">{data ? data.table.code : "—"}</div>
            <div className="mt-1 text-sm text-white/55">
              {data?.session.user ? data.session.user.name : "Гость без аккаунта"}
            </div>
          </div>

          <Link
            href="/staff/tables"
            className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80"
          >
            Назад
          </Link>
        </div>

        {err ? (
          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}
      </div>

      {loading && !data ? <div className="text-sm text-white/60">Загрузка…</div> : null}

      {/* Current unpaid bill */}
      <div className={card}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">Счёт</div>
          <div className="text-2xl font-bold text-white">{data?.billTotalCzk ?? 0} Kč</div>
        </div>

        <div className="mt-3 space-y-1.5">
          {data && data.payableItems.length > 0 ? (
            data.payableItems.map((item) => (
              <div
                key={item.orderItemId}
                className="flex items-start justify-between gap-3 rounded-xl bg-black/20 px-3 py-2 text-sm text-white/85"
              >
                <div className="min-w-0">
                  <div className="truncate">
                    {item.name} × {item.qty}
                  </div>
                  {item.comment ? (
                    <div className="mt-0.5 text-[11px] text-white/45">{item.comment}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-white/70">{item.totalCzk} Kč</div>
              </div>
            ))
          ) : (
            <div className="rounded-xl bg-black/20 px-3 py-3 text-sm text-white/55">
              Неоплаченных позиций нет.
            </div>
          )}
        </div>
      </div>

      {/* The guest started the payment from their phone — just confirm it. */}
      {pending ? (
        <div className="rounded-[28px] border border-sky-400/35 bg-sky-500/12 p-4">
          <div className="text-sm font-semibold text-sky-100">
            Гость ждёт оплату · {pending.method === "CARD" ? "Карта" : "Наличные"}
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{pending.billTotalCzk} Kč</div>
          {pending.loyaltyAppliedCzk > 0 ? (
            <div className="mt-1 text-xs text-sky-100/80">
              Списывается кэшбэк: {pending.loyaltyAppliedCzk} Kč
            </div>
          ) : null}

          <button className={`${btnAccent} mt-4`} disabled={busy} onClick={() => void confirm()}>
            {busy ? "Сохраняем…" : "Подтвердить оплату"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
            className="mt-2 w-full text-xs text-white/40 underline underline-offset-4 disabled:opacity-50"
          >
            Отменить счёт
          </button>
        </div>
      ) : null}

      {/* Actions */}
      {data ? (
        <div className={card}>
          {!pending && data.capabilities.canSettle ? (
            askMethod ? (
              <div className="grid gap-2">
                <div className="text-sm font-semibold text-white">Чем платит гость?</div>
                <button className={btnPrimary} disabled={busy} onClick={() => void settle("CARD")}>
                  Картой
                </button>
                <button className={btnPrimary} disabled={busy} onClick={() => void settle("CASH")}>
                  Наличными
                </button>
                <button className={btnGhost} disabled={busy} onClick={() => setAskMethod(false)}>
                  Отмена
                </button>
              </div>
            ) : (
              <button
                className={btnAccent}
                disabled={busy || data.billTotalCzk <= 0}
                onClick={() => setAskMethod(true)}
              >
                Рассчитать
              </button>
            )
          ) : null}

          {!askMethod ? (
            <button
              className={`${btnGhost} ${!pending && data.capabilities.canSettle ? "mt-2" : ""}`}
              onClick={() => setComposerOpen(true)}
            >
              Добавить позиции
            </button>
          ) : null}
        </div>
      ) : null}

      {data ? (
        <OrderComposer
          open={composerOpen}
          tableId={data.table.id}
          tableCode={data.table.code}
          sessionId={data.session.id}
          onClose={() => setComposerOpen(false)}
          onSaved={async () => {
            setComposerOpen(false);
            emitStaffLiveSync("order-created");
            await load({ silent: true });
          }}
        />
      ) : null}
    </div>
  );
}
