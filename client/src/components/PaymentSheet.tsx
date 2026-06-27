"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/providers/i18n";
import { useEscapeToClose } from "@/lib/useModalA11y";

function QtyInline({
  qty,
  onMinus,
  onPlus,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="flex h-11 items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-1.5">
      <button
        type="button"
        aria-label="−"
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg text-white active:bg-white/15"
        onClick={onMinus}
      >
        −
      </button>
      <div className="w-8 text-center text-sm font-semibold text-white">{qty}</div>
      <button
        type="button"
        aria-label="+"
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-lg text-white active:bg-white/15"
        onClick={onPlus}
      >
        +
      </button>
    </div>
  );
}

export function PaymentSheet({
  open,
  onClose,
  onPick,
  onSelectAll,
  availablePointsCzk = 0,
  useLoyalty,
  onToggleLoyalty,
  items = [],
  selectedQtyByKey = {},
  selectedTotalCzk = 0,
  cashbackAppliedCzk = 0,
  finalPayableCzk = 0,
  onChangeSelectedQty,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: "CARD" | "CASH") => void;
  onSelectAll?: () => void;
  availablePointsCzk?: number;
  useLoyalty: boolean;
  onToggleLoyalty: (next: boolean) => void;
  items?: Array<{
    key: string;
    name: string;
    comment?: string;
    availableQty: number;
    unitPriceCzk: number;
    totalCzk: number;
  }>;
  selectedQtyByKey?: Record<string, number>;
  selectedTotalCzk?: number;
  cashbackAppliedCzk?: number;
  finalPayableCzk?: number;
  onChangeSelectedQty?: (key: string, qty: number) => void;
}) {
  const { isCz } = useI18n();
  const [step, setStep] = useState<"select" | "method">("select");
  const [query, setQuery] = useState("");
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (open) {
      setStep("select");
      setQuery("");
    }
  }, [open]);

  const selectedItemsCount = useMemo(
    () => items.reduce((sum, item) => sum + Math.max(selectedQtyByKey[item.key] ?? 0, 0), 0),
    [items, selectedQtyByKey]
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => {
      const haystack = `${item.name} ${item.comment ?? ""}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-4 pb-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "select" ? (
          <>
            <div className="text-sm font-semibold text-white">{isCz ? "Vyberte položky k platbě" : "Choose items to pay"}</div>

            {items.length ? (
              <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{isCz ? "Sdílená objednávka stolu" : "Shared table order"}</div>
                  <div className="text-sm font-semibold text-white">{selectedTotalCzk} Kč</div>
                </div>

                <input
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 outline-none"
                  placeholder={isCz ? "Najít jídlo nebo nápoj…" : "Find a dish or drink…"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                <div className="mt-3 max-h-[34vh] space-y-2 overflow-y-auto pr-1">
                  {filteredItems.map((item) => {
                    const qty = selectedQtyByKey[item.key] ?? 0;
                    return (
                      <div
                        key={item.key}
                        className={[
                          "rounded-2xl border p-3 transition",
                          qty > 0
                            ? "border-sky-400/30 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.12)]"
                            : "border-white/10 bg-black/20",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className={["text-sm font-medium", qty > 0 ? "text-sky-50" : "text-white"].join(" ")}>
                              {item.name}
                            </div>
                            {item.comment ? (
                              <div className={["mt-1 text-[11px]", qty > 0 ? "text-sky-100/70" : "text-white/45"].join(" ")}>
                                {item.comment}
                              </div>
                            ) : null}
                            <div className={["mt-1 text-[11px]", qty > 0 ? "text-sky-100/75" : "text-white/50"].join(" ")}>
                              {isCz
                                ? `${item.availableQty} k dispozici • ${item.unitPriceCzk} Kč za kus`
                                : `${item.availableQty} available • ${item.unitPriceCzk} Kč each`}
                            </div>
                            {qty > 0 ? (
                              <div className="mt-2 inline-flex rounded-full border border-sky-400/25 bg-sky-500/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100">
                                {isCz ? "Vybráno" : "Selected"}
                              </div>
                            ) : null}
                          </div>

                          <div className="w-[112px] shrink-0">
                            <QtyInline
                              qty={qty}
                              onMinus={() => onChangeSelectedQty?.(item.key, Math.max(qty - 1, 0))}
                              onPlus={() => onChangeSelectedQty?.(item.key, Math.min(qty + 1, item.availableQty))}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {filteredItems.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/55">
                    {isCz ? "Pro toto hledání nebylo nic nalezeno." : "Nothing found for this search."}
                  </div>
                ) : null}

                <div className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-500/8 px-3 py-2 text-xs text-sky-100/85">
                  {isCz
                    ? `Vybráno: ${selectedItemsCount} ${selectedItemsCount === 1 ? "položka" : selectedItemsCount >= 2 && selectedItemsCount <= 4 ? "položky" : "položek"} • ${selectedTotalCzk} Kč`
                    : `Selected: ${selectedItemsCount} item${selectedItemsCount === 1 ? "" : "s"} • ${selectedTotalCzk} Kč`}
                </div>
              </div>
            ) : null}

            <button
              disabled={!items.length}
              className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
              onClick={() => {
                onSelectAll?.();
                setStep("method");
              }}
            >
              {isCz ? "Zaplatit vše" : "Pay all"}
            </button>

            <button
              disabled={selectedTotalCzk <= 0}
              className="mt-2 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
              onClick={() => setStep("method")}
            >
              {isCz ? "Vybrat a zaplatit" : "Select and pay"}
            </button>

            <button
              className="mt-3 w-full rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/70"
              onClick={onClose}
            >
              {isCz ? "Zavřít" : "Close"}
            </button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-white">{isCz ? "Zvolte způsob platby" : "Choose how you want to pay"}</div>

            <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3 text-sm text-white/70">
                <span>{isCz ? "Vybrané položky" : "Selected items"}</span>
                <span className="font-semibold text-white">{selectedItemsCount}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-white/70">
                <span>{isCz ? "Celkem" : "Bill total"}</span>
                <span className="font-semibold text-white">{selectedTotalCzk} Kč</span>
              </div>
              {useLoyalty && cashbackAppliedCzk > 0 ? (
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-gold/90">
                  <span>{isCz ? "Použitý cashback" : "Cashback used"}</span>
                  <span className="font-semibold">{cashbackAppliedCzk} Kč</span>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-white/70">
                <span>{isCz ? "K úhradě" : "To pay"}</span>
                <span className="font-semibold text-white">{finalPayableCzk} Kč</span>
              </div>
            </div>

            {availablePointsCzk > 0 ? (
              <button
                className={[
                  "mt-3 w-full rounded-3xl border px-4 py-3 text-left text-sm transition",
                  useLoyalty
                    ? "border-gold/20 bg-gold/10 text-amber-50"
                    : "border-white/10 bg-white/5 text-white",
                ].join(" ")}
                onClick={() => onToggleLoyalty(!useLoyalty)}
              >
                <div className="font-semibold">
                  {useLoyalty ? (isCz ? "Používáte cashback" : "Using cashback") : isCz ? "Použít cashback" : "Use cashback"}
                </div>
                <div className="mt-1 text-xs opacity-75">{isCz ? `${availablePointsCzk} Kč k dispozici` : `${availablePointsCzk} Kč available`}</div>
              </button>
            ) : (
              <div className="mt-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/55">
                {isCz ? "Cashback bude dostupný po půlnoci" : "Cashback available after midnight"}
              </div>
            )}

            <button
              disabled={selectedTotalCzk <= 0}
              className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
              onClick={() => onPick("CARD")}
            >
              {isCz ? "Karta (terminál)" : "Card (terminal)"}
            </button>

            <button
              disabled={selectedTotalCzk <= 0}
              className="mt-2 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
              onClick={() => onPick("CASH")}
            >
              {isCz ? "Hotově" : "Cash"}
            </button>

            <button
              disabled
              className="mt-2 w-full rounded-3xl border border-dashed border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/35"
            >
              Apple Pay {isCz ? "(již brzy)" : "(coming soon)"}
            </button>

            <div className="mt-3 flex gap-3">
              <button
                className="flex-1 rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/70"
                onClick={() => setStep("select")}
              >
                {isCz ? "Zpět" : "Back"}
              </button>
              <button
                className="flex-1 rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/70"
                onClick={onClose}
              >
                {isCz ? "Zavřít" : "Close"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
