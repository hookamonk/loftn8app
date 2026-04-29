import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import type { CallStatus, CallType, OrderStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { validate } from "../../middleware/validate";
import { guestSessionAuth } from "../../middleware/auth/guestSession";
import { summarizeLoyalty } from "../../utils/loyalty";
import { isOrderRequestMessage, ORDER_REQUEST_MARKER } from "../orders/orderRequest";
import { latestLegacyPaymentCutoff, paidQtyByOrderItemId, parsePaymentItemsJson } from "../payments/paymentAllocation";
import { expireGuestSessionIfInactiveAfterPayment } from "./sessionExpiry";
import {
  buildInternalTableCode,
  normalizeVenueSlug,
  venueCandidateSlugs,
  publicTableCode,
  publicVenueCatalog,
  publicVenueSlug,
  venueNameBySlug,
  venueShortNameBySlug,
} from "../../config/venues";
import { branchTables, normalizeTableSlugInput } from "../../config/tables";

export const guestRouter = Router();

guestRouter.get(
  "/branches",
  asyncHandler(async (_req, res) => {
    const activeVenues = await prisma.venue.findMany({
      where: {
        slug: {
          in: publicVenueCatalog().map((branch) => branch.internalSlug),
        },
        isActive: true,
      },
      select: { id: true, slug: true, name: true },
    });

    const bySlug = new Map(activeVenues.map((venue) => [normalizeVenueSlug(venue.slug), venue]));
    const branches = publicVenueCatalog()
      .map((branch) => {
        const venue = bySlug.get(branch.internalSlug);
        if (!venue) return null;

        return {
          id: venue.id,
          slug: branch.slug,
          internalSlug: branch.internalSlug,
          name: venue.name,
          shortName: branch.shortName,
        };
      })
      .filter(Boolean);

    res.json({ ok: true, branches });
  })
);

const CreateSessionSchema = z.object({
  tableCode: z.string().min(1),
  venueSlug: z.string().min(1).optional(),
});

const CreateRatingSchema = z.object({
  food: z.number().min(1).max(5).optional(),
  drinks: z.number().min(1).max(5).optional(),
  hookah: z.number().min(1).max(5).optional(),
  comment: z.string().max(500).optional(),
});

function setCookie(res: any, name: string, value: string, maxAgeSeconds: number) {
  const isProd = env.NODE_ENV === "production";

  res.cookie(name, value, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

function clearCookie(res: any, name: string) {
  const isProd = env.NODE_ENV === "production";

  res.clearCookie(name, {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/",
  });
}

function requestVenueSlug(req: any) {
  return String(req.headers["x-venue-slug"] ?? req.body?.venueSlug ?? req.query?.venueSlug ?? "").trim();
}

async function resolveVenue(rawVenueSlug?: string | null) {
  const candidates = venueCandidateSlugs(rawVenueSlug);
  const exact = await prisma.venue.findFirst({
    where: {
      slug: { in: candidates },
      isActive: true,
    },
    orderBy: { id: "asc" },
    select: { id: true, slug: true, name: true },
  });

  if (exact) return exact;

  throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");
}

async function resolveTableByCode(rawTableCode: string, rawVenueSlug?: string | null) {
  const venue = await resolveVenue(rawVenueSlug);
  const parsed = normalizeTableSlugInput(rawTableCode);
  if (!parsed) return null;

  const venueSlugs = venueCandidateSlugs(venue.slug);
  const exactCodes = Array.from(new Set(parsed.legacyCodeCandidates.flatMap((code) => [
    code,
    ...venueSlugs.map((slug) => buildInternalTableCode(slug, code)),
  ])));

  const existing = await prisma.table.findFirst({
    where: {
      venueId: venue.id,
      OR: [
        { slug: { in: parsed.slugCandidates } },
        ...(exactCodes.length ? [{ code: { in: exactCodes } }] : []),
      ],
    },
    select: {
      id: true,
      code: true,
      label: true,
      displayName: true,
      slug: true,
      venueId: true,
      venue: { select: { slug: true, name: true } },
    },
  });
  if (existing) return existing;

  const branchTable = branchTables(venue.slug).find((table) => parsed.slugCandidates.includes(table.slug));
  if (!branchTable) return null;

  const internalCode = buildInternalTableCode(
    venue.slug,
    branchTable.legacyCode ?? branchTable.slug.toUpperCase()
  );

  return prisma.table.upsert({
    where: { code: internalCode },
    update: {
      venueId: venue.id,
      label: branchTable.displayName,
      displayName: branchTable.displayName,
      slug: branchTable.slug,
    },
    create: {
      venueId: venue.id,
      code: internalCode,
      label: branchTable.displayName,
      displayName: branchTable.displayName,
      slug: branchTable.slug,
    },
    select: {
      id: true,
      code: true,
      label: true,
      displayName: true,
      slug: true,
      venueId: true,
      venue: { select: { slug: true, name: true } },
    },
  });
}

async function resolveUserFromCookie(req: any) {
  const uid = (req.cookies?.uid as string | undefined) ?? undefined;
  if (!uid) return null;

  try {
    const payload = jwt.verify(uid, env.JWT_USER_SECRET) as { userId: string };
    return prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
  } catch {
    return null;
  }
}

async function closePreviousSessionFromCookie(req: any) {
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (!gsid) return;

  try {
    const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
    await prisma.guestSession.updateMany({
      where: {
        id: payload.sessionId,
        endedAt: null,
      },
      data: { endedAt: new Date() },
    });
  } catch {
    // ignore stale cookie
  }
}

async function resolveGuestSessionFromCookie(req: any) {
  req.__guestSessionExpired = false;
  req.__guestSessionBranchMismatch = false;
  const gsid = (req.cookies?.gsid as string | undefined) ?? undefined;
  if (!gsid) return null;

  try {
    const payload = jwt.verify(gsid, env.JWT_GUEST_SESSION_SECRET) as { sessionId: string };
    const session = await prisma.guestSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        table: {
          select: {
            id: true,
            code: true,
            label: true,
            displayName: true,
            slug: true,
            venueId: true,
            venue: { select: { slug: true, name: true } },
          },
        },
        shift: {
          select: { id: true, status: true, openedAt: true, closedAt: true },
        },
      },
    });

    if (!session || session.endedAt) {
      req.__guestSessionExpired = true;
      return null;
    }

    const requestedVenue = requestVenueSlug(req);
    if (
      requestedVenue &&
      normalizeVenueSlug((session.table as any).venue?.slug ?? null) !== normalizeVenueSlug(requestedVenue)
    ) {
      req.__guestSessionBranchMismatch = true;
      return null;
    }

    const expiry = await expireGuestSessionIfInactiveAfterPayment(session.id, {
      id: session.id,
      endedAt: session.endedAt,
      startedAt: session.startedAt,
    });
    if (expiry.expired) {
      req.__guestSessionExpired = true;
      return null;
    }

    const user = await resolveUserFromCookie(req);
    if (user && session.userId !== user.id) {
      return prisma.guestSession.update({
        where: { id: session.id },
        data: { userId: user.id },
        include: {
          table: {
            select: {
              id: true,
              code: true,
              label: true,
              displayName: true,
              slug: true,
              venueId: true,
              venue: { select: { slug: true, name: true } },
            },
          },
          shift: {
            select: { id: true, status: true, openedAt: true, closedAt: true },
          },
        },
      });
    }

    return session;
  } catch {
    return null;
  }
}

function toGuestSessionResponse(
  session: {
    id: string;
    startedAt: Date;
    table: { id: number; code: string; label: string | null; displayName?: string | null; slug?: string | null };
    shift?: { id: string; openedAt: Date } | { id: string; status: string; openedAt: Date; closedAt: Date | null } | null;
  }
) {
  const publicCode = session.table.displayName ?? session.table.label ?? publicTableCode(session.table.code);
  return {
    id: session.id,
    table: {
      id: session.table.id,
      code: publicCode,
      label: session.table.displayName ?? session.table.label,
      displayName: publicCode,
      slug: session.table.slug ?? publicCode.toLowerCase().replace(/\s+/g, "-").replace(/\./g, "-"),
    },
    venue: {
      id: (session.table as any).venueId ?? null,
      slug: publicVenueSlug((session.table as any).venue?.slug ?? null),
      name: venueNameBySlug((session.table as any).venue?.slug ?? null),
      shortName: venueShortNameBySlug((session.table as any).venue?.slug ?? null),
    },
    shift: session.shift
      ? {
          id: session.shift.id,
          openedAt: session.shift.openedAt,
        }
      : null,
    startedAt: session.startedAt,
  };
}

function orderStatusView(status: OrderStatus) {
  if (status === "NEW") {
    return {
      title: "Order sent",
      description: "Your order was sent to the staff team and is waiting for confirmation.",
      tone: "info" as const,
      step: 1,
    };
  }

  if (status === "ACCEPTED") {
    return {
      title: "Order accepted",
      description: "The staff has accepted your order.",
      tone: "success" as const,
      step: 2,
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      title: "Preparing",
      description: "Your order is being prepared right now.",
      tone: "success" as const,
      step: 3,
    };
  }

  if (status === "DELIVERED") {
    return {
      title: "Ready",
      description: "Your order is ready or already on the table.",
      tone: "success" as const,
      step: 4,
    };
  }

  return {
    title: "Cancelled",
    description: "This order was cancelled by the staff.",
    tone: "error" as const,
    step: 0,
  };
}

function callTypeLabel(type: CallType) {
  if (type === "WAITER") return "Waiter";
  if (type === "HOOKAH") return "Hookah service";
  if (type === "BILL") return "Payment";
  return "Message";
}

function callStatusView(type: CallType, status: CallStatus, message?: string | null) {
  if (status === "NEW") {
    return {
      title: `${callTypeLabel(type)} requested`,
      description:
        type === "BILL"
          ? "Your payment request was sent to the staff."
          : "Your request was sent to the staff.",
      tone: "info" as const,
    };
  }

  if (status === "ACKED") {
    return {
      title: "On the way",
      description:
        type === "WAITER"
          ? "A waiter has seen your request and is already coming to your table."
          : type === "HOOKAH"
          ? "A hookah specialist has seen your request and is already coming to your table."
          : type === "BILL"
          ? "Your payment request was accepted and a staff member is on the way."
          : message
          ? "Your message was seen and taken into work."
          : "Your request was accepted by the staff.",
      tone: "success" as const,
    };
  }

  return {
    title: "Done",
    description:
      type === "BILL"
        ? "Your payment request was marked as completed."
        : "This request was marked as completed by the staff.",
    tone: "success" as const,
  };
}

function paymentMethodLabel(method: PaymentMethod) {
  return method === "CARD" ? "Card" : "Cash";
}

function paymentStatusView(
  method: PaymentMethod,
  status: PaymentStatus,
  amountCzk?: number | null
) {
  if (status === "PENDING") {
    return {
      title: "Payment requested",
      description: `Waiting for staff: ${paymentMethodLabel(method)}.`,
      tone: "info" as const,
    };
  }

  if (status === "CONFIRMED") {
    return {
      title: "Payment confirmed",
      description: amountCzk ? `Confirmed for ${amountCzk} Kč.` : "The payment was confirmed by the staff.",
      tone: "success" as const,
    };
  }

  return {
    title: "Payment cancelled",
    description: "The staff cancelled this payment request. Please choose the payment method again.",
    tone: "info" as const,
  };
}

function orderRequestStatusView(status: CallStatus) {
  if (status === "NEW") {
    return {
      title: "Order requested",
      description: "The staff can already see that your table wants to order.",
      tone: "info" as const,
    };
  }

  if (status === "ACKED") {
    return {
      title: "On the way",
      description: "A staff member is coming to your table to take the order.",
      tone: "success" as const,
    };
  }

  return {
    title: "Taken by staff",
    description: "The order is now being entered by the staff.",
    tone: "success" as const,
  };
}

guestRouter.post(
  "/session",
  validate(CreateSessionSchema),
  asyncHandler(async (req, res) => {
    const { tableCode: rawTableCode, venueSlug } = req.body as {
      tableCode: string;
      venueSlug?: string;
    };

    const requestedVenueSlug = venueSlug ?? requestVenueSlug(req);
    const table = await resolveTableByCode(rawTableCode, requestedVenueSlug);

    if (!table) {
      throw new HttpError(404, "TABLE_NOT_FOUND", "Table not found");
    }

    const user = await resolveUserFromCookie(req);
    const shift = await prisma.shift.findFirst({
      where: {
        venueId: table.venueId,
        status: "OPEN",
      },
      orderBy: { openedAt: "desc" },
      select: { id: true, openedAt: true },
    });

    const existingSession = await resolveGuestSessionFromCookie(req);
    if (existingSession && existingSession.table.id === table.id) {
      const nextUserId = user?.id ?? existingSession.userId ?? null;
      const nextShiftId = existingSession.shiftId ?? shift?.id ?? null;

      const syncedSession =
        nextUserId !== existingSession.userId || nextShiftId !== existingSession.shiftId
          ? await prisma.guestSession.update({
              where: { id: existingSession.id },
              data: {
                userId: nextUserId,
                shiftId: nextShiftId,
              },
              include: {
                table: {
                  select: {
                    id: true,
                    code: true,
                    label: true,
                    displayName: true,
                    slug: true,
                    venueId: true,
                    venue: { select: { slug: true, name: true } },
                  },
                },
                shift: {
                  select: { id: true, openedAt: true },
                },
              },
            })
          : {
              id: existingSession.id,
              startedAt: existingSession.startedAt,
                table: {
                  id: existingSession.table.id,
                  code:
                    (existingSession.table as any).displayName ??
                    existingSession.table.label ??
                    publicTableCode(existingSession.table.code),
                  label: (existingSession.table as any).displayName ?? existingSession.table.label,
                  displayName:
                    (existingSession.table as any).displayName ??
                    existingSession.table.label ??
                    publicTableCode(existingSession.table.code),
                  slug:
                    (existingSession.table as any).slug ??
                    publicTableCode(existingSession.table.code).toLowerCase(),
                  venueId: existingSession.table.venueId,
                  venue: existingSession.table.venue,
                },
              shift: existingSession.shift
                ? {
                    id: existingSession.shift.id,
                    openedAt: existingSession.shift.openedAt,
                  }
                : null,
            };

      const token = jwt.sign(
        { sessionId: existingSession.id },
        env.JWT_GUEST_SESSION_SECRET,
        { expiresIn: "24h" }
      );

      setCookie(res, "gsid", token, 60 * 60 * 24);

      return res.json({
        ok: true,
        session: toGuestSessionResponse(syncedSession),
        reused: true,
      });
    }

    await closePreviousSessionFromCookie(req);

    const session = await prisma.guestSession.create({
      data: {
        tableId: table.id,
        shiftId: shift?.id ?? null,
        userId: user?.id ?? null,
      },
      include: {
        table: {
          select: {
            id: true,
            code: true,
            label: true,
            displayName: true,
            slug: true,
            venueId: true,
            venue: { select: { slug: true, name: true } },
          },
        },
        shift: {
          select: { id: true, openedAt: true, status: true, closedAt: true },
        },
      },
    });

    const token = jwt.sign(
      { sessionId: session.id },
      env.JWT_GUEST_SESSION_SECRET,
      { expiresIn: "24h" }
    );

    setCookie(res, "gsid", token, 60 * 60 * 24);

    res.json({
      ok: true,
      session: toGuestSessionResponse(session),
      reused: false,
    });
  })
);

guestRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const session = await resolveGuestSessionFromCookie(req);
    if (!session) {
      if ((req as any).__guestSessionExpired || (req as any).__guestSessionBranchMismatch) {
        clearCookie(res, "gsid");
      }
      return res.json({
        ok: false,
        session: null,
        expired: Boolean((req as any).__guestSessionExpired),
      });
    }

    res.json({
      ok: true,
      session: {
        id: session.id,
        table: {
          id: session.table.id,
          code: session.table.displayName ?? session.table.label ?? publicTableCode(session.table.code),
          label: session.table.displayName ?? session.table.label,
          displayName: session.table.displayName ?? session.table.label ?? publicTableCode(session.table.code),
          slug: session.table.slug ?? publicTableCode(session.table.code).toLowerCase(),
        },
        venue: {
          id: (session.table as any).venueId ?? null,
          slug: publicVenueSlug((session.table as any).venue?.slug ?? null),
          name: venueNameBySlug((session.table as any).venue?.slug ?? null),
          shortName: venueShortNameBySlug((session.table as any).venue?.slug ?? null),
        },
        shift: session.shift ?? null,
        startedAt: session.startedAt,
      },
    });
  })
);

guestRouter.post(
  "/session/disconnect",
  asyncHandler(async (req, res) => {
    await closePreviousSessionFromCookie(req);
    clearCookie(res, "gsid");

    res.json({ ok: true });
  })
);

guestRouter.get(
  "/feed",
  guestSessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;

    const [orders, calls, payments, loyaltyTransactions, orderRequest] = await Promise.all([
      prisma.order.findMany({
        where: {
          tableId: session.tableId,
          table: { venueId: session.table.venueId },
          ...(session.shiftId ? { session: { shiftId: session.shiftId } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              qty: true,
              comment: true,
              priceCzk: true,
              menuItem: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      prisma.staffCall.findMany({
        where: {
          sessionId: session.id,
          table: { venueId: session.table.venueId },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          message: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      (prisma as any).paymentRequest.findMany({
        where: {
          tableId: session.tableId,
          table: { venueId: session.table.venueId },
          ...(session.shiftId ? { session: { shiftId: session.shiftId } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          method: true,
          useLoyalty: true,
          status: true,
          createdAt: true,
          confirmedAt: true,
          billTotalCzk: true,
          loyaltyAppliedCzk: true,
          itemsJson: true,
          session: {
            select: {
              id: true,
              userId: true,
            },
          },
          confirmation: {
            select: { amountCzk: true, billTotalCzk: true, loyaltyAppliedCzk: true, itemsJson: true, createdAt: true },
          },
        },
      }),
      session.userId
        ? (prisma as any).loyaltyTransaction.findMany({
            where: {
              userId: session.userId,
              venueId: session.table.venueId,
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      prisma.staffCall.findFirst({
        where: {
          tableId: session.tableId,
          table: { venueId: session.table.venueId },
          type: "HELP",
          message: ORDER_REQUEST_MARKER,
          ...(session.shiftId ? { session: { shiftId: session.shiftId } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          message: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const legacyCutoff = latestLegacyPaymentCutoff(payments as any[]);
    const paidQtyMap = paidQtyByOrderItemId(payments as any[]);

    const remainingOrders = orders
      .filter((order) => {
        if (!legacyCutoff) return true;
        return new Date(order.createdAt).getTime() > legacyCutoff;
      })
      .map((order) => ({
        ...order,
        items: order.items
          .map((item) => {
            const remainingQty = Math.max(item.qty - (paidQtyMap.get(item.id) ?? 0), 0);
            if (remainingQty <= 0) return null;

            return {
              ...item,
              qty: remainingQty,
            };
          })
          .filter(
            (
              item
            ): item is typeof order.items[number] & {
              qty: number;
            } => Boolean(item)
          ),
      }))
      .filter((order) => order.items.length > 0);

    const toFeedOrder = (order: (typeof remainingOrders)[number]) => {
      const totalCzk = order.items.reduce((sum, item) => sum + item.priceCzk * item.qty, 0);
      const view = orderStatusView(order.status);

      return {
        id: order.id,
        status: order.status,
        comment: order.comment,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        totalCzk,
        step: view.step,
        statusTitle: view.title,
        statusDescription: view.description,
        statusTone: view.tone,
        items: order.items.map((item) => ({
          id: item.id,
          qty: item.qty,
          comment: item.comment,
          priceCzk: item.priceCzk,
          totalCzk: item.priceCzk * item.qty,
          menuItem: item.menuItem,
        })),
      };
    };

    const history = [...(payments as any[])]
      .filter((payment: any) => payment.status === "CONFIRMED")
      .filter((payment: any) => {
        if (session.userId) return payment.session?.userId === session.userId;
        return payment.session?.id === session.id;
      })
      .sort((a: any, b: any) => {
        const left = new Date(a.confirmedAt ?? a.createdAt).getTime();
        const right = new Date(b.confirmedAt ?? b.createdAt).getTime();
        return right - left;
      })
      .map((payment: any) => {
        const closedAt = payment.confirmedAt ?? payment.confirmation?.createdAt ?? payment.createdAt;
        const snapshotItems = parsePaymentItemsJson(payment.confirmation?.itemsJson ?? payment.itemsJson);
        const itemMap = new Map<
          string,
          {
            key: string;
            name: string;
            qty: number;
            totalCzk: number;
            comment?: string;
          }
        >();

        for (const item of snapshotItems) {
          const key = `${item.menuItemId}:${item.comment ?? ""}`;
          const existing = itemMap.get(key);

          if (existing) {
            existing.qty += item.qty;
            existing.totalCzk += item.totalCzk;
            continue;
          }

          itemMap.set(key, {
            key,
            name: item.name,
            qty: item.qty,
            totalCzk: item.totalCzk,
            comment: item.comment ?? undefined,
          });
        }

        return {
          id: payment.id,
          method: payment.method,
          methodLabel: paymentMethodLabel(payment.method),
          amountCzk: payment.confirmation?.amountCzk ?? payment.billTotalCzk ?? 0,
          closedAt,
          orderCount: 1,
          itemCount: Array.from(itemMap.values()).reduce((sum, item) => sum + item.qty, 0),
          items: Array.from(itemMap.values()),
        };
      })
      .filter((entry) => entry.itemCount > 0 || entry.amountCzk > 0);

    const feedOrders = remainingOrders.map(toFeedOrder);

    const visibleCalls = calls.filter((call) => !isOrderRequestMessage(call.message));

    const feedCalls = visibleCalls.map((call) => {
      const view = callStatusView(call.type, call.status, call.message);

      return {
        id: call.id,
        type: call.type,
        typeLabel: callTypeLabel(call.type),
        status: call.status,
        message: call.message,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
        statusTitle: view.title,
        statusDescription: view.description,
        statusTone: view.tone,
      };
    });

    const feedPayments = (payments as any[]).map((payment: any) => {
      const amountCzk = payment.confirmation?.amountCzk ?? null;
      const view = paymentStatusView(payment.method, payment.status, amountCzk);
      const isMine = payment.session?.id === session.id;

      return {
        id: payment.id,
        sessionId: payment.session?.id ?? null,
        isMine,
        method: payment.method,
        methodLabel: paymentMethodLabel(payment.method),
        useLoyalty: Boolean((payment as any).useLoyalty),
        status: payment.status,
        createdAt: payment.createdAt,
        confirmedAt: payment.confirmedAt,
        billTotalCzk: payment.confirmation?.billTotalCzk ?? payment.billTotalCzk ?? null,
        amountCzk,
        loyaltyAppliedCzk: payment.confirmation?.loyaltyAppliedCzk ?? (payment as any).loyaltyAppliedCzk ?? 0,
        items: parsePaymentItemsJson(payment.confirmation?.itemsJson ?? payment.itemsJson),
        statusTitle: view.title,
        statusDescription: view.description,
        statusTone: view.tone,
      };
    });

    const orderedTotalCzk = feedOrders
      .filter((order) => order.status !== "CANCELLED")
      .reduce((sum, order) => sum + order.totalCzk, 0);

    // `history` already contains settled bills, so the current open tab should only
    // reflect the active orders left after settlement.
    const confirmedPaidCzk = 0;
    const redeemedLoyaltyCzk = 0;
    const loyalty = summarizeLoyalty(loyaltyTransactions as any[]);

    const orderRequestView =
      orderRequest && isOrderRequestMessage(orderRequest.message)
        ? orderRequestStatusView(orderRequest.status)
        : null;

    res.json({
      ok: true,
      currentSessionId: session.id,
      table: {
        id: session.table.id,
        code: publicTableCode(session.table.code),
        label: session.table.label,
      },
      venue: {
        id: (session.table as any).venueId ?? null,
        slug: publicVenueSlug((session.table as any).venue?.slug ?? null),
        name: venueNameBySlug((session.table as any).venue?.slug ?? null),
        shortName: venueShortNameBySlug((session.table as any).venue?.slug ?? null),
      },
      totals: {
        orderedTotalCzk,
        confirmedPaidCzk,
        dueCzk: Math.max(orderedTotalCzk - confirmedPaidCzk - redeemedLoyaltyCzk, 0),
      },
      loyalty: {
        availableCzk: loyalty.availableCzk,
        pendingCzk: loyalty.pendingCzk,
        nextAvailableAt: loyalty.nextAvailableAt,
        cashbackPercent: 10,
      },
      orderRequest:
        orderRequest && orderRequestView
          ? {
              id: orderRequest.id,
              status: orderRequest.status,
              createdAt: orderRequest.createdAt,
              updatedAt: orderRequest.updatedAt,
              statusTitle: orderRequestView.title,
              statusDescription: orderRequestView.description,
              statusTone: orderRequestView.tone,
            }
          : null,
      orders: feedOrders,
      history,
      calls: feedCalls,
      payments: feedPayments,
    });
  })
);

guestRouter.post(
  "/session/leave",
  guestSessionAuth,
  asyncHandler(async (req, res) => {
    const session = req.guestSession!;
    const now = new Date();

    await prisma.guestSession.updateMany({
      where: {
        id: session.id,
        endedAt: null,
      },
      data: {
        endedAt: now,
      },
    });

    clearCookie(res, "gsid");

    res.json({
      ok: true,
      leftAt: now,
    });
  })
);

guestRouter.post(
  "/rating",
  guestSessionAuth,
  validate(CreateRatingSchema),
  asyncHandler(async (req, res) => {
    const s = req.guestSession!;
    const { food, drinks, hookah, comment } = req.body;

    const session = await prisma.guestSession.findUnique({
      where: { id: s.id },
    });

    if (!session) {
      throw new HttpError(401, "SESSION_INVALID", "Session invalid");
    }

    if (session.endedAt) {
      throw new HttpError(401, "SESSION_ENDED", "Session ended");
    }

    const values = [food, drinks, hookah].filter((v) => typeof v === "number") as number[];

    const overall =
      values.length > 0
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : 5;

    await prisma.rating.create({
      data: {
        sessionId: session.id,
        tableId: session.tableId,
        overall,
        food,
        drinks,
        hookah,
        comment,
      },
    });

    res.json({ ok: true });
  })
);
