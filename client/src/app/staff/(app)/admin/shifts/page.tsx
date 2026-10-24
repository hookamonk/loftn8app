"use client";

import { useCallback, useEffect, useState } from "react";
import { listShiftReports, type AdminVenueScope, type ShiftSummaryRow } from "@/lib/staffApi";
import { useStaffSession } from "@/providers/staffSession";
import { ShiftReportList } from "@/components/staff/ShiftReportList";
import { money } from "@/lib/shiftReportFormat";

/** Admin: every venue's shifts with card / cash totals; tap a shift for its full report. */

const VENUES: Array<{ key: AdminVenueScope; label: string }> = [
  { key: "all", label: "Все точки" },
  { key: "zizkov", label: "Žižkov" },
  { key: "garden", label: "Garden" },
  { key: "nekazanka", label: "Nekázanka" },
];

export default function AdminShiftsPage() {
  const { staff } = useStaffSession();
  const [venue, setVenue] = useState<AdminVenueScope>("all");
  const [shifts, setShifts] = useState<ShiftSummaryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setShifts(null);
    const r = await listShiftReports(venue);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setShifts(r.data.shifts);
  }, [venue]);

  useEffect(() => {
    void load();
  }, [load]);

  if (staff?.role !== "ADMIN") {
    return <div className="text-sm text-white/55">Доступ только для администратора.</div>;
  }

  const closed = (shifts ?? []).filter((s) => s.status === "CLOSED");
  const total = (key: "cardCzk" | "cashCzk" | "totalCzk") => closed.reduce((sum, s) => sum + s[key], 0);

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex flex-wrap gap-2">
        {VENUES.map((v) => (
          <button
            key={v.key}
            onClick={() => setVenue(v.key)}
            className={[
              "h-10 rounded-xl border px-4 text-sm font-semibold transition",
              v.key === venue ? "border-white/20 bg-white text-black" : "border-white/10 bg-white/5 text-white/70",
            ].join(" ")}
          >
            {v.label}
          </button>
        ))}
      </div>

      {err ? <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{err}</div> : null}

      {shifts && closed.length ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Карта", total("cardCzk")],
            ["Наличные", total("cashCzk")],
            ["Всего", total("totalCzk")],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">{label}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-white">{money(value as number)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-white/[0.05] p-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
          Смены{shifts ? ` · ${shifts.length}` : ""}
        </div>
        <div className="mt-1">
          {shifts ? <ShiftReportList shifts={shifts} showVenue={venue === "all"} /> : <div className="text-sm text-white/50">Загрузка…</div>}
        </div>
      </div>
    </div>
  );
}
