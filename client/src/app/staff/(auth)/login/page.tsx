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

    const staff = r.data.staff;
    setStaff(staff);

    if (staff.role === "ADMIN") {
      router.replace("/staff/admin");
      return;
    }

    router.replace("/staff/summary");
  };

  return (
    <main className="min-h-screen w-full bg-[#050508] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-[380px] w-[380px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
          <div className="text-xs tracking-[0.22em] text-white/45">LOFT №8</div>
          <h1 className="mt-2 text-2xl font-semibold">Вход в систему</h1>
          <p className="mt-1 text-sm text-white/60">
            Официант, кальянщик, менеджер
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          ) : null}

          <form className="mt-5 space-y-3" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-xs text-white/60">Username</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/25"
                placeholder="login"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
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
                autoComplete="current-password"
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
