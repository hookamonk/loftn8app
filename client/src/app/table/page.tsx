"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { GuestQrEntry } from "@/components/GuestQrEntry";

function TablePageContent() {
  const searchParams = useSearchParams();
  const guestBypass = searchParams.get("guest") === "1";

  return <GuestQrEntry guestBypass={guestBypass} />;
}

export default function TablePage() {
  return (
    <Suspense fallback={null}>
      <TablePageContent />
    </Suspense>
  );
}
