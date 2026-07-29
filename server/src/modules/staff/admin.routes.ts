import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth, requireAdminOnly } from "./staff.middleware";
import { HttpError } from "../../utils/httpError";
import { summarizeLoyalty } from "../../utils/loyalty";
import {
  resolveVenueSlug,
  venueCandidateSlugs,
  venueNameBySlug,
  venueShortNameBySlug,
} from "../../config/venues";

export const staffAdminRouter = Router();

staffAdminRouter.use(requireStaffAuth);
// Admin dashboard is ADMIN-only. Managers run shifts, not the business console.
staffAdminRouter.use(requireAdminOnly);

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

type VenueScope = {
  scope: string; // "all" | internal slug
  venueIds: number[];
  venues: Array<{ id: number; slug: string }>;
};

/**
 * Resolve the `?venue=` query into a set of venue ids. Admins are cross-venue:
 * "all" (or missing) spans every active venue, otherwise it narrows to one.
 * Unlike the role dashboards, admin reads are NOT locked to the staff member's
 * own venue — the picker drives the scope.
 */
async function resolveVenueScope(raw: unknown): Promise<VenueScope> {
  const value = String(raw ?? "all").trim().toLowerCase();

  if (!value || value === "all") {
    const venues = await prisma.venue.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, slug: true },
    });
    return { scope: "all", venueIds: venues.map((v) => v.id), venues };
  }

  const slug = resolveVenueSlug(value);
  if (!slug) throw new HttpError(400, "INVALID_VENUE", "Invalid venue");

  const venue = await prisma.venue.findFirst({
    where: { slug: { in: venueCandidateSlugs(slug) }, isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, slug: true },
  });
  if (!venue) throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");

  return { scope: slug, venueIds: [venue.id], venues: [venue] };
}

// ОБЩАЯ СВОДКА — регистрации, выручка, оценки. Кросс-точечная, с разбивкой по
// точкам (чтобы при выборе «все» было видно каждую из 3 точек отдельно).
staffAdminRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const scope = await resolveVenueScope(req.query.venue);
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const venueIds = scope.venueIds;

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
    ] = await Promise.all([
      prisma.user.count({
        where: {
          ...dateWhere("createdAt", from),
          sessions: { some: { table: { venueId: { in: venueIds } } } },
        },
      }),
      prisma.guestSession.count({
        where: { ...dateWhere("startedAt", from), table: { venueId: { in: venueIds } } },
      }),
      prisma.guestSession.count({
        where: {
          ...dateWhere("startedAt", from),
          table: { venueId: { in: venueIds } },
          userId: { not: null },
        },
      }),
      prisma.guestSession.count({
        where: {
          ...dateWhere("startedAt", from),
          table: { venueId: { in: venueIds } },
          userId: null,
        },
      }),
      prisma.order.count({
        where: { ...dateWhere("createdAt", from), table: { venueId: { in: venueIds } } },
      }),
      prisma.staffCall.count({
        where: { ...dateWhere("createdAt", from), table: { venueId: { in: venueIds } } },
      }),
      prisma.rating.count({
        where: { ...dateWhere("createdAt", from), table: { venueId: { in: venueIds } } },
      }),
      prisma.paymentConfirmation.count({
        where: { ...dateWhere("createdAt", from), venueId: { in: venueIds } },
      }),
      prisma.paymentConfirmation.aggregate({
        where: { ...dateWhere("createdAt", from), venueId: { in: venueIds } },
        _sum: { amountCzk: true },
      }),
      prisma.rating.aggregate({
        where: { ...dateWhere("createdAt", from), table: { venueId: { in: venueIds } } },
        _avg: { overall: true, food: true, drinks: true, hookah: true },
      }),
    ]);

    // Per-venue breakdown so the "all venues" view shows each point separately.
    const byVenue = await Promise.all(
      scope.venues.map(async (venue) => {
        const [regCount, venueRevenue, venueRatings] = await Promise.all([
          prisma.user.count({
            where: {
              ...dateWhere("createdAt", from),
              sessions: { some: { table: { venueId: venue.id } } },
            },
          }),
          prisma.paymentConfirmation.aggregate({
            where: { ...dateWhere("createdAt", from), venueId: venue.id },
            _sum: { amountCzk: true },
          }),
          prisma.rating.aggregate({
            where: { ...dateWhere("createdAt", from), table: { venueId: venue.id } },
            _avg: { overall: true },
            _count: { _all: true },
          }),
        ]);

        return {
          venueId: venue.id,
          slug: venue.slug,
          name: venueNameBySlug(venue.slug),
          shortName: venueShortNameBySlug(venue.slug),
          usersCount: regCount,
          revenueCzk: venueRevenue._sum.amountCzk ?? 0,
          ratingsCount: venueRatings._count._all,
          avgOverall: venueRatings._avg.overall ?? null,
        };
      })
    );

    res.json({
      ok: true,
      summary: {
        range,
        scope: scope.scope,
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
        byVenue,
      },
    });
  })
);

// ЗАРЕГИСТРИРОВАННЫЕ ГОСТИ + их доступный кэшбэк по выбранной точке (или всем).
staffAdminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const scope = await resolveVenueScope(req.query.venue);
    const range = getRangeKey(req.query.range);
    const from = getDateFromRange(range);
    const venueIds = scope.venueIds;

    const users = await prisma.user.findMany({
      where: {
        ...dateWhere("createdAt", from),
        sessions: { some: { table: { venueId: { in: venueIds } } } },
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
      take: 500,
    });

    // Available cashback ("бонусы") per user across the selected venue(s). One
    // query for the whole page, summarized in memory to stay a single round-trip.
    const userIds = users.map((u) => u.id);
    const loyaltyTxns = userIds.length
      ? await prisma.loyaltyTransaction.findMany({
          where: { venueId: { in: venueIds }, userId: { in: userIds } },
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
