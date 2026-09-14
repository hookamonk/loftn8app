import { Suspense } from "react";
import { BottomNav } from "@/components/BottomNav";
import { GuestBranchGuard } from "@/components/GuestBranchGuard";
import { PostPaymentPrompt } from "@/components/PostPaymentPrompt";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GuestBranchGuard />
      <Suspense fallback={null}>
        <div className="pb-28">{children}</div>
      </Suspense>
      <BottomNav />
      <PostPaymentPrompt />
    </>
  );
}
