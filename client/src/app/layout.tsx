import "./globals.css";
import { AppProvider } from "@/providers/app";
import { Manrope } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { getVenueName } from "@/lib/venue";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

const venueName = getVenueName(process.env.NEXT_PUBLIC_VENUE_SLUG);

export const metadata: Metadata = {
  title: venueName,
  applicationName: venueName,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: venueName,
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#070707",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text)] antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
