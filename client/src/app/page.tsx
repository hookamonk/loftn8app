"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GuestQrEntry } from "@/components/GuestQrEntry";

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const table = (searchParams.get("table") ?? "").trim();
    if (table) {
      router.replace(`/t/${encodeURIComponent(table)}`);
    }
  }, [router, searchParams]);

  return <GuestQrEntry />;
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  );
}
