import "./globals.css";
import { AppProvider } from "@/providers/app";
import { ZoomLock } from "@/components/ZoomLock";
import { Manrope } from "next/font/google";
import type { Metadata, Viewport } from "next";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

const APP_NAME = "LOFT№8";

export const metadata: Metadata = {
  title: APP_NAME,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  icons: {
    icon: "/logo.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  // Fixed scale: no auto-zoom when a field gets focus, no pinch / double-tap
  // zoom. Together with <ZoomLock /> this holds on iOS Safari as well.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text)] antialiased" suppressHydrationWarning>
        <ZoomLock />
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
