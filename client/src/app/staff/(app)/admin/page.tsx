"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminSummary,
  type AdminSummary,
  type AdminRange,
  type AdminVenueScope,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

const VENUES: Array<{ key: AdminVenueScope; label: string }> = [
  { key: "all", label: "Все точки" },
  { key: "zizkov", label: "Žižkov" },
  { key: "garden", label: "Garden" },
  { key: "nekazanka", label: "Nekázanka" },
];

const RANGES: Array<{ key: AdminRange; label: string }> = [
  { key: "today", label: "День" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "all", label: "Всё время" },
];

function money(czk: number) {
  return `${Math.round(czk).toLocaleString("cs-CZ")} Kč`;
}

function rating(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (key: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={[
              "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
              active
                ? "border-white/20 bg-white text-black"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5">
      <div className="text-xs uppercase tracking-[0.14em] text-white/45">{title}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      {hint ? <div className="mt-1 text-xs text-white/40">{hint}</div> : null}
    </div>
  );
}

export default function StaffAdminStatsPage() {
  const { staff } = useStaffSession();
  const isAdmin = staff?.role === "ADMIN";

  const [venue, setVenue] = useState<AdminVenueScope>("all");
  const [range, setRange] = useState<AdminRange>("month");
  const [data, setData] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await getAdminSummary(range, venue);
    if (!r.ok) {
      setErr(r.error || "Не удалось загрузить статистику");
      setLoading(false);
      return;
    }
    setData(r.data.summary);
    setLoading(false);
  }, [range, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isAdmin) {
    return (
      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-white">
        <div className="text-lg font-semibold">Статистика</div>
        <div className="mt-2 text-sm text-white/55">Доступ только для администратора.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-white/10 bg-white/[0.05] p-5 space-y-4">
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.14em] text-white/45">Точка</div>
          <Segmented value={venue} options={VENUES} onChange={setVenue} />
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-[0.14em] text-white/45">Период</div>
          <Segmented value={range} options={RANGES} onChange={setRange} />
        </div>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[112px] animate-pulse rounded-[24px] border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title="Регистрации"
              value={String(data.usersCount)}
              hint="зарегистрированных гостей"
            />
            <StatCard title="Выручка" value={money(data.totalRevenueCzk)} hint={`оплат: ${data.paymentsCount}`} />
            <StatCard
              title="Средняя оценка"
              value={rating(data.avgOverall)}
              hint={`отзывов: ${data.ratingsCount}`}
            />
            <StatCard
              title="Сессии гостей"
              value={String(data.guestSessionsCount)}
              hint={`с аккаунтом: ${data.registeredGuestSessionsCount} · без: ${data.anonymousGuestSessionsCount}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatCard title="Заказы" value={String(data.ordersCount)} />
            <StatCard title="Вызовы" value={String(data.callsCount)} />
            <StatCard
              title="Оценки: еда / напитки / кальян"
              value={`${rating(data.avgFood)} / ${rating(data.avgDrinks)} / ${rating(data.avgHookah)}`}
            />
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
            <div className="text-sm font-semibold text-white">По точкам</div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.14em] text-white/45">
                  <tr>
                    <th className="px-3 py-2 font-medium">Точка</th>
                    <th className="px-3 py-2 text-right font-medium">Регистрации</th>
                    <th className="px-3 py-2 text-right font-medium">Выручка</th>
                    <th className="px-3 py-2 text-right font-medium">Ср. оценка</th>
                    <th className="px-3 py-2 text-right font-medium">Отзывы</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byVenue.map((v) => (
                    <tr key={v.venueId} className="border-t border-white/8 text-white/85">
                      <td className="px-3 py-2.5 font-semibold text-white">{v.shortName}</td>
                      <td className="px-3 py-2.5 text-right">{v.usersCount}</td>
                      <td className="px-3 py-2.5 text-right">{money(v.revenueCzk)}</td>
                      <td className="px-3 py-2.5 text-right">{rating(v.avgOverall)}</td>
                      <td className="px-3 py-2.5 text-right text-white/60">{v.ratingsCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/40">
            ID-карты лояльности (Apple/Google Wallet) появятся здесь после подключения.
          </div>
        </>
      ) : null}
    </div>
  );
}
