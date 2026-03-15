"use client";

import { useEffect, useState } from "react";
import {
  getAdminSummary,
  getAdminShifts,
  getAdminRatings,
  getAdminUsers,
  getAdminStaffPerformance,
  type AdminSummary,
  type AdminShiftItem,
  type AdminRatingItem,
  type AdminUserItem,
  type AdminStaffPerformanceItem,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

const glass =
  "rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl";

function Card({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={glass}>
      <div className="text-xs text-white/60">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs text-white/40">{hint}</div> : null}
    </div>
  );
}

export default function StaffAdminPage() {
  const { staff } = useStaffSession();

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [shifts, setShifts] = useState<AdminShiftItem[]>([]);
  const [ratings, setRatings] = useState<AdminRatingItem[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [staffPerf, setStaffPerf] = useState<AdminStaffPerformanceItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr(null);

    const [s1, s2, s3, s4, s5] = await Promise.all([
      getAdminSummary(),
      getAdminShifts(),
      getAdminRatings(),
      getAdminUsers(),
      getAdminStaffPerformance(),
    ]);

    if (!s1.ok) return setErr(s1.error), setLoading(false);
    if (!s2.ok) return setErr(s2.error), setLoading(false);
    if (!s3.ok) return setErr(s3.error), setLoading(false);
    if (!s4.ok) return setErr(s4.error), setLoading(false);
    if (!s5.ok) return setErr(s5.error), setLoading(false);

    setSummary(s1.data.summary);
    setShifts(s2.data.shifts);
    setRatings(s3.data.ratings);
    setUsers(s4.data.users);
    setStaffPerf(s5.data.staff);

    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  if (staff?.role !== "MANAGER" && staff?.role !== "ADMIN") {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className={glass}>
            <div className="text-lg font-semibold">Admin panel</div>
            <div className="mt-2 text-sm text-white/60">Доступ только для manager/admin.</div>
          </div>
        </div> 
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className={glass}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Admin panel</div>
              <div className="mt-1 text-sm text-white/60">
                Общая статистика точки, смен, оценок, пользователей и персонала
              </div>
            </div>
            <button
              onClick={() => void load()}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Обновить
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}
        </div>

        {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

        {summary ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card title="Выручка" value={`${summary.totalRevenueCzk} Kč`} hint="подтверждённые оплаты" />
            <Card title="Пользователи" value={summary.usersCount} />
            <Card title="Заказы" value={summary.ordersCount} />
            <Card title="Вызовы" value={summary.callsCount} />
            <Card title="Оценки" value={summary.ratingsCount} />
            <Card title="Оплаты" value={summary.confirmedPaymentsCount} />
            <Card
              title="Средняя оценка"
              value={summary.avgOverall ? summary.avgOverall.toFixed(1) : "—"}
              hint={`Еда ${summary.avgFood?.toFixed(1) ?? "—"} • Напитки ${summary.avgDrinks?.toFixed(1) ?? "—"} • Кальян ${summary.avgHookah?.toFixed(1) ?? "—"}`}
            />
            <Card
              title="Смен всего"
              value={summary.shiftsTotal}
              hint={summary.openShift ? `Открыта: ${new Date(summary.openShift.openedAt).toLocaleString()}` : "Сейчас смена закрыта"}
            />
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className={glass}>
            <div className="text-lg font-semibold">Смены</div>
            <div className="mt-3 space-y-3">
              {shifts.map((shift) => (
                <div key={shift.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm font-semibold">
                    {shift.status} • {new Date(shift.openedAt).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Manager open: {shift.openedByManager?.username ?? shift.openedByManager?.id ?? "—"}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Closed: {shift.closedAt ? new Date(shift.closedAt).toLocaleString() : "ещё открыта"}
                  </div>
                  <div className="mt-2 text-xs text-white/50">
                    Участников: {shift.participants?.length ?? 0} • Гостевых сессий: {shift.guestSessions?.length ?? 0}
                  </div>
                </div>
              ))}
              {shifts.length === 0 ? <div className="text-sm text-white/60">Нет смен.</div> : null}
            </div>
          </section>

          <section className={glass}>
            <div className="text-lg font-semibold">Оценки</div>
            <div className="mt-3 space-y-3">
              {ratings.slice(0, 20).map((r) => (
                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm font-semibold">
                    Стол {r.table.code} • overall {r.overall}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Еда {r.food ?? "—"} • Напитки {r.drinks ?? "—"} • Кальян {r.hookah ?? "—"}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                  {r.comment ? <div className="mt-2 text-sm text-white/85">{r.comment}</div> : null}
                </div>
              ))}
              {ratings.length === 0 ? <div className="text-sm text-white/60">Нет оценок.</div> : null}
            </div>
          </section>

          <section className={glass}>
            <div className="text-lg font-semibold">Пользователи</div>
            <div className="mt-3 space-y-3">
              {users.slice(0, 20).map((u) => (
                <div key={u.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm font-semibold">{u.name}</div>
                  <div className="mt-1 text-xs text-white/60">{u.phone}</div>
                  <div className="mt-1 text-xs text-white/60">{u.email ?? "без email"}</div>
                  <div className="mt-1 text-xs text-white/50">
                    Зарегистрирован: {new Date(u.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
              {users.length === 0 ? <div className="text-sm text-white/60">Нет пользователей.</div> : null}
            </div>
          </section>

          <section className={glass}>
            <div className="text-lg font-semibold">Staff performance</div>
            <div className="mt-3 space-y-3">
              {staffPerf.map((s) => (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-sm font-semibold">
                    {s.username} • {s.role}
                  </div>
                  <div className="mt-1 text-xs text-white/60">Смен: {s.shiftsJoined}</div>
                  <div className="mt-1 text-xs text-white/60">
                    Confirmed payments: {s.confirmedPaymentsCount}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Сумма: {s.confirmedPaymentsSumCzk} Kč
                  </div>
                </div>
              ))}
              {staffPerf.length === 0 ? <div className="text-sm text-white/60">Нет staff данных.</div> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
} 