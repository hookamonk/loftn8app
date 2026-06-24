import type { Metadata } from "next";
import { StaffSessionProvider } from "@/providers/staffSession";

// Separate PWA identity for staff: "Add to Home Screen" from any /staff page
// installs an app that launches straight into the staff dashboard
// (start_url "/staff/login") with its own icon, instead of the guest landing.
// Push is origin-wide, so it works either way — this just gives staff a
// dedicated entry point.
export const metadata: Metadata = {
  title: "LOFT№8 Staff",
  applicationName: "LOFT№8 Staff",
  manifest: "/staff.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LOFT№8 Staff",
  },
};

export default function StaffRootLayout({ children }: { children: React.ReactNode }) {
  return <StaffSessionProvider>{children}</StaffSessionProvider>;
}
