"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getVenueName } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { RatingSheet } from "@/components/RatingSheet";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { useI18n } from "@/providers/i18n";

const GOOGLE_REVIEW_URL = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL;

function requestStatusText(status?: "NEW" | "ACKED" | "DONE", isCz?: boolean) {
  if (status === "ACKED") return isCz ? "Na cestě" : "On the way";
  if (status === "NEW") return isCz ? "Požadavek odeslán" : "Request sent";
  return undefined;
}

function paymentStatusText(status?: "PENDING" | "CONFIRMED" | "CANCELLED", isCz?: boolean) {
  if (status === "PENDING") return isCz ? "Platba vyžádána" : "Payment requested";
  if (status === "CONFIRMED") return isCz ? "Platba potvrzena" : "Payment confirmed";
  if (status === "CANCELLED") return isCz ? "Platba zrušena" : "Payment cancelled";
  return undefined;
}

const PAYMENT_STATUS_FLASH_MS = 2 * 60 * 1000;

function isRecentPayment(ts?: string | null) {
  if (!ts) return false;
  const value = new Date(ts).getTime();
  if (!Number.isFinite(value)) return false;
  return Date.now() - value <= PAYMENT_STATUS_FLASH_MS;
}

function messageStatusCopy(status?: "NEW" | "ACKED" | "DONE", isCz?: boolean) {
  if (status === "ACKED") return isCz ? "Vaše zpráva byla přijata a obsluha ji řeší." : "Your message was seen and taken into work.";
  if (status === "DONE") return isCz ? "Vaše zpráva byla označena jako vyřešená." : "Your message thread was marked as completed.";
  if (status === "NEW") return isCz ? "Vaše zpráva byla odeslána obsluze." : "Your message was sent to the staff.";
  return "";
}

function ActionCard({
  title,
  subtitle,
  statusText,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  statusText?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      className="w-full rounded-[28px] border border-white/10 bg-white/6 p-4 text-left backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)] disabled:opacity-60"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-white/60">{subtitle}</div>
          {statusText ? <div className="mt-2 text-xs font-medium text-gold">{statusText}</div> : null}
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-black/30">
          {icon}
        </div>
      </div>
    </button>
  );
}

function SmallIcon({ name }: { name: "user" | "zap" | "card" }) {
  const common = {
    width: 20,
    height: 20,
    fill: "none",
    stroke: "rgba(255,255,255,0.85)",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "user")
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M20 21a8 8 0 1 0-16 0" />
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      </svg>
    );

  if (name === "zap")
    return (
      <svg {...common} viewBox="0 0 24 24">
        <path d="M13 2 3 14h8l-1 8 11-14h-8l0-6Z" />
      </svg>
    );

  return (
    <svg {...common} viewBox="0 0 24 24">
      <path d="M3 10h18" />
      <path d="M7 16h10" />
      <path d="M5 6h14" />
    </svg>
  );
}

export default function CallPage() {
  const router = useRouter();
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { me, loading } = useAuth();
  const canRate = !loading && !!me?.authenticated;
  const { feed, refresh } = useGuestFeed();

  const [msg, setMsg] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [doneFlash, setDoneFlash] = useState<Record<string, boolean>>({});
  const prevStatusesRef = useRef<Record<string, "NEW" | "ACKED" | "DONE">>({});
  const latestPaymentSnapshotRef = useRef<{ id: string; status: "PENDING" | "CONFIRMED" | "CANCELLED" } | null>(null);

  const { push } = useToast();

  const latestWaiter = feed?.calls.find((call) => call.type === "WAITER");
  const latestHookah = feed?.calls.find((call) => call.type === "HOOKAH");
  const latestPayment = useMemo(
    () => (feed?.payments ?? []).find((payment) => payment.isMine) ?? null,
    [feed?.payments]
  );
  const latestMessage = feed?.calls.find((call) => call.type === "HELP");

  useEffect(() => {
    const nextStatuses: Record<string, "NEW" | "ACKED" | "DONE"> = {};

    for (const key of ["WAITER", "HOOKAH", "BILL", "HELP"] as const) {
      const latest = feed?.calls.find((call) => call.type === key);
      if (!latest) continue;

      nextStatuses[key] = latest.status;
      const prev = prevStatusesRef.current[key];
      if (prev && prev !== "DONE" && latest.status === "DONE") {
        setDoneFlash((current) => ({ ...current, [key]: true }));
        window.setTimeout(() => {
          setDoneFlash((current) => ({ ...current, [key]: false }));
        }, 1800);
      }
    }

    prevStatusesRef.current = nextStatuses;
  }, [feed]);

  useEffect(() => {
    const latestPaymentEntry = (feed?.payments ?? []).find((payment) => payment.isMine) ?? null;
    if (!latestPaymentEntry) {
      latestPaymentSnapshotRef.current = null;
      return;
    }

    const prev = latestPaymentSnapshotRef.current;
    if (
      prev &&
      prev.id === latestPaymentEntry.id &&
      prev.status === "PENDING" &&
      latestPaymentEntry.status === "CANCELLED"
    ) {
      push({
        kind: "info",
        title: isCz ? "Žádost o platbu zrušena" : "Payment request cancelled",
        message: isCz ? "Vyberte prosím cashback nebo znovu způsob platby." : "Please choose cashback or the payment method again.",
      });
    }

    latestPaymentSnapshotRef.current = {
      id: latestPaymentEntry.id,
      status: latestPaymentEntry.status,
    };
  }, [feed?.payments, push]);

  const waiterStatus = doneFlash.WAITER ? (isCz ? "Hotovo" : "Done") : requestStatusText(latestWaiter?.status, isCz);
  const hookahStatus = doneFlash.HOOKAH ? (isCz ? "Hotovo" : "Done") : requestStatusText(latestHookah?.status, isCz);
  const shouldShowPaymentStatus = Boolean(
    latestPayment &&
      (latestPayment.status === "PENDING" ||
        ((latestPayment.status === "CONFIRMED" || latestPayment.status === "CANCELLED") &&
          isRecentPayment(latestPayment.confirmedAt ?? latestPayment.createdAt)))
  );
  const paymentStatus = shouldShowPaymentStatus ? paymentStatusText(latestPayment?.status, isCz) : undefined;
  const messageStatus = doneFlash.HELP ? (isCz ? "Hotovo" : "Done") : requestStatusText(latestMessage?.status, isCz);
  // Live updates come from GuestFeedProvider's central polling; no local loop.

  const send = async (type: string, message?: string) => {
    if (cooldown) return;
    setCooldown(true);

    try {
      await api("/calls", {
        method: "POST",
        body: JSON.stringify({ type, message: message || undefined }),
      });
      await refresh();

      push({
        kind: "success",
        title: isCz ? "Odesláno" : "Sent",
        message: isCz ? "Obsluha už vidí váš stůl." : "The staff can already see your table.",
      });

      setMsg("");
    } catch (e: any) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: e?.message ?? (isCz ? "Nepodařilo se odeslat požadavek" : "Failed"),
      });
    } finally {
      window.setTimeout(() => setCooldown(false), 1400);
    }
  };

  const submitRating = async (payload: {
    food: number;
    drinks: number;
    hookah: number;
    comment?: string;
  }) => {
    if (!canRate) {
      push({
        kind: "info",
        title: isCz ? "Je vyžadován účet" : "Account required",
        message: isCz ? "Hodnocení je dostupné až po přihlášení." : "Rating is available only after sign in.",
        action: { label: isCz ? "Přihlásit se" : "Sign in", href: "/auth" },
      });
      return;
    }

    try {
      await api("/guest/rating", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      push({
        kind: "success",
        title: isCz ? "Děkujeme!" : "Thank you!",
        message: isCz ? "Vaše hodnocení bylo odesláno" : "Your rating has been submitted",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: e?.message ?? (isCz ? "Nepodařilo se odeslat hodnocení" : "Failed"),
      });
    }
  };

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="mb-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">
            {venueName}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">{isCz ? "Obsluha" : "Staff"}</h1>

          {!loading && !me?.authenticated ? (
            <div className="mt-2 text-xs text-white/60">
              {isCz
                ? "Jste v režimu hosta — přivolání obsluhy je dostupné. Objednávky a hodnocení jsou dostupné po přihlášení."
                : "You are in guest mode — staff assistance is available. Orders and ratings are available after sign in."}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <ActionCard
            disabled={cooldown}
            title={isCz ? "Zavolat číšníka" : "Call waiter"}
            subtitle={isCz ? "Rychlý požadavek" : "Quick request"}
            statusText={waiterStatus}
            icon={<SmallIcon name="user" />}
            onClick={() => send("WAITER")}
          />

          <ActionCard
            disabled={cooldown}
            title={isCz ? "Urgentní servis vodní dýmky" : "Urgent hookah service"}
            subtitle={isCz ? "Rychlý požadavek" : "Quick request"}
            statusText={hookahStatus}
            icon={<SmallIcon name="zap" />}
            onClick={() => send("HOOKAH")}
          />

          <ActionCard
            disabled={cooldown}
            title={isCz ? "Platba" : "Payment"}
            subtitle={isCz ? "Vyberte položky a způsob platby na účtu" : "Choose items and payment on your bill"}
            statusText={paymentStatus}
            icon={<SmallIcon name="card" />}
            onClick={() => router.push("/cart")}
          />
        </div>

        <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold text-white">
            {isCz ? "Zpráva pro obsluhu" : "Message to staff"}
          </div>

          <textarea
            className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
            placeholder={isCz ? 'Například: "Vodní dýmka pálí", "Prosím přijďte ke stolu"' : 'For example: "Hookah is burning", "Please come to the table"'}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
          />

          <button
            disabled={cooldown}
            className="mt-3 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => send("HELP", msg)}
          >
            {isCz ? "Odeslat" : "Send"}
          </button>

          {latestMessage ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
              <div className="font-medium text-white">{messageStatus ?? (isCz ? "Zpráva odeslána" : "Message sent")}</div>
              <div className="mt-1">
                {doneFlash.HELP ? (isCz ? "Tento požadavek byl dokončen." : "This request has been completed.") : messageStatusCopy(latestMessage.status, isCz)}
              </div>
            </div>
          ) : null}

          <button
            className="mt-3 w-full rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
            onClick={() => setRatingOpen(true)}
          >
            {isCz ? "Ohodnotit návštěvu" : "Rate your visit"}
          </button>
        </div>

        <RatingSheet
          open={ratingOpen}
          onClose={() => setRatingOpen(false)}
          onSubmit={submitRating}
          googleReviewUrl={GOOGLE_REVIEW_URL}
        />
      </main>
    </RequireTable>
  );
} 
