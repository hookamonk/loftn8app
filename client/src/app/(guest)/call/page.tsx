"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { getVenueName } from "@/lib/venue";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useAuth } from "@/providers/auth";
import { useGuestFeed } from "@/providers/guestFeed";
import { useI18n } from "@/providers/i18n";

/**
 * Two taps, two outcomes: get a waiter, or get the hookah master. Plus a free
 * text message when neither fits. Every card shows the live state of its own
 * request, so the guest never wonders whether it went through.
 */

type CallStatus = "NEW" | "ACKED" | "DONE";

function statusText(status: CallStatus | undefined, isCz: boolean) {
  if (status === "NEW") return isCz ? "Odesláno" : "Sent";
  if (status === "ACKED") return isCz ? "Na cestě" : "On the way";
  return undefined;
}

function Icon({ name }: { name: "user" | "zap" }) {
  const common = {
    width: 20,
    height: 20,
    fill: "none",
    stroke: "rgba(255,255,255,0.85)",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "user") {
    return (
      <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 21a8 8 0 1 0-16 0" />
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      </svg>
    );
  }

  return (
    <svg {...common} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 3 14h8l-1 8 11-14h-8l0-6Z" />
    </svg>
  );
}

function ActionCard({
  title,
  subtitle,
  status,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  status?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-[28px] border border-white/10 bg-white/6 p-4 text-left backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)] transition active:scale-[0.99] disabled:opacity-70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-white/60">{subtitle}</div>
          {status ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gold">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              {status}
            </div>
          ) : null}
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/30">
          {icon}
        </div>
      </div>
    </button>
  );
}

export default function CallPage() {
  const { isCz, ready } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { me, loading } = useAuth();
  const { feed, refresh } = useGuestFeed();
  const { push } = useToast();

  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const calls = feed?.calls ?? [];
  const waiter = calls.find((call) => call.type === "WAITER" && call.status !== "DONE");
  const hookah = calls.find((call) => call.type === "HOOKAH" && call.status !== "DONE");
  const message = calls.find((call) => call.type === "HELP");

  const isRegistered = Boolean(me?.authenticated);

  const send = async (type: "WAITER" | "HOOKAH" | "HELP", text?: string) => {
    if (busy) return;

    if (!isRegistered) {
      push({
        kind: "info",
        title: isCz ? "Vyžaduje registraci" : "Registration required",
        message: isCz
          ? "Zaregistrujte se, abyste mohli přivolat obsluhu."
          : "Register to call the staff.",
        action: { label: isCz ? "Zaregistrovat se" : "Register", href: "/auth" },
      });
      return;
    }

    setBusy(true);
    try {
      await api("/calls", {
        method: "POST",
        body: JSON.stringify({ type, message: text || undefined }),
      });
      await refresh();

      push({
        kind: "success",
        title: isCz ? "Odesláno" : "Sent",
        message: isCz ? "Obsluha už vidí váš stůl." : "The staff can already see your table.",
      });

      if (type === "HELP") setMsg("");
    } catch (e: unknown) {
      push({
        kind: "error",
        title: isCz ? "Chyba" : "Error",
        message: e instanceof Error ? e.message : isCz ? "Nepodařilo se odeslat" : "Failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <RequireTable>
      <main className="mx-auto max-w-md px-4 pb-28 pt-5">
        <div className="mb-4 pr-24">
          <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">{venueName}</div>
          <h1 className="mt-1 text-2xl font-bold text-white">{isCz ? "Obsluha" : "Staff"}</h1>

          {!loading && !isRegistered ? (
            <div className="mt-2 text-xs leading-5 text-white/60">
              {isCz
                ? "Jste v režimu hosta — dostupné je jen menu. Zaregistrujte se, abyste mohli objednávat."
                : "You're in guest mode — only the menu is available. Register to order."}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <ActionCard
            disabled={busy || Boolean(waiter)}
            title={isCz ? "Zavolat číšníka" : "Call the waiter"}
            subtitle={isCz ? "Přijde přijmout objednávku" : "They'll come to take your order"}
            status={statusText(waiter?.status, isCz)}
            icon={<Icon name="user" />}
            onClick={() => void send("WAITER")}
          />

          <ActionCard
            disabled={busy || Boolean(hookah)}
            title={isCz ? "Servis vodní dýmky" : "Hookah service"}
            subtitle={isCz ? "Přijde kalianér" : "The hookah master will come"}
            status={statusText(hookah?.status, isCz)}
            icon={<Icon name="zap" />}
            onClick={() => void send("HOOKAH")}
          />
        </div>

        <div className="mt-4 rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
          <div className="text-sm font-semibold text-white">
            {isCz ? "Zpráva pro obsluhu" : "Message to the staff"}
          </div>

          <textarea
            className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/25"
            placeholder={
              isCz
                ? 'Například: "Vodní dýmka pálí"'
                : 'For example: "The hookah is burning"'
            }
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={3}
          />

          <button
            type="button"
            disabled={busy || !msg.trim()}
            className="mt-3 h-12 w-full rounded-2xl border border-white/10 bg-white/10 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-40"
            onClick={() => void send("HELP", msg.trim())}
          >
            {isCz ? "Odeslat" : "Send"}
          </button>

          {message && message.status !== "DONE" ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/70">
              <div className="font-medium text-white">{message.statusTitle}</div>
              <div className="mt-1">{message.statusDescription}</div>
            </div>
          ) : null}
        </div>
      </main>
    </RequireTable>
  );
}
