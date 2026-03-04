import "./globals.css";
import { AppProvider } from "@/providers/app";
import { Manrope } from "next/font/google";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata = { title: "Loft N8 Pilot" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text)] antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
