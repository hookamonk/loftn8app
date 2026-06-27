"use client";

// Shared wait-time urgency helpers for the staff queues (orders & calls):
// the longer an item has been waiting, the louder it looks, so staff can
// triage at a glance.

export type WaitTone = "calm" | "amber" | "red";

export function waitInfo(createdAt: string, now: number): { mins: number; tone: WaitTone } {
  const mins = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  const tone: WaitTone = mins >= 10 ? "red" : mins >= 5 ? "amber" : "calm";
  return { mins, tone };
}

export const TONE_BORDER: Record<WaitTone, string> = {
  calm: "border-white/10",
  amber: "border-amber-400/40",
  red: "border-red-500/50",
};

const TONE_BADGE: Record<WaitTone, string> = {
  calm: "bg-white/10 text-white/65",
  amber: "bg-amber-400/20 text-amber-200",
  red: "bg-red-500/25 text-red-100 animate-pulse",
};

export function WaitBadge({ createdAt, now }: { createdAt: string; now: number }) {
  const { mins, tone } = waitInfo(createdAt, now);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[tone]}`}
    >
      ⏱ {mins < 1 ? "только что" : `${mins} мин`}
    </span>
  );
}

// Card base without a border-color, so callers can apply an urgency border.
export const queueCardBase =
  "rounded-[28px] border bg-white/6 p-4 backdrop-blur-xl shadow-[0_20px_80px_rgba(0,0,0,0.45)]";
