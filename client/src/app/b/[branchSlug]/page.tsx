"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { refreshVenueCatalog, resolveVenueSlug, setVenueSlug } from "@/lib/venue";

export default function BranchEntryPage() {
  const params = useParams<{ branchSlug: string }>();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      await refreshVenueCatalog();
      if (cancelled) return;

      const branchSlug = decodeURIComponent(params.branchSlug);
      const resolved = resolveVenueSlug(branchSlug);

      if (!resolved) {
        router.replace("/");
        return;
      }

      setVenueSlug(resolved);
      router.replace("/auth");
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [params.branchSlug, router]);

  return null;
}
