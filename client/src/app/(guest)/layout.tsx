import { Suspense } from "react";
import { BottomNav } from "@/components/BottomNav";
import { CartBar } from "@/components/CartBar";
import { GuestBranchGuard } from "@/components/GuestBranchGuard";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GuestBranchGuard />
      <Suspense fallback={null}>
        <div className="pb-28">{children}</div>
      </Suspense>
      <CartBar />
      <BottomNav />
    </>
  );
}
