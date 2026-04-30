import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { normalizeVenueSlug, publicVenueSlug, resolveVenueSlug, venueCandidateSlugs, venueNameBySlug } from "../../config/venues";
import { HttpError } from "../../utils/httpError";
import { defaultMenuCategoryDefinitions } from "../../config/menuStructure";

export const menuRouter = Router();

const MENU_CACHE_TTL_MS = 30 * 1000;

type MenuPayload = {
  venue: { id: number; name: string; slug: string };
  categories: Array<{
    id: number;
    name: string;
    sort: number;
    section: string;
    items: Array<{
      id: number;
      name: string;
      description: string | null;
      priceCzk: number;
      imageUrl: string | null;
    }>;
  }>;
};

const menuCache = new Map<
  number,
  {
    expiresAt: number;
    payload: MenuPayload;
  }
>();

async function resolveVenue(rawVenueSlug?: string | null) {
  const requestedVenue = resolveVenueSlug(rawVenueSlug);
  if (!requestedVenue) {
    throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");
  }

  const candidates = venueCandidateSlugs(rawVenueSlug);
  const existing = await prisma.venue.findFirst({
    where: {
      slug: { in: candidates },
      isActive: true,
    },
    orderBy: { id: "asc" },
  });

  if (existing) return existing;

  throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");
}

async function ensureVenueMenuStructure(venueId: number) {
  for (const category of defaultMenuCategoryDefinitions()) {
    const existing = await prisma.menuCategory.findFirst({
      where: { venueId, name: category.name },
      select: { id: true },
    });

    if (existing) {
      await prisma.menuCategory.update({
        where: { id: existing.id },
        data: { sort: category.sort, section: category.section },
      });
      continue;
    }

    await prisma.menuCategory.create({
      data: {
        venueId,
        name: category.name,
        sort: category.sort,
        section: category.section,
      },
    });
  }
}

menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const requestedVenueSlug = String(req.headers["x-venue-slug"] ?? req.query?.venueSlug ?? "").trim();
    const venue = await resolveVenue(requestedVenueSlug);
    const now = Date.now();
    const cached = menuCache.get(venue.id);

    if (cached && cached.expiresAt > now) {
      res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
      return res.json(cached.payload);
    }

    await ensureVenueMenuStructure(venue.id);

    const categories = await prisma.menuCategory.findMany({
      where: { venueId: venue.id },
      orderBy: [{ section: "asc" }, { sort: "asc" }],
      include: {
        items: {
          where: { isActive: true },
          orderBy: { sort: "asc" }, 
        },
      },
    });

    const payload: MenuPayload = {
      venue: { id: venue.id, name: venueNameBySlug(venue.slug), slug: publicVenueSlug(venue.slug) },
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        sort: c.sort,
        section: c.section,
        items: c.items.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceCzk: i.priceCzk,
          imageUrl: (i as any).imageUrl ?? null, //return it
        })),
      })),
    };

    menuCache.set(venue.id, {
      expiresAt: now + MENU_CACHE_TTL_MS,
      payload,
    });

    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    res.json(payload);
  })
);
