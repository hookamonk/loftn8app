"use client";

import { GuestAccount } from "@/components/GuestAccount";
import { getVenueName } from "@/lib/venue";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { useI18n } from "@/providers/i18n";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const router = useRouter();
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { me, loading } = useAuth();
  const { feed } = useGuestFeed();

  // Signing out mid-order would detach the account from the bill (and from its
  // cashback), so it stays locked until the table is settled.
  const busyAtTable = Boolean(
    (feed?.orderRequest && feed.orderRequest.status !== "DONE") ||
      (feed?.calls ?? []).some((call) => call.status === "NEW" || call.status === "ACKED") ||
      (feed?.payments ?? []).some((payment) => payment.status === "PENDING") ||
      (feed?.orders ?? []).some((order) => order.status !== "CANCELLED" && (order.items?.length ?? 0) > 0)
  );

  return (
    <main className="mx-auto max-w-md px-4 pb-28 pt-4">
      <div className="pr-24">
        <h1 className="text-xl font-semibold text-white">{isCz ? "Profil" : "Profile"}</h1>
        <div className="mt-0.5 text-[11px] tracking-[0.18em] text-white/35">{venueName}</div>
      </div>

      <div className="mt-3.5">
        {!loading && !me.authenticated ? (
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm leading-6 text-white/70">
              {isCz
                ? "V režimu hosta se nic neukládá. Přihlaste se, abyste sbírali cashback."
                : "Nothing is saved in guest mode. Sign in to collect cashback."}
            </div>
            <button
              type="button"
              className="mt-4 h-11 w-full rounded-xl bg-white text-sm font-semibold text-black transition active:scale-[0.99]"
              onClick={() => router.replace("/auth")}
            >
              {isCz ? "Přihlášení / Registrace" : "Sign in / Register"}
            </button>
          </section>
        ) : (
          <GuestAccount
            blockSignOut={{
              blocked: busyAtTable,
              reason: isCz
                ? "Odhlášení bude možné po dokončení objednávky a platby."
                : "Sign-out unlocks once your order and payment are finished.",
            }}
          />
        )}
      </div>
    </main>
  );
}
