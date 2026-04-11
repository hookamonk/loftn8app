"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { storage } from "@/lib/storage";
import { api } from "@/lib/api";
import { getVenueSlug, setVenueSlug, VENUE_CHANGE_EVENT } from "@/lib/venue";

type GuestSessionMeResponse =
  | {
      ok: true;
      session: {
        id: string;
        table: { id: number; code: string; label: string | null };
        venue?: { id: number | null; slug: string | null; name: string | null } | null;
        shift: { id: string; status: string; openedAt: string; closedAt: string | null } | null;
        startedAt: string;
      };
    }
  | {
      ok: false;
      session: null;
      expired?: boolean;
    };

type SessionState = {
  tableCode: string | null;
  setTableCode: (code: string | null) => void;
  clearSession: () => void;
  sessionReady: boolean;
  sessionError: string | null;
  restoreSession: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

const TABLE_KEY = "tableCode";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [tableCode, _setTableCode] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const restoreInFlightRef = useRef(false);

  const setTableCode = (code: string | null) => {
    _setTableCode(code);
    setSessionReady(false);
    setSessionError(null);
    if (code) storage.set(TABLE_KEY, code);
    else storage.del(TABLE_KEY);
  };

  const clearSession = () => {
    _setTableCode(null);
    setSessionReady(false);
    setSessionError("No table selected");
    storage.del(TABLE_KEY);
  };

  const restoreSession = async () => {
    if (restoreInFlightRef.current) return;
    restoreInFlightRef.current = true;

    try {
      setSessionError(null);

      const savedCode = storage.get(TABLE_KEY, null as string | null);
      if (savedCode && savedCode !== tableCode) {
        _setTableCode(savedCode);
      }

      // 1) пробуем использовать существующую guest session
      try {
        const guestSession = await api<GuestSessionMeResponse>("/guest/me");
        if (guestSession.ok && guestSession.session) {
          const actualCode = guestSession.session.table.code;
          const actualVenueSlug = guestSession.session.venue?.slug;
          if (actualVenueSlug) {
            setVenueSlug(actualVenueSlug);
          }
          if (actualCode && actualCode !== tableCode) {
            _setTableCode(actualCode);
            storage.set(TABLE_KEY, actualCode);
          }
          setSessionReady(true);
          return;
        }
        if (guestSession.expired) {
          clearSession();
          return;
        }
      } catch {
        // ignore
      }

      // 2) если есть tableCode — восстанавливаем session молча
      const code = savedCode ?? tableCode;
      if (code) {
        try {
          const created = await api<{
            ok: true;
            session: {
              table: { code: string };
              venue?: { slug: string | null } | null;
            };
          }>("/guest/session", {
            method: "POST",
            body: JSON.stringify({ tableCode: code, venueSlug: getVenueSlug() }),
          });
          const actualCode = created.session.table.code;
          const actualVenueSlug = created.session.venue?.slug;
          if (actualVenueSlug) {
            setVenueSlug(actualVenueSlug);
          }
          if (actualCode && actualCode !== tableCode) {
            _setTableCode(actualCode);
            storage.set(TABLE_KEY, actualCode);
          }
          setSessionReady(true);
          return;
        } catch (e: any) {
          storage.del(TABLE_KEY);
          _setTableCode(null);
          setSessionError(e?.message ?? "Failed to restore table session");
        }
      } else {
        setSessionError("No table selected");
      }

      setSessionReady(false);
    } finally {
      restoreInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const savedCode = storage.get(TABLE_KEY, null as string | null);
    if (savedCode) {
      _setTableCode(savedCode);
    }
    void restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tableCode) return;
    if (sessionReady) return;
    if (restoreInFlightRef.current) return;
    void restoreSession();
  }, [tableCode, sessionReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onVenueChange = (event: Event) => {
      const detail = (event as CustomEvent<{ prevSlug?: string | null; slug?: string | null }>).detail;
      const prevSlug = detail?.prevSlug ?? null;
      const nextSlug = detail?.slug ?? null;

      if (prevSlug && nextSlug && prevSlug !== nextSlug) {
        clearSession();
      }
    };

    window.addEventListener(VENUE_CHANGE_EVENT, onVenueChange as EventListener);
    return () => window.removeEventListener(VENUE_CHANGE_EVENT, onVenueChange as EventListener);
  }, []);

  const value = useMemo(
    () => ({
      tableCode,
      setTableCode,
      clearSession,
      sessionReady,
      sessionError,
      restoreSession,
    }),
    [tableCode, sessionReady, sessionError]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
