import { BottomNav } from "@/components/BottomNav";
import { CartBar } from "@/components/CartBar";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-28">{children}</div>
      <CartBar />
      <BottomNav />
    </>
  );
}