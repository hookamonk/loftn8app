import "./globals.css";
import { AppProvider } from "@/providers/app";
import { Manrope } from "next/font/google";
import type { Metadata, Viewport } from "next";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loft N8 Pilot",
  applicationName: "Loft N8",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Loft N8",
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
