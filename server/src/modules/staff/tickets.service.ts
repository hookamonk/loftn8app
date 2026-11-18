import type { MenuSection, OrderStatus, Prisma, StaffRole, TicketStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { publicVenueSlug } from "../../config/venues";
import { HttpError } from "../../utils/httpError";
import { emitGuestEvent } from "../guest/guestEvents";
import { notifyGuestsOrderItemCancelled, notifyGuestsOrderStatus } from "../guest/guestPush.service";
import { paidQtyByOrderItemId, parsePaymentItemsJson } from "../payments/paymentAllocation";
import { emitStaffEvent, type StaffEventKind } from "./staffEvents";
import { pushToVenueRoles, type PushPayload } from "./push.service";
import {
  SECTION_LABEL,
  canCancelItems,
  canDeliver,
  canPrepare,
  deliverRolesFor,
  isStationRole,
  prepareRolesFor,
  ticketSectionsForRole,
} from "./roles";
import { toPublicTable } from "./tableView";

/**
 * Station tickets: every order a waiter or hookah master sends is split into
 * one ticket per station (kitchen / bar / hookah zone).
 *
 *   NEW ──«Принять»──▶ ACCEPTED ──«Готово»──▶ READY ──«Выдано»──▶ SERVED
 *
 * The station accepts and finishes it, the waiter (or hookah master) carries
 * it out. A NEW ticket re-alerts its station every few minutes until someone
 * accepts it. Order.status is derived from the tickets, so the guest side
 * (feed, "you can pay now") keeps working exactly as before.
 */

type Tx = Prisma.TransactionClient;

const SECTION_ORDER: MenuSection[] = ["DISHES", "DRINKS", "HOOKAH"];
const ACTIVE_STATUSES: TicketStatus[] = ["NEW", "ACCEPTED", "READY"];
// A station keeps seeing a cancelled ticket (crossed out) for this long, so a
// card never just vanishes from under the cook.
const CANCELLED_VISIBLE_MS = 10 * 60_000;
const SERVED_LIST_LIMIT = 60;

const READY_TITLE: Record<MenuSection, string> = {
  DISHES: "Еда готова",
  DRINKS: "Напитки готовы",
  HOOKAH: "Кальян готов",
};

/* ------------------------------------------------------------------------ */
/* Order status                                                             */
/* ------------------------------------------------------------------------ */

/** Null = the order only has lines from before station tickets; leave it be. */
export function deriveOrderStatus(ticketStatuses: TicketStatus[], itemCount: number): OrderStatus | null {
  if (itemCount <= 0) return "CANCELLED";
  const live = ticketStatuses.filter((status) => status !== "CANCELLED");
  if (live.length === 0) return null;
  if (live.every((status) => status === "SERVED")) return "DELIVERED";
  if (live.some((status) => status !== "NEW")) return "IN_PROGRESS";
  return "NEW";
}

type OrderStatusChange = {
  orderId: string;
  tableId: number;
  before: OrderStatus;
  after: OrderStatus;
  changed: boolean;
};

/**
 * Re-derive Order.status under a row lock, so two stations finishing the same
 * order at the same moment can never leave it on a stale status.
 */
export async function refreshOrderStatus(tx: Tx, orderId: string): Promise<OrderStatusChange | null> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      tableId: true,
      status: true,
      _count: { select: { items: true } },
      tickets: { select: { status: true } },
    },
  });
  if (!order) return null;

  const next = deriveOrderStatus(
    order.tickets.map((ticket) => ticket.status),
    order._count.items
  );
  if (!next || next === order.status) {
    return { orderId, tableId: order.tableId, before: order.status, after: order.status, changed: false };
  }

  await tx.order.update({ where: { id: orderId }, data: { status: next } });
  return { orderId, tableId: order.tableId, before: order.status, after: next, changed: true };
}

/** Feed refresh + lock-screen push for the guests at the table. */
export function announceOrderStatus(change: OrderStatusChange | null, opts?: { push?: boolean }) {
  if (!change?.changed) return;
  emitGuestEvent(change.tableId, "order-status");
  if (opts?.push === false) return;
  void notifyGuestsOrderStatus(change.orderId, change.after).catch((e) => {
    console.warn("guest push notifyGuestsOrderStatus failed", e);
  });
}

async function refreshAndAnnounce(orderId: string) {
  const change = await prisma.$transaction((tx) => refreshOrderStatus(tx, orderId));
  announceOrderStatus(change);
  return change;
}

/* ------------------------------------------------------------------------ */
/* Creating tickets                                                         */
/* ------------------------------------------------------------------------ */

export type TicketLine = {
  menuItemId: number;
  qty: number;
  comment?: string | null;
  priceCzk: number;
  section: MenuSection;
};

/**
 * Creates the order lines of one send, grouped into one ticket per station.
 * Runs inside the caller's transaction. Returns the new ticket ids.
 */
export async function createStationTickets(
  tx: Tx,
  params: {
    venueId: number;
    tableId: number;
    orderId: string;
    shiftId: string;
    staffId: string;
    lines: TicketLine[];
  }
) {
  const ticketIds: string[] = [];

  for (const station of SECTION_ORDER) {
    const lines = params.lines.filter((line) => line.section === station);
    if (lines.length === 0) continue;

    // "Дозаказ" = this station already got something from the table during
    // the current visit (an earlier party that has left doesn't count).
    const earlier = await tx.stationTicket.count({
      where: {
        tableId: params.tableId,
        shiftId: params.shiftId,
        station,
        status: { not: "CANCELLED" },
        order: { session: { endedAt: null } },
      },
    });

    // Hookah station paused: the hookah just goes on the bill — recorded as
    // served at once, so nothing waits, alerts or reminds anybody.
    const straightToBill = station === "HOOKAH" && !env.HOOKAH_STATION;
    const now = new Date();

    const ticket = await tx.stationTicket.create({
      data: {
        venueId: params.venueId,
        tableId: params.tableId,
        orderId: params.orderId,
        shiftId: params.shiftId,
        station,
        isAddon: earlier > 0,
        createdById: params.staffId,
        ...(straightToBill
          ? {
              status: "SERVED" as const,
              acceptedAt: now,
              acceptedById: params.staffId,
              readyAt: now,
              readyById: params.staffId,
              servedAt: now,
              servedById: params.staffId,
            }
          : {}),
        items: {
          create: lines.map((line) => ({
            orderId: params.orderId,
            menuItemId: line.menuItemId,
            qty: line.qty,
            comment: line.comment?.trim() || null,
            priceCzk: line.priceCzk,
          })),
        },
      },
      select: { id: true },
    });

    ticketIds.push(ticket.id);
  }

  return ticketIds;
}

/* ------------------------------------------------------------------------ */
/* Reading tickets                                                          */
/* ------------------------------------------------------------------------ */

const ticketSelect = {
  id: true,
  venueId: true,
  orderId: true,
  station: true,
  status: true,
  isAddon: true,
  createdAt: true,
  acceptedAt: true,
  readyAt: true,
  servedAt: true,
  cancelledAt: true,
  etaAt: true,
  etaMinutes: true,
  table: { select: { id: true, code: true, label: true } },
  venue: { select: { slug: true } },
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      orderId: true,
      qty: true,
      comment: true,
      priceCzk: true,
      menuItem: { select: { id: true, name: true, nameCs: true } },
    },
  },
  cancellations: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      qty: true,
      comment: true,
      reason: true,
      createdAt: true,
      menuItem: { select: { nameCs: true } },
    },
  },
} satisfies Prisma.StationTicketSelect;

type TicketRow = Prisma.StationTicketGetPayload<{ select: typeof ticketSelect }>;

function toTicketView(ticket: TicketRow) {
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    station: ticket.station,
    status: ticket.status,
    isAddon: ticket.isAddon,
    createdAt: ticket.createdAt,
    acceptedAt: ticket.acceptedAt,
    readyAt: ticket.readyAt,
    servedAt: ticket.servedAt,
    cancelledAt: ticket.cancelledAt,
    // Set only in busy hours, when the station said how long it will take.
    etaAt: ticket.etaAt,
    etaMinutes: ticket.etaMinutes,
    table: toPublicTable(ticket.table),
    items: ticket.items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      menuItemId: item.menuItem.id,
      name: item.menuItem.name,
      // The kitchen reads the menu in Czech.
      nameCs: item.menuItem.nameCs,
      qty: item.qty,
      comment: item.comment,
      priceCzk: item.priceCzk,
    })),
    cancellations: ticket.cancellations.map(({ menuItem, ...line }) => ({ ...line, nameCs: menuItem.nameCs })),
  };
}

export async function listTickets(params: {
  venueId: number;
  shiftId: string;
  role: StaffRole;
  view: "active" | "served";
}) {
  const sections = ticketSectionsForRole(params.role);
  const scope = { venueId: params.venueId, shiftId: params.shiftId, station: { in: sections } };

  if (params.view === "served") {
    const rows = await prisma.stationTicket.findMany({
      where: { ...scope, status: "SERVED" },
      orderBy: { servedAt: "desc" },
      take: SERVED_LIST_LIMIT,
      select: ticketSelect,
    });
    return rows.map(toTicketView);
  }

  // Whoever prepares tickets also sees the ones the manager just cancelled.
  const showCancelled = isStationRole(params.role) || params.role === "HOOKAH";
  const rows = await prisma.stationTicket.findMany({
    where: {
      ...scope,
      OR: [
        { status: { in: ACTIVE_STATUSES } },
        ...(showCancelled
          ? [{ status: "CANCELLED" as const, cancelledAt: { gte: new Date(Date.now() - CANCELLED_VISIBLE_MS) } }]
          : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: ticketSelect,
  });
  return rows.map(toTicketView);
}

/** Badge numbers: tickets waiting for this role to accept / to carry out. */
export async function ticketCountsForRole(venueId: number, shiftId: string, role: StaffRole) {
  const sections = ticketSectionsForRole(role);
  const prepare = sections.filter((section) => canPrepare(role, section));
  // The manager's badge tracks what nobody has accepted; carrying out is
  // the waiters' job and would only double the number.
  const deliver = role === "MANAGER" ? [] : sections.filter((section) => canDeliver(role, section));

  const [toAccept, toDeliver] = await Promise.all([
    prepare.length
      ? prisma.stationTicket.count({ where: { venueId, shiftId, station: { in: prepare }, status: "NEW" } })
      : Promise.resolve(0),
    deliver.length
      ? prisma.stationTicket.count({ where: { venueId, shiftId, station: { in: deliver }, status: "READY" } })
      : Promise.resolve(0),
  ]);

  return { toAccept, toDeliver };
}

/* ------------------------------------------------------------------------ */
/* Moving tickets                                                           */
/* ------------------------------------------------------------------------ */

export type TicketAction = "accept" | "ready" | "served";

const FROM: Record<TicketAction, TicketStatus[]> = {
  accept: ["NEW"],
  ready: ["NEW", "ACCEPTED"],
  served: ["READY"],
};

const TO: Record<TicketAction, TicketStatus> = {
  accept: "ACCEPTED",
  ready: "READY",
  served: "SERVED",
};

const RANK: Record<TicketStatus, number> = {
  NEW: 0,
  ACCEPTED: 1,
  READY: 2,
  SERVED: 3,
  CANCELLED: 4,
};

export async function moveTicket(params: {
  ticketId: string;
  venueId: number;
  staffId: string;
  role: StaffRole;
  action: TicketAction;
  /** The device that pressed the button: no alert about it there. */
  deviceId?: string | null;
}) {
  const { ticketId, venueId, staffId, role, action } = params;

  const ticket = await prisma.stationTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, venueId: true, station: true, status: true, orderId: true },
  });
  if (!ticket || ticket.venueId !== venueId) {
    throw new HttpError(404, "TICKET_NOT_FOUND", "Заказ не найден");
  }

  const allowed = action === "served" ? canDeliver(role, ticket.station) : canPrepare(role, ticket.station);
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "Это не ваш заказ");

  const now = new Date();
  const data: Prisma.StationTicketUncheckedUpdateManyInput = { status: TO[action] };
  if (action === "accept") Object.assign(data, { acceptedAt: now, acceptedById: staffId });
  if (action === "ready") Object.assign(data, { readyAt: now, readyById: staffId });
  if (action === "served") Object.assign(data, { servedAt: now, servedById: staffId });

  // Atomic: only the tap that actually moves the ticket wins; a double tap or
  // a second iPad gets "already done" instead of a second notification.
  const moved = await prisma.stationTicket.updateMany({
    where: { id: ticket.id, status: { in: FROM[action] } },
    data,
  });

  if (moved.count === 0) {
    const current = await prisma.stationTicket.findUnique({
      where: { id: ticket.id },
      select: { status: true },
    });
    const status = current?.status ?? ticket.status;
    if (status === "CANCELLED") throw new HttpError(409, "TICKET_CANCELLED", "Заказ отменён менеджером");
    if (RANK[status] >= RANK[TO[action]]) return { changed: false, status };
    throw new HttpError(409, "TICKET_NOT_READY", "Заказ ещё не готов");
  }

  // «Готово» straight from NEW also counts as accepted.
  if (action === "ready") {
    await prisma.stationTicket.updateMany({
      where: { id: ticket.id, acceptedAt: null },
      data: { acceptedAt: now, acceptedById: staffId },
    });
  }

  await refreshAndAnnounce(ticket.orderId);
  emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

  if (action === "ready") {
    void notifyTicketReady(ticket.id, { exceptDevice: params.deviceId }).catch((e) =>
      console.warn("push notifyTicketReady failed", e)
    );
  }

  return { changed: true, status: TO[action] };
}

/* ------------------------------------------------------------------------ */
/* Cancelling lines (manager only)                                          */
/* ------------------------------------------------------------------------ */

export async function cancelOrderLine(params: {
  venueId: number;
  shiftId: string;
  staffId: string;
  role: StaffRole;
  orderId: string;
  orderItemId: string;
  qty?: number;
  reason?: string | null;
  deviceId?: string | null;
}) {
  if (!canCancelItems(params.role)) {
    throw new HttpError(403, "FORBIDDEN", "Отменить позицию может только менеджер");
  }

  const item = await prisma.orderItem.findUnique({
    where: { id: params.orderItemId },
    select: {
      id: true,
      orderId: true,
      qty: true,
      comment: true,
      priceCzk: true,
      menuItemId: true,
      ticketId: true,
      menuItem: { select: { name: true, nameCs: true } },
      ticket: { select: { status: true } },
      order: { select: { status: true, tableId: true, table: { select: { venueId: true } } } },
    },
  });

  if (!item || item.orderId !== params.orderId || item.order.table.venueId !== params.venueId) {
    throw new HttpError(404, "ITEM_NOT_FOUND", "Позиция не найдена");
  }
  if (item.order.status === "CANCELLED") {
    throw new HttpError(409, "ORDER_CANCELLED", "Заказ уже отменён");
  }

  // Never take back something the guest has already paid for — or something
  // on a bill that is being paid right now (the bill holds a snapshot of it).
  const payments = await prisma.paymentRequest.findMany({
    where: {
      tableId: item.order.tableId,
      status: { in: ["CONFIRMED", "PENDING"] },
      session: { shiftId: params.shiftId },
    },
    select: { status: true, itemsJson: true, confirmation: { select: { itemsJson: true } } },
  });
  if ((paidQtyByOrderItemId(payments).get(item.id) ?? 0) > 0) {
    throw new HttpError(409, "ITEM_ALREADY_PAID", "Позиция уже оплачена");
  }
  const onPendingBill = payments
    .filter((payment) => payment.status === "PENDING")
    .some((payment) => parsePaymentItemsJson(payment.itemsJson).some((line) => line.orderItemId === item.id));
  if (onPendingBill) {
    throw new HttpError(409, "ITEM_ON_PENDING_BILL", "Позиция в выставленном счёте — сначала отмените счёт");
  }

  const reason = params.reason?.trim() || null;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${params.orderId} FOR UPDATE`;

    const fresh = await tx.orderItem.findUnique({ where: { id: item.id }, select: { qty: true } });
    if (!fresh) throw new HttpError(404, "ITEM_NOT_FOUND", "Позиция не найдена");

    const qty = Math.min(Math.max(1, params.qty ?? fresh.qty), fresh.qty);

    await tx.orderItemCancellation.create({
      data: {
        venueId: params.venueId,
        tableId: item.order.tableId,
        orderId: params.orderId,
        ticketId: item.ticketId,
        menuItemId: item.menuItemId,
        name: item.menuItem.name,
        qty,
        priceCzk: item.priceCzk,
        comment: item.comment,
        reason,
        cancelledById: params.staffId,
      },
    });

    if (qty >= fresh.qty) {
      await tx.orderItem.delete({ where: { id: item.id } });
    } else {
      await tx.orderItem.update({ where: { id: item.id }, data: { qty: fresh.qty - qty } });
    }

    let wholeTicket = false;
    if (item.ticketId) {
      const left = await tx.orderItem.count({ where: { ticketId: item.ticketId } });
      if (left === 0) {
        const closed = await tx.stationTicket.updateMany({
          where: { id: item.ticketId, status: { not: "CANCELLED" } },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        wholeTicket = closed.count > 0;
      }
    }

    const change = await refreshOrderStatus(tx, params.orderId);
    return { qty, wholeTicket, change };
  });

  const orderCancelled = result.change?.after === "CANCELLED";

  emitGuestEvent(item.order.tableId, "order-item-cancelled");
  // The cancellation push below already tells the guests about a cancelled
  // order; any other status change (e.g. the rest is served → "you can pay")
  // is announced as usual.
  announceOrderStatus(result.change, { push: !orderCancelled });
  emitStaffEvent(params.venueId, { kind: "DATA_CHANGED" });

  void notifyGuestsOrderItemCancelled(params.orderId, orderCancelled).catch((e) => {
    console.warn("guest push notifyGuestsOrderItemCancelled failed", e);
  });

  // The station only needs to hear about it while the ticket is still theirs
  // (or on its way to the table).
  if (item.ticketId && item.ticket && item.ticket.status !== "SERVED" && item.ticket.status !== "CANCELLED") {
    void notifyTicketCancelled({
      ticketId: item.ticketId,
      statusBefore: item.ticket.status,
      line: `${item.menuItem.name} ×${result.qty}`,
      lineCs: `${item.menuItem.nameCs || item.menuItem.name} ×${result.qty}`,
      reason,
      wholeTicket: result.wholeTicket,
      exceptDevice: params.deviceId,
    }).catch((e) => console.warn("push notifyTicketCancelled failed", e));
  }

  return { orderCancelled, cancelledQty: result.qty };
}

/* ------------------------------------------------------------------------ */
/* Ready time (busy hours)                                                  */
/* ------------------------------------------------------------------------ */

/** What a station may promise: 10, 15, … 40 minutes. */
export const ETA_MINUTES = [10, 15, 20, 25, 30, 35, 40] as const;

/**
 * In a rush the station says when the order will be ready; the waiter sees the
 * same countdown and can tell the guest. `null` clears it. Saying a time on a
 * new order also takes it (the reminders stop). Silent: no alert anywhere,
 * the screens just refresh.
 */
export async function setTicketEta(params: {
  ticketId: string;
  venueId: number;
  staffId: string;
  role: StaffRole;
  minutes: number | null;
}) {
  const ticket = await prisma.stationTicket.findUnique({
    where: { id: params.ticketId },
    select: { id: true, venueId: true, station: true, status: true, orderId: true },
  });
  if (!ticket || ticket.venueId !== params.venueId) {
    throw new HttpError(404, "TICKET_NOT_FOUND", "Заказ не найден");
  }
  if (!canPrepare(params.role, ticket.station)) throw new HttpError(403, "FORBIDDEN", "Это не ваш заказ");
  if (params.minutes !== null && !(ETA_MINUTES as readonly number[]).includes(params.minutes)) {
    throw new HttpError(400, "INVALID_INPUT", "Время: от 10 до 40 минут");
  }

  const now = new Date();
  const eta =
    params.minutes === null
      ? { etaAt: null, etaMinutes: null }
      : { etaAt: new Date(now.getTime() + params.minutes * 60_000), etaMinutes: params.minutes };

  // Only while it is being made; a new order is taken at the same moment.
  const updated = await prisma.stationTicket.updateMany({
    where: { id: ticket.id, status: { in: ["NEW", "ACCEPTED"] } },
    data: eta,
  });
  if (updated.count === 0) throw new HttpError(409, "TICKET_NOT_ACTIVE", "Заказ уже готов или отменён");

  let accepted = false;
  if (params.minutes !== null) {
    const took = await prisma.stationTicket.updateMany({
      where: { id: ticket.id, status: "NEW" },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedById: params.staffId },
    });
    accepted = took.count === 1;
  }

  if (accepted) await refreshAndAnnounce(ticket.orderId);
  emitStaffEvent(params.venueId, { kind: "DATA_CHANGED" });

  return { etaAt: eta.etaAt, etaMinutes: eta.etaMinutes, accepted };
}

/* ------------------------------------------------------------------------ */
/* Notifications                                                            */
/* ------------------------------------------------------------------------ */

function linesSummary(
  items: Array<{ qty: number; menuItem: { name: string; nameCs?: string | null } }>,
  max = 140,
  czech = false
) {
  const text = items
    .map((item) => `${(czech && item.menuItem.nameCs) || item.menuItem.name} ×${item.qty}`)
    .join(", ");
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Only the kitchen reads dish names in Czech; the bar and the hookah zone keep theirs. */
const czechForStation = (station: MenuSection) => station === "DISHES";

type TicketAlert = {
  venueId: number;
  roles: StaffRole[];
  payload: Omit<PushPayload, "url" | "kind"> & { kind: Extract<StaffEventKind, PushPayload["kind"]> };
  /** The device whose action caused the alert hears nothing about it. */
  exceptDevice?: string | null;
  /** Text for the station tablet when it differs (the kitchen reads Czech dish names). */
  stationBody?: string;
};

/** The live channel: instant on every open screen. Never waits for anything. */
function emitAlert({ venueId, roles, payload, exceptDevice }: TicketAlert) {
  const unique = Array.from(new Set(roles));
  emitStaffEvent(venueId, {
    kind: payload.kind,
    tableCode: payload.tableCode,
    tag: payload.tag,
    roles: unique,
    exceptDevice,
  });
}

/** Web push (lock screen). Station tablets land on their station screen, everyone else on Orders. */
async function pushAlert({ venueId, roles, payload, exceptDevice, stationBody }: TicketAlert) {
  const unique = Array.from(new Set(roles));
  const stations = unique.filter(isStationRole);
  const floor = unique.filter((role) => !isStationRole(role));
  const opts = { exceptDevice };
  const stationPayload = { ...payload, url: "/staff/station", ...(stationBody ? { body: stationBody } : {}) };
  await Promise.all([
    stations.length ? pushToVenueRoles(venueId, stations, stationPayload, opts) : null,
    floor.length ? pushToVenueRoles(venueId, floor, { ...payload, url: "/staff/orders" }, opts) : null,
  ]);
}

/**
 * Same alert on both channels: SSE (instant while the screen is open) and web
 * push (lock screen). They share the tag, so an open screen beeps once.
 */
async function alertRoles(
  venueId: number,
  roles: StaffRole[],
  payload: TicketAlert["payload"],
  exceptDevice?: string | null,
  stationBody?: string
) {
  const alert = { venueId, roles, payload, exceptDevice, stationBody };
  emitAlert(alert);
  await pushAlert(alert);
}

async function loadTicketForAlert(ticketId: string) {
  return prisma.stationTicket.findUnique({ where: { id: ticketId }, select: ticketSelect });
}

/**
 * One order can go to the kitchen AND the bar: both screens are alerted at the
 * same moment (the bar never waits for the kitchen's pushes to be delivered),
 * then every push goes out in parallel.
 */
export async function notifyTicketsCreated(ticketIds: string[], opts?: { exceptDevice?: string | null }) {
  const tickets = await Promise.all(ticketIds.map((ticketId) => loadTicketForAlert(ticketId)));

  const alerts: TicketAlert[] = [];
  for (const ticket of tickets) {
    if (!ticket || ticket.status !== "NEW") continue;

    const tableCode = toPublicTable(ticket.table).code;
    alerts.push({
      venueId: ticket.venueId,
      roles: [...prepareRolesFor(ticket.station), "MANAGER"],
      exceptDevice: opts?.exceptDevice,
      stationBody: czechForStation(ticket.station)
        ? `Стол ${tableCode} · ${linesSummary(ticket.items, 140, true)}`
        : undefined,
      payload: {
        kind: "TICKET_NEW",
        title: `${ticket.isAddon ? "Дозаказ" : "Новый заказ"} · ${SECTION_LABEL[ticket.station]}`,
        body: `Стол ${tableCode} · ${linesSummary(ticket.items)}`,
        // New-order and reminder alerts share the tag: the reminder replaces the
        // notification on the lock screen instead of piling up a new one.
        tag: `ticket:${ticket.id}`,
        ts: Date.now(),
        tableCode,
        venueId: ticket.venueId,
        venueSlug: publicVenueSlug(ticket.venue.slug),
        vibrate: [320, 140, 320, 140, 420],
      },
    });
  }

  alerts.forEach(emitAlert);
  await Promise.all(alerts.map(pushAlert));
}

async function notifyTicketReady(ticketId: string, opts?: { exceptDevice?: string | null }) {
  const ticket = await loadTicketForAlert(ticketId);
  if (!ticket || ticket.status !== "READY") return;

  const tableCode = toPublicTable(ticket.table).code;
  await alertRoles(ticket.venueId, deliverRolesFor(ticket.station), {
    kind: "TICKET_READY",
    title: `${READY_TITLE[ticket.station]} · Стол ${tableCode}`,
    body: linesSummary(ticket.items),
    tag: `ticket_ready:${ticket.id}`,
    ts: Date.now(),
    tableCode,
    venueId: ticket.venueId,
    venueSlug: publicVenueSlug(ticket.venue.slug),
    vibrate: [200, 100, 200, 100, 400],
  }, opts?.exceptDevice);
}

async function notifyTicketCancelled(params: {
  ticketId: string;
  statusBefore: TicketStatus;
  line: string;
  reason: string | null;
  wholeTicket: boolean;
  exceptDevice?: string | null;
  lineCs?: string;
}) {
  const ticket = await loadTicketForAlert(params.ticketId);
  if (!ticket) return;

  const roles = [...prepareRolesFor(ticket.station)];
  if (params.statusBefore === "READY") roles.push(...deliverRolesFor(ticket.station));

  const tableCode = toPublicTable(ticket.table).code;
  await alertRoles(ticket.venueId, roles, {
    kind: "TICKET_CANCELLED",
    title: `${params.wholeTicket ? "Заказ отменён" : "Отмена позиции"} · Стол ${tableCode}`,
    body: params.reason ? `${params.line} · ${params.reason}` : params.line,
    tag: `ticket_cancel:${ticket.id}:${Date.now()}`,
    ts: Date.now(),
    tableCode,
    venueId: ticket.venueId,
    venueSlug: publicVenueSlug(ticket.venue.slug),
    vibrate: [600, 200, 600],
  }, params.exceptDevice, czechForStation(ticket.station) && params.lineCs
    ? (params.reason ? `${params.lineCs} · ${params.reason}` : params.lineCs)
    : undefined);
}

async function notifyTicketReminder(ticketId: string) {
  const ticket = await loadTicketForAlert(ticketId);
  if (!ticket || ticket.status !== "NEW") return;

  const tableCode = toPublicTable(ticket.table).code;
  const minutes = Math.max(1, Math.floor((Date.now() - ticket.createdAt.getTime()) / 60_000));
  await alertRoles(ticket.venueId, [...prepareRolesFor(ticket.station), "MANAGER"], {
    kind: "TICKET_REMINDER",
    title: `Заказ не принят · ${SECTION_LABEL[ticket.station]}`,
    body: `Стол ${tableCode} · ждёт ${minutes} мин`,
    tag: `ticket:${ticket.id}`,
    renotify: true,
    ts: Date.now(),
    tableCode,
    venueId: ticket.venueId,
    venueSlug: publicVenueSlug(ticket.venue.slug),
    vibrate: [500, 150, 500, 150, 500, 150, 500],
  });
}

/* ------------------------------------------------------------------------ */
/* "Not accepted" reminders                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Like a seatbelt chime: a ticket nobody accepted re-alerts its station and
 * the manager every TICKET_REMINDER_MINUTES until someone taps «Принять».
 * Only tickets of an open shift are reminded. Each round is claimed with an
 * atomic update, so even two server instances never send it twice.
 */
export async function runTicketReminders(now = new Date()) {
  const cutoff = new Date(now.getTime() - env.TICKET_REMINDER_MINUTES * 60_000);

  const due = await prisma.stationTicket.findMany({
    where: {
      status: "NEW",
      shift: { status: "OPEN" },
      OR: [{ lastRemindedAt: null, createdAt: { lte: cutoff } }, { lastRemindedAt: { lte: cutoff } }],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, lastRemindedAt: true },
  });

  const claimedIds: string[] = [];
  for (const ticket of due) {
    const claimed = await prisma.stationTicket.updateMany({
      where: { id: ticket.id, status: "NEW", lastRemindedAt: ticket.lastRemindedAt },
      data: { lastRemindedAt: now, reminderCount: { increment: 1 } },
    });
    if (claimed.count === 1) claimedIds.push(ticket.id);
  }

  // In parallel: the bar's reminder never waits for the kitchen's pushes.
  await Promise.all(
    claimedIds.map((ticketId) =>
      notifyTicketReminder(ticketId).catch((e) => {
        console.warn("push notifyTicketReminder failed", e);
      })
    )
  );

  return due.length;
}

let reminderTimer: NodeJS.Timeout | null = null;
let reminderRunning = false;

export function startTicketReminders() {
  if (reminderTimer) return;

  // Check often enough that a reminder is never late by more than a fraction
  // of its interval (2 min → every 15 s).
  const tickMs = Math.min(15_000, Math.max(1_000, (env.TICKET_REMINDER_MINUTES * 60_000) / 6));

  reminderTimer = setInterval(() => {
    if (reminderRunning) return;
    reminderRunning = true;
    runTicketReminders()
      .catch((e) => console.warn("ticket reminders failed", e))
      .finally(() => {
        reminderRunning = false;
      });
  }, tickMs);

  reminderTimer.unref?.();
}
