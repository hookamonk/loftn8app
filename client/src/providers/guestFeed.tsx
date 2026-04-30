"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useSession } from "@/providers/session";
import type { ToastKind } from "@/providers/toast";

type FeedTone = ToastKind;

export type GuestFeedOrder = {
  id: string;
  status: "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  totalCzk: number;
  step: number;
  statusTitle: string;
  statusDescription: string;
  statusTone: FeedTone;
  items: Array<{
    id: string;
    qty: number;
    comment: string | null;
    priceCzk: number;
    totalCzk: number;
    menuItem: { id: number; name: string };
  }>;
};

export type GuestFeedCall = {
  id: string;
  type: "WAITER" | "HOOKAH" | "BILL" | "HELP";
  typeLabel: string;
  status: "NEW" | "ACKED" | "DONE";
  message: string | null;
  createdAt: string;
  updatedAt: string;
  statusTitle: string;
  statusDescription: string;
  statusTone: FeedTone;
};

export type GuestFeedPayment = {
  id: string;
  sessionId: string | null;
  isMine: boolean;
  method: "CARD" | "CASH";
  methodLabel: string;
  useLoyalty: boolean;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  createdAt: string;
  confirmedAt: string | null;
  billTotalCzk: number | null;
  amountCzk: number | null;
  loyaltyAppliedCzk: number;
  items: Array<{
    orderItemId: string;
    menuItemId: number;
    name: string;
    qty: number;
    unitPriceCzk: number;
    totalCzk: number;
    comment?: string;
  }>;
  statusTitle: string;
  statusDescription: string;
  statusTone: FeedTone;
};

export type GuestFeedOrderRequest = {
  id: string;
  status: "NEW" | "ACKED" | "DONE";
  createdAt: string;
  updatedAt: string;
  statusTitle: string;
  statusDescription: string;
  statusTone: FeedTone;
};

export type GuestFeedHistory = {
  id: string;
  method: "CARD" | "CASH";
  methodLabel: string;
  amountCzk: number;
  closedAt: string;
  orderCount: number;
  itemCount: number;
  items: Array<{
    key: string;
    name: string;
    qty: number;
    totalCzk: number;
    comment?: string;
  }>;
};

export type GuestFeed = {
  currentSessionId: string;
  table: { id: number; code: string; label: string | null };
  totals: {
    orderedTotalCzk: number;
    confirmedPaidCzk: number;
    dueCzk: number;
  };
  loyalty: {
    availableCzk: number;
    pendingCzk: number;
    nextAvailableAt: string | null;
    cashbackPercent: number;
  };
  orderRequest: GuestFeedOrderRequest | null;
  orders: GuestFeedOrder[];
  history: GuestFeedHistory[];
  calls: GuestFeedCall[];
  payments: GuestFeedPayment[];
};

type GuestFeedState = {
  feed: GuestFeed | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<GuestFeedState | null>(null);

function isGuestSurface(pathname: string) {
  return pathname === "/cart" || pathname === "/call" || pathname === "/profile";
}

export function GuestFeedProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sessionReady, clearSession } = useSession();
  const [feed, setFeed] = useState<GuestFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const enabled = sessionReady && isGuestSurface(pathname);
  const waitingForStaffOrder =
    enabled &&
    pathname === "/cart" &&
    Boolean(feed?.orderRequest && (feed.orderRequest.status === "NEW" || feed.orderRequest.status === "ACKED")) &&
    (feed?.orders?.length ?? 0) === 0;
  const hasActiveOrders = Boolean(
    feed?.orders?.some((order) => order.status === "NEW" || order.status === "ACCEPTED" || order.status === "IN_PROGRESS")
  );
  const hasActiveCalls = Boolean(feed?.calls?.some((call) => call.status === "NEW" || call.status === "ACKED"));
  const hasPendingPayments = Boolean(feed?.payments?.some((payment) => payment.status === "PENDING"));
  const hasActiveOrderRequest = Boolean(
    feed?.orderRequest && (feed.orderRequest.status === "NEW" || feed.orderRequest.status === "ACKED")
  );
  const liveActivity = enabled && (hasActiveOrderRequest || hasActiveOrders || hasActiveCalls || hasPendingPayments);

  const refresh = async (opts?: { silent?: boolean }) => {
    if (!enabled) {
      setFeed(null);
      return;
    }

    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }

    const silent = opts?.silent ?? false;

    const run = (async () => {
      if (!silent) setLoading(true);

      try {
        const next = await api<{
          ok: true;
          currentSessionId: string;
          table: GuestFeed["table"];
          totals: GuestFeed["totals"];
          loyalty: GuestFeed["loyalty"];
          orderRequest: GuestFeed["orderRequest"];
          orders: GuestFeed["orders"];
          history: GuestFeed["history"];
          calls: GuestFeed["calls"];
          payments: GuestFeed["payments"];
        }>("/guest/feed");

        const nextFeed: GuestFeed = {
          currentSessionId: next.currentSessionId,
          table: next.table,
          totals: next.totals,
          loyalty: next.loyalty,
          orderRequest: next.orderRequest,
          orders: next.orders,
          history: next.history,
          calls: next.calls,
          payments: next.payments,
        };

        setFeed(nextFeed);
      } catch (e: any) {
        const message = String(e?.message ?? "");
        const sessionExpired =
          message.includes("Guest session is required") ||
          message.includes("Invalid guest session token") ||
          message.includes("Session not found or ended");

        if (sessionExpired) {
          setFeed(null);
          clearSession({ redirect: true });
        } else if (!silent) {
          setFeed(null);
        }
      } finally {
        if (!silent) setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    await run;
  };

  const { tick } = usePolling(() => refresh({ silent: true }), {
    enabled,
    activeMs: waitingForStaffOrder ? 800 : liveActivity ? 1500 : 10000,
    idleMs: waitingForStaffOrder ? 2000 : liveActivity ? 3500 : 20000,
    immediate: false,
  });

  useEffect(() => {
    if (!enabled) return;
    if (!waitingForStaffOrder && !liveActivity) return;
    void tick();
  }, [enabled, waitingForStaffOrder, liveActivity, tick]);

  useEffect(() => {
    if (!enabled) {
      setFeed(null);
      return;
    }

    void refresh();
  }, [enabled]);

  const value = useMemo(() => ({ feed, loading, refresh }), [feed, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuestFeed() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGuestFeed must be used within GuestFeedProvider");
  return ctx;
}
