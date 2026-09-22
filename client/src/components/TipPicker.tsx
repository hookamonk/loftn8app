"use client";

import { useState } from "react";
import { useI18n } from "@/providers/i18n";

/**
 * Tip selector used at payment time: none · 5 % · 10 % · custom amount.
 * The percentages are taken from the bill BEFORE cashback, rounded to whole
 * crowns. The parent owns the choice; this component only renders it.
 */

export type TipMode = "none" | "5" | "10" | "custom";
export type TipChoice = { mode: TipMode; customCzk: number };

export const NO_TIP: TipChoice = { mode: "none", customCzk: 0 };
export const TIP_MAX_CZK = 100_000;

function percentOf(billCzk: number, percent: number) {
  return Math.max(Math.round((Math.max(billCzk, 0) * percent) / 100), 0);
}

export function tipCzkFromChoice(choice: TipChoice, billCzk: number): number {
  if (choice.mode === "5") return percentOf(billCzk, 5);
  if (choice.mode === "10") return percentOf(billCzk, 10);
  if (choice.mode === "custom") return Math.min(Math.max(Math.round(choice.customCzk) || 0, 0), TIP_MAX_CZK);
  return 0;
}

/** Reverse mapping for a tip that already exists on the server. */
export function choiceFromTip(tipCzk: number, billCzk: number): TipChoice {
  const tip = Math.max(Math.round(tipCzk) || 0, 0);
  if (tip <= 0) return NO_TIP;
  if (tip === percentOf(billCzk, 5)) return { mode: "5", customCzk: 0 };
  if (tip === percentOf(billCzk, 10)) return { mode: "10", customCzk: 0 };
  return { mode: "custom", customCzk: tip };
}

export function TipPicker({
  billCzk,
  value,
  onChange,
  disabled,
}: {
  billCzk: number;
  value: TipChoice;
  onChange: (choice: TipChoice) => void;
  disabled?: boolean;
}) {
  const { isCz } = useI18n();
  const [draft, setDraft] = useState(value.mode === "custom" && value.customCzk > 0 ? String(value.customCzk) : "");

  const tipCzk = tipCzkFromChoice(value, billCzk);

  const options: Array<{ mode: TipMode; label: string }> = [
    { mode: "none", label: isCz ? "Bez" : "None" },
    { mode: "5", label: "5 %" },
    { mode: "10", label: "10 %" },
    { mode: "custom", label: isCz ? "Jiná" : "Other" },
  ];

  const pick = (mode: TipMode) => {
    if (disabled) return;
    if (mode === "custom") {
      onChange({ mode: "custom", customCzk: Number(draft) || 0 });
      return;
    }
    onChange({ mode, customCzk: 0 });
  };

  const onDraft = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, "").slice(0, 6);
    setDraft(digits);
    onChange({ mode: "custom", customCzk: Number(digits) || 0 });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm text-white/70">
        <span>{isCz ? "Spropitné" : "Tip"}</span>
        <span className="font-semibold text-white">{tipCzk > 0 ? `+${tipCzk} Kč` : "—"}</span>
      </div>

      <div className="mt-2 flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
        {options.map((option) => {
          const active = value.mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              disabled={disabled}
              onClick={() => pick(option.mode)}
              className={[
                "h-8 flex-1 rounded-lg text-xs font-semibold transition disabled:cursor-default",
                active ? "bg-white text-black" : "text-white/60 hover:text-white",
              ].join(" ")}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {value.mode === "custom" ? (
        <label className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 focus-within:border-white/25">
          <input
            value={draft}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            autoFocus
            disabled={disabled}
            onChange={(event) => onDraft(event.target.value)}
            className="h-full w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
          <span className="shrink-0 text-sm text-white/50">Kč</span>
        </label>
      ) : null}
    </div>
  );
}
