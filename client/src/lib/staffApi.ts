import type { StaffSession, StaffRole } from "@/providers/staffSession";
import { ensureBackendWarm } from "@/lib/backendWarmup";
import { getStaffVenueSlug } from "@/lib/venue";

const API_BASE = "/api";
const RETRYABLE_STATUS = new Set([502, 503, 504]);
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  const venueSlug = typeof window !== "undefined" ? getStaffVenueSlug() : undefined;

  if (method !== "GET") {
    await ensureBackendWarm();
  }

  if (method === "GET") {
    const key = requestKey(path, init, venueSlug);
    const existing = inFlightGetRequests.get(key) as Promise<ApiResult<T>> | undefined;
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      try {
        return await performFetchJson<T>(path, init, maxAttempts, venueSlug);
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
  venueSlug?: string
): Promise<ApiResult<T>> {

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const requestPath =
        String(init?.method ?? "GET").toUpperCase() === "GET" ? withNoStoreQuery(path) : path;
      const res = await fetch(`${API_BASE}${requestPath}`, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
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
        await sleep(retryDelay(attempt));
        continue;
      }
      return { ok: false, error: "NETWORK_ERROR", status: 0 };
    }
  }

  return { ok: false, error: "NETWORK_ERROR", status: 0 };
}

async function tryPaths<T>(paths: string[], init?: RequestInit): Promise<ApiResult<T>> {
  let last: ApiResult<T> | null = null;

  for (const p of paths) {
    const r = await fetchJson<T>(p, init);
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
export type StaffSummary = {
  newOrders: number;
  newCalls: number;
  pendingPayments: number;
  shift?: {
    id: string;
    openedAt: string;
  };
};

export async function getStaffSummary(): Promise<ApiResult<StaffSummary>> {
  const r = await tryPaths<{
    ok: true;
    shift?: { id: string; openedAt: string };
    newOrders: number;
    newCalls: number;
    pendingPayments: number;
  }>(["/staff/dashboard/summary", "/staff/summary"], {
    method: "GET",
  });

  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      shift: r.data.shift,
      newOrders: r.data.newOrders,
      newCalls: r.data.newCalls,
      pendingPayments: r.data.pendingPayments,
    },
  };
}

export type OrderStatus = "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
export type CallStatus = "NEW" | "ACKED" | "DONE";
export type PaymentStatus = "PENDING" | "CONFIRMED" | "CANCELLED";
export type CallType = "WAITER" | "HOOKAH" | "BILL" | "HELP";
export type PaymentMethod = "CARD" | "CASH";

export type StaffOrder = {
  id: string;
  status: OrderStatus;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  table: { code: string; label: string | null };
  session: { id: string; user: { id: string; name: string; phone: string } | null };
  items: Array<{
    id: string;
    qty: number;
    comment: string | null;
    priceCzk: number;
    menuItem: { id: number; name: string };
  }>;
};

export type StaffOrderRequest = {
  id: string;
  status: CallStatus;
  createdAt: string;
  table: { id: number; code: string; label: string | null };
  session: { id: string; user: { id: string; name: string; phone: string } | null };
  items?: Array<{ menuItemId: number; name: string; qty: number; priceCzk: number }>;
};

export async function listOrders(status: OrderStatus): Promise<ApiResult<{ orders: StaffOrder[] }>> {
  return tryPaths<{ ok: true; orders: StaffOrder[] }>(
    [`/staff/dashboard/orders?status=${status}`, `/staff/orders?status=${status}`],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { orders: r.data.orders } } : r));
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [`/staff/dashboard/orders/${id}/status`, `/staff/orders/${id}/status`],
    { method: "PATCH", body: JSON.stringify({ status }) }
  );
}

export async function cancelOrderItem(
  orderId: string,
  itemId: string
): Promise<ApiResult<{ ok: true; orderCancelled: boolean }>> {
  return tryPaths<{ ok: true; orderCancelled: boolean }>(
    [
      `/staff/dashboard/orders/${orderId}/items/${itemId}/cancel`,
      `/staff/orders/${orderId}/items/${itemId}/cancel`,
    ],
    { method: "POST" }
  );
}

export async function listOrderRequests(): Promise<ApiResult<{ requests: StaffOrderRequest[] }>> {
  return tryPaths<{ ok: true; requests: StaffOrderRequest[] }>(
    ["/staff/dashboard/order-requests"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { requests: r.data.requests } } : r));
}

export async function connectOrderRequest(id: string): Promise<ApiResult<{ request: StaffOrderRequest }>> {
  return tryPaths<{ ok: true; request: StaffOrderRequest }>(
    [`/staff/dashboard/order-requests/${id}/connect`],
    { method: "POST", body: JSON.stringify({}) }
  ).then((r) => (r.ok ? { ok: true, data: { request: r.data.request } } : r));
}

export async function createTableOrder(payload: {
  tableId: number;
  sessionId: string;
  requestId?: string;
  comment?: string;
  items: Array<{ menuItemId: number; qty: number; comment?: string }>;
}): Promise<ApiResult<any>> {
  return tryPaths<any>(
    ["/staff/dashboard/table-orders"],
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export type StaffCall = {
  id: string;
  status: CallStatus;
  type: CallType;
  message: string | null;
  createdAt: string;
  table: { code: string; label: string | null };
  session: { id: string; user: { id: string; name: string; phone: string } | null };
};

export async function listCalls(status: CallStatus): Promise<ApiResult<{ calls: StaffCall[] }>> {
  return tryPaths<{ ok: true; calls: StaffCall[] }>(
    [`/staff/dashboard/calls?status=${status}`, `/staff/calls?status=${status}`],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { calls: r.data.calls } } : r));
}

export async function updateCallStatus(id: string, status: CallStatus): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    [`/staff/dashboard/calls/${id}/status`, `/staff/calls/${id}/status`],
    { method: "PATCH", body: JSON.stringify({ status }) }
  );
}

export type StaffPayment = {
  id: string;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
  billTotalCzk: number;
  paidAmountCzk: number;
  requestedAmountCzk: number;
  useLoyalty: boolean;
  loyaltyAppliedCzk: number;
  table: { code: string; label: string | null };
  session: {
    id: string;
    userId: string | null;
    user: { id: string; name: string; phone: string } | null;
  };
  items: Array<{
    orderItemId: string;
    menuItemId: number;
    name: string;
    qty: number;
    unitPriceCzk: number;
    totalCzk: number;
    comment?: string;
  }>;
};

export type StaffActiveTable = {
  table: { id: number; code: string; label: string | null };
  session: {
    id: string;
    startedAt: string;
    user: { id: string; name: string; phone: string } | null;
  };
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
    user: { id: string; name: string; phone: string } | null;
  };
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

export async function listPayments(status: PaymentStatus): Promise<ApiResult<{ payments: StaffPayment[] }>> {
  return tryPaths<{ ok: true; payments: StaffPayment[] }>(
    [`/staff/dashboard/payments?status=${status}`, `/staff/payments?status=${status}`],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { payments: r.data.payments } } : r));
}

export async function listActiveTables(): Promise<ApiResult<{ tables: StaffActiveTable[] }>> {
  return tryPaths<{ ok: true; tables: StaffActiveTable[] }>(["/staff/dashboard/tables"], {
    method: "GET",
  }).then((r) => (r.ok ? { ok: true, data: { tables: r.data.tables } } : r));
}

export async function getActiveTableDetails(
  tableId: number
): Promise<ApiResult<{ table: StaffActiveTableDetails }>> {
  return tryPaths<{ ok: true } & StaffActiveTableDetails>(
    [`/staff/dashboard/tables/${tableId}`],
    { method: "GET" }
  ).then((r) =>
    r.ok
      ? {
          ok: true,
          data: {
            table: {
              table: r.data.table,
              session: r.data.session,
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
  return tryPaths<any>(
    [`/staff/dashboard/tables/${tableId}/request-payment`],
    { method: "POST", body: JSON.stringify({ method }) }
  );
}

export async function disconnectActiveTable(
  tableId: number
): Promise<ApiResult<{ sessionId: string; endedAt: string }>> {
  return tryPaths<{ ok: true; sessionId: string; endedAt: string }>(
    [`/staff/dashboard/tables/${tableId}/disconnect`],
    { method: "POST", body: JSON.stringify({}) }
  ).then((r) =>
    r.ok ? { ok: true, data: { sessionId: r.data.sessionId, endedAt: r.data.endedAt } } : r
  );
}

export async function confirmPayment(id: string): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/confirm`, `/staff/payments/${id}/confirm`],
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function changePaymentMethod(id: string, method: PaymentMethod): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/method`, `/staff/payments/${id}/method`],
    { method: "POST", body: JSON.stringify({ method }) }
  );
}

export async function cancelPayment(id: string): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/cancel`, `/staff/payments/${id}/cancel`],
    { method: "POST", body: JSON.stringify({}) }
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
  avgOverall: number | null;
  avgFood: number | null;
  avgDrinks: number | null;
  avgHookah: number | null;
  byVenue: AdminVenueStat[];
};

export type AdminUserItem = {
  id: string;
  name: string;
  phone: string;
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
