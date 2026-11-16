"use client";

import type { StationTicket } from "@/lib/staffApi";
import { STATION_LABEL } from "@/lib/staffRoles";

/**
 * One station ticket: table, what to make, how long it has been waiting and
 * the single next action. Used on the station iPads (size "lg") and on the
 * waiter / hookah / manager phones.
 */

export type TicketCardAction = {
  label: string;
  tone: "primary" | "accent";
  busy?: boolean;
  onClick: () => void;
};

type Line = StationTicket["items"][number];

const STATUS_CHIP: Record<StationTicket["status"], { label: string; className: string }> = {
  NEW: { label: "Не принят", className: "bg-red-500/20 text-red-100" },
  ACCEPTED: { label: "Готовится", className: "bg-white/10 text-white/75" },
  READY: { label: "Готово", className: "bg-emerald-500/20 text-emerald-200" },
  SERVED: { label: "Выдано", className: "bg-white/8 text-white/50" },
  CANCELLED: { label: "Отменён", className: "bg-white/8 text-white/50" },
};

function minutesSince(iso: string | null, now: number) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

function clock(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Waiting time shown on the card, counted from the moment that matters now. */
function waitLabel(ticket: StationTicket, now: number) {
  if (ticket.status === "SERVED") return clock(ticket.servedAt);
  if (ticket.status === "CANCELLED") return clock(ticket.cancelledAt);
  const from = ticket.status === "READY" ? ticket.readyAt : ticket.createdAt;
  const mins = minutesSince(from, now);
  return mins < 1 ? "сейчас" : `${mins} мин`;
}

/**
 * Busy hours: the station said when it will be ready. Shown only while the
 * order is being made and only if a time was set — a normal day shows nothing.
 */
export function etaInfo(ticket: StationTicket, now: number) {
  if (!ticket.etaAt || (ticket.status !== "NEW" && ticket.status !== "ACCEPTED")) return null;
  const at = new Date(ticket.etaAt).getTime();
  const left = at - now;
  if (left > 0) {
    return { late: false, label: `Выдача через ${Math.max(1, Math.ceil(left / 60000))} мин · к ${clock(ticket.etaAt)}` };
  }
  const over = Math.floor(-left / 60000);
  return { late: true, label: over < 1 ? `Выдача сейчас · ${clock(ticket.etaAt)}` : `Опаздывает на ${over} мин · было к ${clock(ticket.etaAt)}` };
}

function borderFor(ticket: StationTicket, now: number) {
  if (ticket.status === "NEW") return "border-red-500/60";
  if (ticket.status === "READY") return "border-emerald-400/50";
  // With a promised time the card turns red only once that time has passed.
  const eta = etaInfo(ticket, now);
  if (eta) return eta.late ? "border-red-500/40" : "border-amber-400/40";
  if (ticket.status === "ACCEPTED") {
    const mins = minutesSince(ticket.createdAt, now);
    if (mins >= 20) return "border-red-500/40";
    if (mins >= 10) return "border-amber-400/40";
  }
  return "border-white/10";
}

export function TicketCard({
  ticket,
  now,
  size = "md",
  showStation = false,
  showStatus = false,
  action,
  onCancelLine,
  onEta,
}: {
  ticket: StationTicket;
  now: number;
  size?: "md" | "lg";
  showStation?: boolean;
  /** Info-only cards (no action for this account) say where the ticket is. */
  showStatus?: boolean;
  action?: TicketCardAction | null;
  /** Manager: take a line off the order. */
  onCancelLine?: (line: Line) => void;
  /** Whoever prepares it: set / change the ready time (busy hours). */
  onEta?: () => void;
}) {
  const lg = size === "lg";
  const cancelled = ticket.status === "CANCELLED";
  const chip = STATUS_CHIP[ticket.status];
  const eta = etaInfo(ticket, now);
  const canSetEta = !!onEta && (ticket.status === "NEW" || ticket.status === "ACCEPTED");

  return (
    <div
      className={[
        "flex flex-col rounded-3xl border bg-white/[0.05] p-3.5",
        borderFor(ticket, now),
        cancelled ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`font-bold text-white ${lg ? "text-2xl" : "text-lg"}`}>Стол {ticket.table.code}</span>
          {showStation ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75">
              {STATION_LABEL[ticket.station]}
            </span>
          ) : null}
          {ticket.isAddon && !cancelled ? (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-200">
              Дозаказ
            </span>
          ) : null}
          {showStatus || cancelled ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}>{chip.label}</span>
          ) : null}
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2 py-0.5 font-semibold tabular-nums",
            lg ? "text-sm" : "text-[11px]",
            ticket.status === "NEW" ? "animate-pulse bg-red-500/25 text-red-100" : "bg-white/10 text-white/65",
          ].join(" ")}
        >
          {waitLabel(ticket, now)}
        </span>
      </div>

      {eta ? (
        <div
          className={[
            "mt-2 rounded-xl px-2.5 py-1.5 font-semibold tabular-nums",
            lg ? "text-base" : "text-xs",
            eta.late ? "bg-red-500/15 text-red-200" : "bg-amber-400/15 text-amber-100",
          ].join(" ")}
        >
          ⏱ {eta.label}
        </div>
      ) : null}

      <div className={`mt-2.5 space-y-1.5 ${lg ? "text-lg" : "text-sm"}`}>
        {ticket.items.map((line) => (
          <div key={line.id} className="flex items-start justify-between gap-2">
            <div className={`min-w-0 ${cancelled ? "line-through" : ""}`}>
              <div className="text-white">
                <span className="font-bold tabular-nums">{line.qty} ×</span> {line.name}
              </div>
              {line.comment ? (
                <div className={`${lg ? "text-base" : "text-xs"} font-medium text-amber-200`}>{line.comment}</div>
              ) : null}
            </div>
            {onCancelLine && !cancelled ? (
              <button
                type="button"
                aria-label={`Отменить ${line.name}`}
                onClick={() => onCancelLine(line)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-sm text-white/60 active:bg-white/15"
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}

        {ticket.cancellations.map((line) => (
          <div key={line.id} className="text-red-200/80">
            <span className="line-through">
              {line.qty} × {line.name}
            </span>
            <span className={`${lg ? "text-sm" : "text-[11px]"} font-semibold`}>
              {" "}
              — отменено{line.reason ? `: ${line.reason}` : ""}
            </span>
          </div>
        ))}
      </div>

      {action || canSetEta ? (
        // Pinned to the bottom so buttons line up across a grid of cards.
        <div className="mt-auto flex gap-2 pt-3">
          {canSetEta ? (
            <button
              type="button"
              onClick={onEta}
              aria-label="Время выдачи"
              className={[
                "shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 font-semibold text-white/85 transition active:scale-[0.99]",
                lg ? "h-14 text-base" : "h-11 text-sm",
              ].join(" ")}
            >
              ⏱ Время
            </button>
          ) : null}
          {action ? (
            <button
              type="button"
              disabled={action.busy}
              onClick={action.onClick}
              className={[
                "min-w-0 flex-1 rounded-xl font-semibold text-black transition active:scale-[0.99] disabled:opacity-50",
                lg ? "h-14 text-lg" : "h-11 text-sm",
                action.tone === "accent" ? "bg-emerald-400" : "bg-white",
              ].join(" ")}
            >
              {action.busy ? "…" : action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
