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
import { MaintenanceGate } from "@/components/MaintenanceGate";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStaffSurface = pathname.startsWith("/staff");
  const isMaintenancePage = pathname === "/maintenance";

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

  // The maintenance screen renders without the guest session/auth/feed
  // providers (nothing to redirect it away) — just i18n + the language switch.
  if (isMaintenancePage) {
    return (
      <I18nProvider>
        <ToastProvider>
          <LanguageSwitch />
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
              <MaintenanceGate />
              <LanguageSwitch />
              {children}
            </GuestFeedProvider>
          </ToastProvider>
        </AuthProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
