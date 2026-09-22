"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getVenueName } from "@/lib/venue";
import { beginGuestPushOptIn, completeGuestPushOptIn } from "@/lib/guestPush";
import { useToast } from "@/providers/toast";
import { RequireTable } from "@/components/RequireTable";
import { useAuth } from "@/providers/auth";
import { useGuestFeed, type GuestFeedCall } from "@/providers/guestFeed";
import { useI18n } from "@/providers/i18n";

/**
 * Two taps, two outcomes: get a waiter, or get the hookah master. Plus a free
 * text message when neither fits. Every card shows the live state of its own
 * request, so the guest never wonders whether it went through.
 *
 * Staff handle hookah calls and messages in ONE tap («Принять» → DONE), so for
 * the guest "accepted" means "being handled right now". That state is shown
 * for a while after acceptance and then quietly disappears.
 */

type ServiceKind = "waiter" | "hookah" | "message";

// How long "accepted / on the way" stays visible after staff took the request.
const ACCEPTED_VISIBLE_MS = 15 * 60 * 1000;

function isAcceptedRecently(call: GuestFeedCall, now: number) {
  if (call.status === "ACKED") return true;
  if (call.status !== "DONE") return false;
  return now - new Date(call.updatedAt).getTime() < ACCEPTED_VISIBLE_MS;
}

function serviceStatus(
  call: GuestFeedCall | undefined,
  kind: ServiceKind,
  now: number,
  isCz: boolean
): string | undefined {
  if (!call) return undefined;

  if (call.status === "NEW") return isCz ? "Odesláno" : "Sent";

  if (!isAcceptedRecently(call, now)) return undefined;

  if (kind === "message") return isCz ? "Váš požadavek se zpracovává" : "Your request is being handled";
  return isCz ? "Na cestě" : "On the way";
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

function StatusLine({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-gold">
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold" />
      <span className="truncate">{status}</span>
    </div>
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
      className="w-full rounded-3xl border border-white/10 bg-white/6 p-3.5 text-left backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.3)] transition active:scale-[0.99] disabled:opacity-70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-white/60">{subtitle}</div>
          {status ? (
            <div className="mt-2">
              <StatusLine status={status} />
            </div>
          ) : null}
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/30">
          {icon}
        </div>
      </div>
    </button>
  );
}

export default function CallPage() {
  const { isCz, ready, lang } = useI18n();
  const venueName = ready ? getVenueName() : "LOFT№8 Žižkov";
  const { me, loading } = useAuth();
  const { feed, refresh } = useGuestFeed();
  const { push } = useToast();

  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Ticks so "accepted" states expire on time even between feed refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const calls = feed?.calls ?? [];

  // The waiter request is closed by staff only when the order is punched in,
  // so its card stays locked until then.
  const waiter = calls.find((call) => call.type === "WAITER" && call.status !== "DONE");

  // Hookah / message: the button is locked only while the request is still
  // open; the status keeps showing for a while after staff accepted it.
  const hookahOpen = calls.find((call) => call.type === "HOOKAH" && call.status !== "DONE");
  const hookahLatest = calls.find((call) => call.type === "HOOKAH");
  const messageLatest = calls.find((call) => call.type === "HELP");

  const waiterStatus = serviceStatus(waiter, "waiter", now, isCz);
  const hookahStatus = serviceStatus(hookahLatest, "hookah", now, isCz);
  const messageStatus = serviceStatus(messageLatest, "message", now, isCz);

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

    // First relevant tap: let the browser ask for notification permission so
    // "on the way" / "order ready" reach the lock screen. Asked once per device.
    const pushOptIn = beginGuestPushOptIn();

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
      void completeGuestPushOptIn(pushOptIn, lang);
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
      <main className="mx-auto max-w-md px-4 pb-28 pt-4">
        <div className="mb-3.5 pr-24">
          <h1 className="text-xl font-semibold text-white">{isCz ? "Obsluha" : "Staff"}</h1>
          <div className="mt-0.5 text-[11px] tracking-[0.18em] text-white/35">{venueName}</div>

          {!loading && !isRegistered ? (
            <div className="mt-2 text-xs leading-5 text-white/60">
              {isCz
                ? "Jste v režimu hosta — dostupné je jen menu. Zaregistrujte se, abyste mohli objednávat."
                : "You're in guest mode — only the menu is available. Register to order."}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2.5">
          <ActionCard
            disabled={busy || Boolean(waiter)}
            title={isCz ? "Zavolat číšníka" : "Call the waiter"}
            subtitle={isCz ? "Přijde přijmout objednávku" : "They'll come to take your order"}
            status={waiterStatus}
            icon={<Icon name="user" />}
            onClick={() => void send("WAITER")}
          />

          <ActionCard
            disabled={busy || Boolean(hookahOpen)}
            title={isCz ? "Servis vodní dýmky" : "Hookah service"}
            subtitle={isCz ? "Přijde kalianér" : "The hookah master will come"}
            status={hookahStatus}
            icon={<Icon name="zap" />}
            onClick={() => void send("HOOKAH")}
          />
        </div>

        <div className="mt-2.5 rounded-3xl border border-white/10 bg-white/6 p-3.5 backdrop-blur-xl shadow-[0_8px_28px_rgba(0,0,0,0.3)]">
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
            className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-white/10 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-40"
            onClick={() => void send("HELP", msg.trim())}
          >
            {isCz ? "Odeslat" : "Send"}
          </button>

          {messageLatest && messageStatus ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="min-w-0 truncate text-xs text-white/60">{messageLatest.message}</div>
              <div className="shrink-0">
                <StatusLine status={messageStatus} />
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </RequireTable>
  );
}
