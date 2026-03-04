"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AuthMeResponse } from "@/types";

type AuthState = {
  loading: boolean;
  me: AuthMeResponse;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<AuthMeResponse>({ authenticated: false });

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api<AuthMeResponse>("/auth/guest/me");
      setMe(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(() => ({ loading, me, refresh }), [loading, me]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
