"use client";

import { useState } from "react";
import { requestTablePayment, type StaffActiveTableDetails, type TablePerson } from "@/lib/staffApi";
import { useToast } from "@/providers/toast";
import { useEscapeToClose } from "@/lib/useModalA11y";

/**
 * «Рассчитать»: who pays (their account gets 10% cashback), what they pay —
 * the whole bill or only their lines — and how. A table of several people is
 * settled one after another: each bill takes only what it covers, the rest
 * stays on the table for the next one. A guest with cashback on their account
 * can have it taken off with one tap («Списать»); if nobody asks, it simply
 * stays on their account.
 */

const NONE = "none";

export type PaySheetTarget = {
  tableId: number;
  tableCode: string;
  people: TablePerson[];
  items: StaffActiveTableDetails["payableItems"];
};

export function PaySheet({
  target,
  onClose,
  onDone,
}: {
  target: PaySheetTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(!!target, onClose);
  if (!target) return null;
  return <Sheet key={target.tableId} target={target} onClose={onClose} onDone={onDone} />;
}

function Sheet({ target, onClose, onDone }: { target: PaySheetTarget; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  // The guest signed in at the table pays by default; one tap changes it.
  const [payer, setPayer] = useState<string>(target.people[0]?.sessionId ?? NONE);
  const [useCashback, setUseCashback] = useState(false);
  const [part, setPart] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const whole = target.items.reduce((sum, item) => sum + item.totalCzk, 0);
  const chosen = target.items
    .filter((item) => picked[item.orderItemId])
    .map((item) => ({ item, qty: picked[item.orderItemId] }));
  const partTotal = chosen.reduce((sum, line) => sum + line.qty * line.item.unitPriceCzk, 0);
  const total = part ? partTotal : whole;
  const person = target.people.find((p) => p.sessionId === payer) ?? null;
  const balance = person?.cashbackCzk ?? 0;
  // What comes off now; the server takes exactly this at confirmation.
  const applied = useCashback && person ? Math.min(balance, total) : 0;
  const due = total - applied;

  const choosePayer = (sessionId: string) => {
    setPayer(sessionId);
    // Someone else's cashback is never taken by accident.
    setUseCashback(false);
  };

  const submit = async (method: "CARD" | "CASH") => {
    if (busy || total <= 0) return;
    setBusy(true);
    const r = await requestTablePayment(target.tableId, method, {
      payerSessionId: payer,
      useCashback: applied > 0,
      items: part ? chosen.map((line) => ({ orderItemId: line.item.orderItemId, qty: line.qty })) : undefined,
    });
    setBusy(false);
    if (!r.ok) return push({ kind: "error", title: "Счёт не выставлен", message: r.error });
    push({
      kind: "success",
      title: `Счёт ${due} Kč выставлен`,
      message: `${method === "CARD" ? "Картой — несите терминал" : "Наличными"}${
        applied > 0 ? ` · списано ${applied} Kč кэшбэка` : ""
      }${person ? ` · кэшбэк: ${person.name}` : ""}`,
    });
    onDone();
  };

  const toggle = (orderItemId: string, qty: number) =>
    setPicked((current) => {
      const next = { ...current };
      if (next[orderItemId]) delete next[orderItemId];
      else next[orderItemId] = qty;
      return next;
    });

  const option = (active: boolean) =>
    [
      "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition",
      active ? "border-white/60 bg-white/15 text-white" : "border-white/10 bg-white/[0.04] text-white/80",
    ].join(" ");
  const dot = (active: boolean) => (
    <span
      aria-hidden
      className={[
        "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
        active ? "border-white" : "border-white/35",
      ].join(" ")}
    >
      {active ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
    </span>
  );

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0c0c11] p-4 staff-sheet-bottom">
        <div className="text-[11px] tracking-[0.18em] text-white/40">СТОЛ {target.tableCode}</div>
        <div className="mt-1 text-lg font-semibold text-white">Рассчитать</div>

        {target.people.length ? (
          <>
            <div className="mt-3 text-xs font-semibold text-white/55">Кто платит · кэшбэк уйдёт ему</div>
            <div className="mt-1.5 space-y-1.5">
              {target.people.map((p) => (
                <button key={p.sessionId} type="button" onClick={() => choosePayer(p.sessionId)} className={option(payer === p.sessionId)}>
                  {dot(payer === p.sessionId)}
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  {p.card ? <span className="ml-auto shrink-0 text-[11px] text-white/45">карта …{p.card}</span> : null}
                </button>
              ))}
              <button type="button" onClick={() => choosePayer(NONE)} className={option(payer === NONE)}>
                {dot(payer === NONE)}
                <span>Без аккаунта · без кэшбэка</span>
              </button>
            </div>

            {/* The chosen guest has cashback: one tap takes it off this bill. */}
            {person && balance > 0 ? (
              <button
                type="button"
                onClick={() => setUseCashback((value) => !value)}
                className={[
                  "mt-2 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                  useCashback ? "border-emerald-400/60 bg-emerald-500/15" : "border-emerald-400/25 bg-emerald-500/[0.06]",
                ].join(" ")}
              >
                <span className="text-emerald-100">
                  На счету <span className="font-semibold">{balance} Kč</span> кэшбэка
                </span>
                <span className="flex shrink-0 items-center gap-2 font-semibold text-white">
                  <span
                    aria-hidden
                    className={[
                      "grid h-5 w-5 place-items-center rounded-md border text-[12px] font-bold",
                      useCashback ? "border-emerald-300 bg-emerald-300 text-black" : "border-white/40",
                    ].join(" ")}
                  >
                    {useCashback ? "✓" : ""}
                  </span>
                  Списать
                </span>
              </button>
            ) : null}
          </>
        ) : null}

        <div className="mt-3 text-xs font-semibold text-white/55">Что оплачивает</div>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setPart(false)} className={option(!part)}>
            {dot(!part)}
            <span>Весь счёт</span>
          </button>
          <button type="button" onClick={() => setPart(true)} className={option(part)}>
            {dot(part)}
            <span>Часть позиций</span>
          </button>
        </div>

        {part ? (
          <div className="mt-2 space-y-1.5">
            {target.items.map((item) => {
              const qty = picked[item.orderItemId];
              return (
                <div
                  key={item.orderItemId}
                  onClick={() => toggle(item.orderItemId, item.qty)}
                  className={[
                    "flex cursor-pointer items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm text-white/85",
                    qty ? "bg-white/15 ring-1 ring-white/40" : "bg-black/25",
                  ].join(" ")}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      aria-hidden
                      className={[
                        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[12px] font-bold",
                        qty ? "border-white bg-white text-black" : "border-white/30",
                      ].join(" ")}
                    >
                      {qty ? "✓" : ""}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate">
                        {item.name} × {item.qty}
                      </div>
                      {qty && item.qty > 1 ? (
                        <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label="Меньше"
                            disabled={qty <= 1}
                            onClick={() => setPicked((c) => ({ ...c, [item.orderItemId]: Math.max(1, qty - 1) }))}
                            className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-14 text-center text-xs font-semibold tabular-nums">
                            {qty} из {item.qty}
                          </span>
                          <button
                            type="button"
                            aria-label="Больше"
                            disabled={qty >= item.qty}
                            onClick={() => setPicked((c) => ({ ...c, [item.orderItemId]: Math.min(item.qty, qty + 1) }))}
                            className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-white/70">{(qty || item.qty) * item.unitPriceCzk} Kč</span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
          <span className="text-[11px] uppercase tracking-[0.14em] text-white/50">К оплате</span>
          <span className="text-2xl font-bold tabular-nums text-white">{due} Kč</span>
        </div>
        {applied > 0 ? (
          <div className="mt-1 text-right text-xs text-white/55">
            счёт {total} Kč − кэшбэк {applied} Kč
          </div>
        ) : null}
        {person && due > 0 ? (
          <div className="mt-1 text-right text-xs text-emerald-200/80">
            начислится {person.name}: {Math.floor((due * 10) / 100)} Kč
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy || total <= 0}
            onClick={() => void submit("CARD")}
            className="h-11 rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
          >
            Картой
          </button>
          <button
            type="button"
            disabled={busy || total <= 0}
            onClick={() => void submit("CASH")}
            className="h-11 rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-40"
          >
            Наличными
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-11 w-full rounded-xl border border-white/10 text-sm font-semibold text-white/75"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
