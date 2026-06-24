"use client";

import React, { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "./session";
import { AuthProvider } from "./auth";
import { ToastProvider } from "./toast";
import { GuestFeedProvider } from "./guestFeed";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import { I18nProvider } from "./i18n";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStaffSurface = pathname.startsWith("/staff");

  useEffect(() => {
    void ensureBackendWarm();
  }, [pathname]);

  if (isStaffSurface) {
    return (
      <I18nProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider>
      <SessionProvider>
        <AuthProvider>
          <ToastProvider>
            <GuestFeedProvider>
              <LanguageSwitch />
              {children}
            </GuestFeedProvider>
          </ToastProvider>
        </AuthProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
