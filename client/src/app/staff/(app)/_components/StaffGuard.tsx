"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStaffSummary } from "@/lib/staffApi";

export default function StaffGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await getStaffSummary();
      if (!r.ok) {
        router.replace("/staff/login");
        return;
      }
      setOk(true);
    })();
  }, [router]);

  if (!ok) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-gray-500">Checking session…</div>
      </main>
    );
  }

  return <>{children}</>;
}
