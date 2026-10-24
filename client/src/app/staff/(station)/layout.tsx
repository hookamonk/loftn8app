"use client";

import { StaffGuard } from "@/components/staff/StaffGuard";

// Station iPads (kitchen / bar / hookah zone) get one full-screen view and
// none of the floor navigation.
export default function StaffStationLayout({ children }: { children: React.ReactNode }) {
  return <StaffGuard>{children}</StaffGuard>;
}
