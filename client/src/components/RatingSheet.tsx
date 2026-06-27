"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/providers/i18n";
import { useEscapeToClose } from "@/lib/useModalA11y";

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const stars = useMemo(() => [1, 2, 3, 4, 5], []);
  return (
    <div className="flex gap-2">
      {stars.map((s) => (
        <button
          key={s}
          type="button"
          className={[
            "h-10 w-10 rounded-2xl border text-sm font-semibold transition",
            s <= value ? "border-white/10 bg-white text-black" : "border-white/10 bg-white/5 text-white",
          ].join(" ")}
          onClick={() => onChange(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function RatingSheet({
  open,
  onClose,
  onSubmit,
  googleReviewUrl,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: { food: number; drinks: number; hookah: number; comment?: string }) => void;
  googleReviewUrl?: string;
}) {
  const { isCz } = useI18n();
  const [food, setFood] = useState(5);
  const [drinks, setDrinks] = useState(5);
  const [hookah, setHookah] = useState(5);
  const [comment, setComment] = useState("");
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[96] flex items-end justify-center bg-black/70 px-4 pb-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-bold text-white">{isCz ? "Hodnocení" : "Rating"}</div>
        <div className="mt-1 text-xs text-white/60">
          {isCz ? "Pomáhá nám to zlepšovat servis." : "This helps us improve the service."}
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="text-xs text-white/65">{isCz ? "Jídlo" : "Food"}</div>
            <div className="mt-2"><Stars value={food} onChange={setFood} /></div>
          </div>
          <div>
            <div className="text-xs text-white/65">{isCz ? "Nápoje" : "Drinks"}</div>
            <div className="mt-2"><Stars value={drinks} onChange={setDrinks} /></div>
          </div>
          <div>
            <div className="text-xs text-white/65">{isCz ? "Vodní dýmka" : "Hookah"}</div>
            <div className="mt-2"><Stars value={hookah} onChange={setHookah} /></div>
          </div>

          <div>
            <div className="text-xs text-white/65">{isCz ? "Poznámka" : "Comment"}</div>
            <textarea
              className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none"
              placeholder={isCz ? "1–2 věty (volitelné)" : "1–2 sentences (optional)"}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </div>

        <button
          className="mt-4 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black"
          onClick={() => {
            onSubmit({ food, drinks, hookah, comment: comment.trim() || undefined });
            onClose();
          }}
        >
          {isCz ? "Odeslat hodnocení" : "Submit rating"}
        </button>

        {googleReviewUrl ? (
          <a
            className="mt-2 block w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-center text-sm font-semibold text-white"
            href={googleReviewUrl}
            target="_blank"
            rel="noreferrer"
          >
            {isCz ? "Zanechat recenzi na Googlu" : "Leave a review on Google"}
          </a>
        ) : null}

        <button
          className="mt-3 w-full rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/70"
          onClick={onClose}
        >
          {isCz ? "Zavřít" : "Close"}
        </button>
      </div>
    </div>
  );
}
