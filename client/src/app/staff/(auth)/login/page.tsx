"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getStaffMe, staffLogin, type ApiResult } from "@/lib/staffApi";
import { homeForRole } from "@/lib/staffRoles";
import { useStaffSession } from "@/providers/staffSession";
import { enablePush, ensureServiceWorker, rebindPushIfPossible } from "@/lib/staffPush";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import {
  getStoredStaffVenueSlug,
  getVenueCatalog,
  refreshVenueCatalog,
  setStaffVenueSlug,
  type VenueOption,
  type VenueSlug,
} from "@/lib/venue";

/** True only after hydration — the form reads localStorage, the server can't. */
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function loginErrorText(r: Extract<ApiResult<unknown>, { ok: false }>) {
  if (r.status === 0 || r.error === "NETWORK_ERROR") return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
  if (r.status === 429) return "Слишком много попыток входа. Подождите 15 минут и попробуйте снова.";
  if (r.status === 401) return "Неверный логин или пароль.";
  if (r.status >= 500) return "Сервер запускается. Подождите минуту и попробуйте ещё раз.";
  return "Не получилось войти. Попробуйте ещё раз.";
}

export default function StaffLoginPage() {
  const mounted = useMounted();

  return (
    <main className="min-h-dvh w-full bg-[#07070a] text-white">
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.05] p-4">
          <div className="text-[11px] tracking-[0.18em] text-white/40">LOFT№8</div>
          <h1 className="mt-1 text-xl font-semibold">Вход для персонала</h1>
          {/* Rendered only on the client: the chosen venue comes from this
              device's storage, so the highlighted venue is always the real one. */}
          {mounted ? <LoginForm /> : <div className="mt-4 h-[360px]" />}
        </div>
      </div>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const { setStaff } = useStaffSession();

  const [venues, setVenues] = useState<VenueOption[]>(() => getVenueCatalog());
  const [selectedVenue, setSelectedVenue] = useState<VenueSlug>(() => getStoredStaffVenueSlug() ?? "loft-zizkov");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void ensureBackendWarm();
  }, []);

  // The installed app opens here: an account that is still signed in (a
  // station iPad, a waiter's phone) goes straight to its screen.
  useEffect(() => {
    let active = true;
    void getStaffMe().then((r) => {
      if (!active || !r.ok) return;
      if (r.data.staff.venueSlug) setStaffVenueSlug(r.data.staff.venueSlug);
      setStaff(r.data.staff);
      router.replace(homeForRole(r.data.staff.role));
    });
    return () => {
      active = false;
    };
  }, [router, setStaff]);

  useEffect(() => {
    let active = true;
    void refreshVenueCatalog().then((catalog) => {
      if (active) setVenues(catalog);
    });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErr(null);

    if (!username.trim() || !password) {
      setErr("Введите логин и пароль.");
      return;
    }

    setLoading(true);
    setStaffVenueSlug(selectedVenue);
    const r = await staffLogin(username.trim(), password, selectedVenue);
    setLoading(false);

    if (!r.ok) {
      setErr(loginErrorText(r));
      return;
    }

    const staff = r.data.staff;
    // The account decides the venue: if another venue was highlighted, the
    // server still signs it in to its own one — every next request must say so.
    if (staff.venueSlug) setStaffVenueSlug(staff.venueSlug);
    setStaff(staff);

    // Подписку на push запускаем в фоне (не блокируя переход) — иначе медленный
    // запрос/диалог разрешения задерживал вход и приходилось жать дважды.
    // Вызов стартует синхронно в рамках жеста клика, поэтому диалог разрешения
    // браузер всё равно показывает. Если здесь не выйдет (iOS без установки на
    // экран «Домой», отказ в разрешении) — на экране «Смена» есть пошаговый
    // мастер, который доводит уведомления до рабочего состояния.
    void ensureServiceWorker()
      .then(() => enablePush())
      .then(() => rebindPushIfPossible())
      .catch(() => {});

    router.replace(homeForRole(staff.role));
  };

  return (
    <form className="mt-4 space-y-3" onSubmit={onSubmit}>
      {err ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>
      ) : null}

      <div className="grid gap-1.5">
        {venues.map((venue) => {
          const active = selectedVenue === venue.slug;
          return (
            <button
              key={venue.slug}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedVenue(venue.slug)}
              className={[
                "h-11 w-full rounded-xl border px-4 text-left text-sm font-semibold transition",
                active ? "border-white/20 bg-white text-black" : "border-white/10 bg-black/30 text-white/80",
              ].join(" ")}
            >
              {venue.name}
            </button>
          );
        })}
      </div>

      <input
        className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
        placeholder="Логин"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="username"
      />

      <input
        className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
        placeholder="Пароль"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />

      <button
        className="h-11 w-full rounded-xl bg-white text-sm font-semibold text-black disabled:opacity-60"
        disabled={loading}
      >
        {loading ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
