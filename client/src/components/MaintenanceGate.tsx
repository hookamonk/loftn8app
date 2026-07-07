"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MAINTENANCE_MODE } from "@/lib/maintenance";

/**
 * While maintenance mode is on, every guest-side route (incl. the QR entry
 * pages) is redirected to /maintenance. Staff routes and /maintenance itself
 * are never touched. Mounted only in the guest provider branch.
 */
export function MaintenanceGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!MAINTENANCE_MODE) return;
    if (pathname === "/maintenance") return;
    if (pathname.startsWith("/staff")) return;
    router.replace("/maintenance");
  }, [pathname, router]);

  return null;
}
