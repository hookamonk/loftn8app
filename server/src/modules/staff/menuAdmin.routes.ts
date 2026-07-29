import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireStaffAuth, requireAdminOnly } from "./staff.middleware";
import { HttpError } from "../../utils/httpError";
import { resolveVenueSlug, venueCandidateSlugs, venueNameBySlug } from "../../config/venues";
import { invalidateMenuCache } from "../menu/menu.routes";

/**
 * ADMIN-only menu editor. Every write targets ONE venue (chosen via `?venue=`)
 * and busts that venue's guest-menu cache so edits appear in the app at once.
 */
export const staffMenuAdminRouter = Router();

staffMenuAdminRouter.use(requireStaffAuth);
staffMenuAdminRouter.use(requireAdminOnly);

const SECTIONS = ["DISHES", "DRINKS", "HOOKAH"] as const;
type Section = (typeof SECTIONS)[number];

/** Menu editing always targets a single, explicit venue (never "all"). */
async function resolveOneVenue(raw: unknown): Promise<{ id: number; slug: string }> {
  const slug = resolveVenueSlug(String(raw ?? ""));
  if (!slug) throw new HttpError(400, "VENUE_REQUIRED", "Choose a venue to edit");

  const venue = await prisma.venue.findFirst({
    where: { slug: { in: venueCandidateSlugs(slug) }, isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, slug: true },
  });
  if (!venue) throw new HttpError(404, "VENUE_NOT_FOUND", "Venue not found");

  return venue;
}

function nullableTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// ===== READ (full menu incl. inactive items, for editing) =====
staffMenuAdminRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);

    const categories = await prisma.menuCategory.findMany({
      where: { venueId: venue.id },
      orderBy: [{ section: "asc" }, { sort: "asc" }],
      include: {
        items: {
          orderBy: { sort: "asc" },
          include: { _count: { select: { orderItems: true } } },
        },
      },
    });

    res.json({
      ok: true,
      venue: { id: venue.id, slug: venue.slug, name: venueNameBySlug(venue.slug) },
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        nameCs: c.nameCs ?? null,
        section: c.section,
        sort: c.sort,
        items: c.items.map((i) => ({
          id: i.id,
          name: i.name,
          nameCs: i.nameCs ?? null,
          description: i.description,
          descriptionCs: i.descriptionCs ?? null,
          priceCzk: i.priceCzk,
          sort: i.sort,
          isActive: i.isActive,
          imageUrl: i.imageUrl,
          hasOrders: i._count.orderItems > 0,
        })),
      })),
    });
  })
);

// ===== CATEGORIES =====
const CategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameCs: z.string().trim().max(120).optional(),
  section: z.enum(SECTIONS),
  sort: z.number().int().optional(),
});

staffMenuAdminRouter.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const parsed = CategoryCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Invalid category");
    const body = parsed.data;

    const sort =
      body.sort ??
      ((
        await prisma.menuCategory.aggregate({
          where: { venueId: venue.id, section: body.section as Section },
          _max: { sort: true },
        })
      )._max.sort ?? -1) + 1;

    const category = await prisma.menuCategory.create({
      data: {
        venueId: venue.id,
        name: body.name,
        nameCs: body.nameCs ?? null,
        section: body.section as Section,
        sort,
      },
    });

    invalidateMenuCache(venue.id);
    res.json({ ok: true, category: { id: category.id } });
  })
);

const CategoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  nameCs: z.string().trim().max(120).nullable().optional(),
  section: z.enum(SECTIONS).optional(),
  sort: z.number().int().optional(),
});

staffMenuAdminRouter.patch(
  "/categories/:id",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "INVALID_INPUT", "Bad id");

    const parsed = CategoryUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Invalid category");
    const body = parsed.data;

    const existing = await prisma.menuCategory.findFirst({
      where: { id, venueId: venue.id },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found");

    await prisma.menuCategory.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.nameCs !== undefined ? { nameCs: body.nameCs } : {}),
        ...(body.section !== undefined ? { section: body.section as Section } : {}),
        ...(body.sort !== undefined ? { sort: body.sort } : {}),
      },
    });

    invalidateMenuCache(venue.id);
    res.json({ ok: true });
  })
);

staffMenuAdminRouter.delete(
  "/categories/:id",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "INVALID_INPUT", "Bad id");

    const category = await prisma.menuCategory.findFirst({
      where: { id, venueId: venue.id },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!category) throw new HttpError(404, "CATEGORY_NOT_FOUND", "Category not found");

    if (category._count.items > 0) {
      throw new HttpError(
        409,
        "CATEGORY_NOT_EMPTY",
        "Move or delete the items in this category first"
      );
    }

    await prisma.menuCategory.delete({ where: { id } });
    invalidateMenuCache(venue.id);
    res.json({ ok: true });
  })
);

// ===== ITEMS =====
const ItemCreateSchema = z.object({
  categoryId: z.number().int(),
  name: z.string().trim().min(1).max(160),
  nameCs: z.string().trim().max(160).optional(),
  description: z.string().trim().max(1000).optional(),
  descriptionCs: z.string().trim().max(1000).optional(),
  priceCzk: z.number().int().min(0).max(1_000_000),
  sort: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

async function assertCategoryInVenue(categoryId: number, venueId: number) {
  const cat = await prisma.menuCategory.findFirst({
    where: { id: categoryId, venueId },
    select: { id: true },
  });
  if (!cat) throw new HttpError(400, "INVALID_CATEGORY", "Category is not in this venue");
}

staffMenuAdminRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const parsed = ItemCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Invalid item");
    const body = parsed.data;

    await assertCategoryInVenue(body.categoryId, venue.id);

    const sort =
      body.sort ??
      ((
        await prisma.menuItem.aggregate({
          where: { categoryId: body.categoryId },
          _max: { sort: true },
        })
      )._max.sort ?? -1) + 1;

    const item = await prisma.menuItem.create({
      data: {
        categoryId: body.categoryId,
        name: body.name,
        nameCs: body.nameCs ?? null,
        description: nullableTrimmed(body.description),
        descriptionCs: nullableTrimmed(body.descriptionCs),
        priceCzk: body.priceCzk,
        sort,
        isActive: body.isActive ?? true,
      },
    });

    invalidateMenuCache(venue.id);
    res.json({ ok: true, item: { id: item.id } });
  })
);

const ItemUpdateSchema = z.object({
  categoryId: z.number().int().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  nameCs: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  descriptionCs: z.string().trim().max(1000).nullable().optional(),
  priceCzk: z.number().int().min(0).max(1_000_000).optional(),
  sort: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

staffMenuAdminRouter.patch(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "INVALID_INPUT", "Bad id");

    const parsed = ItemUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", "Invalid item");
    const body = parsed.data;

    // The item must belong to a category in this venue.
    const existing = await prisma.menuItem.findFirst({
      where: { id, category: { venueId: venue.id } },
      select: { id: true },
    });
    if (!existing) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");

    // Moving to another category — that category must also be in this venue.
    if (body.categoryId !== undefined) {
      await assertCategoryInVenue(body.categoryId, venue.id);
    }

    await prisma.menuItem.update({
      where: { id },
      data: {
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.nameCs !== undefined ? { nameCs: body.nameCs } : {}),
        ...(body.description !== undefined
          ? { description: body.description ? body.description.trim() : null }
          : {}),
        ...(body.descriptionCs !== undefined
          ? { descriptionCs: body.descriptionCs ? body.descriptionCs.trim() : null }
          : {}),
        ...(body.priceCzk !== undefined ? { priceCzk: body.priceCzk } : {}),
        ...(body.sort !== undefined ? { sort: body.sort } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    invalidateMenuCache(venue.id);
    res.json({ ok: true });
  })
);

staffMenuAdminRouter.delete(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const venue = await resolveOneVenue(req.query.venue);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "INVALID_INPUT", "Bad id");

    const existing = await prisma.menuItem.findFirst({
      where: { id, category: { venueId: venue.id } },
      select: { id: true, _count: { select: { orderItems: true } } },
    });
    if (!existing) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");

    // Items referenced by past orders can't be hard-deleted (would break order
    // history / FK) — deactivate them instead so they leave the live menu.
    if (existing._count.orderItems > 0) {
      await prisma.menuItem.update({ where: { id }, data: { isActive: false } });
      invalidateMenuCache(venue.id);
      return res.json({ ok: true, softDeleted: true });
    }

    await prisma.menuItem.delete({ where: { id } });
    invalidateMenuCache(venue.id);
    res.json({ ok: true, softDeleted: false });
  })
);
