import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { venueNameBySlug } from "../../config/venues";

export const menuRouter = Router();

async function resolveVenue() {
  const existing = await prisma.venue.findFirst({
    where: {
      slug: { in: ["pilot", "zizkov"] },
      isActive: true,
    },
    orderBy: { id: "asc" },
  });

  if (existing) return existing;

  return prisma.venue.create({
    data: {
      slug: "pilot",
      name: venueNameBySlug("pilot"),
      isActive: true,
    },
  });
}

async function ensureVenueMenuSeeded(venueId: number) {
  const existingCount = await prisma.menuCategory.count({ where: { venueId } });
  if (existingCount > 0) return;

  const sourceVenue = await prisma.venue.findFirst({
    where: {
      isActive: true,
      id: { not: venueId },
      menuCategories: {
        some: {
          items: {
            some: { isActive: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    include: {
      menuCategories: {
        orderBy: [{ section: "asc" }, { sort: "asc" }],
        include: {
          items: {
            orderBy: { sort: "asc" },
          },
        },
      },
    },
  });

  if (!sourceVenue) return;

  await prisma.$transaction(
    sourceVenue.menuCategories.map((category) =>
      prisma.menuCategory.create({
        data: {
          venueId,
          name: category.name,
          sort: category.sort,
          section: category.section,
          items: {
            create: category.items.map((item) => ({
              name: item.name,
              description: item.description,
              priceCzk: item.priceCzk,
              imageUrl: item.imageUrl,
              isActive: item.isActive,
              sort: item.sort,
            })),
          },
        },
      })
    )
  );
}

menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const venue = await resolveVenue();
    await ensureVenueMenuSeeded(venue.id);

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

    res.json({
      venue: { id: venue.id, name: venueNameBySlug(venue.slug), slug: venue.slug },
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
    });
  })
);
