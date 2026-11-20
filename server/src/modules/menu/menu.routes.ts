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
    nameCs: string | null;
    sort: number;
    section: string;
    items: Array<{
      id: number;
      name: string;
      nameCs: string | null;
      description: string | null;
      descriptionCs: string | null;
      priceCzk: number;
      imageUrl: string | null;
    }>;
  }>;
};

function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "#") return null;
  return trimmed;
}

/**
 * Guests get the menu without the staff-only items (sides punched to a dish,
 * rentals); waiters and managers get everything — cached separately.
 */
type MenuAudience = "guest" | "staff";

const menuCache = new Map<
  string,
  {
    expiresAt: number;
    payload: MenuPayload;
  }
>();

const cacheKey = (venueId: number, audience: MenuAudience) => `${venueId}:${audience}`;

/**
 * Drop the cached menus of a venue so the next request rebuilds them.
 * Called by the admin menu editor after every write, so edits show up in the
 * guest and staff apps immediately instead of after the 30s TTL.
 */
export function invalidateMenuCache(venueId: number) {
  menuCache.delete(cacheKey(venueId, "guest"));
  menuCache.delete(cacheKey(venueId, "staff"));
}

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

async function menuFor(venue: { id: number; slug: string }, audience: MenuAudience): Promise<MenuPayload> {
  const now = Date.now();
  const key = cacheKey(venue.id, audience);
  const cached = menuCache.get(key);
  if (cached && cached.expiresAt > now) return cached.payload;

  await ensureVenueMenuStructure(venue.id);

  const categories = await prisma.menuCategory.findMany({
    where: { venueId: venue.id },
    orderBy: [{ section: "asc" }, { sort: "asc" }],
    include: {
      items: {
        where: { isActive: true, ...(audience === "guest" ? { staffOnly: false } : {}) },
        orderBy: { sort: "asc" },
      },
    },
  });

  const payload: MenuPayload = {
    venue: { id: venue.id, name: venueNameBySlug(venue.slug), slug: publicVenueSlug(venue.slug) },
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      nameCs: (c as any).nameCs ?? null,
      sort: c.sort,
      section: c.section,
      items: c.items.map((i) => ({
        id: i.id,
        name: i.name,
        nameCs: (i as any).nameCs ?? null,
        description: i.description,
        descriptionCs: (i as any).descriptionCs ?? null,
        priceCzk: i.priceCzk,
        imageUrl: sanitizeImageUrl((i as any).imageUrl),
      })),
    })),
  };

  menuCache.set(key, { expiresAt: now + MENU_CACHE_TTL_MS, payload });
  return payload;
}

/** The waiters' and managers' menu: everything active, staff-only items included. */
export async function staffMenu(venueId: number) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true, slug: true } });
  if (!venue) throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");
  return menuFor(venue, "staff");
}

menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const requestedVenueSlug = String(req.headers["x-venue-slug"] ?? req.query?.venueSlug ?? "").trim();
    const venue = await resolveVenue(requestedVenueSlug);
    const payload = await menuFor(venue, "guest");
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    res.json(payload);
  })
);
