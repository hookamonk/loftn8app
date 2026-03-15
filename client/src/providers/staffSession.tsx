"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type StaffRole = "WAITER" | "HOOKAH" | "MANAGER" | "ADMIN";

export type StaffSession = {
  id: string;
  role: StaffRole;
  venueId: number;
  username: string;
};

type CtxType = {
  staff: StaffSession | null;
  setStaff: (s: StaffSession | null) => void;
  clear: () => void;
};

const Ctx = createContext<CtxType | null>(null);

const KEY = "staff_session_v1";

export function StaffSessionProvider({ children }: { children: React.ReactNode }) {
  const [staff, setStaffState] = useState<StaffSession | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setStaffState(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const setStaff = (s: StaffSession | null) => {
    setStaffState(s);
    try {
      if (!s) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
  };

  const clear = () => setStaff(null);

  const value = useMemo(() => ({ staff, setStaff, clear }), [staff]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaffSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStaffSession must be used within StaffSessionProvider");
  return ctx;
}