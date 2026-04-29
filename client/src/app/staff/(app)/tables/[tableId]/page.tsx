"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getActiveTableDetails,
  requestTablePayment,
  type StaffActiveTableDetails,
} from "@/lib/staffApi";
import { usePolling } from "@/lib/usePolling";
import { useStaffPushEvents } from "@/lib/useStaffPushEvents";
import { emitStaffLiveSync, subscribeStaffLiveSync } from "@/lib/staffLiveSync";
import { useToast } from "@/providers/toast";
import { useStaffSession } from "@/providers/staffSession";

const card =
  "rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
const btn =
  "rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50";
const btnPrimary =
  "rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50";
const btnGhost =
  "rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white";

function callTypeLabel(type: "WAITER" | "HOOKAH" | "BILL" | "HELP") {
  if (type === "WAITER") return "Официант";
  if (type === "HOOKAH") return "Кальянщик";
  if (type === "BILL") return "Оплата";
  return "Помощь";
}

function paymentMethodLabel(method: "CARD" | "CASH") {
  return method === "CARD" ? "Карта" : "Наличные";
}

export default function StaffTableDetailsPage() {
  const params = useParams<{ tableId: string }>();
  const router = useRouter();
  const { push } = useToast();
  const { staff } = useStaffSession();
  const tableId = Number(params.tableId);

  const [data, setData] = useState<StaffActiveTableDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [busyMethod, setBusyMethod] = useState<"CARD" | "CASH" | null>(null);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setErr(null);

    const result = await getActiveTableDetails(tableId);

    if (!silent) setLoading(false);

    if (!result.ok) {
      setErr(result.error);
      return;
    }

    setData(result.data.table);
    setLast(Date.now());
  };

  const { tick, isRunning } = usePolling(() => load({ silent: true }), {
    activeMs: 5000,
    idleMs: 12000,
    immediate: false,
    enabled: Number.isFinite(tableId) && tableId > 0,
  });

  useEffect(() => {
    if (!Number.isFinite(tableId) || tableId <= 0) return;
    void load({ silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  useStaffPushEvents((payload) => {
    if (
      payload.kind === "ORDER_CREATED" ||
      payload.kind === "CALL_CREATED" ||
      payload.kind === "PAYMENT_REQUESTED" ||
      payload.kind === "GUEST_MESSAGE"
    ) {
      void tick();
    }
  });

  useEffect(() => subscribeStaffLiveSync(() => void tick()), [tick]);

  const totalCurrentItems = useMemo(
    () => data?.payableItems.reduce((sum, item) => sum + item.qty, 0) ?? 0,
    [data]
  );

  const addHref = data
    ? `/staff/orders/create?tableId=${encodeURIComponent(String(data.table.id))}&tableCode=${encodeURIComponent(
        data.table.code
      )}&sessionId=${encodeURIComponent(data.session.id)}&returnTo=${encodeURIComponent(`/staff/tables/${data.table.id}`)}`
    : "/staff/tables";

  const onRequestPayment = async (method: "CARD" | "CASH") => {
    if (!data || !data.capabilities.canSettle || busyMethod) return;

    setBusyMethod(method);
    const result = await requestTablePayment(data.table.id, method);
    setBusyMethod(null);

    if (!result.ok) {
      push({ kind: "error", title: "Ошибка", message: result.error });
      return;
    }

    push({
      kind: "success",
      title: "Расчёт создан",
      message: `Для стола отправлен запрос на оплату: ${paymentMethodLabel(method)}.`,
    });

    emitStaffLiveSync("payment-request-created");
    await load({ silent: false });
  };

  return (
    <div>
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.24em] text-white/45">ACTIVE TABLE</div>
            <div className="mt-2 text-xl font-semibold text-white">
              {data ? `Стол ${data.table.code}${data.table.label ? ` • ${data.table.label}` : ""}` : "Стол"}
            </div>
            <div className="mt-1 text-xs text-white/50">
              Автообновление: {isRunning ? "включено" : "выключено"}
              {last ? ` • ${new Date(last).toLocaleTimeString()}` : ""}
            </div>
            {data ? (
              <div className="mt-3 space-y-1 text-sm text-white/65">
                <div>
                  {data.session.user
                    ? `${data.session.user.name} • ${data.session.user.phone}`
                    : "Гость без аккаунта"}
                </div>
                <div>Текущих позиций: {totalCurrentItems}</div>
                <div>Сумма к расчёту: {data.billTotalCzk} Kč</div>
              </div>
            ) : null}
          </div>

          <Link href="/staff/tables" className={btnGhost}>
            Назад
          </Link>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        {data ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.capabilities.canAddItems ? (
              <Link href={addHref} className={btnPrimary}>
                Добавить позиции
              </Link>
            ) : null}

            {data.capabilities.canSettle ? (
              <>
                <button
                  className={btn}
                  disabled={busyMethod !== null || data.billTotalCzk <= 0}
                  onClick={() => void onRequestPayment("CARD")}
                >
                  {busyMethod === "CARD" ? "Создаём…" : "Рассчитать: карта"}
                </button>
                <button
                  className={btn}
                  disabled={busyMethod !== null || data.billTotalCzk <= 0}
                  onClick={() => void onRequestPayment("CASH")}
                >
                  {busyMethod === "CASH" ? "Создаём…" : "Рассчитать: наличные"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

      {data?.pendingPayment ? (
        <div className={`${card} mt-4`}>
          <div className="text-sm font-semibold text-white">Активный расчёт</div>
          <div className="mt-2 text-sm text-white/70">
            {paymentMethodLabel(data.pendingPayment.method)} • {data.pendingPayment.billTotalCzk} Kč
          </div>
          <div className="mt-1 text-xs text-white/50">
            Отправлен {new Date(data.pendingPayment.createdAt).toLocaleString()}
          </div>
        </div>
      ) : null}

      <div className={`${card} mt-4`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Текущий заказ</div>
            <div className="mt-1 text-xs text-white/55">Актуальные позиции по столу, которые еще не закрыты оплатой.</div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/75">
            {totalCurrentItems}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {data && data.payableItems.length > 0 ? (
            data.payableItems.map((item) => (
              <div
                key={`${item.orderItemId}:${item.qty}`}
                className="rounded-2xl border border-white/10 bg-black/20 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {item.name} × {item.qty}
                    </div>
                    {item.comment ? <div className="mt-1 text-xs text-white/50">{item.comment}</div> : null}
                  </div>
                  <div className="text-sm font-semibold text-white">{item.totalCzk} Kč</div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
              По этому столу сейчас нет активных неоплаченных позиций.
            </div>
          )}
        </div>
      </div>

      <div className={`${card} mt-4`}>
        <div className="text-sm font-semibold text-white">История по текущей сессии</div>
        <div className="mt-3 space-y-3">
          {data && data.orders.length > 0 ? (
            data.orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      Заказ • {new Date(order.createdAt).toLocaleTimeString()}
                    </div>
                    <div className="mt-1 text-xs text-white/55">Статус: {order.status}</div>
                    {order.comment ? <div className="mt-2 text-xs text-white/50">{order.comment}</div> : null}
                  </div>
                  <div className="text-sm font-semibold text-white">{order.totalCzk} Kč</div>
                </div>

                <div className="mt-3 space-y-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-sm text-white/80">
                      <div>
                        {item.menuItem.name} × {item.qty}
                      </div>
                      <div>{item.qty * item.priceCzk} Kč</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
              По этой сессии еще нет сохраненных заказов.
            </div>
          )}
        </div>
      </div>

      <div className={`${card} mt-4`}>
        <div className="text-sm font-semibold text-white">Активные вызовы</div>
        <div className="mt-3 space-y-2">
          {data && data.activeCalls.length > 0 ? (
            data.activeCalls.map((call) => (
              <div key={call.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{callTypeLabel(call.type)}</div>
                    <div className="mt-1 text-xs text-white/55">
                      {new Date(call.createdAt).toLocaleTimeString()} • {call.status}
                    </div>
                  </div>
                </div>
                {call.message ? <div className="mt-2 text-sm text-white/75">{call.message}</div> : null}
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">
              Активных вызовов по этому столу нет.
            </div>
          )}
        </div>
      </div>

      {staff?.role === "HOOKAH" ? (
        <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-500/10 p-3 text-sm text-sky-100/90">
          Кальянщик может добавлять только кальяны. Кнопка расчёта доступна только официанту и менеджеру.
        </div>
      ) : null}
    </div>
  );
}
