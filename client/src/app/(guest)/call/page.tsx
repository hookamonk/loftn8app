"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { PaymentSheet } from "@/components/PaymentSheet";
import { RatingSheet } from "@/components/RatingSheet";
import { useAuth } from "@/providers/auth";

const GOOGLE_REVIEW_URL = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL;

function ActionCard({
  title,
  subtitle,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
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
  const { me, loading } = useAuth();
  const canRate = !loading && !!me?.authenticated;

  const [msg, setMsg] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);

  const { push } = useToast();

  const send = async (type: string, message?: string) => {
    if (cooldown) return;
    setCooldown(true);

    try {
      await api("/calls", {
        method: "POST",
        body: JSON.stringify({ type, message: message || undefined }),
      });

      push({
        kind: "success",
        title: "Sent",
        message: "The staff can already see your table",
      });

      setMsg("");
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: e?.message ?? "Failed",
      });
    } finally {
      window.setTimeout(() => setCooldown(false), 1400);
    }
  };

  const requestPayment = async (method: "CARD" | "CASH") => {
    setPayOpen(false);

    await send("BILL", `PAYMENT_METHOD:${method}`);

    if (canRate) {
      setRatingOpen(true);
    } else {
      push({
        kind: "info",
        title: "Rating is available after sign in",
        message: "Please sign in or register to leave a rating.",
        action: { label: "Sign in", href: "/auth" },
      });
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
        title: "Account required",
        message: "Rating is available only after sign in.",
        action: { label: "Sign in", href: "/auth" },
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
        title: "Thank you!",
        message: "Your rating has been submitted",
      });
    } catch (e: any) {
      push({
        kind: "error",
        title: "Error",
        message: e?.message ?? "Failed",
      });
    }
  };

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="mb-4">
          <div className="text-[11px] tracking-[0.28em] text-white/55">
            LOFT №8
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">Staff</h1>

          {!loading && !me?.authenticated ? (
            <div className="mt-2 text-xs text-white/60">
              You are in guest mode — staff assistance is available. Orders and ratings are available after sign in.
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <ActionCard
            disabled={cooldown}
            title="Call waiter"
            subtitle="Quick request"
            icon={<SmallIcon name="user" />}
            onClick={() => send("WAITER")}
          />

          <ActionCard
            disabled={cooldown}
            title="Urgent hookah service"
            subtitle="Quick request"
            icon={<SmallIcon name="zap" />}
            onClick={() => send("HOOKAH")}
          />

          <ActionCard
            disabled={cooldown}
            title="Payment"
            subtitle="Card / Cash"
            icon={<SmallIcon name="card" />}
            onClick={() => setPayOpen(true)}
          />
        </div>

        <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold text-white">
            Message to staff
          </div>

          <textarea
            className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
            placeholder='For example: "Hookah is burning", "Please come to the table"'
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
          />

          <button
            disabled={cooldown}
            className="mt-3 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            onClick={() => send("HELP", msg)}
          >
            Send
          </button>
        </div>

        <PaymentSheet
          open={payOpen}
          onClose={() => setPayOpen(false)}
          onPick={requestPayment}
        />

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