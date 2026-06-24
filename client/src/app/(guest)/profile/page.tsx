"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { restartGuestOnboarding } from "@/lib/guestOnboarding";
import { getVenueName, setVenueSlug } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { useSession } from "@/providers/session";
import { useToast } from "@/providers/toast";
import { useI18n } from "@/providers/i18n";

function userInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}

export default function ProfilePage() {
  const router = useRouter();
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const { feed } = useGuestFeed();
  const { clearSession } = useSession();
  const [busy, setBusy] = useState(false);

  const user = me?.authenticated ? me.user : null;
  const loyalty = feed?.loyalty ?? {
    availableCzk: 0,
    pendingCzk: 0,
    nextAvailableAt: null,
    cashbackPercent: 10,
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/auth/guest/logout", { method: "POST" });
      clearSession();
      setVenueSlug(null);
      await refresh();
      push({
        kind: "success",
        title: isCz ? "Hotovo" : "Done",
        message: isCz ? "Byli jste odhlášeni." : "You have been signed out.",
      });
      router.replace("/");
    } catch (e: any) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: e?.message ?? "Failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const showGuideAgain = () => {
    restartGuestOnboarding();
    router.push("/menu");
  };

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">
        {venueName}
      </div>
      <h1 className="mt-1 text-2xl font-bold text-white">
        {isCz ? "Profil" : "Profile"}
      </h1>

      {user ? (
        <>
          {/* Identity */}
          <section className="mt-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3.5">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/12 bg-white/10 text-base font-semibold text-white">
                {userInitials(user.name)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold leading-tight text-white">
                  {user.name}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/55">
                  {user.email || user.phone}
                </div>
              </div>
            </div>

            <button
              className="mt-4 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99]"
              onClick={() => router.push("/cabinet")}
            >
              {isCz ? "Otevřít osobní účet" : "Open personal account"}
            </button>
          </section>

          {/* Loyalty quick view */}
          <section className="mt-3 rounded-[28px] border border-gold/15 bg-gold/[0.06] p-5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.2em] text-gold/70">
                {isCz ? "Dostupný cashback" : "Available cashback"}
              </div>
              <div className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold">
                {loyalty.cashbackPercent}%
              </div>
            </div>
            <div className="mt-1.5 flex items-end gap-2">
              <div className="text-[34px] font-semibold leading-none text-gold">
                {loyalty.availableCzk}
              </div>
              <div className="pb-1 text-sm font-medium text-gold/70">Kč</div>
            </div>
            {loyalty.pendingCzk > 0 ? (
              <div className="mt-2 text-[12px] text-amber-50/60">
                {isCz ? "Čeká na odemčení" : "Waiting to unlock"}:{" "}
                {loyalty.pendingCzk} Kč
              </div>
            ) : null}
            <div className="mt-3 text-[12px] leading-5 text-amber-50/70">
              {isCz
                ? `Z každého potvrzeného účtu vám vrátíme ${loyalty.cashbackPercent}%. Použijte cashback na příští účet u stolu.`
                : `Every confirmed bill returns ${loyalty.cashbackPercent}%. Spend it on your next bill at the table.`}
            </div>
          </section>

          {/* Actions */}
          <div className="mt-3 space-y-2.5">
            <button
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-white transition hover:bg-white/[0.07]"
              onClick={showGuideAgain}
            >
              {isCz ? "Zobrazit průvodce znovu" : "Show the guide again"}
            </button>
            <button
              disabled={busy || loading}
              onClick={logout}
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] disabled:opacity-50"
            >
              {busy
                ? isCz
                  ? "Odhlašuji…"
                  : "Signing out…"
                : isCz
                  ? "Odhlásit se"
                  : "Sign out"}
            </button>
          </div>
        </>
      ) : (
        <section className="mt-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <div className="text-sm leading-6 text-white/70">
            {isCz
              ? "V režimu hosta se účet neukládá. Přihlaste se, abyste sbírali cashback a viděli historii účtenek."
              : "In guest mode nothing is saved. Sign in to collect cashback and keep your receipt history."}
          </div>
          <button
            className="mt-4 h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition active:scale-[0.99]"
            onClick={() => router.replace("/auth")}
          >
            {isCz ? "Přihlášení / Registrace" : "Sign in / Register"}
          </button>
          <button
            className="mt-2.5 h-12 w-full rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-white transition hover:bg-white/[0.07]"
            onClick={showGuideAgain}
          >
            {isCz ? "Zobrazit průvodce znovu" : "Show the guide again"}
          </button>
        </section>
      )}
    </main>
  );
}
