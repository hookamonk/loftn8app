import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { requireStaffAuth } from "./staff.middleware";
import { effectiveAvailableAt, nextPragueMidnight, summarizeLoyalty } from "../../utils/loyalty";
import { notifyOrderCreated } from "../staff/push.service";
import { ORDER_REQUEST_MARKER, isOrderRequestMessage } from "../orders/orderRequest";
import { parsePaymentItemsJson } from "../payments/paymentAllocation";
import { publicTableCode } from "../../config/venues";
import type {
  CallType,
  CallStatus,
  OrderStatus,
  PaymentStatus,
  StaffRole,
  MenuSection,
} from "@prisma/client";

export const staffDashboardRouter = Router();
staffDashboardRouter.use(requireStaffAuth);

const IdParamSchema = z.object({
  id: z.string().min(1),
});

function callTypesForRole(role: StaffRole): CallType[] {
  if (role === "WAITER") return ["WAITER", "BILL", "HELP"];
  if (role === "HOOKAH") return ["HOOKAH", "HELP"];
  return ["WAITER", "HOOKAH", "BILL", "HELP"];
}

function orderSectionsForRole(role: StaffRole): MenuSection[] | null {
  if (role === "HOOKAH") return ["HOOKAH"];
  if (role === "WAITER") return ["DISHES", "DRINKS"];
  return null;
}

function toPublicTable<T extends { code: string; label: string | null }>(table: T): T {
  return {
    ...table,
    code: publicTableCode(table.code),
  };
}

async function createOrAppendTableOrder(
  tx: typeof prisma,
  params: {
    tableId: number;
    sessionId: string;
    userId?: string | null;
    comment?: string | null;
    items: Array<{
      menuItemId: number;
      qty: number;
      comment?: string;
      priceCzk: number;
    }>;
  }
) {
  const latestConfirmedPayment = await (tx as any).paymentRequest.findFirst({
    where: {
      tableId: params.tableId,
      status: "CONFIRMED",
    },
    orderBy: { confirmedAt: "desc" },
    select: {
      confirmedAt: true,
      createdAt: true,
    },
  });

  const paidThroughAt = latestConfirmedPayment?.confirmedAt ?? latestConfirmedPayment?.createdAt ?? null;
  const existingOpenOrder = await tx.order.findFirst({
    where: {
      tableId: params.tableId,
      status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] },
      ...(paidThroughAt
        ? {
            createdAt: {
              gt: paidThroughAt,
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      comment: true,
    },
  });

  const mergedComment = (() => {
    const left = String(existingOpenOrder?.comment ?? "").trim();
    const right = String(params.comment ?? "").trim();
    if (!left) return right || null;
    if (!right || left === right) return left;
    return `${left} | ${right}`;
  })();

  if (existingOpenOrder) {
    return tx.order.update({
      where: { id: existingOpenOrder.id },
      data: {
        sessionId: params.sessionId,
        userId: params.userId ?? null,
        status: "IN_PROGRESS",
        comment: mergedComment,
        items: {
          create: params.items,
        },
      },
      include: { items: true },
    });
  }

  return tx.order.create({
    data: {
      sessionId: params.sessionId,
      tableId: params.tableId,
      userId: params.userId ?? null,
      status: "IN_PROGRESS",
      comment: params.comment,
      items: {
        create: params.items,
      },
    },
    include: { items: true },
  });
}

async function getActiveShiftOrThrow(venueId: number) {
  const shift = await prisma.shift.findFirst({
    where: { venueId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (!shift) {
    throw new HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
  }

  return shift;
}

// summary
staffDashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const types = callTypesForRole(role);

    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);

    const [newOrders, newCalls, pendingPayments] = await Promise.all([
      role === "HOOKAH"
        ? Promise.resolve(0)
        : prisma.staffCall.count({
            where: {
              status: { in: ["NEW", "ACKED"] },
              type: "HELP",
              message: ORDER_REQUEST_MARKER,
              session: { shiftId: shift.id },
            },
          }),
      prisma.staffCall.count({
        where: {
          status: "NEW",
          type: { in: types },
          NOT: {
            message: ORDER_REQUEST_MARKER,
          },
          session: { shiftId: shift.id },
        },
      }),
      role === "HOOKAH"
        ? Promise.resolve(0)
        : prisma.paymentRequest.count({
            where: {
              status: "PENDING",
              session: { shiftId: shift.id },
            },
          }),
    ]);

    res.json({
      ok: true,
      shift: {
        id: shift.id,
        openedAt: shift.openedAt,
      },
      newOrders,
      newCalls,
      pendingPayments,
    });
  })
);

// ORDERS
staffDashboardRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const status = (req.query.status as OrderStatus | undefined) ?? "NEW";

    const shift = await getActiveShiftOrThrow(venueId);
    const sections = orderSectionsForRole(role);

    const where: any = {
      session: { shiftId: shift.id },
    };

    if (status === "IN_PROGRESS") {
      where.status = { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] };
    } else {
      where.status = status;
    }

    if (sections) {
      where.items = {
        some: {
          menuItem: { category: { section: { in: sections } } },
        },
      };
    }

    const itemsInclude: any = sections
      ? {
          where: { menuItem: { category: { section: { in: sections } } } },
          include: { menuItem: { select: { id: true, name: true } } },
        }
      : {
          include: { menuItem: { select: { id: true, name: true } } },
        };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
        items: itemsInclude,
      },
    });

    res.json({
      ok: true,
      orders: orders.map((order) => ({
        ...order,
        table: toPublicTable(order.table),
        status:
          status === "IN_PROGRESS" && (order.status === "NEW" || order.status === "ACCEPTED")
            ? "IN_PROGRESS"
            : order.status,
      })),
    });
  })
);

const UpdateOrderStatusSchema = z.object({
  status: z.enum(["NEW", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "CANCELLED"]),
});

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

staffDashboardRouter.patch(
  "/orders/:id/status",
  validate(UpdateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body as any;

    const sections = orderSectionsForRole(role);

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        tableId: true,
        session: { select: { shiftId: true } },
        items: {
          select: {
            menuItem: { select: { category: { select: { section: true } } } },
          },
        },
      },
    });

    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    if (order.session?.shiftId !== shift.id) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");

    if (sections) {
      const allowed = order.items.some((it) => sections.includes(it.menuItem.category.section));
      if (!allowed) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { status },
    });

    res.json({ ok: true });
  })
);

staffDashboardRouter.post(
  "/table-orders",
  validate(CreateTableOrderSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);
    const body = req.body as z.infer<typeof CreateTableOrderSchema>;

    if (role === "HOOKAH") {
      throw new HttpError(403, "FORBIDDEN", "Hookah role cannot create table orders");
    }

    const menuItemIds = body.items.map((item) => item.menuItemId);
    const sections = orderSectionsForRole(role);

    const [session, menuItems] = await Promise.all([
      prisma.guestSession.findUnique({
        where: { id: body.sessionId },
        select: {
          id: true,
          tableId: true,
          userId: true,
          shiftId: true,
          endedAt: true,
        },
      }),
      prisma.menuItem.findMany({
        where: {
          id: { in: menuItemIds },
          isActive: true,
          ...(sections ? { category: { section: { in: sections } } } : {}),
        },
      }),
    ]);

    if (!session || session.tableId !== body.tableId || session.shiftId !== shift.id || session.endedAt) {
      throw new HttpError(404, "SESSION_NOT_FOUND", "Session not found for this table");
    }
    if (menuItems.length !== menuItemIds.length) {
      throw new HttpError(400, "MENU_ITEM_INVALID", "Some menu items are invalid/inactive");
    }

    const priceMap = new Map(menuItems.map((item) => [item.id, item.priceCzk]));

    const order = await prisma.$transaction(async (tx) => {
      const created = await createOrAppendTableOrder(tx as typeof prisma, {
        tableId: body.tableId,
        sessionId: session.id,
        userId: session.userId,
        comment: body.comment,
        items: body.items.map((it) => ({
          menuItemId: it.menuItemId,
          qty: it.qty,
          comment: it.comment,
          priceCzk: priceMap.get(it.menuItemId)!,
        })),
      });

      if (body.requestId) {
        await tx.staffCall.updateMany({
          where: {
            id: body.requestId,
            type: "HELP",
            message: ORDER_REQUEST_MARKER,
            status: { in: ["NEW", "ACKED"] },
          },
          data: {
            status: "DONE",
          },
        });
      }

      return created;
    });

    void notifyOrderCreated(order.id).catch((e) => {
      console.warn("push notifyOrderCreated failed", e);
    });

    res.json({ ok: true, order });
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

    const calls = await prisma.staffCall.findMany({
      where: {
        status,
        type: { in: types },
        NOT: {
          message: ORDER_REQUEST_MARKER,
        },
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: { select: { code: true, label: true } },
        session: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    res.json({
      ok: true,
      calls: calls.map((call) => ({
        ...call,
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

    if (role === "HOOKAH") {
      return res.json({ ok: true, requests: [] });
    }

    const requests = await prisma.staffCall.findMany({
      where: {
        status: { in: ["NEW", "ACKED"] },
        type: "HELP",
        message: ORDER_REQUEST_MARKER,
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
      requests: requests.map((request) => ({
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
        table: toPublicTable(request.table),
        session: request.session,
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

    if (role === "HOOKAH") {
      throw new HttpError(403, "FORBIDDEN", "Hookah role cannot take table orders");
    }

    const { id } = IdParamSchema.parse(req.params);
    const request = await prisma.staffCall.findUnique({
      where: { id },
      include: {
        table: { select: { id: true, code: true, label: true, venueId: true } },
        session: { select: { id: true, shiftId: true, user: { select: { id: true, name: true, phone: true } } } },
      },
    });

    if (!request || !isOrderRequestMessage(request.message)) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }
    if (request.table.venueId !== venueId || request.session?.shiftId !== shift.id) {
      throw new HttpError(404, "REQUEST_NOT_FOUND", "Order request not found");
    }

    const updated = await prisma.staffCall.update({
      where: { id: request.id },
      data: {
        status: request.status === "NEW" ? "ACKED" : request.status,
      },
    });

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

const UpdateCallStatusSchema = z.object({
  status: z.enum(["NEW", "ACKED", "DONE"]),
});

staffDashboardRouter.patch(
  "/calls/:id/status",
  validate(UpdateCallStatusSchema),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    const { id } = IdParamSchema.parse(req.params);
    const { status } = req.body as any;

    const allowedTypes = callTypesForRole(role);

    const call = await prisma.staffCall.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        session: { select: { shiftId: true } },
      },
    });

    if (!call) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (call.session?.shiftId !== shift.id) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");
    if (!allowedTypes.includes(call.type)) throw new HttpError(404, "CALL_NOT_FOUND", "Call not found");

    await prisma.staffCall.update({
      where: { id: call.id },
      data: { status },
    });

    res.json({ ok: true });
  })
);

// PAYMENTS
staffDashboardRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;

    if (role === "HOOKAH") {
      return res.json({ ok: true, payments: [] });
    }

    const status = (req.query.status as PaymentStatus | undefined) ?? "PENDING";
    const shift = await getActiveShiftOrThrow(venueId);

    const payments = await (prisma as any).paymentRequest.findMany({
      where: {
        status,
        session: { shiftId: shift.id },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: {
            code: true,
            label: true,
            orders: {
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
              where: { status: "CONFIRMED" },
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

    if (role === "HOOKAH") {
      throw new HttpError(403, "FORBIDDEN", "Hookah role cannot confirm payments");
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
          itemsJson: true,
          useLoyalty: true,
          table: {
            select: {
              orders: {
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
                where: { status: "CONFIRMED" },
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
          session: {
            select: {
              shiftId: true,
              userId: true,
              user: {
                select: {
                  loyaltyTransactions: {
                    select: {
                      id: true,
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

      if (!pr) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");
      if (pr.session?.shiftId !== shift.id) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment request not found");

      if (pr.status !== "PENDING") {
        throw new HttpError(409, "PAYMENT_NOT_PENDING", "Payment request is not pending");
      }

      const selectedItems = parsePaymentItemsJson(pr.itemsJson);
      const billTotalCzk = pr.billTotalCzk || selectedItems.reduce((sum, item) => sum + item.totalCzk, 0);
      const loyaltySummary = summarizeLoyalty(pr.session.user?.loyaltyTransactions ?? []);
      const loyaltyAppliedCzk = pr.useLoyalty
        ? Math.min(loyaltySummary.availableCzk, Math.max(billTotalCzk, 0))
        : 0;
      const amountCzk = Math.max(billTotalCzk - loyaltyAppliedCzk, 0);

      if (amountCzk < 0) {
        throw new HttpError(409, "PAYMENT_ALREADY_SETTLED", "Payment is already settled");
      }

      const updated = await (tx as any).paymentRequest.update({
        where: { id: pr.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          confirmedByStaffId: staffId,
          loyaltyAppliedCzk,
        },
      });

      const confirmation = await (tx as any).paymentConfirmation.upsert({
        where: { paymentRequestId: pr.id },
        update: { billTotalCzk, amountCzk, loyaltyAppliedCzk, itemsJson: selectedItems },
        create: {
          paymentRequestId: pr.id,
          venueId,
          staffId,
          userId: pr.session?.userId ?? null,
          method: pr.method,
          billTotalCzk,
          amountCzk,
          loyaltyAppliedCzk,
          itemsJson: selectedItems,
        },
      });

      if (loyaltyAppliedCzk > 0) {
        let remainingToRedeem = loyaltyAppliedCzk;
        const availableTxns = [...(pr.session.user?.loyaltyTransactions ?? [])]
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
      const userId = pr.session?.userId ?? null;

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

    res.json({ ok: true, ...result });
  })
);

staffDashboardRouter.post(
  "/payments/:id/cancel",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const role = req.staff!.role;
    const shift = await getActiveShiftOrThrow(venueId);

    if (role === "HOOKAH") {
      throw new HttpError(403, "FORBIDDEN", "Hookah role cannot cancel payments");
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
    if (payment.session?.shiftId !== shift.id || payment.session.table.venueId !== venueId) {
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

    res.json({ ok: true, paymentRequest: updated });
  })
);
