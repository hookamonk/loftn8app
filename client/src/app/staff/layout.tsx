import { StaffSessionProvider } from "@/providers/staffSession";

export default function StaffRootLayout({ children }: { children: React.ReactNode }) {
  return <StaffSessionProvider>{children}</StaffSessionProvider>;
}
