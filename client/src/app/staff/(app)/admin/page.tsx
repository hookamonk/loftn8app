"use client";

import { useEffect, useMemo, useState } from "react";
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

type AdminTab = "overview" | "shifts" | "ratings" | "users" | "staff";
type RangeKey = "all" | "today" | "week" | "month";

const shellCard =
  "rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl";

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function isInRange(dateStr: string, range: RangeKey) {
  if (range === "all") return true;

  const now = new Date();
  const d = new Date(dateStr);
  const diff = now.getTime() - d.getTime();

  if (range === "today") {
    return now.toDateString() === d.toDateString();
  }
  if (range === "week") {
    return diff <= 7 * 24 * 60 * 60 * 1000;
  }
  if (range === "month") {
    return diff <= 30 * 24 * 60 * 60 * 1000;
  }

  return true;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-2xl border px-3 py-2 text-sm transition",
        active
          ? "border-white/20 bg-white/15 text-white"
          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl border px-3 py-1.5 text-xs transition",
        active
          ? "border-white/20 bg-white/15 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={shellCard}>
      <div className="text-xs text-white/55">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {hint ? <div className="mt-2 text-xs text-white/40">{hint}</div> : null}
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <div className="text-lg font-semibold text-white">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-white/50">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
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

  const [tab, setTab] = useState<AdminTab>("overview");
  const [range, setRange] = useState<RangeKey>("all");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isAllowed = staff?.role === "MANAGER" || staff?.role === "ADMIN";

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

  const filteredShifts = useMemo(() => {
    const q = query.trim().toLowerCase();

    return shifts.filter((shift) => {
      if (!isInRange(shift.openedAt, range)) return false;
      if (!q) return true;

      const openedBy = shift.openedByManager?.username?.toLowerCase() ?? "";
      return (
        shift.status.toLowerCase().includes(q) ||
        shift.id.toLowerCase().includes(q) ||
        openedBy.includes(q)
      );
    });
  }, [shifts, range, query]);

  const filteredRatings = useMemo(() => {
    const q = query.trim().toLowerCase();

    return ratings.filter((rating) => {
      if (!isInRange(rating.createdAt, range)) return false;
      if (!q) return true;

      const userName = rating.session.user?.name?.toLowerCase() ?? "";
      const comment = rating.comment?.toLowerCase() ?? "";
      const tableCode = rating.table.code.toLowerCase();

      return userName.includes(q) || comment.includes(q) || tableCode.includes(q);
    });
  }, [ratings, range, query]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();

    return users.filter((user) => {
      if (!isInRange(user.createdAt, range)) return false;
      if (!q) return true;

      return (
        user.name.toLowerCase().includes(q) ||
        user.phone.toLowerCase().includes(q) ||
        (user.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, range, query]);

  const filteredStaffPerf = useMemo(() => {
    const q = query.trim().toLowerCase();

    return staffPerf.filter((item) => {
      if (!q) return true;
      return item.username.toLowerCase().includes(q) || item.role.toLowerCase().includes(q);
    });
  }, [staffPerf, query]);

  const openShiftInfo = useMemo(() => {
    return summary?.openShift
      ? `Открыта ${formatDate(summary.openShift.openedAt)}`
      : "Сейчас смена закрыта";
  }, [summary]);

  const latestRatings = useMemo(() => filteredRatings.slice(0, 6), [filteredRatings]);
  const latestUsers = useMemo(() => filteredUsers.slice(0, 6), [filteredUsers]);
  const topStaff = useMemo(
    () =>
      [...filteredStaffPerf]
        .sort((a, b) => b.confirmedPaymentsSumCzk - a.confirmedPaymentsSumCzk)
        .slice(0, 5),
    [filteredStaffPerf]
  );

  const derivedRevenueByRange = useMemo(() => {
    if (range === "all") return summary?.totalRevenueCzk ?? 0;

    const rangeShiftIds = new Set(
      filteredShifts.map((s) => s.id)
    );

    const matchedRatings = filteredRatings.length;
    const matchedUsers = filteredUsers.length;

    return {
      shifts: filteredShifts.length,
      ratings: matchedRatings,
      users: matchedUsers,
    };
  }, [range, summary, filteredShifts, filteredRatings, filteredUsers]);

  if (!isAllowed) {
    return (
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className={shellCard}>
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
        <div className={shellCard}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs tracking-[0.24em] text-white/40">LOFT N8 ANALYTICS</div>
              <div className="mt-2 text-2xl font-semibold">Admin Dashboard</div>
              <div className="mt-1 text-sm text-white/55">
                Статистика точки, смен, пользователей, рейтингов и персонала
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск: user / table / comment / username"
                className="h-11 min-w-[240px] rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => void load()}
                className="h-11 rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
              >
                Обновить
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
              Overview
            </TabButton>
            <TabButton active={tab === "shifts"} onClick={() => setTab("shifts")}>
              Shifts
            </TabButton>
            <TabButton active={tab === "ratings"} onClick={() => setTab("ratings")}>
              Ratings
            </TabButton>
            <TabButton active={tab === "users"} onClick={() => setTab("users")}>
              Users
            </TabButton>
            <TabButton active={tab === "staff"} onClick={() => setTab("staff")}>
              Staff
            </TabButton>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <RangeButton active={range === "all"} onClick={() => setRange("all")}>
              All
            </RangeButton>
            <RangeButton active={range === "today"} onClick={() => setRange("today")}>
              Today
            </RangeButton>
            <RangeButton active={range === "week"} onClick={() => setRange("week")}>
              7 days
            </RangeButton>
            <RangeButton active={range === "month"} onClick={() => setRange("month")}>
              30 days
            </RangeButton>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}
        </div>

        {loading ? <div className="mt-4 text-sm text-white/60">Загрузка…</div> : null}

        {!loading && tab === "overview" ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                title="Выручка"
                value={`${summary?.totalRevenueCzk ?? 0} Kč`}
                hint="подтверждённые оплаты"
              />
              <MetricCard title="Пользователи" value={summary?.usersCount ?? 0} />
              <MetricCard title="Заказы" value={summary?.ordersCount ?? 0} />
              <MetricCard title="Вызовы" value={summary?.callsCount ?? 0} />
              <MetricCard title="Оценки" value={summary?.ratingsCount ?? 0} />
              <MetricCard title="Оплаты" value={summary?.confirmedPaymentsCount ?? 0} />
              <MetricCard
                title="Средняя оценка"
                value={summary?.avgOverall ? summary.avgOverall.toFixed(1) : "—"}
                hint={`Еда ${summary?.avgFood?.toFixed(1) ?? "—"} • Напитки ${summary?.avgDrinks?.toFixed(1) ?? "—"} • Кальян ${summary?.avgHookah?.toFixed(1) ?? "—"}`}
              />
              <MetricCard
                title="Смены"
                value={summary?.shiftsTotal ?? 0}
                hint={openShiftInfo}
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <section className={shellCard}>
                <SectionTitle
                  title="Быстрый статус"
                  subtitle="Ключевые показатели по проекту"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Активная смена</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {summary?.openShift ? "Открыта" : "Закрыта"}
                    </div>
                    <div className="mt-2 text-xs text-white/40">{openShiftInfo}</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Отзывы в выборке</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {filteredRatings.length}
                    </div>
                    <div className="mt-2 text-xs text-white/40">с учётом фильтра периода</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Новых пользователей в выборке</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {filteredUsers.length}
                    </div>
                    <div className="mt-2 text-xs text-white/40">с учётом фильтра периода</div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Смен в выборке</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      {filteredShifts.length}
                    </div>
                    <div className="mt-2 text-xs text-white/40">с учётом фильтра периода</div>
                  </div>
                </div>
              </section>

              <section className={shellCard}>
                <SectionTitle
                  title="Top Staff"
                  subtitle="По сумме подтверждённых оплат"
                />
                <div className="space-y-3">
                  {topStaff.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {s.username} • {s.role}
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          Смен: {s.shiftsJoined} • Confirmed payments: {s.confirmedPaymentsCount}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {s.confirmedPaymentsSumCzk} Kč
                      </div>
                    </div>
                  ))}
                  {topStaff.length === 0 ? (
                    <div className="text-sm text-white/60">Нет данных.</div>
                  ) : null}
                </div>
              </section>

              <section className={shellCard}>
                <SectionTitle
                  title="Последние оценки"
                  subtitle="Свежий фид отзывов"
                />
                <div className="space-y-3">
                  {latestRatings.map((r) => (
                    <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            Стол {r.table.code} • overall {r.overall}
                          </div>
                          <div className="mt-1 text-xs text-white/55">
                            Еда {r.food ?? "—"} • Напитки {r.drinks ?? "—"} • Кальян {r.hookah ?? "—"}
                          </div>
                          <div className="mt-1 text-xs text-white/45">{formatDate(r.createdAt)}</div>
                        </div>
                      </div>
                      {r.comment ? (
                        <div className="mt-2 text-sm text-white/80">{r.comment}</div>
                      ) : null}
                    </div>
                  ))}
                  {latestRatings.length === 0 ? (
                    <div className="text-sm text-white/60">Нет оценок.</div>
                  ) : null}
                </div>
              </section>

              <section className={shellCard}>
                <SectionTitle
                  title="Последние пользователи"
                  subtitle="Новые регистрации"
                />
                <div className="space-y-3">
                  {latestUsers.map((u) => (
                    <div key={u.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="text-sm font-semibold text-white">{u.name}</div>
                      <div className="mt-1 text-xs text-white/55">{u.phone}</div>
                      <div className="mt-1 text-xs text-white/45">{u.email ?? "без email"}</div>
                      <div className="mt-1 text-xs text-white/40">{formatDate(u.createdAt)}</div>
                    </div>
                  ))}
                  {latestUsers.length === 0 ? (
                    <div className="text-sm text-white/60">Нет пользователей.</div>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : null}

        {!loading && tab === "shifts" ? (
          <section className={`${shellCard} mt-4`}>
            <SectionTitle
              title="История смен"
              subtitle="Открытие, закрытие, участники, гостевые сессии"
              right={<div className="text-xs text-white/45">Всего: {filteredShifts.length}</div>}
            />

            <div className="space-y-3">
              {filteredShifts.map((shift) => (
                <div key={shift.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {shift.status} • {formatDate(shift.openedAt)}
                      </div>
                      <div className="mt-1 text-xs text-white/55">
                        Opened by: {shift.openedByManager?.username ?? "—"}
                      </div>
                      <div className="mt-1 text-xs text-white/45">
                        Closed: {shift.closedAt ? formatDate(shift.closedAt) : "ещё открыта"}
                      </div>
                      <div className="mt-1 text-xs text-white/45">Shift ID: {shift.id}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-white/70 lg:min-w-[220px]">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        Участников: {shift.participants?.length ?? 0}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                        Guest sessions: {shift.guestSessions?.length ?? 0}
                      </div>
                    </div>
                  </div>

                  {shift.participants?.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {shift.participants.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/80"
                        >
                          <div className="font-medium text-white">
                            {p.staff?.username ?? p.staffId} • {p.role}
                          </div>
                          <div className="mt-1 text-xs text-white/45">
                            Joined: {formatDate(p.joinedAt)}
                          </div>
                          <div className="mt-1 text-xs text-white/45">
                            Left: {p.leftAt ? formatDate(p.leftAt) : "active"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {filteredShifts.length === 0 ? (
                <div className="text-sm text-white/60">Нет смен по текущему фильтру.</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {!loading && tab === "ratings" ? (
          <section className={`${shellCard} mt-4`}>
            <SectionTitle
              title="Отзывы и оценки"
              subtitle="Фильтр по периоду и поиск по столу / имени / комментарию"
              right={<div className="text-xs text-white/45">Всего: {filteredRatings.length}</div>}
            />

            <div className="grid gap-3 md:grid-cols-3">
              <MetricCard
                title="Overall avg"
                value={summary?.avgOverall ? summary.avgOverall.toFixed(1) : "—"}
              />
              <MetricCard
                title="Food avg"
                value={summary?.avgFood ? summary.avgFood.toFixed(1) : "—"}
              />
              <MetricCard
                title="Drinks / Hookah avg"
                value={`${summary?.avgDrinks?.toFixed(1) ?? "—"} / ${summary?.avgHookah?.toFixed(1) ?? "—"}`}
              />
            </div>

            <div className="mt-4 space-y-3">
              {filteredRatings.map((r) => (
                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        Стол {r.table.code} • overall {r.overall}
                      </div>
                      <div className="mt-1 text-xs text-white/55">
                        Еда {r.food ?? "—"} • Напитки {r.drinks ?? "—"} • Кальян {r.hookah ?? "—"}
                      </div>
                      <div className="mt-1 text-xs text-white/45">{formatDate(r.createdAt)}</div>
                      <div className="mt-1 text-xs text-white/45">
                        User: {r.session.user ? `${r.session.user.name} • ${r.session.user.phone}` : "гость без аккаунта"}
                      </div>
                    </div>

                    <div className="text-xs text-white/45">
                      Shift: {r.session.shiftId ?? "без shift"}
                    </div>
                  </div>

                  {r.comment ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/80">
                      {r.comment}
                    </div>
                  ) : null}
                </div>
              ))}

              {filteredRatings.length === 0 ? (
                <div className="text-sm text-white/60">Нет отзывов по текущему фильтру.</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {!loading && tab === "users" ? (
          <section className={`${shellCard} mt-4`}>
            <SectionTitle
              title="Пользователи"
              subtitle="Регистрации и контактные данные"
              right={<div className="text-xs text-white/45">Всего: {filteredUsers.length}</div>}
            />

            <div className="space-y-3">
              {filteredUsers.map((u) => (
                <div key={u.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">{u.name}</div>
                      <div className="mt-1 text-xs text-white/55">{u.phone}</div>
                      <div className="mt-1 text-xs text-white/45">{u.email ?? "без email"}</div>
                    </div>

                    <div className="text-xs text-white/45">
                      Зарегистрирован: {formatDate(u.createdAt)}
                    </div>
                  </div>
                </div>
              ))}

              {filteredUsers.length === 0 ? (
                <div className="text-sm text-white/60">Нет пользователей по текущему фильтру.</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {!loading && tab === "staff" ? (
          <section className={`${shellCard} mt-4`}>
            <SectionTitle
              title="Staff performance"
              subtitle="Смены и подтверждённые оплаты"
              right={<div className="text-xs text-white/45">Всего: {filteredStaffPerf.length}</div>}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredStaffPerf.map((s) => (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">
                    {s.username} • {s.role}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-white/80">
                      Смен: <span className="font-semibold text-white">{s.shiftsJoined}</span>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-white/80">
                      Confirmed payments:{" "}
                      <span className="font-semibold text-white">{s.confirmedPaymentsCount}</span>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-white/80">
                      Сумма: <span className="font-semibold text-white">{s.confirmedPaymentsSumCzk} Kč</span>
                    </div>
                  </div>
                </div>
              ))}

              {filteredStaffPerf.length === 0 ? (
                <div className="text-sm text-white/60">Нет staff-данных.</div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
} 