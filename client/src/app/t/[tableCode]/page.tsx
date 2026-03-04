"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/providers/session";

function normalizeToCode(raw: string) {
  const v = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d+$/.test(v)) return `T${v}`;
  if (v.startsWith("T") && /^\d+$/.test(v.slice(1))) return v;
  return v; // fallback
}

export default function TableEntry() {
  const params = useParams<{ tableCode: string }>();
  const router = useRouter();
  const { setTableCode } = useSession();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const raw = decodeURIComponent(params.tableCode);
        const tableCode = normalizeToCode(raw);

        await api("/guest/session", {
          method: "POST",
          body: JSON.stringify({ tableCode }),
        });

        setTableCode(tableCode);
        router.replace("/menu");
      } catch (e: any) {
        setErr(e?.message ?? "Failed to create session");
      }
    };
    void run();
  }, [params.tableCode, router, setTableCode]);

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-bold">Starting session…</h1>
      {err ? <p className="mt-3 rounded-lg border bg-white p-3 text-sm text-red-600">{err}</p> : null}
    </main>
  );
}