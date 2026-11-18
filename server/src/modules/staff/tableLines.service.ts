import type { StaffRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { paidQtyByOrderItemId, parsePaymentItemsJson } from "../payments/paymentAllocation";
import { emitGuestEvent } from "../guest/guestEvents";
import { canCancelItems } from "./roles";
import { emitStaffEvent } from "./staffEvents";
import { upsertOpenTableOrder } from "./openOrder";
import { announceOrderStatus, cancelOrderLine, refreshOrderStatus } from "./tickets.service";
import { toPublicTable } from "./tableView";

/**
 * Manager only: take chosen lines off a table, or move them to another table
 * (guests changed tables, a line was punched on the wrong table). Only what is
 * not paid yet and not on a bill being paid right now.
 */

export type TableLine = { orderItemId: string; qty: number };

type Ctx = { venueId: number; shiftId: string; staffId: string; role: StaffRole };

async function loadLines(ctx: Ctx, tableId: number, lines: TableLine[], verb: string) {
  if (!canCancelItems(ctx.role)) {
    throw new HttpError(403, "FORBIDDEN", `${verb} позиции может только менеджер`);
  }
  if (lines.length === 0) throw new HttpError(400, "INVALID_INPUT", "Выберите позиции");

  const ids = Array.from(new Set(lines.map((line) => line.orderItemId)));
  if (ids.length !== lines.length) throw new HttpError(400, "INVALID_INPUT", "Позиция выбрана дважды");

  const items = await prisma.orderItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      orderId: true,
      qty: true,
      comment: true,
      priceCzk: true,
      menuItemId: true,
      ticketId: true,
      menuItem: { select: { name: true } },
      order: {
        select: { id: true, tableId: true, status: true, table: { select: { venueId: true } }, session: { select: { shiftId: true } } },
      },
    },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  const payments = await prisma.paymentRequest.findMany({
    where: { tableId, status: { in: ["CONFIRMED", "PENDING"] }, session: { shiftId: ctx.shiftId } },
    select: { status: true, itemsJson: true, confirmation: { select: { itemsJson: true } } },
  });
  const paid = paidQtyByOrderItemId(payments);
  const onPendingBill = new Set(
    payments
      .filter((payment) => payment.status === "PENDING")
      .flatMap((payment) => parsePaymentItemsJson(payment.itemsJson).map((line) => line.orderItemId))
  );

  return lines.map((line) => {
    const item = byId.get(line.orderItemId);
    if (
      !item ||
      item.order.tableId !== tableId ||
      item.order.table.venueId !== ctx.venueId ||
      item.order.session?.shiftId !== ctx.shiftId ||
      item.order.status === "CANCELLED"
    ) {
      throw new HttpError(404, "ITEM_NOT_FOUND", "Позиция не найдена на этом столе");
    }
    const name = item.menuItem.name;
    if ((paid.get(item.id) ?? 0) > 0) throw new HttpError(409, "ITEM_ALREADY_PAID", `Уже оплачено: ${name}`);
    if (onPendingBill.has(item.id)) {
      throw new HttpError(409, "ITEM_ON_PENDING_BILL", `${name} — в выставленном счёте. Сначала отмените счёт.`);
    }
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > item.qty) {
      throw new HttpError(400, "INVALID_QTY", `Неверное количество: ${name}`);
    }
    return { item, qty: line.qty };
  });
}

/** «Удалить»: every chosen line goes through the regular cancellation (report, station alert). */
export async function cancelTableLines(
  ctx: Ctx & { deviceId?: string | null },
  tableId: number,
  lines: TableLine[],
  reason?: string | null
) {
  const checked = await loadLines(ctx, tableId, lines, "Удалять");
  for (const { item, qty } of checked) {
    await cancelOrderLine({
      venueId: ctx.venueId,
      shiftId: ctx.shiftId,
      staffId: ctx.staffId,
      role: ctx.role,
      orderId: item.orderId,
      orderItemId: item.id,
      qty,
      reason,
      deviceId: ctx.deviceId,
    });
  }
  return { cancelled: checked.reduce((sum, line) => sum + line.qty, 0) };
}

/**
 * «Перенести»: the lines move to the other table's open order. Their kitchen /
 * bar tickets follow them: a ticket that moves completely changes table; a
 * ticket split by the move is copied for the new table with the same status
 * and timing, so nothing is cooked twice and nothing is lost.
 */
export async function moveTableLines(ctx: Ctx, fromTableId: number, toTableId: number, lines: TableLine[]) {
  if (fromTableId === toTableId) throw new HttpError(400, "SAME_TABLE", "Выберите другой стол");
  const target = await prisma.table.findFirst({
    where: { id: toTableId, venueId: ctx.venueId },
    select: { id: true, code: true, label: true },
  });
  if (!target) throw new HttpError(404, "TABLE_NOT_FOUND", "Стол не найден");

  const checked = await loadLines(ctx, fromTableId, lines, "Переносить");
  const touchedTickets = Array.from(new Set(checked.map((line) => line.item.ticketId).filter((id): id is string => !!id)));

  const result = await prisma.$transaction(async (tx) => {
    const sourceOrderIds = Array.from(new Set(checked.map((line) => line.item.orderId)));
    for (const orderId of sourceOrderIds) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

    // Guests already sitting there — or the table is opened for them now.
    const seated = await tx.guestSession.findMany({
      where: { tableId: toTableId, shiftId: ctx.shiftId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, userId: true },
    });
    const session =
      seated.find((candidate) => candidate.userId) ??
      seated[0] ??
      (await tx.guestSession.create({
        data: { tableId: toTableId, shiftId: ctx.shiftId },
        select: { id: true, userId: true },
      }));
    const order = await upsertOpenTableOrder(tx, {
      tableId: toTableId,
      sessionId: session.id,
      userId: session.userId,
      shiftId: ctx.shiftId,
    });

    // Re-read under the lock: nothing changed since the checks.
    const fresh = new Map(
      (
        await tx.orderItem.findMany({
          where: { id: { in: checked.map((line) => line.item.id) } },
          select: { id: true, qty: true, orderId: true },
        })
      ).map((row) => [row.id, row])
    );
    for (const { item, qty } of checked) {
      const row = fresh.get(item.id);
      if (!row || row.orderId !== item.orderId || row.qty < qty) {
        throw new HttpError(409, "ITEM_CHANGED", "Позиции только что изменились — обновите стол и повторите");
      }
    }

    // Tickets: move whole, or split off a copy for the new table.
    const newTicketFor = new Map<string, string>();
    for (const ticketId of touchedTickets) {
      const ticketItems = await tx.orderItem.findMany({ where: { ticketId }, select: { id: true, qty: true } });
      const movesAll = ticketItems.every((ticketItem) => {
        const line = checked.find((candidate) => candidate.item.id === ticketItem.id);
        return !!line && line.qty === ticketItem.qty;
      });
      if (movesAll) {
        await tx.stationTicket.update({ where: { id: ticketId }, data: { tableId: toTableId, orderId: order.id } });
        newTicketFor.set(ticketId, ticketId);
      } else {
        const source = await tx.stationTicket.findUniqueOrThrow({ where: { id: ticketId } });
        const copy = await tx.stationTicket.create({
          data: {
            venueId: source.venueId,
            tableId: toTableId,
            orderId: order.id,
            shiftId: source.shiftId,
            station: source.station,
            status: source.status,
            isAddon: source.isAddon,
            createdById: source.createdById,
            acceptedById: source.acceptedById,
            readyById: source.readyById,
            servedById: source.servedById,
            createdAt: source.createdAt,
            acceptedAt: source.acceptedAt,
            readyAt: source.readyAt,
            servedAt: source.servedAt,
            cancelledAt: source.cancelledAt,
            lastRemindedAt: source.lastRemindedAt,
            reminderCount: source.reminderCount,
            etaAt: source.etaAt,
            etaMinutes: source.etaMinutes,
          },
          select: { id: true },
        });
        newTicketFor.set(ticketId, copy.id);
      }
    }

    for (const { item, qty } of checked) {
      const ticketId = item.ticketId ? newTicketFor.get(item.ticketId) ?? null : null;
      if (qty === item.qty) {
        await tx.orderItem.update({ where: { id: item.id }, data: { orderId: order.id, ticketId } });
      } else {
        await tx.orderItem.update({ where: { id: item.id }, data: { qty: item.qty - qty } });
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            ticketId,
            menuItemId: item.menuItemId,
            qty,
            comment: item.comment,
            priceCzk: item.priceCzk,
          },
        });
      }
    }

    const changes = [];
    for (const orderId of [...sourceOrderIds, order.id]) changes.push(await refreshOrderStatus(tx, orderId));
    return { changes, targetOrderId: order.id };
  });

  // Both tables' bills changed: guests and staff screens refresh. An order
  // emptied by the move simply disappears — no "cancelled" push to guests.
  for (const change of result.changes) announceOrderStatus(change, { push: false });
  emitGuestEvent(fromTableId, "order-status");
  emitGuestEvent(toTableId, "order-status");
  emitStaffEvent(ctx.venueId, { kind: "DATA_CHANGED" });

  return {
    moved: checked.reduce((sum, line) => sum + line.qty, 0),
    toTable: toPublicTable(target).code,
  };
}
