"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DevTablePage() {
  const [code, setCode] = useState("T1");
  const router = useRouter();

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-gray-500">Dev</div>
        <h1 className="text-xl font-bold">Выбор стола</h1>

        <input
          className="mt-3 w-full rounded-2xl border bg-white px-4 py-3 text-sm outline-none"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Например T1"
        />

        <button
          className="mt-3 w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white"
          onClick={() => router.push(`/menu?table=${encodeURIComponent(code.trim())}`)}
        >
          Открыть меню для стола
        </button>

        <div className="mt-3 text-xs text-gray-500">
          Открой: <span className="font-mono">/dev/table</span>
        </div>
      </div>
    </main>
  );
}
