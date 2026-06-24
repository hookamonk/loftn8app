import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth, requireAdminOrManager } from "./staff.middleware";
import { HttpError } from "../../utils/httpError";
import { summarizeLoyalty } from "../../utils/loyalty";

export const staffAdminRouter = Router();

staffAdminRouter.use(requireStaffAuth);
staffAdminRouter.use(requireAdminOrManager);

type RangeKey = "all" | "today" | "week" | "month";
type GuestFilter = "all" | "registered" | "anonymous";

function getRangeKey(raw: unknown): RangeKey {
  const v = String(raw ?? "all");
  if (v === "today" || v === "week" || v === "month") return v;
  return "all";
}

function getGuestFilter(raw: unknown): GuestFilter {
  const v = String(raw ?? "all");
  if (v === "registered" || v === "anonymous") return v;
  return "all";
}

function getDateFromRange(range: RangeKey): Date | undefined {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  if (range === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  if (range === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return undefined;
}

function dateWhere(field: string, from?: Date) {
  if (!from) return {};
  return { [field]: { gte: from } };
}

// ОБЩАЯ СВОДКА
staffAdminRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const [
      usersCount,
      guestSessionsCount,
      registeredGuestSessionsCount,
      anonymousGuestSessionsCount,
      ordersCount,
      callsCount,
      ratingsCount,
      paymentsCount,
      revenueAgg,
      avgRatings,
      shiftsTotal,
      openShift,
    ] = await Promise.all([
      prisma.user.count({
        where: {
          ...dateWhere("createdAt", from),
          sessions: {
            some: {
              table: { venueId },
            },
          },
        },
      }),
      prisma.guestSession.count({
        where: {
          ...dateWhere("startedAt", from),
          table: { venueId },
        },
      }),
      prisma.guestSession.count({
        where: {
          ...dateWhere("startedAt", from),
          table: { venueId },
          userId: { not: null },
        },
      }),
      prisma.guestSession.count({
        where: {
          ...dateWhere("startedAt", from),
          table: { venueId },
          userId: null,
        },
      }),
      prisma.order.count({
        where: {
          ...dateWhere("createdAt", from),
          table: { venueId },
        },
      }),
      prisma.staffCall.count({
        where: {
          ...dateWhere("createdAt", from),
          table: { venueId },
        },
      }),
      prisma.rating.count({
        where: {
          ...dateWhere("createdAt", from),
          table: { venueId },
        },
      }),
      prisma.paymentConfirmation.count({
        where: {
          ...dateWhere("createdAt", from),
          venueId,
        },
      }),
      prisma.paymentConfirmation.aggregate({
        where: {
          ...dateWhere("createdAt", from),
          venueId,
        },
        _sum: { amountCzk: true },
      }),
      prisma.rating.aggregate({
        where: {
          ...dateWhere("createdAt", from),
          table: { venueId },
        },
        _avg: {
          overall: true,
          food: true,
          drinks: true,
          hookah: true,
        },
      }),
      prisma.shift.count({
        where: {
          venueId,
          ...dateWhere("openedAt", from),
        },
      }),
      prisma.shift.findFirst({
        where: { venueId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: {
          id: true,
          openedAt: true,
          openedByManagerId: true,
        },
      }),
    ]);

    res.json({
      ok: true,
      summary: {
        range,
        usersCount,
        guestSessionsCount,
        registeredGuestSessionsCount,
        anonymousGuestSessionsCount,
        ordersCount,
        callsCount,
        ratingsCount,
        paymentsCount,
        totalRevenueCzk: revenueAgg._sum.amountCzk ?? 0,
        avgOverall: avgRatings._avg.overall ?? null,
        avgFood: avgRatings._avg.food ?? null,
        avgDrinks: avgRatings._avg.drinks ?? null,
        avgHookah: avgRatings._avg.hookah ?? null,
        shiftsTotal,
        openShift,
      },
    });
  })
);

staffAdminRouter.get(
  "/shifts",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const shifts = await prisma.shift.findMany({
      where: {
        venueId,
        ...dateWhere("openedAt", from),
      },
      orderBy: { openedAt: "desc" },
      include: {
        openedByManager: {
          select: { id: true, username: true, role: true },
        },
        closedByManager: {
          select: { id: true, username: true, role: true },
        },
        participants: {
          orderBy: { joinedAt: "asc" },
          select: {
            id: true,
            staffId: true,
            role: true,
            joinedAt: true,
            leftAt: true,
            isActive: true,
            staff: {
              select: { id: true, username: true, role: true },
            },
          },
        },
        guestSessions: {
          select: { id: true },
        },
      },
    });

    res.json({ ok: true, shifts });
  })
);

staffAdminRouter.get(
  "/shifts/:id",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const shiftId = String(req.params.id);

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, venueId },
      include: {
        openedByManager: {
          select: { id: true, username: true, role: true },
        },
        closedByManager: {
          select: { id: true, username: true, role: true },
        },
        participants: {
          orderBy: { joinedAt: "asc" },
          include: {
            staff: {
              select: { id: true, username: true, role: true },
            },
          },
        },
      },
    });

    if (!shift) {
      throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift not found");
    }

    const [
      sessionsCount,
      ordersCount,
      callsCount,
      ratingsCount,
      paymentsCount,
      revenueAgg,
      avgRatings,
      registrationsCount,
    ] = await Promise.all([
      prisma.guestSession.count({
        where: { shiftId: shift.id },
      }),
      prisma.order.count({
        where: { session: { shiftId: shift.id } },
      }),
      prisma.staffCall.count({
        where: { session: { shiftId: shift.id } },
      }),
      prisma.rating.count({
        where: { session: { shiftId: shift.id } },
      }),
      prisma.paymentConfirmation.count({
        where: {
          venueId,
          paymentRequest: {
            session: { shiftId: shift.id },
          },
        },
      }),
      prisma.paymentConfirmation.aggregate({
        where: {
          venueId,
          paymentRequest: {
            session: { shiftId: shift.id },
          },
        },
        _sum: { amountCzk: true },
      }),
      prisma.rating.aggregate({
        where: { session: { shiftId: shift.id } },
        _avg: {
          overall: true,
          food: true,
          drinks: true,
          hookah: true,
        },
      }),
      prisma.user.count({
        where: {
          sessions: {
            some: { shiftId: shift.id },
          },
        },
      }),
    ]);

    res.json({
      ok: true,
      shift,
      stats: {
        sessionsCount,
        ordersCount,
        callsCount,
        ratingsCount,
        paymentsCount,
        revenueCzk: revenueAgg._sum.amountCzk ?? 0,
        avgOverall: avgRatings._avg.overall ?? null,
        avgFood: avgRatings._avg.food ?? null,
        avgDrinks: avgRatings._avg.drinks ?? null,
        avgHookah: avgRatings._avg.hookah ?? null,
        registrationsCount,
      },
    });
  })
);


staffAdminRouter.get(
  "/ratings",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const ratings = await prisma.rating.findMany({
      where: {
        ...dateWhere("createdAt", from),
        table: { venueId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        session: {
          select: {
            id: true,
            user: {
              select: { id: true, name: true, phone: true },
            },
            shiftId: true,
          },
        },
      },
      take: 200,
    });

    res.json({ ok: true, ratings });
  })
);


staffAdminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const users = await prisma.user.findMany({
      where: {
        ...dateWhere("createdAt", from),
        sessions: {
          some: {
            table: { venueId },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
        privacyAcceptedAt: true,
        createdAt: true,
      },
      take: 200,
    });

    // Available cashback ("бонусы") per user for this venue. One query for the
    // whole page, then summarized in memory so the list stays a single round-trip.
    const userIds = users.map((u) => u.id);
    const loyaltyTxns = userIds.length
      ? await prisma.loyaltyTransaction.findMany({
          where: { venueId, userId: { in: userIds } },
          select: {
            userId: true,
            cashbackCzk: true,
            redeemedAmountCzk: true,
            availableAt: true,
            createdAt: true,
          },
        })
      : [];

    const txnsByUser = new Map<string, typeof loyaltyTxns>();
    for (const txn of loyaltyTxns) {
      const list = txnsByUser.get(txn.userId);
      if (list) list.push(txn);
      else txnsByUser.set(txn.userId, [txn]);
    }

    const usersWithBonuses = users.map((u) => {
      const summary = summarizeLoyalty(txnsByUser.get(u.id) ?? []);
      return {
        ...u,
        bonusCzk: summary.availableCzk,
        pendingBonusCzk: summary.pendingCzk,
      };
    });

    res.json({ ok: true, users: usersWithBonuses });
  })
);


staffAdminRouter.get(
  "/guest-sessions",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const filter = getGuestFilter(req.query.filter);
    const from = getDateFromRange(range);

    const sessions = await prisma.guestSession.findMany({
      where: {
        ...dateWhere("startedAt", from),
        table: { venueId },
        ...(filter === "registered"
          ? { userId: { not: null } }
          : filter === "anonymous"
          ? { userId: null }
          : {}),
      },
      orderBy: { startedAt: "desc" },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        shift: {
          select: { id: true, status: true, openedAt: true },
        },
        user: {
          select: { id: true, name: true, phone: true, email: true },
        },
        _count: {
          select: {
            orders: true,
            calls: true,
            payments: true,
            ratings: true,
          },
        },
      },
      take: 200,
    });

    res.json({
      ok: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        table: s.table,
        shift: s.shift,
        user: s.user,
        ordersCount: s._count.orders,
        callsCount: s._count.calls,
        paymentsCount: s._count.payments,
        ratingsCount: s._count.ratings,
      })),
    });
  })
);


staffAdminRouter.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const orders = await prisma.order.findMany({
      where: {
        ...dateWhere("createdAt", from),
        table: { venueId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        user: {
          select: { id: true, name: true, phone: true },
        },
        session: {
          select: {
            id: true,
            user: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
        items: {
          select: {
            qty: true,
            priceCzk: true,
          },
        },
      },
      take: 200,
    });

    res.json({
      ok: true,
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        comment: o.comment,
        createdAt: o.createdAt,
        table: o.table,
        user: o.user,
        session: o.session,
        itemsCount: o.items.reduce((sum, x) => sum + x.qty, 0),
        totalCzk: o.items.reduce((sum, x) => sum + x.qty * x.priceCzk, 0),
      })),
    });
  })
);


staffAdminRouter.get(
  "/calls",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const calls = await prisma.staffCall.findMany({
      where: {
        ...dateWhere("createdAt", from),
        table: { venueId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        session: {
          select: {
            id: true,
            user: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
      take: 200,
    });

    res.json({ ok: true, calls });
  })
);


staffAdminRouter.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const payments = await prisma.paymentRequest.findMany({
      where: {
        ...dateWhere("createdAt", from),
        table: { venueId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        table: {
          select: { id: true, code: true, label: true },
        },
        session: {
          select: {
            id: true,
            user: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
        confirmation: {
          select: {
            id: true,
            amountCzk: true,
            createdAt: true,
            staff: {
              select: { id: true, username: true, role: true },
            },
          },
        },
      },
      take: 200,
    });

    res.json({ ok: true, payments });
  })
);


staffAdminRouter.get(
  "/staff-performance",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);

    const staff = await prisma.staffUser.findMany({
      where: { venueId, isActive: true },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ role: "asc" }, { username: "asc" }],
    });

    const result = await Promise.all(
      staff.map(async (s) => {
        const shiftsJoined = await prisma.shiftParticipant.count({
          where: {
            staffId: s.id,
            shift: {
              venueId,
              ...dateWhere("openedAt", from),
            },
          },
        });

        return {
          ...s,
          shiftsJoined,
        };
      })
    );

    res.json({ ok: true, staff: result });
  })
);