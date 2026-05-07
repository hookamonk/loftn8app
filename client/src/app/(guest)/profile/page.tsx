"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { restartGuestOnboarding } from "@/lib/guestOnboarding";
import { getVenueName, setVenueSlug } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { useSession } from "@/providers/session";
import { useToast } from "@/providers/toast";
import { useI18n } from "@/providers/i18n";

export default function ProfilePage() {
  const router = useRouter();
  const { isCz, locale, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const searchParams = useSearchParams();
  const { push } = useToast();
  const { me, loading, refresh } = useAuth();
  const { feed } = useGuestFeed();
  const { clearSession } = useSession();
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loyaltyInfoOpen, setLoyaltyInfoOpen] = useState(false);

  const user = useMemo(() => (me?.authenticated ? me.user : null), [me]);
  const history = feed?.history ?? [];
  const loyalty = feed?.loyalty ?? {
    availableCzk: 0,
    pendingCzk: 0,
    nextAvailableAt: null,
    cashbackPercent: 10,
  };

  useEffect(() => {
    if (searchParams.get("history") === "1") {
      setHistoryOpen(true);
    }
  }, [searchParams]);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/auth/guest/logout", { method: "POST" });
      clearSession();
      setVenueSlug(null);
      await refresh();
      push({ kind: "success", title: isCz ? "Hotovo" : "Done", message: isCz ? "Byli jste odhlášeni" : "You have been logged out" });
      router.replace("/");
    } catch (e: any) {
      push({ kind: "error", title: isCz ? "Chyba" : "Error", message: e?.message ?? "Failed" });
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
      <div className="mb-4">
        <div className="text-[11px] tracking-[0.28em] text-white/55">{venueName}</div>
        <h1 className="mt-1 text-2xl font-bold text-white">{isCz ? "Profil" : "Profile"}</h1>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
        {user ? (
          <div className="space-y-3">
            <Field label={isCz ? "Jméno" : "Name"} value={user.name} />
            <Field label={isCz ? "Telefon" : "Phone"} value={user.phone} />
            <Field label="Email" value={user.email || "—"} />
            <button
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/10 text-sm font-semibold text-white"
              onClick={() => router.push("/cabinet")}
            >
              {isCz ? "Otevřít osobní účet" : "Open personal cabinet"}
            </button>
            <button
              className="h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 hover:text-white"
              onClick={showGuideAgain}
            >
              {isCz ? "Zobrazit průvodce znovu" : "Show guide again"}
            </button>
          </div>
        ) : (
          <div className="text-sm text-white/75">
            {isCz ? "V režimu hosta se účet neukládá." : "Your account is not saved in guest mode."}
            <div className="mt-3">
              <button
                className="h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black"
                onClick={() => router.replace("/auth")}
              >
                {isCz ? "Přihlášení / Registrace" : "Sign in / Register"}
              </button>
              <button
                className="mt-3 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 hover:text-white"
                onClick={showGuideAgain}
              >
                {isCz ? "Zobrazit průvodce znovu" : "Show guide again"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{isCz ? "Věrnostní program" : "Loyalty"}</div>
            <div className="mt-1 text-xs text-white/55">{isCz ? "10% cashback po každé potvrzené platbě" : "10% cashback after each confirmed payment"}</div>
          </div>

          <button
            className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-white"
            onClick={() => setLoyaltyInfoOpen(true)}
          >
            i
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{isCz ? "Dostupné" : "Available"}</div>
            <div className="mt-2 text-xl font-semibold text-white">{loyalty.availableCzk} Kč</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-white/38">{isCz ? "Čeká" : "Pending"}</div>
            <div className="mt-2 text-xl font-semibold text-white">{loyalty.pendingCzk} Kč</div>
          </div>
        </div>

        {loyalty.pendingCzk > 0 && loyalty.nextAvailableAt ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
            {isCz ? "Nový cashback bude dostupný po půlnoci." : "New cashback will become available after midnight."}
            <div className="mt-1 text-xs text-white/45">{formatDate(loyalty.nextAvailableAt)}</div>
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
        <div className="text-sm font-semibold text-white">{isCz ? "Historie návštěv" : "Visit history"}</div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          {history.length ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{isCz ? "Historie účtenek" : "Receipt history"}</div>
                <div className="mt-1 text-xs text-white/55">{isCz ? "Otevřete své předchozí uzavřené účty" : "Open your previous closed bills"}</div>
              </div>

              <button
                className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                onClick={() => setHistoryOpen(true)}
              >
                {isCz ? "Otevřít" : "Open"}
              </button>
            </div>
          ) : (
            <div className="text-sm text-white/60">
              {isCz ? "Účtenky se zde objeví po potvrzení platby." : "Receipts will appear here after payment is confirmed."}
            </div>
          )}
        </div>
      </section>

      {user ? (
        <button
          disabled={busy || loading}
          onClick={logout}
          className="mt-4 h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 hover:text-white disabled:opacity-50"
        >
          {busy ? (isCz ? "Odhlašuji…" : "Logging out…") : isCz ? "Odhlásit se" : "Logout"}
        </button>
      ) : null}

      {historyOpen ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-4 pb-4" onClick={() => setHistoryOpen(false)}>
          <div
            className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{isCz ? "Historie účtenek" : "Receipt history"}</div>
              </div>

              <button
                className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                onClick={() => setHistoryOpen(false)}
              >
                {isCz ? "Zavřít" : "Close"}
              </button>
            </div>

            {history.length ? (
              <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                {history.map((entry) => {
                  const open = expandedId === entry.id;

                  return (
                    <div key={entry.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                      <button
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        onClick={() => setExpandedId(open ? null : entry.id)}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">{isCz ? "Uzavřený účet" : "Closed bill"}</div>
                          <div className="mt-1 text-xs text-white/55">
                            {formatDate(entry.closedAt, locale)} • {entry.methodLabel}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold text-white">{entry.amountCzk} Kč</div>
                          <div className="mt-1 text-[11px] text-white/45">{open ? (isCz ? "Skrýt" : "Hide") : isCz ? "Zobrazit" : "View"}</div>
                        </div>
                      </button>

                      {open ? (
                        <div className="border-t border-white/8 px-4 py-3">
                          <div className="space-y-1.5">
                            {entry.items.map((item) => (
                              <div key={item.key} className="flex items-start justify-between gap-3 text-sm text-white/80">
                                <div>
                                  {item.name} × {item.qty}
                                  {item.comment ? (
                                    <div className="mt-0.5 text-[11px] text-white/42">{item.comment}</div>
                                  ) : null}
                                </div>
                                <div className="shrink-0">{item.totalCzk} Kč</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
                {isCz ? "Účtenky se zde objeví po potvrzení platby." : "Receipts will appear here after payment is confirmed."}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {loyaltyInfoOpen ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-4 pb-4" onClick={() => setLoyaltyInfoOpen(false)}>
          <div
            className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-white">{isCz ? "Jak funguje věrnostní program" : "How loyalty works"}</div>
            <div className="mt-3 space-y-2 text-sm text-white/75">
              <div>{isCz ? "Po každé potvrzené platbě získáte 10 % cashback." : "You get 10% cashback after each confirmed payment."}</div>
              <div>{isCz ? "Nový cashback je dostupný až po půlnoci." : "New cashback becomes available only after midnight."}</div>
              <div>{isCz ? "Na příštím účtu můžete použít všechny dostupné body, nebo je dál šetřit." : "You can either use all available points on the next bill or keep saving them."}</div>
            </div>

            <button
              className="mt-4 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white"
              onClick={() => setLoyaltyInfoOpen(false)}
            >
              {isCz ? "Zavřít" : "Close"}
            </button>
          </div>
        </div>
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

function formatDate(value: string, locale: string = "en-US") {
  return new Date(value).toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
