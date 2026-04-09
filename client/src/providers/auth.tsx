"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { AuthMeResponse } from "@/types";

type AuthState = {
  loading: boolean;
  me: AuthMeResponse;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStaffSurface = pathname.startsWith("/staff");
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<AuthMeResponse>({ authenticated: false });
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = async () => {
    if (isStaffSurface) {
      setMe({ authenticated: false });
      setLoading(false);
      return;
    }

    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }

    setLoading(true);

    const run = (async () => {
      try {
        const data = await api<AuthMeResponse>("/auth/guest/me");
        setMe(data);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    await run;
  }; 

  useEffect(() => {
    if (isStaffSurface) {
      setMe({ authenticated: false });
      setLoading(false);
      return;
    }
    void refresh();
  }, [isStaffSurface]);

  const value = useMemo(() => ({ loading, me, refresh }), [loading, me]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
