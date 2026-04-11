"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasVenueSelection } from "@/lib/venue";

export function GuestBranchGuard() {
  const router = useRouter();

  useEffect(() => {
    if (!hasVenueSelection()) {
      router.replace("/");
    }
  }, [router]);

  return null;
}
