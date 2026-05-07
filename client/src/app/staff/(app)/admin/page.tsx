"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAdminSummary,
  getAdminShifts,
  getAdminRatings,
  getAdminUsers,
  getAdminStaffPerformance,
  getAdminShiftDetails,
  getAdminGuestSessions,
  getAdminOrders, 
  getAdminCalls,
  getAdminPayments,
  type AdminSummary,
  type AdminShiftItem,
  type AdminRatingItem, 
  type AdminUserItem,
  type AdminStaffPerformanceItem,
  type AdminShiftDetails,
  type AdminRange,
  type AdminGuestFilter,
  type AdminGuestSessionItem,
  type AdminOrderItem,
  type AdminCallItem,
  type AdminPaymentItem,
} from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

type AdminTab =
  | "overview"
  | "users"
  | "guests"
  | "shifts"
  | "orders"
  | "calls"
  | "payments"
  | "ratings"
  | "staff";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function rangeLabel(range: AdminRange) {
  if (range === "today") return "Сегодня";
  if (range === "week") return "7 дней";
  if (range === "month") return "30 дней";
  return "Всё время";
}

function callTypeLabel(v: string) {
  if (v === "WAITER") return "Официант";
  if (v === "HOOKAH") return "Кальянщик";
  if (v === "BILL") return "Счёт";
  return "Помощь";
}

function statusBadge(status: string) {
  const cls =
    status === "OPEN" || status === "CONFIRMED" || status === "DELIVERED" || status === "DONE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "PENDING" || status === "NEW" || status === "ACCEPTED" || status === "ACKED"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "CANCELLED"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={cn("inline-flex rounded-full border px-2 py-1 text-xs font-medium", cls)}>
      {status}
    </span>
  );
}

function StatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-base font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SidebarItem({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      )}
    >
      <span className="font-medium">{label}</span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
            active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function RangeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-sm transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function GuestFilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-sm transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function ShiftDetailsDrawer({
  open,
  onClose,
  data,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  data: AdminShiftDetails | null;
  loading: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="ml-auto h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">Детали смены</div>
            <div className="mt-1 text-sm text-slate-500">
              Подробная статистика по конкретной смене
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Закрыть
          </button>
        </div>

        <div className="p-5">
          {loading ? <div className="text-sm text-slate-500">Загрузка…</div> : null}

          {!loading && !data ? (
            <div className="text-sm text-slate-500">Нет данных по смене.</div>
          ) : null}

          {!loading && data ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <StatCard title="Статус" value={data.shift.status} />
                <StatCard title="Открыта" value={formatDate(data.shift.openedAt)} />
                <StatCard title="Закрыта" value={formatDate(data.shift.closedAt)} />
                <StatCard title="Заработок смены" value={`${data.stats.revenueCzk} Kč`} />
                <StatCard title="Заказы" value={data.stats.ordersCount} />
                <StatCard title="Оплаты" value={data.stats.paymentsCount} />
                <StatCard title="Вызовы" value={data.stats.callsCount} />
                <StatCard title="Оценки" value={data.stats.ratingsCount} />
                <StatCard title="Регистрации" value={data.stats.registrationsCount} />
              </div>

              <SectionCard title="Общая информация" subtitle="Кто открыл / кто закрыл / средние оценки">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <div>
                      <span className="font-medium text-slate-900">Открыл:</span>{" "}
                      {data.shift.openedByManager?.username ?? "—"}
                    </div>
                    <div className="mt-2">
                      <span className="font-medium text-slate-900">Закрыл:</span>{" "}
                      {data.shift.closedByManager?.username ?? "—"}
                    </div>
                    <div className="mt-2">
                      <span className="font-medium text-slate-900">ID смены:</span>{" "}
                      {data.shift.id}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <div>
                      <span className="font-medium text-slate-900">Средняя общая:</span>{" "}
                      {data.stats.avgOverall?.toFixed(1) ?? "—"}
                    </div>
                    <div className="mt-2">
                      <span className="font-medium text-slate-900">Еда:</span>{" "}
                      {data.stats.avgFood?.toFixed(1) ?? "—"}
                    </div>
                    <div className="mt-2">
                      <span className="font-medium text-slate-900">Напитки:</span>{" "}
                      {data.stats.avgDrinks?.toFixed(1) ?? "—"}
                    </div>
                    <div className="mt-2">
                      <span className="font-medium text-slate-900">Кальян:</span>{" "}
                      {data.stats.avgHookah?.toFixed(1) ?? "—"}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Участники смены" subtitle="Кто работал в рамках этой смены">
                <div className="space-y-3">
                  {data.shift.participants.map((p) => (
                    <div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm font-medium text-slate-900">
                          {p.staff?.username ?? p.staffId} • {p.role}
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.isActive ? "active" : "inactive"}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        Вошёл: {formatDate(p.joinedAt)} • Вышел: {formatDate(p.leftAt)}
                      </div>
                    </div>
                  ))}
                  {data.shift.participants.length === 0 ? (
                    <div className="text-sm text-slate-500">Нет участников.</div>
                  ) : null}
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function StaffAdminPage() {
  const { staff } = useStaffSession();

  const [tab, setTab] = useState<AdminTab>("overview");
  const [range, setRange] = useState<AdminRange>("all");
  const [guestFilter, setGuestFilter] = useState<AdminGuestFilter>("all");
  const [query, setQuery] = useState("");

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [shifts, setShifts] = useState<AdminShiftItem[]>([]);
  const [ratings, setRatings] = useState<AdminRatingItem[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [staffPerf, setStaffPerf] = useState<AdminStaffPerformanceItem[]>([]);
  const [guestSessions, setGuestSessions] = useState<AdminGuestSessionItem[]>([]);
  const [orders, setOrders] = useState<AdminOrderItem[]>([]);
  const [calls, setCalls] = useState<AdminCallItem[]>([]);
  const [payments, setPayments] = useState<AdminPaymentItem[]>([]);

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<AdminShiftDetails | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);

  const isAllowed = staff?.role === "MANAGER" || staff?.role === "ADMIN";

  const load = async (activeRange: AdminRange = range, activeGuestFilter: AdminGuestFilter = guestFilter) => {
    setLoading(true);
    setErr(null);

    const [s1, s2, s3, s4, s5, s6, s7, s8] = await Promise.all([
      getAdminSummary(activeRange),
      getAdminShifts(activeRange),
      getAdminRatings(activeRange),
      getAdminUsers(activeRange),
      getAdminStaffPerformance(activeRange),
      getAdminGuestSessions(activeRange, activeGuestFilter),
      getAdminOrders(activeRange),
      getAdminCalls(activeRange),
    ]);

    const s9 = await getAdminPayments(activeRange);

    if (!s1.ok) return setErr(s1.error), setLoading(false);
    if (!s2.ok) return setErr(s2.error), setLoading(false);
    if (!s3.ok) return setErr(s3.error), setLoading(false);
    if (!s4.ok) return setErr(s4.error), setLoading(false);
    if (!s5.ok) return setErr(s5.error), setLoading(false);
    if (!s6.ok) return setErr(s6.error), setLoading(false);
    if (!s7.ok) return setErr(s7.error), setLoading(false);
    if (!s8.ok) return setErr(s8.error), setLoading(false);
    if (!s9.ok) return setErr(s9.error), setLoading(false);

    setSummary(s1.data.summary);
    setShifts(s2.data.shifts);
    setRatings(s3.data.ratings);
    setUsers(s4.data.users);
    setStaffPerf(s5.data.staff);
    setGuestSessions(s6.data.sessions);
    setOrders(s7.data.orders);
    setCalls(s8.data.calls);
    setPayments(s9.data.payments);

    setLoading(false);
  };

  useEffect(() => {
    void load(range, guestFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, guestFilter]);

  const openShiftDetails = async (id: string) => {
    setSelectedShiftId(id);
    setShiftLoading(true);
    setSelectedShift(null);

    const r = await getAdminShiftDetails(id);
    setShiftLoading(false);

    if (!r.ok) {
      setErr(r.error || "Не удалось загрузить детали смены");
      return;
    }

    setSelectedShift(r.data);
  };

  const q = query.trim().toLowerCase();

  const filteredUsers = useMemo(() => {
    if (!q) return users;
    return users.filter((u) => {
      return (
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, q]);

  const filteredGuests = useMemo(() => {
    if (!q) return guestSessions;
    return guestSessions.filter((s) => {
      return (
        s.id.toLowerCase().includes(q) ||
        s.table.code.toLowerCase().includes(q) ||
        (s.user?.name ?? "").toLowerCase().includes(q) ||
        (s.user?.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [guestSessions, q]);

  const filteredShifts = useMemo(() => {
    if (!q) return shifts;
    return shifts.filter((shift) => {
      return (
        shift.id.toLowerCase().includes(q) ||
        shift.status.toLowerCase().includes(q) ||
        (shift.openedByManager?.username ?? "").toLowerCase().includes(q)
      );
    });
  }, [shifts, q]);

  const filteredRatings = useMemo(() => {
    if (!q) return ratings;
    return ratings.filter((r) => {
      return (
        r.table.code.toLowerCase().includes(q) ||
        (r.comment ?? "").toLowerCase().includes(q) ||
        (r.session.user?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [ratings, q]);

  const filteredStaff = useMemo(() => {
    if (!q) return staffPerf;
    return staffPerf.filter((s) => {
      return s.username.toLowerCase().includes(q) || s.role.toLowerCase().includes(q);
    });
  }, [staffPerf, q]);

  const filteredOrders = useMemo(() => {
    if (!q) return orders;
    return orders.filter((o) => {
      return (
        o.id.toLowerCase().includes(q) ||
        o.table.code.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q) ||
        (o.session.user?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [orders, q]);

  const filteredCalls = useMemo(() => {
    if (!q) return calls;
    return calls.filter((c) => {
      return (
        c.id.toLowerCase().includes(q) ||
        c.table.code.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q) ||
        (c.session.user?.name ?? "").toLowerCase().includes(q) ||
        (c.message ?? "").toLowerCase().includes(q)
      );
    });
  }, [calls, q]);

  const filteredPayments = useMemo(() => {
    if (!q) return payments;
    return payments.filter((p) => {
      return (
        p.id.toLowerCase().includes(q) ||
        p.table.code.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q) ||
        (p.session.user?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [payments, q]);

  const latestRatings = filteredRatings.slice(0, 6);
  const latestUsers = filteredUsers.slice(0, 6);

  if (!isAllowed) {
    return (
      <main className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-900 shadow-sm">
        <div className="text-lg font-semibold">Админ-панель</div>
        <div className="mt-2 text-sm text-slate-500">Доступ только для manager/admin.</div>
      </main>
    );
  }

  return (
    <>
      <main className="rounded-[28px] border border-slate-200 bg-[#f6f7fb] p-4 text-slate-900 shadow-sm lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              LOFT№8 Analytics
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              Админ-панель
            </div>
            <div className="mt-2 text-sm text-slate-500">
              Структура как в Prisma: слева разделы, справа данные.
            </div>

            <div className="mt-4 space-y-2">
              <SidebarItem
                active={tab === "overview"}
                label="Статистика"
                onClick={() => setTab("overview")}
              />
              <SidebarItem
                active={tab === "users"}
                label="Пользователи"
                count={users.length}
                onClick={() => setTab("users")}
              />
              <SidebarItem
                active={tab === "guests"}
                label="Гости"
                count={guestSessions.length}
                onClick={() => setTab("guests")}
              />
              <SidebarItem
                active={tab === "shifts"}
                label="Смены"
                count={shifts.length}
                onClick={() => setTab("shifts")}
              />
              <SidebarItem
                active={tab === "orders"}
                label="Заказы"
                count={orders.length}
                onClick={() => setTab("orders")}
              />
              <SidebarItem
                active={tab === "calls"}
                label="Вызовы"
                count={calls.length}
                onClick={() => setTab("calls")}
              />
              <SidebarItem
                active={tab === "payments"}
                label="Оплаты"
                count={payments.length}
                onClick={() => setTab("payments")}
              />
              <SidebarItem
                active={tab === "ratings"}
                label="Оценки"
                count={ratings.length}
                onClick={() => setTab("ratings")}
              />
              <SidebarItem
                active={tab === "staff"}
                label="Персонал"
                count={staffPerf.length}
                onClick={() => setTab("staff")}
              />
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-2xl font-semibold text-slate-900">
                    {tab === "overview" && "Статистика"}
                    {tab === "users" && "Пользователи"}
                    {tab === "guests" && "Гости"}
                    {tab === "shifts" && "Смены"}
                    {tab === "orders" && "Заказы"}
                    {tab === "calls" && "Вызовы"}
                    {tab === "payments" && "Оплаты"}
                    {tab === "ratings" && "Оценки"}
                    {tab === "staff" && "Персонал"}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Период: {rangeLabel(range)}
                  </div>
                </div>

                <button
                  onClick={() => void load(range, guestFilter)}
                  className="h-11 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Обновить
                </button>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск: пользователь / стол / комментарий / логин / ID"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />

                <div className="flex flex-wrap gap-2">
                  <RangeButton active={range === "all"} onClick={() => setRange("all")}>
                    Всё
                  </RangeButton>
                  <RangeButton active={range === "today"} onClick={() => setRange("today")}>
                    Сегодня
                  </RangeButton>
                  <RangeButton active={range === "week"} onClick={() => setRange("week")}>
                    7 дней
                  </RangeButton>
                  <RangeButton active={range === "month"} onClick={() => setRange("month")}>
                    30 дней
                  </RangeButton>
                </div>
              </div>

              {tab === "guests" ? (
                <div className="flex flex-wrap gap-2">
                  <GuestFilterButton active={guestFilter === "all"} onClick={() => setGuestFilter("all")}>
                    Все
                  </GuestFilterButton>
                  <GuestFilterButton active={guestFilter === "registered"} onClick={() => setGuestFilter("registered")}>
                    С аккаунтом
                  </GuestFilterButton>
                  <GuestFilterButton active={guestFilter === "anonymous"} onClick={() => setGuestFilter("anonymous")}>
                    Без аккаунта
                  </GuestFilterButton>
                </div>
              ) : null}
            </div>

            {err ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {err}
              </div>
            ) : null}

            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Загрузка данных…
              </div>
            ) : null}

            {!loading && tab === "overview" && summary ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard title="Выручка" value={`${summary.totalRevenueCzk} Kč`} hint="за выбранный период" />
                  <StatCard title="Пользователи" value={summary.usersCount} />
                  <StatCard title="Гостевые сессии" value={summary.guestSessionsCount} />
                  <StatCard title="С аккаунтом" value={summary.registeredGuestSessionsCount} />
                  <StatCard title="Без аккаунта" value={summary.anonymousGuestSessionsCount} />
                  <StatCard title="Заказы" value={summary.ordersCount} />
                  <StatCard title="Вызовы" value={summary.callsCount} />
                  <StatCard title="Оплаты" value={summary.paymentsCount} />
                  <StatCard title="Оценки" value={summary.ratingsCount} />
                  <StatCard
                    title="Средняя оценка"
                    value={summary.avgOverall ? summary.avgOverall.toFixed(1) : "—"}
                    hint={`Еда ${summary.avgFood?.toFixed(1) ?? "—"} • Напитки ${summary.avgDrinks?.toFixed(1) ?? "—"} • Кальян ${summary.avgHookah?.toFixed(1) ?? "—"}`}
                  />
                  <StatCard title="Смены" value={summary.shiftsTotal} />
                  <StatCard
                    title="Активная смена"
                    value={summary.openShift ? "Открыта" : "Закрыта"}
                    hint={summary.openShift ? formatDate(summary.openShift.openedAt) : "Сейчас смены нет"}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <SectionCard title="Последние оценки" subtitle="Свежий фид отзывов">
                    <div className="space-y-3">
                      {latestRatings.map((r) => (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">
                            Стол {r.table.code} • общая {r.overall}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Еда {r.food ?? "—"} • Напитки {r.drinks ?? "—"} • Кальян {r.hookah ?? "—"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{formatDate(r.createdAt)}</div>
                          {r.comment ? <div className="mt-2 text-sm text-slate-700">{r.comment}</div> : null}
                        </div>
                      ))}
                      {latestRatings.length === 0 ? (
                        <div className="text-sm text-slate-500">Нет отзывов.</div>
                      ) : null}
                    </div>
                  </SectionCard>

                  <SectionCard title="Последние пользователи" subtitle="Новые регистрации">
                    <div className="space-y-3">
                      {latestUsers.map((u) => (
                        <div key={u.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-slate-900">{u.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{u.phone}</div>
                          <div className="mt-1 text-xs text-slate-400">{u.email ?? "без email"}</div>
                          <div className="mt-1 text-xs text-slate-400">{formatDate(u.createdAt)}</div>
                        </div>
                      ))}
                      {latestUsers.length === 0 ? (
                        <div className="text-sm text-slate-500">Нет пользователей.</div>
                      ) : null}
                    </div>
                  </SectionCard>
                </div>
              </div>
            ) : null}

            {!loading && tab === "users" && (
              <SectionCard
                title="Пользователи"
                subtitle="Только зарегистрированные пользователи"
                right={<div className="text-sm text-slate-500">Всего: {filteredUsers.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Имя</th>
                        <th className="px-4 py-3">Телефон</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Согласие</th>
                        <th className="px-4 py-3">Создан</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                          <td className="px-4 py-3">{u.phone}</td>
                          <td className="px-4 py-3">{u.email ?? "—"}</td>
                          <td className="px-4 py-3">{u.privacyAcceptedAt ? "Да" : "Нет"}</td>
                          <td className="px-4 py-3">{formatDate(u.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredUsers.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет пользователей.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "guests" && (
              <SectionCard
                title="Гости"
                subtitle="Все гостевые сессии по столам"
                right={<div className="text-sm text-slate-500">Всего: {filteredGuests.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Стол</th>
                        <th className="px-4 py-3">Гость</th>
                        <th className="px-4 py-3">Тип</th>
                        <th className="px-4 py-3">Сессия</th>
                        <th className="px-4 py-3">Активность</th>
                        <th className="px-4 py-3">Начало</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGuests.map((s) => (
                        <tr key={s.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {s.table.code}
                            {s.table.label ? ` • ${s.table.label}` : ""}
                          </td>
                          <td className="px-4 py-3">
                            {s.user ? `${s.user.name} • ${s.user.phone}` : "Гость без аккаунта"}
                          </td>
                          <td className="px-4 py-3">{s.user ? "С аккаунтом" : "Без аккаунта"}</td>
                          <td className="px-4 py-3">{s.id}</td>
                          <td className="px-4 py-3">
                            Заказы {s.ordersCount} • Вызовы {s.callsCount} • Оплаты {s.paymentsCount} • Оценки {s.ratingsCount}
                          </td>
                          <td className="px-4 py-3">{formatDate(s.startedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredGuests.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет гостевых сессий.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "shifts" && (
              <SectionCard
                title="Смены"
                subtitle="История смен и быстрый просмотр деталей"
                right={<div className="text-sm text-slate-500">Всего: {filteredShifts.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Открыта</th>
                        <th className="px-4 py-3">Статус</th>
                        <th className="px-4 py-3">Открыл</th>
                        <th className="px-4 py-3">Участники</th>
                        <th className="px-4 py-3">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShifts.map((shift) => (
                        <tr key={shift.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{formatDate(shift.openedAt)}</div>
                            <div className="text-xs text-slate-400">{shift.id}</div>
                          </td>
                          <td className="px-4 py-3">{statusBadge(shift.status)}</td>
                          <td className="px-4 py-3">{shift.openedByManager?.username ?? "—"}</td>
                          <td className="px-4 py-3">{shift.participants?.length ?? 0}</td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => void openShiftDetails(shift.id)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              Открыть
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredShifts.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет смен.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "orders" && (
              <SectionCard
                title="Заказы"
                subtitle="Все заказы гостей по точке"
                right={<div className="text-sm text-slate-500">Всего: {filteredOrders.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Дата</th>
                        <th className="px-4 py-3">Стол</th>
                        <th className="px-4 py-3">Статус</th>
                        <th className="px-4 py-3">Гость</th>
                        <th className="px-4 py-3">Позиции</th>
                        <th className="px-4 py-3">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((o) => (
                        <tr key={o.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3">{formatDate(o.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{o.table.code}</td>
                          <td className="px-4 py-3">{statusBadge(o.status)}</td>
                          <td className="px-4 py-3">{o.session.user ? `${o.session.user.name} • ${o.session.user.phone}` : "Без аккаунта"}</td>
                          <td className="px-4 py-3">{o.itemsCount}</td>
                          <td className="px-4 py-3">{o.totalCzk} Kč</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredOrders.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет заказов.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "calls" && (
              <SectionCard
                title="Вызовы"
                subtitle="Все обращения гостей"
                right={<div className="text-sm text-slate-500">Всего: {filteredCalls.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Дата</th>
                        <th className="px-4 py-3">Стол</th>
                        <th className="px-4 py-3">Тип</th>
                        <th className="px-4 py-3">Статус</th>
                        <th className="px-4 py-3">Гость</th>
                        <th className="px-4 py-3">Сообщение</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCalls.map((c) => (
                        <tr key={c.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3">{formatDate(c.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{c.table.code}</td>
                          <td className="px-4 py-3">{callTypeLabel(c.type)}</td>
                          <td className="px-4 py-3">{statusBadge(c.status)}</td>
                          <td className="px-4 py-3">{c.session.user ? `${c.session.user.name} • ${c.session.user.phone}` : "Без аккаунта"}</td>
                          <td className="px-4 py-3">{c.message || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredCalls.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет вызовов.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "payments" && (
              <SectionCard
                title="Оплаты"
                subtitle="Запросы оплаты и подтверждения"
                right={<div className="text-sm text-slate-500">Всего: {filteredPayments.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Дата</th>
                        <th className="px-4 py-3">Стол</th>
                        <th className="px-4 py-3">Метод</th>
                        <th className="px-4 py-3">Статус</th>
                        <th className="px-4 py-3">Гость</th>
                        <th className="px-4 py-3">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayments.map((p) => (
                        <tr key={p.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3">{formatDate(p.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{p.table.code}</td>
                          <td className="px-4 py-3">{p.method === "CARD" ? "Карта" : "Наличные"}</td>
                          <td className="px-4 py-3">{statusBadge(p.status)}</td>
                          <td className="px-4 py-3">{p.session.user ? `${p.session.user.name} • ${p.session.user.phone}` : "Без аккаунта"}</td>
                          <td className="px-4 py-3">{p.confirmation?.amountCzk ? `${p.confirmation.amountCzk} Kč` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredPayments.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет оплат.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "ratings" && (
              <SectionCard
                title="Оценки"
                subtitle="Отзывы по столам и пользователям"
                right={<div className="text-sm text-slate-500">Всего: {filteredRatings.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Стол</th>
                        <th className="px-4 py-3">Общая</th>
                        <th className="px-4 py-3">Комментарий</th>
                        <th className="px-4 py-3">Дата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRatings.map((r) => (
                        <tr key={r.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3 font-medium text-slate-900">{r.table.code}</td>
                          <td className="px-4 py-3">{r.overall}</td>
                          <td className="px-4 py-3">{r.comment || "—"}</td>
                          <td className="px-4 py-3">{formatDate(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredRatings.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет отзывов.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {!loading && tab === "staff" && (
              <SectionCard
                title="Персонал"
                subtitle="Сколько смен отработано"
                right={<div className="text-sm text-slate-500">Всего: {filteredStaff.length}</div>}
              >
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Сотрудник</th>
                        <th className="px-4 py-3">Роль</th>
                        <th className="px-4 py-3">Смен отработано</th>
                        <th className="px-4 py-3">Создан</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStaff.map((s) => (
                        <tr key={s.id} className="border-t border-slate-200 text-slate-700">
                          <td className="px-4 py-3 font-medium text-slate-900">{s.username}</td>
                          <td className="px-4 py-3">{s.role}</td>
                          <td className="px-4 py-3">{s.shiftsJoined}</td>
                          <td className="px-4 py-3">{formatDate(s.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredStaff.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Нет данных по персоналу.</div>
                  ) : null}
                </div>
              </SectionCard>
            )}
          </div>
        </div>
      </main>

      <ShiftDetailsDrawer
        open={!!selectedShiftId}
        onClose={() => {
          setSelectedShiftId(null);
          setSelectedShift(null);
        }}
        data={selectedShift}
        loading={shiftLoading}
      />
    </>
  );
}
