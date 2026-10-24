"use client";

import Link from "next/link";
import type { ShiftSummaryRow } from "@/lib/staffApi";
import { money, shiftSpan } from "@/lib/shiftReportFormat";

/** Shifts, newest first: when, card / cash collected, tap → full report. */
export function ShiftReportList({ shifts, showVenue }: { shifts: ShiftSummaryRow[]; showVenue?: boolean }) {
  if (!shifts.length) return <div className="text-sm text-white/50">Смен пока нет.</div>;

  return (
    <div className="divide-y divide-white/8">
      {shifts.map((shift) => (
        <Link
          key={shift.id}
          href={`/staff/reports/${shift.id}`}
          className="flex items-center justify-between gap-3 py-2.5 active:opacity-70"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              {showVenue ? <span className="text-white/60">{shift.venueShortName}</span> : null}
              <span>{shiftSpan(shift.openedAt, shift.closedAt)}</span>
              {shift.status === "OPEN" ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">идёт</span>
              ) : null}
            </div>
            <div className="text-xs text-white/50">
              карта {money(shift.cardCzk)} · наличные {money(shift.cashCzk)}
            </div>
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums text-white">{money(shift.totalCzk)} ›</div>
        </Link>
      ))}
    </div>
  );
}
