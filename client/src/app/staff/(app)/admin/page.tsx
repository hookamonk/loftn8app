"use client";

import { useEffect, useMemo, useState } from "react";
import { getAdminUsers, type AdminUserItem } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("cs-CZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}

export default function StaffAdminPage() {
  const { staff } = useStaffSession();
  const isAllowed = staff?.role === "MANAGER" || staff?.role === "ADMIN";

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);
    const r = await getAdminUsers("all");
    if (!r.ok) {
      setErr(r.error || "Не удалось загрузить пользователей");
      setLoading(false);
      return;
    }
    setUsers(r.data.users);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q),
    );
  }, [users, q]);

  if (!isAllowed) {
    return (
      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-white">
        <div className="text-lg font-semibold">Админ-панель</div>
        <div className="mt-2 text-sm text-white/55">
          Доступ только для менеджера и администратора.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: имя, телефон или e-mail"
          className="h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
        />
        <button
          onClick={() => void load()}
          className="h-12 shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Обновить
        </button>
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[72px] animate-pulse rounded-[20px] border border-white/10 bg-white/[0.03]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-10 text-center">
          <div className="text-sm font-semibold text-white/80">
            {q ? "Ничего не найдено" : "Пока нет зарегистрированных гостей"}
          </div>
          <div className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-white/45">
            {q
              ? "Измените запрос поиска."
              : "Гость появится здесь после регистрации в приложении."}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2.5 lg:hidden">
            {filtered.map((u) => (
              <div
                key={u.id}
                className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/12 bg-white/10 text-sm font-semibold text-white">
                    {initials(u.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">
                      {u.name}
                    </div>
                    <div className="truncate text-xs text-white/55">{u.phone}</div>
                    <div className="truncate text-xs text-white/40">
                      {u.email || "без e-mail"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-semibold text-emerald-300">
                      {u.bonusCzk} Kč
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-white/35">
                      бонусы
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-[20px] border border-white/10 lg:block">
            <table className="min-w-full text-sm">
              <thead className="bg-white/[0.04] text-left text-[11px] uppercase tracking-[0.14em] text-white/45">
                <tr>
                  <th className="px-5 py-3.5 font-medium">Гость</th>
                  <th className="px-5 py-3.5 font-medium">Телефон</th>
                  <th className="px-5 py-3.5 font-medium">E-mail</th>
                  <th className="px-5 py-3.5 font-medium">Регистрация</th>
                  <th className="px-5 py-3.5 text-right font-medium">Бонусы</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u.id}
                    className="border-t border-white/8 text-white/80 transition hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/12 bg-white/10 text-xs font-semibold text-white">
                          {initials(u.name)}
                        </div>
                        <span className="font-semibold text-white">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">{u.phone}</td>
                    <td className="px-5 py-3.5 text-white/60">{u.email || "—"}</td>
                    <td className="px-5 py-3.5 text-white/55">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="font-semibold text-emerald-300">
                        {u.bonusCzk} Kč
                      </span>
                      {u.pendingBonusCzk > 0 ? (
                        <span className="ml-2 text-[11px] text-white/35">
                          +{u.pendingBonusCzk} ждёт
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
