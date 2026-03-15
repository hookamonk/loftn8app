import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth, requireAdminOrManager } from "./staff.middleware";

export const staffAdminRouter = Router();

staffAdminRouter.use(requireStaffAuth);
staffAdminRouter.use(requireAdminOrManager);

// общий summary
staffAdminRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const [
      usersCount,
      ordersCount,
      callsCount,
      ratingsCount,
      confirmedPaymentsCount,
      paymentSumAgg,
      avgRatings,
      shiftsTotal,
      openShift,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.order.count({
        where: { table: { venueId } },
      }),
      prisma.staffCall.count({
        where: { table: { venueId } },
      }),
      prisma.rating.count({
        where: { table: { venueId } },
      }),
      prisma.paymentConfirmation.count({
        where: { venueId },
      }),
      prisma.paymentConfirmation.aggregate({
        where: { venueId },
        _sum: { amountCzk: true },
      }),
      prisma.rating.aggregate({
        where: { table: { venueId } },
        _avg: {
          overall: true,
          food: true,
          drinks: true,
          hookah: true,
        },
      }),
      prisma.shift.count({
        where: { venueId },
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
        usersCount,
        ordersCount,
        callsCount,
        ratingsCount,
        confirmedPaymentsCount,
        totalRevenueCzk: paymentSumAgg._sum.amountCzk ?? 0,
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

// список смен
staffAdminRouter.get(
  "/shifts",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const shifts = await prisma.shift.findMany({
      where: { venueId },
      orderBy: { openedAt: "desc" },
      include: {
        openedByManager: {
          select: { id: true, username: true, role: true },
        },
        closedByManager: {
          select: { id: true, username: true, role: true },
        },
        participants: {
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

// детальная статистика по смене
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
          include: {
            staff: {
              select: { id: true, username: true, role: true },
            },
          },
        },
      },
    });

    if (!shift) {
      return res.status(404).json({ message: "Shift not found" });
    }

    const [
      sessionsCount,
      ordersCount,
      callsCount,
      ratingsCount,
      paymentsCount,
      paymentSumAgg,
      avgRatings,
      registrationsCount,
      staffStats,
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
      prisma.shiftParticipant.findMany({
        where: { shiftId: shift.id },
        include: {
          staff: {
            select: { id: true, username: true, role: true },
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
        revenueCzk: paymentSumAgg._sum.amountCzk ?? 0,
        avgOverall: avgRatings._avg.overall ?? null,
        avgFood: avgRatings._avg.food ?? null,
        avgDrinks: avgRatings._avg.drinks ?? null,
        avgHookah: avgRatings._avg.hookah ?? null,
        registrationsCount,
        staffStats,
      },
    });
  })
);

// ratings feed
staffAdminRouter.get(
  "/ratings",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const ratings = await prisma.rating.findMany({
      where: { table: { venueId } },
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
      take: 100,
    });

    res.json({ ok: true, ratings });
  })
);

// registrations / users
staffAdminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
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
      take: 100,
    });

    res.json({ ok: true, users });
  })
);

// staff performance по venue
staffAdminRouter.get(
  "/staff-performance",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const staff = await prisma.staffUser.findMany({
      where: { venueId, isActive: true },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    const result = await Promise.all(
      staff.map(async (s) => {
        const [confirmedPayments, shiftEntries] = await Promise.all([
          prisma.paymentConfirmation.aggregate({
            where: { venueId, staffId: s.id },
            _count: true,
            _sum: { amountCzk: true },
          }),
          prisma.shiftParticipant.count({
            where: { staffId: s.id, shift: { venueId } },
          }),
        ]);

        return {
          ...s,
          shiftsJoined: shiftEntries,
          confirmedPaymentsCount: confirmedPayments._count,
          confirmedPaymentsSumCzk: confirmedPayments._sum.amountCzk ?? 0,
        };
      })
    );

    res.json({ ok: true, staff: result });
  })
); 