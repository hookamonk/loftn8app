"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "./session";
import { AuthProvider } from "./auth";
import { CartProvider } from "./cart";
import { ToastProvider } from "./toast";
import { GuestFeedProvider } from "./guestFeed";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStaffSurface = pathname.startsWith("/staff");

  if (isStaffSurface) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <SessionProvider>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <GuestFeedProvider>
              {children}
            </GuestFeedProvider>
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
