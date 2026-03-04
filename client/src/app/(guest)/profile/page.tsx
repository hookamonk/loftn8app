"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useToast } from "@/providers/toast";

export default function ProfilePage() {
  const router = useRouter();
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  const user = useMemo(() => (me?.authenticated ? me.user : null), [me]);

  useEffect(() => {
    if (loading) return;
    // профиль можно показывать и анонимному, но лучше вести на /auth
    // если хочешь оставлять — закомментируй редирект
    // if (!me?.authenticated) router.replace("/auth");
  }, [loading, me, router]);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/auth/guest/logout", { method: "POST" });
      await refresh();
      push({ kind: "success", title: "Готово", message: "Вы вышли из аккаунта" });
      router.replace("/auth");
    } catch (e: any) {
      push({ kind: "error", title: "Ошибка", message: e?.message ?? "Failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-5">
      <div className="mb-4">
        <div className="text-[11px] tracking-[0.28em] text-white/55">LOFT №8</div>
        <h1 className="mt-1 text-2xl font-bold text-white">Профиль</h1>
        <div className="mt-1 text-xs text-white/60">
          {user ? "Данные аккаунта" : "Вы вошли без аккаунта"}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
        {user ? (
          <div className="space-y-3">
            <Field label="Имя" value={user.name} />
            <Field label="Телефон" value={user.phone} />
            <Field label="Email" value={user.email || "—"} />
          </div>
        ) : (
          <div className="text-sm text-white/75">
            У вас нет аккаунта — профиль не сохраняется.
            <div className="mt-3">
              <button
                className="h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black"
                onClick={() => router.replace("/auth")}
              >
                Войти / Регистрация
              </button>
            </div>
          </div>
        )}
      </div>

      {user ? (
        <button
          disabled={busy}
          onClick={logout}
          className="mt-4 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 hover:text-white disabled:opacity-50"
        >
          {busy ? "Выходим…" : "Logout"}
        </button>
      ) : null}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-white/55">{label}</div>
      <div className="mt-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white">
        {value}
      </div>
    </div>
  );
}