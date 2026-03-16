import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth, requireAdminOrManager } from "./staff.middleware";
import { HttpError } from "../../utils/httpError";

export const staffAdminRouter = Router();

staffAdminRouter.use(requireStaffAuth);
staffAdminRouter.use(requireAdminOrManager);

type RangeKey = "all" | "today" | "week" | "month";

function getRangeKey(raw: unknown): RangeKey {
  const v = String(raw ?? "all");
  if (v === "today" || v === "week" || v === "month") return v;
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

// СПИСОК СМЕН
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

// ДЕТАЛИ СМЕНЫ
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

// ОЦЕНКИ
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

// ПОЛЬЗОВАТЕЛИ
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

    res.json({ ok: true, users });
  })
);

// ПЕРСОНАЛ
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
        const [shiftEntries] = await Promise.all([
          prisma.shiftParticipant.count({
            where: {
              staffId: s.id,
              shift: {
                venueId,
                ...dateWhere("openedAt", from),
              },
            },
          }),
        ]);

        return {
          ...s,
          shiftsJoined: shiftEntries,
        };
      })
    );

    res.json({ ok: true, staff: result });
  })
); 