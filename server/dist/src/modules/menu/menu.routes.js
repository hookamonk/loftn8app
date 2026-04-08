"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuRouter = void 0;
const express_1 = require("express");
const prisma_1 = require("../../db/prisma");
const asyncHandler_1 = require("../../utils/asyncHandler");
exports.menuRouter = (0, express_1.Router)();
exports.menuRouter.get("/", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const venue = await prisma_1.prisma.venue.findUnique({ where: { slug: "pilot" } });
    if (!venue)
        return res.status(404).json({ error: "VENUE_NOT_FOUND" });
    const categories = await prisma_1.prisma.menuCategory.findMany({
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
        venue: { id: venue.id, name: venue.name, slug: venue.slug },
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
                imageUrl: i.imageUrl ?? null, //return it
            })),
        })),
    });
}));
