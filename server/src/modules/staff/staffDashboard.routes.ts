import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { requireStaffAuth } from "./staff.middleware";
import { effectiveAvailableAt, nextPragueMidnight, summarizeLoyalty } from "../../utils/loyalty";
import { callAlertKind, notifyPaymentRequested } from "../staff/push.service";
import { ORDER_REQUEST_MARKER, isOrderRequestMessage } from "../orders/orderRequest";
import {
  latestLegacyPaymentCutoff,
  paidQtyByOrderItemId,
  parsePaymentItemsJson,
} from "../payments/paymentAllocation";
import { getOpenShiftOrThrow } from "./shiftCache";
import { addStaffClient, emitStaffEvent } from "./staffEvents";
import { cleanDeviceId, staffDeviceOf } from "./staffDevice";
import { upsertOpenTableOrder } from "./openOrder";
import { staffMenu } from "../menu/menu.routes";
import { attachGuest, cardTail, detachGuest, openTable, searchGuests } from "./tableGuests.service";
import { cancelTableLines, moveTableLines, type TableLine } from "./tableLines.service";
import { emitGuestEvent } from "../guest/guestEvents";
import {
  notifyGuestCallUpdated,
  notifyGuestPayment,
  notifyGuestsBillIssued,
  notifyGuestsOrderCreated,
} from "../guest/guestPush.service";
import {
  expireGuestSessionIfInactiveAfterPayment,
  getGuestSessionClosureState,
} from "../guest/sessionExpiry";
import type { Prisma, CallType, CallStatus, MenuSection, OrderStatus, PaymentStatus, StaffRole } from "@prisma/client";
import {
  callTypesForRole,
  canHandlePayments,
  canPrepare,
  canTakeOrderRequests,
  canWorkTables,
  deliverRolesFor,
  orderSectionsForRole,
  ticketSectionsForRole,
} from "./roles";
import { toPublicTable } from "./tableView";
import { staffCallMessage } from "../calls/hookahReasons";
import {
  announceOrderStatus,
  cancelOrderLine,
  createStationTickets,
  notifyTicketsCreated,
  refreshOrderStatus,
  ticketCountsForRole,
} from "./tickets.service";

export const staffDashboardRouter = Router();
staffDashboardRouter.use(requireStaffAuth);

const IdParamSchema = z.object({
  id: z.string().min(1),
});

// Realtime channel (Server-Sent Events). The dashboard keeps this open and
// receives "refresh now" events instantly; polling remains as a fallback.
staffDashboardRouter.get("/events", (req, res) => {
  const venueId = req.staff!.venueId;
  const role = req.staff!.role;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering (nginx / some PaaS) so events are delivered live.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Tell the browser to reconnect quickly and send an initial event so the
  // client knows the channel is live.
  res.write("retry: 3000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  const remove = addStaffClient(venueId, role, res, cleanDeviceId(req.query.device));

  req.on("close", () => {
    remove();
    res.end();
  });
});

// A guest tapping "Call the waiter" in the menu IS the request to order: staff
// accept it under Orders, walk to the table and punch the order in there. Only
// plain service calls (hookah / free-text message / bill) stay under Calls —
// see callTypesForRole in roles.ts for who answers which.

/** Everything that shows up in the staff "Orders" tab as an incoming request. */
function orderRequestWhere(): Prisma.StaffCallWhereInput {
  return {
    OR: [
      { type: "WAITER" },
      { type: "HELP", message: ORDER_REQUEST_MARKER },
    ],
  };
}

function isOrderRequestCall(call: { type: CallType; message: string | null }) {
  return call.type === "WAITER" || isOrderRequestMessage(call.message);
}

/**
 * Everything this role was alerted about that is still waiting: new calls and
 * order requests, bills to take, tickets to accept, tickets to carry out.
 * Tags and kinds are exactly those of the live alert and the push, so a
 * screen that missed both (connection dropped, push lost) still beeps once
 * from its regular summary refresh — and never twice.
 */
type OpenAlert = { tag: string; kind: string; tableCode: string; station?: MenuSection | null };
const OPEN_ALERTS_LIMIT = 60;

async function openAlertsForRole(
  venueId: number,
  shift: { id: string; openedAt: Date },
  role: StaffRole
): Promise<OpenAlert[]> {
  const types = callTypesForRole(role);
  const sections = ticketSectionsForRole(role);
  const toAccept = sections.filter((section) => canPrepare(role, section));
  const toDeliver = sections.filter((section) => deliverRolesFor(section).includes(role));
  const table = { select: { code: true, label: true } } as const;
  const newest = { createdAt: "desc" } as const;

  const [requests, calls, payments, newTickets, readyTickets] = await Promise.all([
    canTakeOrderRequests(role)
      ? prisma.staffCall.findMany({
          where: { status: "NEW", ...orderRequestWhere(), table: { venueId }, createdAt: { gte: shift.openedAt } },
          select: { id: true, type: true, message: true, table },
          orderBy: newest,
          take: OPEN_ALERTS_LIMIT,
        })
      : Promise.resolve([]),
    types.length
      ? prisma.staffCall.findMany({
          where: {
            status: "NEW",
            type: { in: types },
            ...excludeOrderRequestMarker(),
            table: { venueId },
            session: { shiftId: shift.id },
          },
          select: { id: true, type: true, message: true, table },
          orderBy: newest,
          take: OPEN_ALERTS_LIMIT,
        })
      : Promise.resolve([]),
    canHandlePayments(role)
      ? prisma.paymentRequest.findMany({
          where: { status: "PENDING", table: { venueId }, session: { shiftId: shift.id } },
          select: { id: true, table },
          orderBy: newest,
          take: OPEN_ALERTS_LIMIT,
        })
      : Promise.resolve([]),
    toAccept.length
      ? prisma.stationTicket.findMany({
          where: { venueId, shiftId: shift.id, status: "NEW", station: { in: toAccept } },
          select: { id: true, station: true, table },
          orderBy: newest,
          take: OPEN_ALERTS_LIMIT,
        })
      : Promise.resolve([]),
    toDeliver.length
      ? prisma.stationTicket.findMany({
          where: { venueId, shiftId: shift.id, status: "READY", station: { in: toDeliver } },
          select: { id: true, station: true, table },
          orderBy: newest,
          take: OPEN_ALERTS_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const code = (t: { code: string; label: string | null }) => toPublicTable(t).code;
  return [
    ...[...requests, ...calls].map((call) => ({
      tag: `call_new:${call.id}`,
      kind: callAlertKind(call.type, call.message),
      tableCode: code(call.table),
      station: call.type === "HOOKAH" ? ("HOOKAH" as const) : null,
    })),
    ...payments.map((pr) => ({ tag: `payment_pending:${pr.id}`, kind: "PAYMENT_REQUESTED", tableCode: code(pr.table) })),
    ...newTickets.map((t) => ({ tag: `ticket:${t.id}`, kind: "TICKET_NEW", tableCode: code(t.table), station: t.station })),
    ...readyTickets.map((t) => ({
      tag: `ticket_ready:${t.id}`,
      kind: "TICKET_READY",
      tableCode: code(t.table),
      station: t.station,
    })),
  ];
}

function excludeOrderRequestMarker(): Prisma.StaffCallWhereInput {
  return {
    OR: [
      { message: null },
      {
        message: {
          not: ORDER_REQUEST_MARKER,
        },
      },
    ],
  };
}

function forbidStations(role: StaffRole) {
  if (!canWorkTables(role)) {
    throw new HttpError(403, "FORBIDDEN", "Недоступно для этого аккаунта");
  }
}

/** Names of the signed-in guests at a table, newest first, each once. */
function guestNames(sessions: Array<{ user: { id: string; name: string } | null }>) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const candidate of sessions) {
    if (!candidate.user || seen.has(candidate.user.id)) continue;
    seen.add(candidate.user.id);
    // An account without a name (Apple can hide it) still shows that someone signed in.
    names.push(candidate.user.name?.trim() || "Гость с аккаунтом");
  }
  return names;
}

function disconnectBlockedReason() {
  return "Сессию можно закрыть только после полной оплаты счета.";
}

type PayableTableItem = {
  orderId: string;
  orderItemId: string;
  menuItemId: number;
  name: string;
  qty: number;
  unitPriceCzk: number;
  totalCzk: number;
  comment?: string;
};

function buildPayableTableItems(params: {
  orders: Array<{
    id: string;
    createdAt: Date;
    status: OrderStatus;
    items: Array<{
      id: string;
      qty: number;
      priceCzk: number;
      comment: string | null;
      menuItem: { id: number; name: string };
    }>;
  }>;
  payments: Array<{
    status: PaymentStatus;
    createdAt: Date;
    confirmedAt: Date | null;
    itemsJson: Prisma.JsonValue | null;
    confirmation: {
      itemsJson: Prisma.JsonValue | null;
      createdAt: Date;
    } | null;
  }>;
}) {
  const legacyCutoff = latestLegacyPaymentCutoff(params.payments);
  const paidQtyMap = paidQtyByOrderItemId(params.payments);

  return params.orders
    .filter((order) => {
      if (order.status === "CANCELLED") return false;
      if (!legacyCutoff) return true;
      return new Date(order.createdAt).getTime() > legacyCutoff;
    })
    .flatMap((order) =>
      order.items
        .map((item) => {
          // A free line (a side punched to a dish, 0 Kč) is never owed.
          if (item.priceCzk <= 0) return null;
          const remainingQty = Math.max(item.qty - (paidQtyMap.get(item.id) ?? 0), 0);
          if (remainingQty <= 0) return null;

          return {
            orderId: order.id,
            orderItemId: item.id,
            menuItemId: item.menuItem.id,
            name: item.menuItem.name,
            qty: remainingQty,
            unitPriceCzk: item.priceCzk,
            totalCzk: remainingQty * item.priceCzk,
            comment: item.comment ?? undefined,
          } satisfies PayableTableItem;
        })
        .filter(Boolean)
    ) as PayableTableItem[];
}

async function getActiveTableSessionOrThrow(params: {
  tableId: number;
  venueId: number;
  shiftId: string;
}) {
  const session = await prisma.guestSession.findFirst({
    where: {
      tableId: params.tableId,
      endedAt: null,
      shiftId: params.shiftId,
      table: { venueId: params.venueId },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      tableId: true,
      userId: true,
      shiftId: true,
      startedAt: true,
      endedAt: true,
      table: {
        select: {
          id: true,
          code: true,
          label: true,
          venueId: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
  });

  if (!session) {
    throw new HttpError(404, "TABLE_SESSION_NOT_FOUND", "Active table session not found");
  }

  const expiry = await expireGuestSessionIfInactiveAfterPayment(session.id, {
    id: session.id,
    endedAt: session.endedAt,
    startedAt: session.startedAt,
  });
  if (expiry.expired) {
    throw new HttpError(404, "TABLE_SESSION_NOT_FOUND", "Active table session not found");
  }

  return session;
}

/**
 * The table's open order for this shift (an add-on is appended to it), or a
 * new one. Lines are added afterwards by createStationTickets, one ticket per
 * station, and the status is then derived from those tickets.
 */

async function getActiveShiftOrThrow(venueId: number) {
  return getOpenShiftOrThrow(venueId);
}

// summary
staffDashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const types = callTypesForRole(role);

    const shift = await getActiveShiftOrThrow(venueId);

    const [orderRequests, tickets, newCalls, pendingPayments, alerts] = await Promise.all([
      canTakeOrderRequests(role)
        ? prisma.staffCall.count({
            where: {
              status: "NEW",
              ...orderRequestWhere(),
              table: { venueId },
              createdAt: { gte: shift.openedAt },
            },
          })
        : Promise.resolve(0),
      ticketCountsForRole(venueId, shift.id, role),
      types.length
        ? prisma.staffCall.count({
            where: {
              status: "NEW",
              type: { in: types },
              ...excludeOrderRequestMarker(),
              table: { venueId },
              session: { shiftId: shift.id },
            },
          })
        : Promise.resolve(0),
      canHandlePayments(role)
        ? prisma.paymentRequest.count({
            where: {
              status: "PENDING",
              table: { venueId },
              session: { shiftId: shift.id },
            },
          })
        : Promise.resolve(0),
      openAlertsForRole(venueId, shift, role),
    ]);

    res.json({
      ok: true,
      shift: {
        id: shift.id,
        openedAt: shift.openedAt,
      },
      // The "Orders" badge: everything waiting for an action from THIS role —
      // guest order requests, tickets to accept, tickets to carry out.
      newOrders: orderRequests + tickets.toAccept + tickets.toDeliver,
      ticketsToAccept: tickets.toAccept,
      ticketsToDeliver: tickets.toDeliver,
      newCalls,
      pendingPayments,
      alerts,
    });
  })
);

// ORDERS
const CreateTableOrderSchema = z.object({
  tableId: z.number().int().positive(),
  sessionId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  comment: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int().positive(),
        qty: z.number().int().min(1).max(50),
        comment: z.string().max(300).optional(),
      })
    )
    .min(1),
});

// Take a line (or part of it) off an order — manager only. The line is reduced
// or removed so every bill stays right, the station sees it crossed out, and
// who / what / why is kept in OrderItemCancellation. Paid lines are refused.
const CancelOrderItemSchema = z.object({
  qty: z.number().int().min(1).max(50).optional(),
  reason: z.string().trim().max(200).optional(),
});

staffDashboardRouter.post(
  "/orders/:orderId/items/:itemId/cancel",
  validate(CancelOrderItemSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const body = req.body as z.infer<typeof CancelOrderItemSchema>;

    const result = await cancelOrderLine({
      venueId,
      shiftId: shift.id,
      staffId: req.staff!.staffId,
      role: req.staff!.role,
      orderId: String(req.params.orderId),
      orderItemId: String(req.params.itemId),
      qty: body.qty,
      reason: body.reason,
      deviceId: staffDeviceOf(req),
    });

    res.json({ ok: true, ...result });
  })
);

// The menu the order composer shows: staff-only items included (a side
// punched to a dish, a rental) — guests never see those.
staffDashboardRouter.get(
  "/menu",
  asyncHandler(async (req, res) => {
    const payload = await staffMenu(req.staff!.venueId);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(payload);
  })
);

staffDashboardRouter.post(
  "/table-orders",
  validate(CreateTableOrderSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const sections = orderSectionsForRole(role);
    if (sections.length === 0) {
      throw new HttpError(403, "FORBIDDEN", "Этот аккаунт не принимает заказы");
    }

    const shift = await getActiveShiftOrThrow(venueId);
    const body = req.body as z.infer<typeof CreateTableOrderSchema>;

    // The same dish may come twice (two lines with different comments).
    const menuItemIds = Array.from(new Set(body.items.map((item) => item.menuItemId)));

    const [session, menuItems] = await Promise.all([
      prisma.guestSession.findUnique({
        where: { id: body.sessionId },
        select: {
          id: true,
          tableId: true,
          table: { select: { venueId: true } },
          userId: true,
          shiftId: true,
          endedAt: true,
        },
      }),
      prisma.menuItem.findMany({
        where: {
          id: { in: menuItemIds },
          isActive: true,
          category: { venueId, section: { in: sections } },
        },
        select: { id: true, priceCzk: true, station: true, category: { select: { section: true } } },
      }),
    ]);

    // Venue + active-session is the real boundary. The shift is only used to
    // scope dashboard lists, so do NOT reject when the session's shiftId drifted
    // (e.g. the guest selected items before the shift opened, or a shift cache
    // race) — instead adopt the active session into the current shift below.
    if (
      !session ||
      session.tableId !== body.tableId ||
      session.table.venueId !== venueId ||
      session.endedAt
    ) {
      throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found for this table");
    }
    if (menuItems.length !== menuItemIds.length) {
      throw new HttpError(400, "MENU_ITEM_INVALID", "Some menu items are invalid/inactive");
    }

    const menuById = new Map(menuItems.map((item) => [item.id, item]));

    const { orderId, ticketIds, statusChange } = await prisma.$transaction(async (tx) => {
      if (session.shiftId !== shift.id) {
        await tx.guestSession.update({
          where: { id: session.id },
          data: { shiftId: shift.id },
        });
      }

      const order = await upsertOpenTableOrder(tx, {
        tableId: body.tableId,
        sessionId: session.id,
        userId: session.userId,
        shiftId: shift.id,
        comment: body.comment,
      });

      // One ticket per station: food → kitchen, drinks and hookahs → bar. An
      // item may name its own station (a dessert the bar serves).
      const ticketIds = await createStationTickets(tx, {
        venueId,
        tableId: body.tableId,
        orderId: order.id,
        shiftId: shift.id,
        staffId: req.staff!.staffId,
        lines: body.items.map((it) => {
          const menuItem = menuById.get(it.menuItemId)!;
          return {
            menuItemId: it.menuItemId,
            qty: it.qty,
            comment: it.comment,
            priceCzk: menuItem.priceCzk,
            section: menuItem.station ?? menuItem.category.section,
          };
        }),
      });

      const statusChange = await refreshOrderStatus(tx, order.id);

      // Close EVERY open order-request for this table's session once the staff
      // has placed the order — not just the one passed in. Otherwise a lingering
      // request keeps the guest's "Order" button stuck on "Sent" and blocks any
      // follow-up order (dozakaz). With them cleared, the guest can immediately
      // request more, which fires a fresh staff notification.
      await tx.staffCall.updateMany({
        where: {
          tableId: body.tableId,
          ...orderRequestWhere(),
          status: { in: ["NEW", "ACKED"] },
          session: { shiftId: shift.id },
        },
        data: {
          status: "DONE",
        },
      });

      return { orderId: order.id, ticketIds, statusChange };
    });

    // Whoever punched the order hears nothing about it on their own device.
    void notifyTicketsCreated(ticketIds, { exceptDevice: staffDeviceOf(req) }).catch((e) => {
      console.warn("push notifyTicketsCreated failed", e);
    });
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    emitGuestEvent(body.tableId, "order-created");
    // "Order received" covers the new lines; a status move it caused (an add-on
    // reopening a served order is not possible — those start a new order) only
    // needs the feed refresh.
    announceOrderStatus(statusChange, { push: false });

    void notifyGuestsOrderCreated(orderId).catch((e) => {
      console.warn("guest push notifyGuestsOrderCreated failed", e);
    });

    res.json({ ok: true, order: { id: orderId }, ticketIds });
  })
);

staffDashboardRouter.get(
  "/tables",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    forbidStations(role);
    const shift = await getActiveShiftOrThrow(venueId);

    const sessions = await prisma.guestSession.findMany({
      where: {
        shiftId: shift.id,
        endedAt: null,
        table: { venueId },
      },
      orderBy: [{ startedAt: "desc" }],
      include: {
        table: {
          select: {
            id: true,
            code: true,
            label: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        orders: {
          where: {
            status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] },
          },
          select: {
            id: true,
            createdAt: true,
            items: {
              select: {
                qty: true,
              },
            },
          },
        },
        calls: {
          where: {
            status: { in: ["NEW", "ACKED"] },
            type: { in: callTypesForRole(role) },
            ...excludeOrderRequestMarker(),
          },
          select: {
            id: true,
            createdAt: true,
            status: true,
            type: true,
          },
        },
        payments: {
          where: {
            status: "PENDING",
          },
          select: {
            id: true,
            createdAt: true,
            status: true,
            method: true,
          },
        },
      },
    });

    // A table can have several open sessions (two guests, or one guest who
    // opened the QR in the camera and then in Safari). The table is all of
    // them together — never just the newest one, which may be a guest that
    // hasn't signed in and has ordered nothing.
    const sessionsByTable = new Map<number, Array<(typeof sessions)[number]>>();
    for (const session of sessions) {
      const expiry = await expireGuestSessionIfInactiveAfterPayment(session.id, {
        id: session.id,
        endedAt: session.endedAt,
        startedAt: session.startedAt,
      });
      if (expiry.expired) {
        continue;
      }
      const list = sessionsByTable.get(session.tableId) ?? [];
      list.push(session); // newest first
      sessionsByTable.set(session.tableId, list);
    }

    const tables = await Promise.all(
      Array.from(sessionsByTable.values()).map(async (tableSessions) => {
        const session = tableSessions.find((candidate) => candidate.user) ?? tableSessions[0];
        const closureState = await getGuestSessionClosureState(session.id, {
          id: session.id,
          endedAt: session.endedAt,
          startedAt: session.startedAt,
        });
        const orders = tableSessions.flatMap((candidate) => candidate.orders);
        const calls = tableSessions.flatMap((candidate) => candidate.calls);
        const payments = tableSessions.flatMap((candidate) => candidate.payments);
        const openItemsCount = orders.reduce(
          (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.qty, 0),
          0
        );
        const firstStartedAt = tableSessions.reduce(
          (earliest, candidate) => (candidate.startedAt < earliest ? candidate.startedAt : earliest),
          session.startedAt
        );
        const lastActivityAt = [
          ...tableSessions.map((candidate) => candidate.startedAt),
          ...orders.map((order) => order.createdAt),
          ...calls.map((call) => call.createdAt),
          ...payments.map((payment) => payment.createdAt),
        ].reduce((latest, current) => (current > latest ? current : latest), firstStartedAt);

        return {
          table: toPublicTable(session.table),
          session: {
            id: session.id,
            startedAt: firstStartedAt,
            user: session.user,
          },
          // Everyone signed in at the table.
          guests: guestNames(tableSessions),
          isActive: true,
          openItemsCount,
          activeCallsCount: calls.length,
          pendingPaymentsCount: payments.length,
          lastActivityAt,
          capabilities: {
            canDisconnect: !("missing" in closureState) && !("ended" in closureState) && closureState.eligible,
            disconnectBlockedReason:
              !("missing" in closureState) && !("ended" in closureState) && !closureState.eligible
                ? disconnectBlockedReason()
                : null,
          },
        };
      })
    );

    const sortedTables = tables
      .sort((left, right) => left.table.code.localeCompare(right.table.code, undefined, { numeric: true }));

    res.json({ ok: true, tables: sortedTables });
  })
);

staffDashboardRouter.post(
  "/tables/:id/disconnect",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    forbidStations(req.staff!.role);
    const shift = await getActiveShiftOrThrow(venueId);
    const tableId = Number(req.params.id);

    if (!Number.isFinite(tableId) || tableId <= 0) {
      throw new HttpError(400, "TABLE_ID_INVALID", "Table id is invalid");
    }

    const session = await getActiveTableSessionOrThrow({
      tableId,
      venueId,
      shiftId: shift.id,
    });

    const closureState = await getGuestSessionClosureState(session.id, {
      id: session.id,
      endedAt: session.endedAt,
      startedAt: session.startedAt,
    });
    if ("missing" in closureState || "ended" in closureState || !closureState.eligible) {
      throw new HttpError(409, "TABLE_SESSION_NOT_SETTLED", disconnectBlockedReason());
    }

    const openSessions = await prisma.guestSession.findMany({
      where: {
        tableId,
        shiftId: shift.id,
        endedAt: null,
        table: { venueId },
      },
      select: {
        id: true,
        endedAt: true,
        startedAt: true,
      },
      orderBy: { startedAt: "desc" },
    });

    const closableSessionIds: string[] = [];
    for (const candidate of openSessions) {
      const candidateClosure = await getGuestSessionClosureState(candidate.id, {
        id: candidate.id,
        endedAt: candidate.endedAt,
        startedAt: candidate.startedAt,
      });

      if (!("missing" in candidateClosure) && !("ended" in candidateClosure) && candidateClosure.eligible) {
        closableSessionIds.push(candidate.id);
      }
    }

    const endedAt = new Date();

    await prisma.guestSession.updateMany({
      where: {
        id: { in: closableSessionIds },
        endedAt: null,
      },
      data: { endedAt },
    });

    emitGuestEvent(tableId, "session-ended");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    res.json({ ok: true, sessionId: session.id, closedSessionIds: closableSessionIds, endedAt: endedAt.toISOString() });
  })
);

const TableLinesSchema = z
  .array(z.object({ orderItemId: z.string().min(1), qty: z.number().int().min(1).max(500) }))
  .min(1)
  .max(100);

// Manager: every table of the venue to move lines to (busy ones first).
// Regulars who didn't scan: find their account, open the table, attach them.
function settleCtx(req: any) {
  const role = req.staff!.role;
  forbidStations(role);
  if (!canHandlePayments(role)) {
    throw new HttpError(403, "FORBIDDEN", "Только официант или менеджер");
  }
}

staffDashboardRouter.get(
  "/guests/search",
  asyncHandler(async (req, res) => {
    settleCtx(req);
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const guests = await searchGuests(
      { venueId, shiftId: shift.id, staffId: req.staff!.staffId },
      String(req.query.q ?? "")
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ ok: true, guests });
  })
);

staffDashboardRouter.post(
  "/tables/:id/open",
  asyncHandler(async (req, res) => {
    settleCtx(req);
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const result = await openTable({ venueId, shiftId: shift.id, staffId: req.staff!.staffId }, Number(req.params.id));
    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.post(
  "/tables/:id/guests",
  validate(z.object({ userId: z.string().trim().min(1).max(64) })),
  asyncHandler(async (req, res) => {
    settleCtx(req);
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const result = await attachGuest(
      { venueId, shiftId: shift.id, staffId: req.staff!.staffId },
      Number(req.params.id),
      (req.body as { userId: string }).userId
    );
    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.delete(
  "/tables/:id/guests/:sessionId",
  asyncHandler(async (req, res) => {
    settleCtx(req);
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const result = await detachGuest(
      { venueId, shiftId: shift.id, staffId: req.staff!.staffId },
      Number(req.params.id),
      String(req.params.sessionId)
    );
    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.get(
  "/tables/choices",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    forbidStations(req.staff!.role);
    const shift = await getActiveShiftOrThrow(venueId);
    const [tables, open] = await Promise.all([
      prisma.table.findMany({
        where: { venueId },
        orderBy: { id: "asc" },
        select: { id: true, code: true, label: true },
      }),
      prisma.guestSession.findMany({
        where: { shiftId: shift.id, endedAt: null, table: { venueId } },
        orderBy: { startedAt: "desc" },
        select: { tableId: true, user: { select: { id: true, name: true } } },
      }),
    ]);
    const byTable = new Map<number, Array<{ user: { id: string; name: string } | null }>>();
    for (const session of open) byTable.set(session.tableId, [...(byTable.get(session.tableId) ?? []), session]);
    res.json({
      ok: true,
      tables: tables
        .map((table) => ({
          id: table.id,
          code: toPublicTable(table).code,
          busy: byTable.has(table.id),
          guests: guestNames(byTable.get(table.id) ?? []),
        }))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    });
  })
);

// Manager: «Удалить» chosen lines (not paid, not on a bill being paid).
staffDashboardRouter.post(
  "/tables/:id/items/cancel",
  validate(z.object({ lines: TableLinesSchema, reason: z.string().trim().max(200).optional() })),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const body = req.body as { lines: TableLine[]; reason?: string };
    const result = await cancelTableLines(
      { venueId, shiftId: shift.id, staffId: req.staff!.staffId, role: req.staff!.role, deviceId: staffDeviceOf(req) },
      Number(req.params.id),
      body.lines,
      body.reason
    );
    res.json({ ok: true, ...result });
  })
);

// Manager: «Перенести» chosen lines to another table.
staffDashboardRouter.post(
  "/tables/:id/items/move",
  validate(z.object({ toTableId: z.number().int().positive(), lines: TableLinesSchema })),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const shift = await getActiveShiftOrThrow(venueId);
    const body = req.body as { toTableId: number; lines: TableLine[] };
    const result = await moveTableLines(
      { venueId, shiftId: shift.id, staffId: req.staff!.staffId, role: req.staff!.role },
      Number(req.params.id),
      body.toTableId,
      body.lines
    );
    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.get(
  "/tables/:id",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    forbidStations(role);
    const shift = await getActiveShiftOrThrow(venueId);
    const tableId = Number(req.params.id);

    if (!Number.isFinite(tableId) || tableId <= 0) {
      throw new HttpError(400, "TABLE_ID_INVALID", "Table id is invalid");
    }

    const session = await getActiveTableSessionOrThrow({
      tableId,
      venueId,
      shiftId: shift.id,
    });

    // Whoever settles the table sees the whole bill (hookah included — it is
    // part of what they collect); the hookah master sees his own lines only.
    const sections = canHandlePayments(role) ? null : orderSectionsForRole(role);

    // Every guest who is at the table now (not just the newest session).
    const openSessions = await prisma.guestSession.findMany({
      where: { tableId, endedAt: null, shiftId: shift.id, table: { venueId } },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        userId: true,
        boundById: true,
        user: { select: { id: true, name: true, phone: true, cardNumber: true } },
      },
    });
    const openSessionIds = openSessions.map((candidate) => candidate.id);
    const primary = openSessions.find((candidate) => candidate.user) ?? openSessions[0];

    const [orders, activeCalls, pendingPayment] = await Promise.all([
      prisma.order.findMany({
        where: {
          tableId,
          sessionId: { in: openSessionIds },
          status: { not: "CANCELLED" },
          ...(sections
            ? {
                items: {
                  some: {
                    menuItem: {
                      category: {
                        section: { in: sections },
                      },
                    },
                  },
                },
              }
            : {}),
        },
        orderBy: { createdAt: "asc" },
        include: {
          items: sections
            ? {
                where: {
                  menuItem: { category: { section: { in: sections } } },
                },
                include: {
                  menuItem: { select: { id: true, name: true } },
                },
              }
            : {
                include: {
                  menuItem: { select: { id: true, name: true } },
                },
              },
        },
      }),
      prisma.staffCall.findMany({
        where: {
          sessionId: { in: openSessionIds },
          status: { in: ["NEW", "ACKED"] },
          type: { in: callTypesForRole(role) },
          ...excludeOrderRequestMarker(),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          status: true,
          message: true,
          createdAt: true,
        },
      }),
      (prisma as any).paymentRequest.findFirst({
        where: {
          tableId,
          sessionId: { in: openSessionIds },
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          session: { select: { userId: true, user: { select: { name: true } } } },
          method: true,
          createdAt: true,
          billTotalCzk: true,
          useLoyalty: true,
          loyaltyAppliedCzk: true,
          tipCzk: true,
          confirmation: {
            select: {
              amountCzk: true,
            },
          },
          itemsJson: true,
        },
      }),
    ]);

    // What the waiter must actually collect. `loyaltyAppliedCzk` is written
    // only at confirmation, so for a PENDING request it is always 0 in the row —
    // compute the cashback the guest asked to use the same way /confirm will,
    // otherwise staff would charge the full bill.
    let pendingLoyaltyAppliedCzk = 0;
    // Cashback belongs to the guest who asked for the bill.
    const payerUserId: string | null = pendingPayment?.session?.userId ?? null;
    if (pendingPayment?.useLoyalty && payerUserId) {
      const loyaltyTxns = await prisma.loyaltyTransaction.findMany({
        where: { userId: payerUserId, venueId },
        select: {
          cashbackCzk: true,
          redeemedAmountCzk: true,
          availableAt: true,
          createdAt: true,
        },
      });
      const loyalty = summarizeLoyalty(loyaltyTxns);
      pendingLoyaltyAppliedCzk = Math.min(loyalty.availableCzk, Math.max(pendingPayment.billTotalCzk ?? 0, 0));
    }
    const pendingTipCzk = pendingPayment?.tipCzk ?? 0;
    const pendingDueCzk = pendingPayment
      ? Math.max((pendingPayment.billTotalCzk ?? 0) - pendingLoyaltyAppliedCzk, 0) + pendingTipCzk
      : 0;

    const confirmedPayments = await (prisma as any).paymentRequest.findMany({
      where: {
        tableId,
        status: "CONFIRMED",
        session: { shiftId: shift.id },
      },
      select: {
        status: true,
        createdAt: true,
        confirmedAt: true,
        itemsJson: true,
        confirmation: {
          select: {
            itemsJson: true,
            createdAt: true,
          },
        },
      },
    });

    const payableItems = buildPayableTableItems({
      orders: orders.map((order) => ({
        id: order.id,
        createdAt: order.createdAt,
        status: order.status,
        items: order.items.map((item) => ({
          id: item.id,
          qty: item.qty,
          priceCzk: item.priceCzk,
          comment: item.comment,
          menuItem: item.menuItem,
        })),
      })),
      payments: confirmedPayments,
    });

    const billTotalCzk = payableItems.reduce((sum, item) => sum + item.totalCzk, 0);
    const canDisconnect = !pendingPayment && billTotalCzk <= 0;

    // Each signed-in guest's cashback usable right now (this venue) — the
    // waiter can take it off their part of the bill.
    const peopleIds = Array.from(new Set(openSessions.map((candidate) => candidate.userId).filter((id): id is string => !!id)));
    const peopleTxns = peopleIds.length
      ? await prisma.loyaltyTransaction.findMany({
          where: { userId: { in: peopleIds }, venueId },
          select: { userId: true, cashbackCzk: true, redeemedAmountCzk: true, availableAt: true, createdAt: true },
        })
      : [];
    const cashbackOf = (userId: string) => summarizeLoyalty(peopleTxns.filter((txn) => txn.userId === userId)).availableCzk;

    res.json({
      ok: true,
      table: toPublicTable(session.table),
      session: {
        id: primary?.id ?? session.id,
        startedAt: openSessions.reduce(
          (earliest, candidate) => (candidate.startedAt < earliest ? candidate.startedAt : earliest),
          session.startedAt
        ),
        user: primary?.user ?? session.user,
      },
      // Everyone signed in at the table.
      guests: guestNames(openSessions),
      // The same, for choosing who pays (cashback) and for «Отвязать».
      people: (() => {
        const seen = new Set<string>();
        const people: Array<{
          sessionId: string;
          userId: string;
          name: string;
          card: string | null;
          attached: boolean;
          cashbackCzk: number;
        }> = [];
        for (const candidate of openSessions) {
          if (!candidate.user || seen.has(candidate.user.id)) continue;
          seen.add(candidate.user.id);
          people.push({
            sessionId: candidate.id,
            userId: candidate.user.id,
            name: candidate.user.name?.trim() || "Гость с аккаунтом",
            card: cardTail(candidate.user.cardNumber),
            attached: !!candidate.boundById,
            cashbackCzk: cashbackOf(candidate.user.id),
          });
        }
        return people;
      })(),
      orders: orders.map((order) => ({
        ...order,
        totalCzk: order.items.reduce((sum, item) => sum + item.qty * item.priceCzk, 0),
      })),
      payableItems,
      billTotalCzk,
      activeCalls: activeCalls.map((call) => ({ ...call, message: staffCallMessage(call.type, call.message) })),
      pendingPayment: pendingPayment
        ? {
            ...pendingPayment,
            // Whose account gets the cashback of this bill (null: nobody's).
            payerName: pendingPayment.session?.userId
              ? pendingPayment.session.user?.name?.trim() || "Гость с аккаунтом"
              : null,
            loyaltyAppliedCzk: pendingLoyaltyAppliedCzk,
            tipCzk: pendingTipCzk,
            dueCzk: pendingDueCzk,
            selectedItems: parsePaymentItemsJson(pendingPayment.itemsJson),
          }
        : null,
      capabilities: {
        canAddItems: true,
        canSettle: canHandlePayments(role),
        canDisconnect,
        disconnectBlockedReason: canDisconnect ? null : disconnectBlockedReason(),
      },
    });
  })
);

const CreateStaffTablePaymentSchema = z.object({
  method: z.enum(["CARD", "CASH"]),
  // Who pays — their account gets the cashback. "none": somebody without an
  // account. Default: the guest signed in at the table.
  payerSessionId: z.string().trim().min(1).max(64).optional(),
  // Take the payer's cashback off this bill (the guest said yes).
  useCashback: z.boolean().optional(),
  // The bill split between guests: only these lines. Default: all unpaid.
  items: z
    .array(z.object({ orderItemId: z.string().trim().min(1), qty: z.number().int().min(1).max(1000) }))
    .min(1)
    .max(300)
    .optional(),
});

staffDashboardRouter.post(
  "/tables/:id/request-payment",
  validate(CreateStaffTablePaymentSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);
    const tableId = Number(req.params.id);

    if (!canHandlePayments(role)) {
      throw new HttpError(403, "FORBIDDEN", "Only waiter or manager can settle a table");
    }
    if (!Number.isFinite(tableId) || tableId <= 0) {
      throw new HttpError(400, "TABLE_ID_INVALID", "Table id is invalid");
    }

    const body = req.body as z.infer<typeof CreateStaffTablePaymentSchema>;
    await getActiveTableSessionOrThrow({
      tableId,
      venueId,
      shiftId: shift.id,
    });

    // The bill goes on the payer's session: confirming it gives THEIR account
    // the cashback. Without a choice — the guest signed in at the table (not
    // simply the newest session, which may be a friend without an account).
    const seated = await prisma.guestSession.findMany({
      where: { tableId, shiftId: shift.id, endedAt: null, table: { venueId } },
      orderBy: { startedAt: "desc" },
      select: { id: true, userId: true },
    });
    let session: { id: string; userId?: string | null } | undefined;
    if (body.payerSessionId === "none") {
      session =
        seated.find((candidate) => !candidate.userId) ??
        (await prisma.guestSession.create({ data: { tableId, shiftId: shift.id }, select: { id: true, userId: true } }));
    } else if (body.payerSessionId) {
      session = seated.find((candidate) => candidate.id === body.payerSessionId);
      if (!session) throw new HttpError(400, "PAYER_NOT_AT_TABLE", "Этого гостя нет за столом — обновите стол");
    } else {
      session = seated.find((candidate) => candidate.userId) ?? seated[0];
    }
    if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "No active session for this table");
    // Cashback can only come off a bill paid by a guest with an account; how
    // much is decided at confirmation (their balance at that moment).
    const useLoyalty = !!body.useCashback && !!session.userId;

    const tableWithBilling = await (prisma as any).table.findUnique({
      where: { id: tableId },
      select: {
        venueId: true,
        orders: {
          // Table-wide common bill within the current shift — must match the
          // guest payment path (payments.routes.ts), which scopes by shift, not
          // by a single session. Scoping by one sessionId here would show a
          // partial bill when the table's open order is bound to another of the
          // party's sessions.
          where: {
            session: { shiftId: shift.id },
            status: { not: "CANCELLED" },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            createdAt: true,
            status: true,
            items: {
              select: {
                id: true,
                qty: true,
                priceCzk: true,
                comment: true,
                menuItem: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        payments: {
          where: {
            status: "CONFIRMED",
            session: { shiftId: shift.id },
          },
          select: {
            status: true,
            createdAt: true,
            confirmedAt: true,
            itemsJson: true,
            confirmation: {
              select: {
                itemsJson: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!tableWithBilling || tableWithBilling.venueId !== venueId) {
      throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");
    }

    const payableItems = buildPayableTableItems({
      orders: tableWithBilling.orders,
      payments: tableWithBilling.payments,
    });

    if (!payableItems.length) {
      throw new HttpError(409, "NOTHING_TO_PAY", "Nothing left to pay in this tab");
    }

    // A split bill: only the lines (and quantities) this guest pays for.
    let billed = payableItems;
    if (body.items) {
      const byId = new Map(payableItems.map((item) => [item.orderItemId, item]));
      const seen = new Set<string>();
      billed = body.items.map((line) => {
        const source = byId.get(line.orderItemId);
        if (!source || seen.has(line.orderItemId)) {
          throw new HttpError(400, "ITEM_NOT_PAYABLE", "Позиция уже оплачена или убрана — обновите стол");
        }
        if (line.qty > source.qty) throw new HttpError(400, "ITEM_QTY_INVALID", "Неверное количество — обновите стол");
        seen.add(line.orderItemId);
        return { ...source, qty: line.qty, totalCzk: line.qty * source.unitPriceCzk };
      });
    }

    const billTotalCzk = billed.reduce((sum, item) => sum + item.totalCzk, 0);
    if (billTotalCzk <= 0) {
      throw new HttpError(400, "EMPTY_PAYMENT_SELECTION", "Выберите хотя бы одну позицию");
    }
    const itemsJson = billed.map((item) => ({
      orderItemId: item.orderItemId,
      menuItemId: item.menuItemId,
      name: item.name,
      qty: item.qty,
      unitPriceCzk: item.unitPriceCzk,
      totalCzk: item.totalCzk,
      comment: item.comment,
    }));

    // One PENDING payment per table (matches the guest path): reuse any open
    // request at the table instead of creating a second one — two coexisting
    // PENDING requests both snapshot the full payable bill and could each be
    // confirmed, double-charging and double-granting cashback.
    const existing = await (prisma as any).paymentRequest.findFirst({
      where: {
        tableId,
        status: "PENDING",
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
    });

    const payment = existing
      ? await (prisma as any).paymentRequest.update({
          where: { id: existing.id },
          data: {
            sessionId: session.id,
            method: body.method,
            billTotalCzk,
            useLoyalty,
            loyaltyAppliedCzk: 0,
            itemsJson,
          },
        })
      : await (prisma as any).paymentRequest.create({
          data: {
            sessionId: session.id,
            tableId,
            method: body.method,
            billTotalCzk,
            useLoyalty,
            loyaltyAppliedCzk: 0,
            itemsJson,
          },
        });

    void notifyPaymentRequested(payment.id, { exceptDevice: staffDeviceOf(req) }).catch((e: unknown) => {
      console.warn("push notifyPaymentRequested failed", e);
    });

    emitGuestEvent(tableId, "payment-requested");

    // A brand-new bill from the waiter's side — tell the guests it's ready.
    // A re-issue of an existing request is already known to them.
    if (!existing) {
      void notifyGuestsBillIssued(payment.id).catch((e: unknown) => {
        console.warn("guest push notifyGuestsBillIssued failed", e);
      });
    }

    res.json({ ok: true, payment });
  })
);

// CALLS
staffDashboardRouter.get(
  "/calls",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const status = (req.query.status as CallStatus | undefined) ?? "NEW";
    const types = callTypesForRole(role);

    const shift = await getActiveShiftOrThrow(venueId);
    if (types.length === 0) {
      return res.json({ ok: true, calls: [] });
    }

    const calls = await prisma.staffCall.findMany({
      where: {
        status,
        type: { in: types },
        ...excludeOrderRequestMarker(),
        table: { venueId },
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { id: true, code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    res.json({
      ok: true,
      calls: calls.map((call) => ({
        ...call,
        message: staffCallMessage(call.type, call.message),
        table: toPublicTable(call.table),
      })),
    });
  })
);

staffDashboardRouter.get(
  "/order-requests",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    if (!canTakeOrderRequests(role)) {
      return res.json({ ok: true, requests: [] });
    }

    const requests = await prisma.staffCall.findMany({
      where: {
        status: { in: ["NEW", "ACKED"] },
        ...orderRequestWhere(),
        table: { venueId },
        createdAt: { gte: shift.openedAt },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { id: true, code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    // Resolve the dishes guests picked (requestedItemsJson) into names/prices,
    // so staff see the selection and can place the actual order.
    const allIds = new Set<number>();
    for (const r of requests) {
      const raw = (r as any).requestedItemsJson;
      if (Array.isArray(raw)) for (const it of raw) {
        const n = Number(it?.menuItemId);
        if (Number.isFinite(n)) allIds.add(n);
      }
    }
    const menuItems = allIds.size
      ? await prisma.menuItem.findMany({
          where: { id: { in: Array.from(allIds) } },
          select: { id: true, name: true, priceCzk: true },
        })
      : [];
    const itemById = new Map(menuItems.map((m) => [m.id, m]));
    const resolveItems = (raw: unknown) =>
      Array.isArray(raw)
        ? raw
            .map((it: any) => {
              const mi = itemById.get(Number(it?.menuItemId));
              const qty = Number(it?.qty);
              if (!mi || !Number.isFinite(qty) || qty <= 0) return null;
              return { menuItemId: mi.id, name: mi.name, qty, priceCzk: mi.priceCzk };
            })
            .filter(Boolean)
        : [];

    res.json({
      ok: true,
      requests: requests.map((request) => ({
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
        table: toPublicTable(request.table),
        session: request.session,
        items: resolveItems((request as any).requestedItemsJson),
      })),
    });
  })
);

staffDashboardRouter.post(
  "/order-requests/:id/connect",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    if (!canTakeOrderRequests(role)) {
      throw new HttpError(403, "FORBIDDEN", "This role cannot take table orders");
    }

    const { id } = IdParamSchema.parse(req.params);
    const request = await prisma.staffCall.findUnique({
      where: { id },
      include: {
        table: { select: { id: true, code: true, label: true, venueId: true } },
        session: { select: { id: true, shiftId: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    if (!request || !isOrderRequestCall(request)) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }
    if (request.table.venueId !== venueId || request.createdAt < shift.openedAt) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }

    const updated = await prisma.staffCall.update({
      where: { id: request.id },
      data: {
        status: request.status === "NEW" ? "ACKED" : request.status,
      },
    });

    emitGuestEvent(request.tableId, "order-request-acked");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    if (request.status === "NEW") {
      void notifyGuestCallUpdated(request.id).catch((e) => {
        console.warn("guest push notifyGuestCallUpdated failed", e);
      });
    }

    res.json({
      ok: true,
      request: {
        id: updated.id,
        status: updated.status,
        createdAt: updated.createdAt,
        table: toPublicTable(request.table),
        session: request.session,
      },
    });
  })
);

// A request that will never turn into an order (guest changed their mind, or
// just had a question) must be closable, otherwise its card would sit in the
// Orders tab forever.
staffDashboardRouter.post(
  "/order-requests/:id/done",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    if (!canTakeOrderRequests(req.staff!.role)) {
      throw new HttpError(403, "FORBIDDEN", "This role cannot take table orders");
    }
    const shift = await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const request = await prisma.staffCall.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        message: true,
        tableId: true,
        createdAt: true,
        table: { select: { venueId: true } },
      },
    });

    if (!request || !isOrderRequestCall(request)) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }
    if (request.table.venueId !== venueId || request.createdAt < shift.openedAt) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }

    await prisma.staffCall.update({ where: { id: request.id }, data: { status: "DONE" } });

    emitGuestEvent(request.tableId, "order-request-done");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    res.json({ ok: true });
  })
);

const UpdateCallStatusSchema = z.object({
  status: z.enum(["NEW", "ACKED", "DONE"]),
});

staffDashboardRouter.patch(
  "/calls/:id/status",
  validate(UpdateCallStatusSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body as any;

    const allowedTypes = callTypesForRole(role);

    const call = await prisma.staffCall.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        tableId: true,
        session: { select: { shiftId: true } },
        table: { select: { venueId: true } },
      },
    });

    if (!call) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (call.table.venueId !== venueId) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (!allowedTypes.includes(call.type)) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");

    await prisma.staffCall.update({
      where: { id: call.id },
      data: { status },
    });

    emitGuestEvent(call.tableId, "call-status");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    // Staff took the request (NEW → ACKED / DONE): the guest sees "on the way"
    // or "being handled" on the lock screen. Exactly once per call.
    if (call.status === "NEW" && status !== "NEW") {
      void notifyGuestCallUpdated(call.id).catch((e) => {
        console.warn("guest push notifyGuestCallUpdated failed", e);
      });
    }

    res.json({ ok: true });
  })
);

// PAYMENTS
staffDashboardRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;

    if (!canHandlePayments(role)) {
      return res.json({ ok: true, payments: [] });
    }

    const status = (req.query.status as PaymentStatus | undefined) ?? "PENDING";
    const shift = await getActiveShiftOrThrow(venueId);

    const payments = await (prisma as any).paymentRequest.findMany({
      where: {
        status,
        table: { venueId },
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: {
            code: true,
            label: true,
            orders: {
              where: {
                table: { venueId },
              },
              select: {
                createdAt: true,
                status: true,
                items: {
                  select: {
                    qty: true,
                    priceCzk: true,
                  },
                },
              },
            },
            payments: {
              where: { status: "CONFIRMED", table: { venueId } },
              select: {
                id: true,
                confirmedAt: true,
                createdAt: true,
                confirmation: {
                  select: { amountCzk: true, createdAt: true },
                },
              },
            },
          },
        },
        confirmation: {
          select: {
            amountCzk: true,
            billTotalCzk: true,
            loyaltyAppliedCzk: true,
            itemsJson: true,
          },
        },
        session: {
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                loyaltyTransactions: {
                  where: {
                    venueId,
                  },
                  select: {
                    createdAt: true,
                    cashbackCzk: true,
                    redeemedAmountCzk: true,
                    availableAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const enrichedPayments = payments.map((payment: any) => {
      const loyalty = summarizeLoyalty(payment.session.user?.loyaltyTransactions ?? []);
      const selectedItems = parsePaymentItemsJson(payment.confirmation?.itemsJson ?? payment.itemsJson);
      const billTotalCzk =
        payment.status === "CONFIRMED"
          ? payment.confirmation?.billTotalCzk ?? payment.billTotalCzk ?? 0
          : payment.billTotalCzk ?? selectedItems.reduce((sum, item) => sum + item.totalCzk, 0);
      const pendingLoyaltyAppliedCzk = payment.useLoyalty
        ? Math.min(loyalty.availableCzk, Math.max(billTotalCzk, 0))
        : 0;
      const pendingRequestedAmountCzk = Math.max(billTotalCzk - pendingLoyaltyAppliedCzk, 0);
      const confirmedLoyaltyAppliedCzk =
        payment.confirmation?.loyaltyAppliedCzk ?? payment.loyaltyAppliedCzk ?? 0;
      const paidAmountCzk = payment.confirmation?.amountCzk ?? pendingRequestedAmountCzk;

      return {
        ...payment,
        table: toPublicTable(payment.table),
        session: {
          id: payment.session.id,
          userId: payment.session.userId,
          user: payment.session.user,
        },
        useLoyalty: Boolean(payment.useLoyalty),
        loyaltyAppliedCzk:
          payment.status === "CONFIRMED" ? confirmedLoyaltyAppliedCzk : pendingLoyaltyAppliedCzk,
        requestedAmountCzk:
          payment.status === "CONFIRMED" ? paidAmountCzk : pendingRequestedAmountCzk,
        billTotalCzk,
        paidAmountCzk,
        items: selectedItems,
      };
    });

    res.json({ ok: true, payments: enrichedPayments });
  })
);

const ConfirmPaymentSchema = z.object({
  amountCzk: z.coerce.number().int().min(1).optional(),
});

staffDashboardRouter.post(
  "/payments/:id/confirm",
  validate(ConfirmPaymentSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    if (!canHandlePayments(role)) {
      throw new HttpError(403, "FORBIDDEN", "This role cannot confirm payments");
    }

    const staffId = req.staff!.staffId;
    const { id } = IdParamSchema.parse(req.params);
    const CASHBACK_PERCENT = 10;

    const result = await prisma.$transaction(async (tx) => {
      const pr = await (tx as any).paymentRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          sessionId: true,
          tableId: true,
          method: true,
          billTotalCzk: true,
          tipCzk: true,
          itemsJson: true,
          useLoyalty: true,
          table: {
            select: {
              venueId: true,
            },
          },
          session: {
            select: {
              shiftId: true,
              userId: true,
            },
          },
        },
      });

      if (!pr) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
      if (pr.table.venueId !== venueId) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");

      if (pr.status !== "PENDING") {
        throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
      }

      const selectedItems = parsePaymentItemsJson(pr.itemsJson);
      const billTotalCzk = pr.billTotalCzk || selectedItems.reduce((sum, item) => sum + item.totalCzk, 0);
      // Tip rides along untouched: not part of amountCzk (cashback base and
      // venue revenue), stored on the confirmation for receipts and reports.
      const tipCzk = Math.max(Number(pr.tipCzk ?? 0), 0);
      const userId = pr.session?.userId ?? null;

      // CORRECTNESS: lock this user's loyalty rows for the rest of the
      // transaction so two concurrent confirmations (e.g. the same guest
      // settling at two tables at once) cannot both redeem the same cashback
      // balance. The second confirm blocks on the row lock until the first
      // commits, then reads the already-updated balances below.
      let loyaltyTxns: Array<{
        id: string;
        createdAt: Date;
        cashbackCzk: number;
        redeemedAmountCzk: number;
        availableAt: Date;
      }> = [];
      if (userId) {
        await (tx as any)
          .$queryRaw`SELECT id FROM "LoyaltyTransaction" WHERE "userId" = ${userId} AND "venueId" = ${venueId} FOR UPDATE`;
        loyaltyTxns = await (tx as any).loyaltyTransaction.findMany({
          where: { userId, venueId },
          select: {
            id: true,
            createdAt: true,
            cashbackCzk: true,
            redeemedAmountCzk: true,
            availableAt: true,
          },
        });
      }

      const loyaltySummary = summarizeLoyalty(loyaltyTxns as any[]);
      const loyaltyAppliedCzk = pr.useLoyalty
        ? Math.min(loyaltySummary.availableCzk, Math.max(billTotalCzk, 0))
        : 0;
      const amountCzk = Math.max(billTotalCzk - loyaltyAppliedCzk, 0);

      if (amountCzk < 0) {
        throw new HttpError(409, "PAYMENT_ALREADY_SETTLED", "Payment is already settled");
      }

      // Atomic guard against a double-confirm race (двойной клик / две вкладки):
      // only the transaction that actually flips PENDING→CONFIRMED proceeds to
      // redeem loyalty / grant cashback. A concurrent one matches 0 rows and aborts.
      const guard = await (tx as any).paymentRequest.updateMany({
        where: { id: pr.id, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          confirmedByStaffId: staffId,
          loyaltyAppliedCzk,
        },
      });

      if (guard.count !== 1) {
        throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
      }

      const updated = await (tx as any).paymentRequest.findUnique({ where: { id: pr.id } });

      const confirmation = await (tx as any).paymentConfirmation.upsert({
        where: { paymentRequestId: pr.id },
        update: { billTotalCzk, amountCzk, loyaltyAppliedCzk, tipCzk, itemsJson: selectedItems },
        create: {
          paymentRequestId: pr.id,
          venueId,
          staffId,
          userId: pr.session?.userId ?? null,
          method: pr.method,
          billTotalCzk,
          amountCzk,
          loyaltyAppliedCzk,
          tipCzk,
          itemsJson: selectedItems,
        },
      });

      if (loyaltyAppliedCzk > 0) {
        let remainingToRedeem = loyaltyAppliedCzk;
        const availableTxns = [...loyaltyTxns]
          .filter((txn: any) => effectiveAvailableAt(txn).getTime() <= Date.now())
          .map((txn: any) => ({
            ...txn,
            remaining: Math.max(txn.cashbackCzk - (txn.redeemedAmountCzk ?? 0), 0),
          }))
          .filter((txn: any) => txn.remaining > 0)
          .sort((a: any, b: any) => effectiveAvailableAt(a).getTime() - effectiveAvailableAt(b).getTime());

        for (const txn of availableTxns) {
          if (remainingToRedeem <= 0) break;
          const take = Math.min(txn.remaining, remainingToRedeem);

          await (tx as any).loyaltyTransaction.update({
            where: { id: txn.id },
            data: {
              redeemedAmountCzk: (txn.redeemedAmountCzk ?? 0) + take,
              redeemedAt: new Date(),
              redeemedInPaymentConfirmationId: confirmation.id,
            },
          });

          remainingToRedeem -= take;
        }
      }

      let loyaltyTxn = null;

      if (userId && amountCzk > 0) {
        const cashbackCzk = Math.floor((amountCzk * CASHBACK_PERCENT) / 100);
        loyaltyTxn =
          cashbackCzk > 0
            ? await (tx as any).loyaltyTransaction.upsert({
                where: { paymentConfirmationId: confirmation.id },
                update: {
                  baseAmountCzk: amountCzk,
                  cashbackCzk,
                  availableAt: nextPragueMidnight(new Date()),
                },
                create: {
                  venueId,
                  userId,
                  staffId,
                  paymentConfirmationId: confirmation.id,
                  baseAmountCzk: amountCzk,
                  cashbackCzk,
                  availableAt: nextPragueMidnight(new Date()),
                },
              })
            : null;
      }

      return { updated, confirmation, loyalty: loyaltyTxn, loyaltyAppliedCzk };
    });

    emitGuestEvent(result.updated?.tableId, "payment-confirmed");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    void notifyGuestPayment(id, "confirmed").catch((e) => {
      console.warn("guest push notifyGuestPayment(confirmed) failed", e);
    });

    // Re-arm the post-payment "stay or leave?" prompt for everyone at the table
    // (clear any previous "stay" choice). The table is NOT force-freed here:
    // once the bill is fully paid the guest is asked whether to stay and order
    // more; if they decline or do nothing, the session auto-ends after the
    // grace period (GUEST_SESSION_AUTO_END_AFTER_PAYMENT_MINUTES) — surfaced to
    // staff via the /tables expiry sweep.
    const paidTableId = result.updated?.tableId;
    const paidSessionId = result.updated?.sessionId;
    if (typeof paidTableId === "number") {
      // Re-arm the "stay or leave?" prompt only for the session that just paid —
      // don't clobber another guest's earlier "stay" choice.
      if (paidSessionId) {
        await prisma.guestSession
          .updateMany({
            where: { id: paidSessionId, endedAt: null, stayOptIn: true },
            data: { stayOptIn: false },
          })
          .catch(() => {});
      }
      emitGuestEvent(paidTableId, "payment-confirmed");
    }

    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.post(
  "/payments/:id/cancel",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    await getActiveShiftOrThrow(venueId);

    if (!canHandlePayments(role)) {
      throw new HttpError(403, "FORBIDDEN", "This role cannot cancel payments");
    }

    const { id } = IdParamSchema.parse(req.params);

    const payment = await (prisma as any).paymentRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        session: {
          select: {
            shiftId: true,
            table: {
              select: {
                venueId: true,
              },
            },
          },
        },
      },
    });

    if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
    if (payment.session?.table.venueId !== venueId) {
      throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
    }
    if (payment.status !== "PENDING") {
      throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
    }

    const updated = await (prisma as any).paymentRequest.update({
      where: { id: payment.id },
      data: {
        status: "CANCELLED",
        loyaltyAppliedCzk: 0,
      },
    });

    emitGuestEvent(updated?.tableId, "payment-cancelled");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    void notifyGuestPayment(payment.id, "cancelled").catch((e) => {
      console.warn("guest push notifyGuestPayment(cancelled) failed", e);
    });

    res.json({ ok: true, paymentRequest: updated });
  })
);

// Change the method (card ↔ cash) of a PENDING payment — e.g. the guest asked
// for the terminal but then wants to pay cash.
const ChangePaymentMethodSchema = z.object({ method: z.enum(["CARD", "CASH"]) });

staffDashboardRouter.post(
  "/payments/:id/method",
  validate(ChangePaymentMethodSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    await getActiveShiftOrThrow(venueId);

    if (!canHandlePayments(role)) {
      throw new HttpError(403, "FORBIDDEN", "This role cannot change payments");
    }

    const { id } = IdParamSchema.parse(req.params);
    const { method } = req.body as { method: "CARD" | "CASH" };

    const pr = await (prisma as any).paymentRequest.findUnique({
      where: { id },
      select: { id: true, status: true, tableId: true, table: { select: { venueId: true } } },
    });

    if (!pr || pr.table.venueId !== venueId) {
      throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
    }
    if (pr.status !== "PENDING") {
      throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
    }

    const updated = await (prisma as any).paymentRequest.update({
      where: { id: pr.id },
      data: { method },
    });

    emitGuestEvent(pr.tableId, "payment-method-changed");
    emitStaffEvent(venueId, { kind: "DATA_CHANGED" });

    res.json({ ok: true, paymentRequest: updated });
  })
);
