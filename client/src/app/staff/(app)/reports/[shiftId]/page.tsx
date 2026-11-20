"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getShiftReport, type ShiftReport } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { STATION_LABEL } from "@/lib/staffRoles";
import { clock, duration, minutes, money, shiftSpan } from "@/lib/shiftReportFormat";

/**
 * Shift report — what the manager reconciles with Septim at closing:
 * card (terminal) and cash (drawer) with their tips, cashback given, what was
 * punched in and what stayed unpaid in the app, every line sold, cancellations
 * and every payment. An open shift shows live numbers.
 */

const card = "rounded-3xl border border-white/10 bg-white/[0.05] p-3.5";
const title = "text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45";

function Row({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className={strong ? "text-sm font-semibold text-white" : "text-sm text-white/80"}>{label}</div>
        {sub ? <div className="text-xs text-white/45">{sub}</div> : null}
      </div>
      <div className={`shrink-0 tabular-nums ${strong ? "text-lg font-bold text-white" : "text-sm text-white/85"}`}>{value}</div>
    </div>
  );
}

export default function ShiftReportPage() {
  const params = useParams<{ shiftId: string }>();
  const { staff } = useStaffSession();
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getShiftReport(params.shiftId);
    if (!r.ok) {
      setErr(r.status === 403 || r.status === 404 ? "Отчёт недоступен." : r.error);
      return;
    }
    setErr(null);
    setReport(r.data.report);
  }, [params.shiftId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = staff?.role === "ADMIN" ? "/staff/admin/shifts" : "/staff/summary";

  if (err) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
        <Link href={back} className="inline-flex h-11 items-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/75">
          Назад
        </Link>
      </div>
    );
  }
  if (!report) return <div className="text-sm text-white/60">Загрузка…</div>;

  const { shift, money: m, orders } = report;
  const open = shift.status === "OPEN";

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={title}>Отчёт смены · {shift.venueShortName}</div>
            <div className="mt-1 text-lg font-semibold text-white">{shiftSpan(shift.openedAt, shift.closedAt)}</div>
            <div className="mt-0.5 text-xs text-white/50">
              {duration(shift.openedAt, shift.closedAt)}
              {shift.openedBy ? ` · открыл ${shift.openedBy}` : ""}
              {shift.closedBy ? ` · закрыл ${shift.closedBy}` : ""}
            </div>
          </div>
          <Link href={back} className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70">
            Назад
          </Link>
        </div>
        {open ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            <span>Смена идёт — цифры на текущий момент</span>
            <button type="button" onClick={() => void load()} className="font-semibold underline underline-offset-2">
              Обновить
            </button>
          </div>
        ) : null}
      </div>

      {/* Reconciliation: what the terminal and the drawer must show. */}
      <div className={card}>
        <div className={title}>Сверка с Septim</div>
        <div className="mt-2 divide-y divide-white/8">
          <Row
            label="Карта (терминал)"
            sub={`оплаты ${money(m.card.amountCzk)} + чаевые ${money(m.card.tipCzk)} · ${m.card.count} опл.`}
            value={money(m.card.totalCzk)}
            strong
          />
          <Row
            label="Наличные (касса)"
            sub={`оплаты ${money(m.cash.amountCzk)} + чаевые ${money(m.cash.tipCzk)} · ${m.cash.count} опл.`}
            value={money(m.cash.totalCzk)}
            strong
          />
          <Row label="Всего получено" value={money(m.totalCollectedCzk)} strong />
        </div>
        <div className="mt-2 divide-y divide-white/8 border-t border-white/10 pt-1">
          <Row label="Выручка без чаевых" sub="карта + наличные" value={money(m.revenueCzk)} />
          <Row label="Чаевые" sub={`карта ${money(m.card.tipCzk)} · наличные ${money(m.cash.tipCzk)}`} value={money(m.tipsCzk)} />
          <Row label="Кэшбэк списан" sub="скидка гостям, в Septim вносится как скидка" value={money(m.cashbackCzk)} />
          <Row label="Счета до кэшбэка" value={money(m.billTotalCzk)} />
        </div>
      </div>

      <div className={card}>
        <div className={title}>Заказы</div>
        <div className="mt-2 divide-y divide-white/8">
          <Row
            label="Пробито через приложение"
            sub={`заказов ${orders.count} · позиций ${orders.itemsQty} · чеков станций ${orders.tickets}`}
            value={money(orders.orderedCzk)}
            strong
          />
          <Row
            label="Не оплачено в приложении"
            sub={orders.unpaidTables.length ? "оплачено в Septim или ещё открыто" : "всё оплачено в приложении"}
            value={money(orders.unpaidCzk)}
          />
        </div>
        {orders.unpaidTables.length ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {orders.unpaidTables.map((row) => (
              <span key={row.table} className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-100">
                Стол {row.table} · {money(row.totalCzk)}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {orders.stations.length ? (
        <div className={card}>
          <div className={title}>Станции</div>
          <div className="mt-2 space-y-2">
            {orders.stations.map((s) => (
              <div key={s.station} className="rounded-2xl bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{STATION_LABEL[s.station]}</span>
                  <span className="text-sm font-semibold tabular-nums text-white">{money(s.totalCzk)}</span>
                </div>
                <div className="mt-1 text-xs text-white/55">
                  {s.itemsQty} поз. · {s.tickets} чек. · принятие {minutes(s.avgAcceptSec)} · готово {minutes(s.avgReadySec)} · до гостя{" "}
                  {minutes(s.avgServedSec)}
                  {s.notFinished ? ` · не выдано: ${s.notFinished}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {report.items.length ? (
        <div className={card}>
          <div className={title}>Позиции · для сверки</div>
          {(["DISHES", "DRINKS", "HOOKAH"] as const).map((station) => {
            const lines = report.items.filter((item) => item.station === station);
            if (!lines.length) return null;
            return (
              <div key={station} className="mt-3">
                <div className="text-xs font-semibold text-white/60">{STATION_LABEL[station]}</div>
                <div className="mt-1 divide-y divide-white/8">
                  {lines.map((item) => (
                    <div key={item.menuItemId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="min-w-0 text-white/85">
                        <span className="font-bold tabular-nums text-white">{item.qty} ×</span> {item.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-white/70">{money(item.totalCzk)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className={card}>
        <div className="flex items-center justify-between">
          <div className={title}>Отмены · {report.cancellations.count}</div>
          <div className="text-sm tabular-nums text-white/70">{money(report.cancellations.totalCzk)}</div>
        </div>
        {report.cancellations.list.length ? (
          <div className="mt-2 divide-y divide-white/8">
            {report.cancellations.list.map((c) => (
              <div key={c.id} className="py-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-white/85">
                    {clock(c.at)} · Стол {c.table} · {c.name} ×{c.qty}
                  </span>
                  <span className="shrink-0 tabular-nums text-white/60">{c.totalCzk ? money(c.totalCzk) : ""}</span>
                </div>
                <div className="text-xs text-white/45">
                  {c.reason ? `${c.reason} · ` : ""}
                  {c.by}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-white/50">Отмен не было.</div>
        )}
      </div>

      {/* Journal: regulars attached to a table by hand (they didn't scan). */}
      <div className={card}>
        <div className={title}>Гости, подключённые вручную · {report.attachedGuests?.length ?? 0}</div>
        {report.attachedGuests?.length ? (
          <div className="mt-2 divide-y divide-white/8">
            {report.attachedGuests.map((g, index) => (
              <div key={`${g.at}-${index}`} className="py-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-white/85">
                    {g.at ? clock(g.at) : "—"} · Стол {g.table} · {g.guest}
                    {g.card ? ` · карта …${g.card}` : ""}
                  </span>
                  <span className="shrink-0 tabular-nums text-white/60">
                    {g.cashbackCzk ? `кэшбэк ${money(g.cashbackCzk)}` : ""}
                  </span>
                </div>
                <div className="text-xs text-white/45">
                  подключил {g.by}
                  {g.paidCzk ? ` · оплатил ${money(g.paidCzk)}` : " · не платил"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-white/50">Никого не подключали.</div>
        )}
      </div>

      <div className={card}>
        <div className={title}>Оплаты · {report.payments.length}</div>
        {report.payments.length ? (
          <div className="mt-2 divide-y divide-white/8">
            {report.payments.map((p) => (
              <div key={p.id} className="py-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-white/85">
                    {clock(p.at)} · {p.table ? `Стол ${p.table}` : "—"} · {p.method === "CARD" ? "Карта" : "Наличные"}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-white">{money(p.amountCzk + p.tipCzk)}</span>
                </div>
                <div className="text-xs text-white/45">
                  счёт {money(p.billTotalCzk)}
                  {p.cashbackCzk ? ` · кэшбэк −${money(p.cashbackCzk)}` : ""}
                  {p.tipCzk ? ` · чаевые ${money(p.tipCzk)}` : ""} · {p.by}
                  {p.guest ? ` · ${p.guest}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-white/50">Оплат через приложение не было.</div>
        )}
      </div>
    </div>
  );
}
