"use client";

import { StaffGuard } from "@/components/staff/StaffGuard";
import { StaffShell } from "@/components/staff/StaffShell";

export default function StaffAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffGuard>
      <StaffShell>{children}</StaffShell>
    </StaffGuard>
  );
}

