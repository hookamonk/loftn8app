import type { StaffSession, StaffRole } from "@/providers/staffSession";
import type { MenuSection } from "@/types";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import { getStaffVenueSlug } from "@/lib/venue";
import { getStaffDeviceId } from "@/lib/staffDevice";
import { markOwnAlerts } from "@/lib/staffOwnAlerts";

const API_BASE = "/api";
const RETRYABLE_STATUS = new Set([502, 503, 504]);
// Light lists the screens refresh all the time: a read that hangs (lost packet
// on venue Wi-Fi) is cut off and retried, it must never freeze a screen until
// the browser gives up on its own (~30 s+). Heavy reads (reports) have no limit.
const LIST_TIMEOUT_MS = 6000;
const inFlightGetRequests = new Map<string, Promise<ApiResult<unknown>>>();

function retryDelay(attempt: number) {
  return Math.min(1200 * attempt, 4000);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestKey(path: string, init?: RequestInit, venueSlug?: string) {
  const headers = {
    "Content-Type": "application/json",
    ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
    ...(init?.headers || {}),
  };

  return JSON.stringify({
    path,
    method: "GET",
    headers: Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)),
  });
}

function withNoStoreQuery(path: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}__ts=${Date.now()}`;
}

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export type AdminRange = "all" | "today" | "week" | "month";
export type AdminVenueScope = "all" | "zizkov" | "garden" | "nekazanka";

function withQuery(path: string, params?: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v) sp.set(k, v);
  });
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export type FetchOpts = {
  /**
   * Start a new request even if the same one is already running: after an
   * alert the screen needs data read AFTER the change, not a request that
   * left before it.
   */
  fresh?: boolean;
  /** Cut off and retry a read that takes longer than this. */
  timeoutMs?: number;
};

async function fetchJson<T>(path: string, init?: RequestInit, opts?: FetchOpts): Promise<ApiResult<T>> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  const venueSlug = typeof window !== "undefined" ? getStaffVenueSlug() : undefined;

  if (method !== "GET") {
    await ensureBackendWarm();
  }

  if (method === "GET" && opts?.fresh) {
    return performFetchJson<T>(path, init, maxAttempts, venueSlug, opts.timeoutMs);
  }

  if (method === "GET") {
    const key = requestKey(path, init, venueSlug);
    const existing = inFlightGetRequests.get(key) as Promise<ApiResult<T>> | undefined;
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      try {
        return await performFetchJson<T>(path, init, maxAttempts, venueSlug, opts?.timeoutMs);
      } finally {
        inFlightGetRequests.delete(key);
      }
    })();

    inFlightGetRequests.set(key, pending);
    return pending;
  }

  return performFetchJson<T>(path, init, maxAttempts, venueSlug);
}

async function performFetchJson<T>(
  path: string,
  init: RequestInit | undefined,
  maxAttempts: number,
  venueSlug?: string,
  timeoutMs?: number
): Promise<ApiResult<T>> {

  const isGet = String(init?.method ?? "GET").toUpperCase() === "GET";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Reads only: a write is never cut off (it could have reached the server).
    const timeout = isGet && timeoutMs && !init?.signal ? new AbortController() : null;
    const timer = timeout ? window.setTimeout(() => timeout.abort(), timeoutMs) : null;
    try {
      const requestPath = isGet ? withNoStoreQuery(path) : path;
      const res = await fetch(`${API_BASE}${requestPath}`, {
        ...init,
        ...(timeout ? { signal: timeout.signal } : {}),
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
          "X-Staff-Device": getStaffDeviceId(),
          ...(init?.headers || {}),
        },
      });

      const text = await res.text();
      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = (json && (json.message || json.error)) || `HTTP_${res.status}`;

        if (attempt < maxAttempts && RETRYABLE_STATUS.has(res.status)) {
          await sleep(retryDelay(attempt));
          continue;
        }

        return { ok: false, error: msg, status: res.status };
      }

      return { ok: true, data: json as T };
    } catch {
      if (attempt < maxAttempts) {
        // A cut-off read is retried right away; a real network error waits a bit.
        await sleep(timeout?.signal.aborted ? 150 : retryDelay(attempt));
        continue;
      }
      return { ok: false, error: "NETWORK_ERROR", status: 0 };
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  return { ok: false, error: "NETWORK_ERROR", status: 0 };
}

async function tryPaths<T>(paths: string[], init?: RequestInit, opts?: FetchOpts): Promise<ApiResult<T>> {
  let last: ApiResult<T> | null = null;

  for (const p of paths) {
    const r = await fetchJson<T>(p, init, opts);
    last = r;
    if (r.ok) return r;
    if (!r.ok && r.status !== 404) return r;
  }

  return last ?? { ok: false, error: "HTTP_404", status: 404 };
}

// AUTH
export async function staffLogin(
  username: string,
  password: string,
  venueSlug?: string
): Promise<ApiResult<{ staff: StaffSession }>> {
  const r = await tryPaths<{
    ok: true;
    staff: {
      id: string;
      role: StaffRole;
      venueId: number;
      venueSlug?: string;
      venueName?: string;
      username: string;
    };
  }>(["/staff/auth/login", "/staff/login"], {
    method: "POST",
    body: JSON.stringify({ username, password, venueSlug: venueSlug ?? getStaffVenueSlug() }),
  });

  if (!r.ok) return r;
  return { ok: true, data: { staff: r.data.staff } };
}

export async function getStaffMe(): Promise<ApiResult<{ staff: StaffSession }>> {
  const r = await tryPaths<{
    ok: true;
    staff:
      | {
          id: string;
          role: StaffRole;
          venueId: number;
          venueSlug?: string;
          venueName?: string;
          username: string;
        }
      | null;
  }>(["/staff/auth/me"], {
    method: "GET",
  });

  if (!r.ok) return r;
  if (!r.data.staff) return { ok: false, error: "STAFF_UNAUTH", status: 401 };

  return { ok: true, data: { staff: r.data.staff } };
}

export async function staffLogout(): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(["/staff/auth/logout", "/staff/logout"], {
    method: "POST",
  });
}

// SHIFT
export type ShiftParticipant = {
  id: string;
  staffId: string;
  role: StaffRole;
  joinedAt: string;
  leftAt?: string | null;
  isActive?: boolean;
  staff?: {
    id: string;
    username: string;
    role: StaffRole;
  };
};

export type ActiveShift = {
  id: string;
  venueId?: number;
  status?: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt?: string | null;
  participants?: ShiftParticipant[];
};

export async function getCurrentShift(): Promise<ApiResult<{ shift: ActiveShift | null }>> {
  return tryPaths<{ ok: true; shift: ActiveShift | null }>(["/staff/shift/current"], {
    method: "GET",
  }).then((r) => (r.ok ? { ok: true, data: { shift: r.data.shift } } : r));
}

export async function openShift(): Promise<ApiResult<{ shift: ActiveShift }>> {
  return tryPaths<{ ok: true; shift: ActiveShift }>(["/staff/shift/open"], {
    method: "POST",
  }).then((r) => (r.ok ? { ok: true, data: { shift: r.data.shift } } : r));
}

export async function joinShift(): Promise<ApiResult<{ shiftId: string }>> {
  return tryPaths<{ ok: true; shiftId: string }>(["/staff/shift/join"], {
    method: "POST",
  }).then((r) => (r.ok ? { ok: true, data: { shiftId: r.data.shiftId } } : r));
}

export async function closeShift(): Promise<ApiResult<{ shiftId: string; closedAt: string }>> {
  return tryPaths<{ ok: true; shiftId: string; closedAt: string }>(["/staff/shift/close"], {
    method: "POST",
  }).then((r) =>
    r.ok ? { ok: true, data: { shiftId: r.data.shiftId, closedAt: r.data.closedAt } } : r
  );
}

// DASHBOARD
/** Something this account was alerted about and is still waiting (see the summary). */
export type StaffOpenAlert = { tag: string; kind: string; tableCode: string; station?: MenuSection | null };

export type StaffSummary = {
  newOrders: number;
  ticketsToAccept?: number;
  ticketsToDeliver?: number;
  newCalls: number;
  pendingPayments: number;
  alerts?: StaffOpenAlert[];
  shift?: {
    id: string;
    openedAt: string;
  };
};

export async function getStaffSummary(opts?: FetchOpts): Promise<ApiResult<StaffSummary>> {
  const r = await tryPaths<{
    ok: true;
    shift?: { id: string; openedAt: string };
    newOrders: number;
    ticketsToAccept?: number;
    ticketsToDeliver?: number;
    newCalls: number;
    pendingPayments: number;
    alerts?: StaffOpenAlert[];
  }>(
    ["/staff/dashboard/summary", "/staff/summary"],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  );

  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      shift: r.data.shift,
      newOrders: r.data.newOrders,
      ticketsToAccept: r.data.ticketsToAccept,
      ticketsToDeliver: r.data.ticketsToDeliver,
      newCalls: r.data.newCalls,
      pendingPayments: r.data.pendingPayments,
      alerts: r.data.alerts,
    },
  };
}

export type OrderStatus = "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
export type CallStatus = "NEW" | "ACKED" | "DONE";
export type PaymentStatus = "PENDING" | "CONFIRMED" | "CANCELLED";
export type CallType = "WAITER" | "HOOKAH" | "BILL" | "HELP";
export type PaymentMethod = "CARD" | "CASH";

export type StaffOrderRequest = {
  id: string;
  status: CallStatus;
  createdAt: string;
  table: { id: number; code: string; label: string | null };
  session: { id: string; user: { id: string; name: string; phone: string | null } | null };
  items?: Array<{ menuItemId: number; name: string; qty: number; priceCzk: number }>;
};

export async function listOrderRequests(opts?: FetchOpts): Promise<ApiResult<{ requests: StaffOrderRequest[] }>> {
  return tryPaths<{ ok: true; requests: StaffOrderRequest[] }>(
    ["/staff/dashboard/order-requests"],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  ).then((r) => (r.ok ? { ok: true, data: { requests: r.data.requests } } : r));
}

export async function connectOrderRequest(id: string): Promise<ApiResult<{ request: StaffOrderRequest }>> {
  return tryPaths<{ ok: true; request: StaffOrderRequest }>(
    [`/staff/dashboard/order-requests/${id}/connect`],
    { method: "POST", body: JSON.stringify({}) }
  ).then((r) => (r.ok ? { ok: true, data: { request: r.data.request } } : r));
}

export async function dismissOrderRequest(id: string): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>([`/staff/dashboard/order-requests/${id}/done`], {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function createTableOrder(payload: {
  tableId: number;
  sessionId: string;
  requestId?: string;
  comment?: string;
  items: Array<{ menuItemId: number; qty: number; comment?: string }>;
}): Promise<ApiResult<any>> {
  const r = await tryPaths<any>(
    ["/staff/dashboard/table-orders"],
    { method: "POST", body: JSON.stringify(payload) }
  );
  // My own order: no "new order" sound for it on this device.
  if (r.ok && Array.isArray(r.data?.ticketIds)) markOwnAlerts(r.data.ticketIds.map((id: string) => `ticket:${id}`));
  return r;
}

// STATION TICKETS — one per station (kitchen / bar / hookah) per send.
export type TicketStatus = "NEW" | "ACCEPTED" | "READY" | "SERVED" | "CANCELLED";
export type TicketAction = "accept" | "ready" | "served";

export type StationTicket = {
  id: string;
  orderId: string;
  station: MenuSection;
  status: TicketStatus;
  isAddon: boolean;
  createdAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  cancelledAt: string | null;
  /** Busy hours: when the station promised it (null on a normal day). */
  etaAt?: string | null;
  etaMinutes?: number | null;
  table: { id: number; code: string; label: string | null };
  items: Array<{
    id: string;
    orderId: string;
    menuItemId: number;
    name: string;
    /** Czech dish name — what the kitchen tablet shows. */
    nameCs?: string | null;
    qty: number;
    comment: string | null;
    priceCzk: number;
  }>;
  cancellations: Array<{
    id: string;
    name: string;
    nameCs?: string | null;
    qty: number;
    comment: string | null;
    reason: string | null;
    createdAt: string;
  }>;
};

export async function listTickets(
  view: "active" | "served" = "active",
  opts?: FetchOpts
): Promise<ApiResult<{ tickets: StationTicket[] }>> {
  return tryPaths<{ ok: true; tickets: StationTicket[] }>(
    [`/staff/tickets?view=${view}`],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  ).then((r) => (r.ok ? { ok: true, data: { tickets: r.data.tickets } } : r));
}

export async function moveTicket(
  id: string,
  action: TicketAction
): Promise<ApiResult<{ changed: boolean; status: TicketStatus }>> {
  // I mark it ready: no "ready" sound for it on this device.
  if (action === "ready") markOwnAlerts([`ticket_ready:${id}`]);
  return tryPaths<{ ok: true; changed: boolean; status: TicketStatus }>([`/staff/tickets/${id}/${action}`], {
    method: "POST",
    body: JSON.stringify({}),
  }).then((r) => (r.ok ? { ok: true, data: { changed: r.data.changed, status: r.data.status } } : r));
}

/** Station (or anyone who prepares it): ready in `minutes` (10–40); null clears it. */
export async function setTicketEta(
  id: string,
  minutes: number | null
): Promise<ApiResult<{ etaAt: string | null; etaMinutes: number | null; accepted: boolean }>> {
  return tryPaths<{ ok: true; etaAt: string | null; etaMinutes: number | null; accepted: boolean }>(
    [`/staff/tickets/${id}/eta`],
    { method: "POST", body: JSON.stringify({ minutes }) }
  ).then((r) =>
    r.ok ? { ok: true, data: { etaAt: r.data.etaAt, etaMinutes: r.data.etaMinutes, accepted: r.data.accepted } } : r
  );
}

/** Manager only: take `qty` (default: all) of a line off the order. */
export async function cancelOrderItem(
  orderId: string,
  itemId: string,
  body: { qty?: number; reason?: string }
): Promise<ApiResult<{ orderCancelled: boolean; cancelledQty: number }>> {
  return tryPaths<{ ok: true; orderCancelled: boolean; cancelledQty: number }>(
    [`/staff/dashboard/orders/${orderId}/items/${itemId}/cancel`],
    { method: "POST", body: JSON.stringify(body) }
  ).then((r) =>
    r.ok ? { ok: true, data: { orderCancelled: r.data.orderCancelled, cancelledQty: r.data.cancelledQty } } : r
  );
}

export type StaffCall = {
  id: string;
  status: CallStatus;
  type: CallType;
  message: string | null;
  createdAt: string;
  table: { id: number; code: string; label: string | null };
  session: { id: string; user: { id: string; name: string; phone: string | null } | null };
};

export async function listCalls(status: CallStatus, opts?: FetchOpts): Promise<ApiResult<{ calls: StaffCall[] }>> {
  return tryPaths<{ ok: true; calls: StaffCall[] }>(
    [`/staff/dashboard/calls?status=${status}`, `/staff/calls?status=${status}`],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  ).then((r) => (r.ok ? { ok: true, data: { calls: r.data.calls } } : r));
}

export async function updateCallStatus(id: string, status: CallStatus): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [`/staff/dashboard/calls/${id}/status`, `/staff/calls/${id}/status`],
    { method: "PATCH", body: JSON.stringify({ status }) }
  );
}

export type StaffActiveTable = {
  table: { id: number; code: string; label: string | null };
  session: {
    id: string;
    startedAt: string;
    user: { id: string; name: string; phone: string | null } | null;
  };
  /** Everyone signed in at the table (a table can have several open sessions). */
  guests?: string[];
  isActive: boolean;
  openItemsCount: number;
  activeCallsCount: number;
  pendingPaymentsCount: number;
  lastActivityAt: string;
  capabilities: {
    canDisconnect: boolean;
    disconnectBlockedReason: string | null;
  };
};

export type StaffActiveTableDetails = {
  table: { id: number; code: string; label: string | null };
  session: {
    id: string;
    startedAt: string;
    user: { id: string; name: string; phone: string | null } | null;
  };
  /** Everyone signed in at the table (a table can have several open sessions). */
  guests?: string[];
  orders: Array<{
    id: string;
    status: OrderStatus;
    comment: string | null;
    createdAt: string;
    totalCzk: number;
    items: Array<{
      id: string;
      qty: number;
      comment: string | null;
      priceCzk: number;
      menuItem: { id: number; name: string };
    }>;
  }>;
  payableItems: Array<{
    orderId: string;
    orderItemId: string;
    menuItemId: number;
    name: string;
    qty: number;
    unitPriceCzk: number;
    totalCzk: number;
    comment?: string;
  }>;
  billTotalCzk: number;
  activeCalls: Array<{
    id: string;
    type: CallType;
    status: CallStatus;
    message: string | null;
    createdAt: string;
  }>;
  pendingPayment: null | {
    id: string;
    status: PaymentStatus;
    method: PaymentMethod;
    createdAt: string;
    billTotalCzk: number;
    useLoyalty: boolean;
    loyaltyAppliedCzk: number;
    /** Guest's tip on top of the bill. */
    tipCzk: number;
    /** What to collect: bill − cashback + tip. */
    dueCzk: number;
    selectedItems: Array<{
      orderItemId: string;
      menuItemId: number;
      name: string;
      qty: number;
      unitPriceCzk: number;
      totalCzk: number;
      comment?: string;
    }>;
  };
  capabilities: {
    canAddItems: boolean;
    canSettle: boolean;
    canDisconnect: boolean;
    disconnectBlockedReason: string | null;
  };
};

export async function listActiveTables(opts?: FetchOpts): Promise<ApiResult<{ tables: StaffActiveTable[] }>> {
  return tryPaths<{ ok: true; tables: StaffActiveTable[] }>(
    ["/staff/dashboard/tables"],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  ).then((r) => (r.ok ? { ok: true, data: { tables: r.data.tables } } : r));
}

/** Manager: a chosen line and how many of it. */
export type TableLineChoice = { orderItemId: string; qty: number };
export type TableChoice = { id: number; code: string; busy: boolean; guests: string[] };

/** Manager: every table of the venue to move lines to. */
export async function listTableChoices(): Promise<ApiResult<{ tables: TableChoice[] }>> {
  return tryPaths<{ ok: true; tables: TableChoice[] }>(["/staff/dashboard/tables/choices"], { method: "GET" }).then((r) =>
    r.ok ? { ok: true, data: { tables: r.data.tables } } : r
  );
}

/** Manager: «Удалить» chosen lines (unpaid only). */
export async function cancelTableItems(
  tableId: number,
  lines: TableLineChoice[],
  reason?: string
): Promise<ApiResult<{ cancelled: number }>> {
  return tryPaths<{ ok: true; cancelled: number }>([`/staff/dashboard/tables/${tableId}/items/cancel`], {
    method: "POST",
    body: JSON.stringify({ lines, ...(reason ? { reason } : {}) }),
  }).then((r) => (r.ok ? { ok: true, data: { cancelled: r.data.cancelled } } : r));
}

/** Manager: «Перенести» chosen lines to another table. */
export async function moveTableItems(
  tableId: number,
  toTableId: number,
  lines: TableLineChoice[]
): Promise<ApiResult<{ moved: number; toTable: string }>> {
  return tryPaths<{ ok: true; moved: number; toTable: string }>([`/staff/dashboard/tables/${tableId}/items/move`], {
    method: "POST",
    body: JSON.stringify({ toTableId, lines }),
  }).then((r) => (r.ok ? { ok: true, data: { moved: r.data.moved, toTable: r.data.toTable } } : r));
}

/** «Закрыть стол»: the guests paid and left — free the table (refused while anything is unpaid). */
export async function disconnectTable(tableId: number): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>([`/staff/dashboard/tables/${tableId}/disconnect`], {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getActiveTableDetails(
  tableId: number,
  opts?: FetchOpts
): Promise<ApiResult<{ table: StaffActiveTableDetails }>> {
  return tryPaths<{ ok: true } & StaffActiveTableDetails>(
    [`/staff/dashboard/tables/${tableId}`],
    { method: "GET" },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts }
  ).then((r) =>
    r.ok
      ? {
          ok: true,
          data: {
            table: {
              table: r.data.table,
              session: r.data.session,
              guests: r.data.guests ?? [],
              orders: r.data.orders,
              payableItems: r.data.payableItems,
              billTotalCzk: r.data.billTotalCzk,
              activeCalls: r.data.activeCalls,
              pendingPayment: r.data.pendingPayment,
              capabilities: r.data.capabilities,
            },
          },
        }
      : r
  );
}

export async function requestTablePayment(
  tableId: number,
  method: PaymentMethod
): Promise<ApiResult<any>> {
  const r = await tryPaths<any>(
    [`/staff/dashboard/tables/${tableId}/request-payment`],
    { method: "POST", body: JSON.stringify({ method }) }
  );
  // I asked for the bill myself: no "payment request" sound for it here.
  if (r.ok && r.data?.payment?.id) markOwnAlerts([`payment_pending:${r.data.payment.id}`]);
  return r;
}

export async function confirmPayment(id: string): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/confirm`, `/staff/payments/${id}/confirm`],
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function cancelPayment(id: string): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/cancel`, `/staff/payments/${id}/cancel`],
    { method: "POST", body: JSON.stringify({}) }
  );
}

// SHIFT REPORTS (manager: own venue, admin: all)
type MethodTotals = { count: number; amountCzk: number; tipCzk: number; totalCzk: number };

export type ShiftReport = {
  shift: {
    id: string;
    status: "OPEN" | "CLOSED";
    venueSlug: string;
    venueName: string;
    venueShortName: string;
    openedAt: string;
    closedAt: string | null;
    openedBy: string | null;
    closedBy: string | null;
  };
  money: {
    payments: number;
    card: MethodTotals;
    cash: MethodTotals;
    revenueCzk: number;
    tipsCzk: number;
    totalCollectedCzk: number;
    billTotalCzk: number;
    cashbackCzk: number;
  };
  orders: {
    count: number;
    tickets: number;
    itemsQty: number;
    orderedCzk: number;
    unpaidCzk: number;
    unpaidTables: Array<{ table: string; totalCzk: number }>;
    stations: Array<{
      station: MenuSection;
      itemsQty: number;
      totalCzk: number;
      tickets: number;
      avgAcceptSec: number | null;
      avgReadySec: number | null;
      avgServedSec: number | null;
      notFinished: number;
    }>;
  };
  items: Array<{ menuItemId: number; name: string; station: MenuSection; qty: number; totalCzk: number }>;
  cancellations: {
    count: number;
    totalCzk: number;
    list: Array<{ id: string; at: string; table: string; name: string; qty: number; totalCzk: number; reason: string | null; by: string }>;
  };
  payments: Array<{
    id: string;
    at: string;
    table: string | null;
    method: PaymentMethod;
    billTotalCzk: number;
    cashbackCzk: number;
    amountCzk: number;
    tipCzk: number;
    by: string;
    guest: string | null;
  }>;
};

export type ShiftSummaryRow = {
  id: string;
  status: "OPEN" | "CLOSED";
  venueShortName: string;
  openedAt: string;
  closedAt: string | null;
  cardCzk: number;
  cashCzk: number;
  totalCzk: number;
};

export async function listShiftReports(venue?: AdminVenueScope): Promise<ApiResult<{ shifts: ShiftSummaryRow[] }>> {
  return tryPaths<{ ok: true; shifts: ShiftSummaryRow[] }>(
    [withQuery("/staff/reports/shifts", { venue: venue && venue !== "all" ? venue : undefined })],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { shifts: r.data.shifts } } : r));
}

export async function getShiftReport(id: string): Promise<ApiResult<{ report: ShiftReport }>> {
  return tryPaths<{ ok: true; report: ShiftReport }>([`/staff/reports/shifts/${id}`], { method: "GET" }).then((r) =>
    r.ok ? { ok: true, data: { report: r.data.report } } : r
  );
}

// ADMIN
export type AdminVenueStat = {
  venueId: number;
  slug: string;
  name: string;
  shortName: string;
  usersCount: number;
  revenueCzk: number;
  ratingsCount: number;
  avgOverall: number | null;
};

export type AdminSummary = {
  range: AdminRange;
  scope: string;
  usersCount: number;
  guestSessionsCount: number;
  registeredGuestSessionsCount: number;
  anonymousGuestSessionsCount: number;
  ordersCount: number;
  callsCount: number;
  ratingsCount: number;
  paymentsCount: number;
  totalRevenueCzk: number;
  totalTipsCzk: number;
  avgOverall: number | null;
  avgFood: number | null;
  avgDrinks: number | null;
  avgHookah: number | null;
  byVenue: AdminVenueStat[];
};

export type AdminUserItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  privacyAcceptedAt: string | null;
  createdAt: string;
  bonusCzk: number;
  pendingBonusCzk: number;
};

function venueParam(venue: AdminVenueScope): string | undefined {
  return venue === "all" ? undefined : venue;
}

export async function getAdminSummary(
  range: AdminRange = "all",
  venue: AdminVenueScope = "all"
): Promise<ApiResult<{ summary: AdminSummary }>> {
  return tryPaths<{ ok: true; summary: AdminSummary }>(
    [withQuery("/staff/admin/summary", { range, venue: venueParam(venue) })],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { summary: r.data.summary } } : r));
}

export async function getAdminUsers(
  range: AdminRange = "all",
  venue: AdminVenueScope = "all"
): Promise<ApiResult<{ users: AdminUserItem[] }>> {
  return tryPaths<{ ok: true; users: AdminUserItem[] }>(
    [withQuery("/staff/admin/users", { range, venue: venueParam(venue) })],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { users: r.data.users } } : r));
}

// ===== ADMIN MENU EDITOR =====
export type AdminMenuSection = "DISHES" | "DRINKS" | "HOOKAH";

export type AdminMenuItem = {
  id: number;
  name: string;
  nameCs: string | null;
  description: string | null;
  descriptionCs: string | null;
  priceCzk: number;
  sort: number;
  isActive: boolean;
  /** Only waiters and managers see it; never in the guests' menu. */
  staffOnly: boolean;
  /** Made by another station than its category's (null = the category's). */
  station: AdminMenuSection | null;
  imageUrl: string | null;
  hasOrders: boolean;
};

export type AdminMenuCategory = {
  id: number;
  name: string;
  nameCs: string | null;
  section: AdminMenuSection;
  sort: number;
  items: AdminMenuItem[];
};

export type AdminMenu = {
  venue: { id: number; slug: string; name: string };
  categories: AdminMenuCategory[];
};

// The menu editor always targets ONE explicit venue (never "all").
export type AdminMenuVenue = Exclude<AdminVenueScope, "all">;

export async function getAdminMenu(venue: AdminMenuVenue): Promise<ApiResult<AdminMenu>> {
  return tryPaths<{ ok: true } & AdminMenu>(
    [withQuery("/staff/admin/menu", { venue })],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { venue: r.data.venue, categories: r.data.categories } } : r));
}

export async function createAdminCategory(
  venue: AdminMenuVenue,
  body: { name: string; nameCs?: string; section: AdminMenuSection; sort?: number }
): Promise<ApiResult<{ category: { id: number } }>> {
  return tryPaths<{ ok: true; category: { id: number } }>(
    [withQuery("/staff/admin/menu/categories", { venue })],
    { method: "POST", body: JSON.stringify(body) }
  ).then((r) => (r.ok ? { ok: true, data: { category: r.data.category } } : r));
}

export async function updateAdminCategory(
  venue: AdminMenuVenue,
  id: number,
  body: { name?: string; nameCs?: string | null; section?: AdminMenuSection; sort?: number }
): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [withQuery(`/staff/admin/menu/categories/${id}`, { venue })],
    { method: "PATCH", body: JSON.stringify(body) }
  ).then((r) => (r.ok ? { ok: true, data: { ok: true } } : r));
}

export async function deleteAdminCategory(
  venue: AdminMenuVenue,
  id: number
): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [withQuery(`/staff/admin/menu/categories/${id}`, { venue })],
    { method: "DELETE" }
  ).then((r) => (r.ok ? { ok: true, data: { ok: true } } : r));
}

export async function createAdminItem(
  venue: AdminMenuVenue,
  body: {
    categoryId: number;
    name: string;
    nameCs?: string;
    description?: string;
    descriptionCs?: string;
    priceCzk: number;
    sort?: number;
    isActive?: boolean;
    staffOnly?: boolean;
    station?: AdminMenuSection | null;
  }
): Promise<ApiResult<{ item: { id: number } }>> {
  return tryPaths<{ ok: true; item: { id: number } }>(
    [withQuery("/staff/admin/menu/items", { venue })],
    { method: "POST", body: JSON.stringify(body) }
  ).then((r) => (r.ok ? { ok: true, data: { item: r.data.item } } : r));
}

export async function updateAdminItem(
  venue: AdminMenuVenue,
  id: number,
  body: {
    categoryId?: number;
    name?: string;
    nameCs?: string | null;
    description?: string | null;
    descriptionCs?: string | null;
    priceCzk?: number;
    sort?: number;
    isActive?: boolean;
    staffOnly?: boolean;
    station?: AdminMenuSection | null;
  }
): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [withQuery(`/staff/admin/menu/items/${id}`, { venue })],
    { method: "PATCH", body: JSON.stringify(body) }
  ).then((r) => (r.ok ? { ok: true, data: { ok: true } } : r));
}

export async function deleteAdminItem(
  venue: AdminMenuVenue,
  id: number
): Promise<ApiResult<{ softDeleted: boolean }>> {
  return tryPaths<{ ok: true; softDeleted: boolean }>(
    [withQuery(`/staff/admin/menu/items/${id}`, { venue })],
    { method: "DELETE" }
  ).then((r) => (r.ok ? { ok: true, data: { softDeleted: r.data.softDeleted } } : r));
}
