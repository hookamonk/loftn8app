import type { StaffSession, StaffRole } from "@/providers/staffSession";

const API_BASE = "/api";

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiOk<T> | ApiErr;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
    return { ok: false, error: msg, status: res.status };
  }

  return { ok: true, data: json as T };
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

// --------- AUTH ----------
export async function staffLogin(
  username: string,
  password: string
): Promise<ApiResult<{ staff: StaffSession }>> {
  const r = await tryPaths<{
    ok: true;
    staff: { id: string; role: StaffRole; venueId: number; username: string };
  }>(["/staff/auth/login", "/staff/login"], {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  if (!r.ok) return r;

  return { ok: true, data: { staff: r.data.staff } };
}

export async function getStaffMe(): Promise<ApiResult<{ staff: StaffSession }>> {
  const r = await tryPaths<{
    ok: true;
    staff: { id: string; role: StaffRole; venueId: number; username: string } | null;
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

// --------- SHIFT ----------
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
  return tryPaths<{ ok: true; shift: ActiveShift | null }>(
    ["/staff/shift/current"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { shift: r.data.shift } } : r));
}

export async function openShift(): Promise<ApiResult<{ shift: ActiveShift }>> {
  return tryPaths<{ ok: true; shift: ActiveShift }>(
    ["/staff/shift/open"],
    { method: "POST" }
  ).then((r) => (r.ok ? { ok: true, data: { shift: r.data.shift } } : r));
}

export async function joinShift(): Promise<ApiResult<{ shiftId: string }>> {
  return tryPaths<{ ok: true; shiftId: string }>(
    ["/staff/shift/join"],
    { method: "POST" }
  ).then((r) => (r.ok ? { ok: true, data: { shiftId: r.data.shiftId } } : r));
}

export async function leaveShift(): Promise<ApiResult<{ ok: true }>> {
  return tryPaths<{ ok: true }>(
    ["/staff/shift/leave"],
    { method: "POST" }
  );
}

export async function closeShift(): Promise<ApiResult<{ shiftId: string; closedAt: string }>> {
  return tryPaths<{ ok: true; shiftId: string; closedAt: string }>(
    ["/staff/shift/close"],
    { method: "POST" }
  ).then((r) =>
    r.ok
      ? { ok: true, data: { shiftId: r.data.shiftId, closedAt: r.data.closedAt } }
      : r
  );
}

// --------- DASHBOARD ----------
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
export type StaffRoleExtended = "WAITER" | "HOOKAH" | "MANAGER" | "ADMIN";

export type StaffOrder = {
  id: string;
  status: OrderStatus;
  comment: string | null;
  createdAt: string;
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
  table: { code: string; label: string | null };
  session: {
    id: string;
    userId: string | null;
    user: { id: string; name: string; phone: string } | null;
  };
};

export async function listPayments(status: PaymentStatus): Promise<ApiResult<{ payments: StaffPayment[] }>> {
  return tryPaths<{ ok: true; payments: StaffPayment[] }>(
    [`/staff/dashboard/payments?status=${status}`, `/staff/payments?status=${status}`],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { payments: r.data.payments } } : r));
}

export async function confirmPayment(id: string, amountCzk: number): Promise<ApiResult<any>> {
  return tryPaths<any>(
    [`/staff/dashboard/payments/${id}/confirm`, `/staff/payments/${id}/confirm`],
    { method: "POST", body: JSON.stringify({ amountCzk }) }
  );
}

// --------- ADMIN ----------
export type AdminSummary = {
  usersCount: number;
  ordersCount: number;
  callsCount: number;
  ratingsCount: number;
  confirmedPaymentsCount: number;
  totalRevenueCzk: number;
  avgOverall: number | null;
  avgFood: number | null;
  avgDrinks: number | null;
  avgHookah: number | null;
  shiftsTotal: number;
  openShift: {
    id: string;
    openedAt: string;
    openedByManagerId: string;
  } | null;
};

export type AdminShiftItem = {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  openedByManager?: { id: string; username: string; role: StaffRole };
  closedByManager?: { id: string; username: string; role: StaffRole } | null;
  participants: Array<{
    id: string;
    staffId: string;
    role: StaffRole;
    joinedAt: string;
    leftAt: string | null;
    isActive: boolean;
    staff?: { id: string; username: string; role: StaffRole };
  }>;
  guestSessions?: Array<{ id: string }>;
};

export type AdminRatingItem = {
  id: string;
  overall: number;
  food: number | null;
  drinks: number | null;
  hookah: number | null;
  comment: string | null;
  createdAt: string;
  table: { id: number; code: string; label: string | null };
  session: {
    id: string;
    shiftId: string | null;
    user: { id: string; name: string; phone: string } | null;
  };
};

export type AdminUserItem = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string;
  privacyAcceptedAt: string | null;
  createdAt: string;
};

export type AdminStaffPerformanceItem = {
  id: string;
  username: string;
  role: StaffRole;
  createdAt: string;
  shiftsJoined: number;
  confirmedPaymentsCount: number;
  confirmedPaymentsSumCzk: number;
};

export async function getAdminSummary(): Promise<ApiResult<{ summary: AdminSummary }>> {
  return tryPaths<{ ok: true; summary: AdminSummary }>(
    ["/staff/admin/summary"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { summary: r.data.summary } } : r));
}

export async function getAdminShifts(): Promise<ApiResult<{ shifts: AdminShiftItem[] }>> {
  return tryPaths<{ ok: true; shifts: AdminShiftItem[] }>(
    ["/staff/admin/shifts"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { shifts: r.data.shifts } } : r));
}

export async function getAdminRatings(): Promise<ApiResult<{ ratings: AdminRatingItem[] }>> {
  return tryPaths<{ ok: true; ratings: AdminRatingItem[] }>(
    ["/staff/admin/ratings"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { ratings: r.data.ratings } } : r));
}

export async function getAdminUsers(): Promise<ApiResult<{ users: AdminUserItem[] }>> {
  return tryPaths<{ ok: true; users: AdminUserItem[] }>(
    ["/staff/admin/users"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { users: r.data.users } } : r));
}

export async function getAdminStaffPerformance(): Promise<ApiResult<{ staff: AdminStaffPerformanceItem[] }>> {
  return tryPaths<{ ok: true; staff: AdminStaffPerformanceItem[] }>(
    ["/staff/admin/staff-performance"],
    { method: "GET" }
  ).then((r) => (r.ok ? { ok: true, data: { staff: r.data.staff } } : r));
}