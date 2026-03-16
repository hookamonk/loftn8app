"use client";

export function PaymentSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: "CARD" | "CASH") => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 px-4 pb-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0d0d0d] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white">A staff member will come to you with a terminal or the bill.</div>

        <button
          className="mt-3 w-full rounded-3xl bg-white px-4 py-3 text-sm font-semibold text-black"
          onClick={() => onPick("CARD")}
        >
          Card (terminal)
        </button>

        <button
          className="mt-2 w-full rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white"
          onClick={() => onPick("CASH")}
        >
          Cash
        </button>

        <button
          className="mt-3 w-full rounded-3xl border border-white/10 bg-transparent px-4 py-3 text-sm font-semibold text-white/70"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}