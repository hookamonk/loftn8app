"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { refreshVenueCatalog, resolveVenueSlug, setVenueSlug } from "@/lib/venue";

export default function BranchTableEntryPage() {
  const params = useParams<{ branchSlug: string; tableCode: string }>();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      await refreshVenueCatalog();
      if (cancelled) return;

      const branchSlug = decodeURIComponent(params.branchSlug);
      const tableCode = decodeURIComponent(params.tableCode);
      const resolved = resolveVenueSlug(branchSlug);

      if (!resolved) {
        router.replace("/");
        return;
      }

      setVenueSlug(resolved);
      router.replace(`/t/${encodeURIComponent(tableCode)}`);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [params.branchSlug, params.tableCode, router]);

  return null;
}
