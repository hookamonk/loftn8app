"use client";

import React from "react";
import { SessionProvider } from "./session";
import { AuthProvider } from "./auth";
import { CartProvider } from "./cart";
import { ToastProvider } from "./toast";
import { GuestFeedProvider } from "./guestFeed";

export function AppProvider({ children }: { children: React.ReactNode }) {
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
