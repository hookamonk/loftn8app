"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { staffLogin } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";

export default function StaffLoginPage() {
  const router = useRouter();
  const { setStaff } = useStaffSession();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const r = await staffLogin(username.trim(), password);
    setLoading(false);

    if (!r.ok) {
      setErr(r.error || "Something went wrong");
      return;
    }

    setStaff(r.data.staff);
    router.replace("/staff/summary");
  };

  return (
    <main className="min-h-screen w-full bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
          <div className="text-xs text-white/60">Loft N8 • Staff</div>
          <h1 className="mt-1 text-2xl font-semibold">Вход персонала</h1>
          <p className="mt-1 text-sm text-white/60">Используй логин/пароль сотрудника</p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}

          <form className="mt-4 space-y-3" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-xs text-white/60">Username</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
                placeholder="pilot_waiter"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-white/60">Password</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
                placeholder="••••••••"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              className="mt-2 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Входим…" : "Войти"}
            </button>
          </form>
        </div>
      </div> 
    </main>
  );
}
