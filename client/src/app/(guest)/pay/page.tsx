"use client";

import { useState } from "react";
import { api } from "@/lib/api";

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`text-2xl ${n <= value ? "" : "opacity-30"}`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function PayPage() {
  const [step, setStep] = useState<"pay" | "rate">("pay");
  const [status, setStatus] = useState<string | null>(null);

  const [overall, setOverall] = useState(5);
  const [food, setFood] = useState(5);
  const [drinks, setDrinks] = useState(5);
  const [hookah, setHookah] = useState(5);
  const [comment, setComment] = useState("");

  const requestPay = async (method: "CARD" | "CASH") => {
    setStatus(null);
    try {
      await api("/payments/request", { method: "POST", body: JSON.stringify({ method }) });
      setStep("rate");
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? "Failed"}`);
    }
  };

  const sendRating = async () => {
    setStatus(null);
    try {
      await api("/ratings", {
        method: "POST",
        body: JSON.stringify({
          overall,
          food,
          drinks,
          hookah,
          comment: comment || undefined,
        }),
      });
      setStatus("✅ Thanks! Rating sent.");
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? "Failed"}`);
    }
  };

  return (
    <main className="mx-auto max-w-md p-4 pb-24">
      <h1 className="text-xl font-bold">Payment</h1>

      {step === "pay" ? (
        <div className="mt-4 space-y-3">
          <button className="w-full rounded-xl bg-black px-4 py-3 text-left text-white" onClick={() => requestPay("CARD")}>
            Pay by card (Terminal)
          </button>
          <button className="w-full rounded-xl border bg-white px-4 py-3 text-left" onClick={() => requestPay("CASH")}>
            Pay by cash (call staff)
          </button>
          {status ? <div className="text-sm">{status}</div> : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border bg-white p-4">
          <div className="text-sm font-semibold">Rate your visit</div>

          <div className="mt-3 text-sm">Overall</div>
          <Stars value={overall} onChange={setOverall} />

          <div className="mt-3 text-sm">Food</div>
          <Stars value={food} onChange={setFood} />

          <div className="mt-3 text-sm">Drinks</div>
          <Stars value={drinks} onChange={setDrinks} />

          <div className="mt-3 text-sm">Hookah</div>
          <Stars value={hookah} onChange={setHookah} />

          <textarea
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <button className="mt-3 w-full rounded-lg bg-black px-3 py-2 text-white" onClick={sendRating}>
            Send rating
          </button>

          {status ? <div className="mt-3 text-sm">{status}</div> : null}
        </div>
      )}
    </main>
  );
}