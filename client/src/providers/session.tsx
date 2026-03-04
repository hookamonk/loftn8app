"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { storage } from "@/lib/storage";

type SessionState = {
  tableCode: string | null;
  setTableCode: (code: string | null) => void;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [tableCode, _setTableCode] = useState<string | null>(() => storage.get("tableCode", null as any));

  const setTableCode = (code: string | null) => {
    _setTableCode(code);
    if (code) storage.set("tableCode", code);
    else storage.del("tableCode");
  };

  const value = useMemo(() => ({ tableCode, setTableCode }), [tableCode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
