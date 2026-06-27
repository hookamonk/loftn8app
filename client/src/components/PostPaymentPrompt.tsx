"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { storage } from "@/lib/storage";
import { useGuestFeed } from "@/providers/guestFeed";
import { useSession } from "@/providers/session";
import { useToast } from "@/providers/toast";
import { useI18n } from "@/providers/i18n";

/**
 * After the table bill is fully paid the guest is asked whether to stay and
 * order more, or to leave. Choosing "stay" suspends the auto-end timer; "leave"
 * ends the session now. Making no choice lets the server auto-end the session
 * after the grace period (GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES).
 */
export function PostPaymentPrompt() {
  const { feed, refresh } = useGuestFeed();
  const { clearSession } = useSession();
  const { push } = useToast();
  const { isCz } = useI18n();
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(false);

  // Signature of the settled bill, so the prompt appears once at the moment of
  // payment and never again on refresh / re-navigation to the cart.
  const sig = useMemo(() => {
    const ids = (feed?.payments ?? [])
      .filter((p) => p.status === "CONFIRMED")
      .map((p) => p.id)
      .sort()
      .join(",");
    return ids || (feed?.closure?.billFullyPaid ? "settled" : "");
  }, [feed?.payments, feed?.closure?.billFullyPaid]);
  const promptKey = feed?.currentSessionId ? `postPayPromptShown:${feed.currentSessionId}` : null;

  useEffect(() => {
    if (!promptKey || !sig) return;
    setSeen(storage.get<string | null>(promptKey, null) === sig);
  }, [promptKey, sig]);

  const visible = Boolean(feed?.closure?.promptStay) && !busy && !seen;

  // Mark as shown the instant it appears — it won't pop up again afterwards.
  useEffect(() => {
    if (visible && promptKey && sig) storage.set(promptKey, sig);
  }, [visible, promptKey, sig]);

  if (!visible) return null;

  const stay = async () => {
    setBusy(true);
    try {
      await api("/guest/session/stay", { method: "POST" });
      await refresh();
      push({
        kind: "success",
        title: isCz ? "Skvělé!" : "Great!",
        message: isCz ? "Zůstáváte u nás — vyberte si v menu." : "You're staying — pick something from the menu.",
      });
    } catch {
      // ignore — the prompt will reappear on the next feed refresh
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await api("/guest/session/leave", { method: "POST" }).catch(() => {});
      push({
        kind: "success",
        title: isCz ? "Děkujeme za návštěvu!" : "Thanks for visiting!",
        message: isCz ? "Budeme se těšit příště." : "See you next time.",
      });
    } finally {
      clearSession({ redirect: true });
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-[28px] border border-gold/25 bg-[#151515]/97 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-xl text-amber-200">✦</div>
        <div className="mt-4 text-lg font-semibold text-white">
          {isCz ? "Účet je uhrazen — díky!" : "Your bill is paid — thank you!"}
        </div>
        <div className="mt-2 text-sm leading-6 text-white/70">
          {isCz
            ? "Chcete si ještě něco objednat a zůstat u nás? Pokud ne, stůl uvolníme."
            : "Would you like to order more and stay with us? If not, we'll free up your table."}
        </div>

        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={stay}
            className="h-12 w-full rounded-2xl bg-white text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
          >
            {isCz ? "Ano, zůstáváme" : "Yes, we're staying"}
          </button>
          <button
            type="button"
            onClick={leave}
            className="h-12 w-full rounded-2xl border border-white/10 bg-transparent text-sm font-semibold text-white/85 transition hover:text-white"
          >
            {isCz ? "Ne, odcházíme" : "No, we're leaving"}
          </button>
        </div>
      </div>
    </div>
  );
}
