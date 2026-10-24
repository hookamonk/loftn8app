import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { prisma } from "../../db/prisma";
import { requireStaffAuth, requireStaffRole } from "./staff.middleware";
import { resolveVenueScope } from "./admin.routes";
import { buildShiftReport, listShiftSummaries } from "./shiftReport.service";

/**
 * Shift reports — for the manager's closing reconciliation with Septim, and
 * for the admin across all venues.
 *
 *   GET /staff/reports/shifts            manager: own venue · admin: ?venue=
 *   GET /staff/reports/shifts/:id        one shift (an open one is live)
 */
export const staffReportsRouter = Router();
staffReportsRouter.use(requireStaffAuth);
staffReportsRouter.use(requireStaffRole(["MANAGER", "ADMIN"]));

staffReportsRouter.get(
  "/shifts",
  asyncHandler(async (req, res) => {
    const isAdmin = req.staff!.role === "ADMIN";
    const venueIds = isAdmin ? (await resolveVenueScope(req.query.venue)).venueIds : [req.staff!.venueId];
    const shifts = await listShiftSummaries(venueIds, isAdmin ? 90 : 30);
    res.json({ ok: true, shifts });
  })
);

staffReportsRouter.get(
  "/shifts/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const shift = await prisma.shift.findUnique({ where: { id }, select: { venueId: true } });
    // A manager reads his own venue only; the admin reads every venue.
    if (!shift || (req.staff!.role !== "ADMIN" && shift.venueId !== req.staff!.venueId)) {
      throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift not found");
    }
    res.json({ ok: true, report: await buildShiftReport(id) });
  })
);
