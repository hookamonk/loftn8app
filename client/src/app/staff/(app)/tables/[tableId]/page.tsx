"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloseTableSheet, type CloseTableTarget } from "@/components/staff/CloseTableSheet";
import { TableItemsSheet, type TableItemsTarget } from "@/components/staff/TableItemsSheet";
import { GuestSheet } from "@/components/staff/GuestSheet";
import { PaySheet } from "@/components/staff/PaySheet";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelPayment,
  confirmPayment,
  getActiveTableDetails,
  type StaffActiveTableDetails,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useScreenRefresh } from "@/lib/staffScreenRefresh";
import { emitStaffLiveSync, subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { useToast } from "@/providers/toast";
import { useStaffSession } from "@/providers/staffSession";
import { canCancelItems } from "@/lib/staffRoles";
import { OrderComposer } from "@/components/staff/OrderComposer";
import { CancelItemSheet, type CancelTarget } from "@/components/staff/CancelItemSheet";

/**
 * Everything a waiter needs at a table, on one screen: what is unpaid right
 * now, one button to settle it, and — when the guest started the payment from
 * their own phone — one button to confirm it. Regulars who didn't scan are
 * attached by name («Гости»); «Рассчитать» says who pays (their cashback) and
 * what — the bill can be split between the people at the table.
 */

const card =
  "rounded-3xl border border-white/10 bg-white/[0.05] p-3.5";
const btnAccent =
  "h-11 w-full rounded-xl bg-emerald-400 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-50";
const btnGhost =
  "h-11 w-full rounded-xl border border-white/10 bg-transparent text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50";

export default function StaffTableDetailsPage() {
  const params = useParams<{ tableId: string }>();
  const { push } = useToast();
  const router = useRouter();
  const [closeTarget, setCloseTarget] = useState<CloseTableTarget | null>(null);
  const { staff } = useStaffSession();
  const canCancel = canCancelItems(staff?.role);
  const tableId = Number(params.tableId);

  const [data, setData] = useState<StaffActiveTableDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  // Manager: choose lines to delete or move to another table.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [itemsTarget, setItemsTarget] = useState<TableItemsTarget | null>(null);

  // A slower, older answer never overwrites a newer one.
  const loadSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const load = useCallback(
    async (opts?: { silent?: boolean; fresh?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (!silent) setLoading(true);

      const seq = ++loadSeqRef.current;
      const result = await getActiveTableDetails(tableId, opts?.fresh ? { fresh: true } : undefined);

      if (!silent) setLoading(false);
      if (seq < appliedSeqRef.current) return;
      appliedSeqRef.current = seq;

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

  // Alerts: the shell refreshes this table with fresh data, then sounds.
  useScreenRefresh(() => load({ silent: true, fresh: true }), Number.isFinite(tableId) && tableId > 0);
  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

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
              {data?.guests?.length
                ? data.guests.join(", ")
                : data?.session.user
                ? data.session.user.name?.trim() || "Гость с аккаунтом"
                : "Гость без аккаунта"}
            </div>
            {/* A regular who didn't scan: find their account and attach it. */}
            {data?.capabilities.canSettle ? (
              <button
                type="button"
                onClick={() => setGuestsOpen(true)}
                className="mt-2 h-8 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white/80 active:bg-white/10"
              >
                {data.people.length ? `Гости · ${data.people.length}` : "+ Гость"}
              </button>
            ) : null}
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

        {/* Manager: delete or move lines (only what is unpaid, not while a bill is being paid). */}
        {canCancel && data && data.payableItems.length > 0 ? (
          pending ? (
            <div className="mt-2 text-xs text-white/45">Удалить или перенести позиции можно после отмены счёта.</div>
          ) : (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSelecting((value) => !value);
                  setPicked({});
                }}
                className="h-8 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white/80 active:bg-white/10"
              >
                {selecting ? "Отменить выбор" : "Выбрать позиции"}
              </button>
            </div>
          )
        ) : null}

        <div className="mt-3 space-y-1.5">
          {data && data.payableItems.length > 0 ? (
            data.payableItems.map((item) => {
              const chosen = picked[item.orderItemId];
              const toggle = () =>
                setPicked((current) => {
                  const next = { ...current };
                  if (next[item.orderItemId]) delete next[item.orderItemId];
                  else next[item.orderItemId] = item.qty;
                  return next;
                });
              return (
              <div
                key={item.orderItemId}
                onClick={selecting ? toggle : undefined}
                className={[
                  "flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm text-white/85",
                  selecting ? "cursor-pointer" : "",
                  chosen ? "bg-white/15 ring-1 ring-white/40" : "bg-black/20",
                ].join(" ")}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  {selecting ? (
                    <span
                      aria-hidden
                      className={[
                        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[12px] font-bold",
                        chosen ? "border-white bg-white text-black" : "border-white/30",
                      ].join(" ")}
                    >
                      {chosen ? "✓" : ""}
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <div className="truncate">
                      {item.name} × {item.qty}
                    </div>
                    {item.comment ? (
                      <div className="mt-0.5 text-[11px] text-white/45">{item.comment}</div>
                    ) : null}
                    {selecting && chosen && item.qty > 1 ? (
                      <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label="Меньше"
                          disabled={chosen <= 1}
                          onClick={() => setPicked((current) => ({ ...current, [item.orderItemId]: Math.max(1, chosen - 1) }))}
                          className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-14 text-center text-xs font-semibold tabular-nums">
                          {chosen} из {item.qty}
                        </span>
                        <button
                          type="button"
                          aria-label="Больше"
                          disabled={chosen >= item.qty}
                          onClick={() =>
                            setPicked((current) => ({ ...current, [item.orderItemId]: Math.min(item.qty, chosen + 1) }))
                          }
                          className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-white/70">{item.totalCzk} Kč</span>
                  {canCancel && !pending && !selecting ? (
                    <button
                      type="button"
                      aria-label={`Отменить ${item.name}`}
                      onClick={() =>
                        setCancelTarget({
                          orderId: item.orderId,
                          itemId: item.orderItemId,
                          name: item.name,
                          qty: item.qty,
                          tableCode: data.table.code,
                        })
                      }
                      className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/5 text-sm text-white/60 active:bg-white/15"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
              );
            })
          ) : (
            <div className="rounded-xl bg-black/20 px-3 py-3 text-sm text-white/55">
              Неоплаченных позиций нет.
            </div>
          )}
        </div>

        {selecting && data ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(() => {
              const chosen = data.payableItems
                .filter((item) => picked[item.orderItemId])
                .map((item) => ({ orderItemId: item.orderItemId, qty: picked[item.orderItemId], name: item.name }));
              const count = chosen.reduce((sum, line) => sum + line.qty, 0);
              const open = (mode: "delete" | "move") =>
                setItemsTarget({ mode, tableId: data.table.id, tableCode: data.table.code, lines: chosen });
              return (
                <>
                  <button
                    type="button"
                    disabled={count === 0}
                    onClick={() => open("delete")}
                    className="h-11 rounded-xl bg-red-500 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Удалить{count ? ` (${count})` : ""}
                  </button>
                  <button
                    type="button"
                    disabled={count === 0}
                    onClick={() => open("move")}
                    className="h-11 rounded-xl bg-white text-sm font-semibold text-black disabled:opacity-40"
                  >
                    Перенести{count ? ` (${count})` : ""}
                  </button>
                </>
              );
            })()}
          </div>
        ) : null}
      </div>

      {/* The guest started the payment from their phone — just confirm it. */}
      {pending ? (
        <div className="rounded-3xl border border-sky-400/35 bg-sky-500/12 p-3.5">
          <div className="text-sm font-semibold text-sky-100">
            Гость ждёт оплату · {pending.method === "CARD" ? "Карта" : "Наличные"}
          </div>

          <div className="mt-2 space-y-1 text-sm text-sky-100/80">
            <div className="flex justify-between gap-3">
              <span>Счёт</span>
              <span>{pending.billTotalCzk} Kč</span>
            </div>
            {pending.payerName ? (
              <div className="flex justify-between gap-3">
                <span>Кэшбэк получит</span>
                <span className="truncate">{pending.payerName}</span>
              </div>
            ) : null}
            {pending.loyaltyAppliedCzk > 0 ? (
              <div className="flex justify-between gap-3">
                <span>Кэшбэк</span>
                <span>−{pending.loyaltyAppliedCzk} Kč</span>
              </div>
            ) : null}
            {pending.tipCzk > 0 ? (
              <div className="flex justify-between gap-3">
                <span>Чаевые</span>
                <span>+{pending.tipCzk} Kč</span>
              </div>
            ) : null}
          </div>

          <div className="mt-2 flex items-end justify-between gap-3 border-t border-sky-400/15 pt-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-sky-100/60">К получению</span>
            <span className="text-2xl font-bold text-white">{pending.dueCzk} Kč</span>
          </div>

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
            // Who pays (cashback), the whole bill or only their lines, card or cash.
            <button className={btnAccent} disabled={busy || data.billTotalCzk <= 0} onClick={() => setPayOpen(true)}>
              Рассчитать
            </button>
          ) : null}

          <button
            className={`${btnGhost} ${!pending && data.capabilities.canSettle ? "mt-2" : ""}`}
            onClick={() => setComposerOpen(true)}
          >
            Добавить позиции
          </button>

          {/* Paid and gone: free the table (asks first; refused while anything is unpaid). */}
          {data.capabilities.canSettle ? (
            <button
              className={`${btnGhost} mt-2`}
              onClick={() =>
                setCloseTarget({
                  tableId: data.table.id,
                  tableCode: data.table.code,
                  canClose: data.capabilities.canDisconnect,
                  unpaidCzk: data.billTotalCzk,
                  waitingPayment: !!pending,
                })
              }
            >
              Закрыть стол
            </button>
          ) : null}
        </div>
      ) : null}

      <GuestSheet
        target={guestsOpen && data ? { tableId: data.table.id, tableCode: data.table.code, people: data.people } : null}
        onClose={() => setGuestsOpen(false)}
        onChanged={() => {
          emitStaffLiveSync("table-guests-changed");
          void load({ silent: true, fresh: true });
        }}
      />

      <PaySheet
        target={
          payOpen && data && !pending
            ? { tableId: data.table.id, tableCode: data.table.code, people: data.people, items: data.payableItems }
            : null
        }
        onClose={() => setPayOpen(false)}
        onDone={async () => {
          setPayOpen(false);
          emitStaffLiveSync("payment-request-created");
          await load({ silent: true, fresh: true });
        }}
      />

      <TableItemsSheet
        target={itemsTarget}
        onClose={() => setItemsTarget(null)}
        onDone={async () => {
          setItemsTarget(null);
          setSelecting(false);
          setPicked({});
          emitStaffLiveSync("table-items-changed");
          await load({ silent: true, fresh: true });
        }}
      />

      <CloseTableSheet
        target={closeTarget}
        onClose={() => setCloseTarget(null)}
        onDone={() => {
          setCloseTarget(null);
          emitStaffLiveSync("table-closed");
          router.replace("/staff/tables");
        }}
      />

      <CancelItemSheet
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={async () => {
          setCancelTarget(null);
          emitStaffLiveSync("order-item-cancelled");
          await load({ silent: true });
        }}
      />

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
