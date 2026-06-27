import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { requireStaffAuth, requireStaffRole } from "./staff.middleware";
import { getOpenShift, getOpenShiftOrThrow, invalidateOpenShiftCache } from "./shiftCache";

export const staffShiftRouter = Router();

staffShiftRouter.use(requireStaffAuth);

// staff venue
staffShiftRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const shift = await getOpenShift(venueId);
    if (!shift) {
      return res.json({ ok: true, shift: null });
    }

    const participants = await prisma.shiftParticipant.findMany({
      where: {
        shiftId: shift.id,
        isActive: true,
      },
      select: {
        id: true,
        staffId: true,
        role: true,
        joinedAt: true,
        staff: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
    });

    res.json({
      ok: true,
      shift: {
        ...shift,
        participants,
      },
    });
  })
);

// manager open
staffShiftRouter.post(
  "/open",
  requireStaffRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const managerId = req.staff!.staffId;

    // Guarantee EXACTLY ONE open shift per venue, even if two managers (or a
    // double-tap) hit "open" at the same moment. A per-venue Postgres advisory
    // lock serializes the check-then-create inside one transaction, so the
    // second request sees the first's shift and is rejected. Venue scoping is
    // already enforced upstream (req.staff.venueId), so Garden can only open a
    // Garden shift, Žižkov a Žižkov shift, etc.
    const shift = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${venueId})`;

      const existing = await tx.shift.findFirst({
        where: { venueId, status: "OPEN" },
        select: { id: true },
      });
      if (existing) {
        throw new HttpError(409, "SHIFT_ALREADY_OPEN", "Shift is already open");
      }

      return tx.shift.create({
        data: {
          venueId,
          openedByManagerId: managerId,
          participants: {
            create: {
              staffId: managerId,
              role: "MANAGER",
              isActive: true,
            },
          },
        },
        include: {
          participants: {
            where: { isActive: true },
            select: {
              id: true,
              staffId: true,
              role: true,
              joinedAt: true,
            },
          },
        },
      });
    });

    invalidateOpenShiftCache(venueId);

    res.json({ ok: true, shift });
  })
);

// staff join
staffShiftRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const staffId = req.staff!.staffId;
    const role = req.staff!.role;

    const shift = await getOpenShiftOrThrow(venueId);

    const participant = await prisma.shiftParticipant.upsert({
      where: {
        shiftId_staffId: {
          shiftId: shift.id,
          staffId,
        },
      },
      update: {
        isActive: true,
        leftAt: null,
        role,
      },
      create: {
        shiftId: shift.id,
        staffId,
        role,
        isActive: true,
      },
    });

    res.json({ ok: true, shiftId: shift.id, participant });
  })
);

// staff leave
staffShiftRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const staffId = req.staff!.staffId;

    const shift = await getOpenShiftOrThrow(venueId);

    const participant = await prisma.shiftParticipant.findUnique({
      where: {
        shiftId_staffId: {
          shiftId: shift.id,
          staffId,
        },
      },
    });

    if (!participant) {
      return res.json({ ok: true });
    }

    await prisma.shiftParticipant.update({
      where: { id: participant.id },
      data: {
        isActive: false,
        leftAt: new Date(),
      },
    });

    res.json({ ok: true });
  })
);

// manager close
staffShiftRouter.post(
  "/close",
  requireStaffRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const managerId = req.staff!.staffId;

    const shift = await getOpenShift(venueId);
    if (!shift) {
      throw new HttpError(404, "SHIFT_NOT_FOUND", "Active shift not found");
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.shiftParticipant.updateMany({
        where: { shiftId: shift.id, isActive: true },
        data: { isActive: false, leftAt: now },
      });

      await tx.guestSession.updateMany({
        where: { shiftId: shift.id, endedAt: null },
        data: { endedAt: now },
      });

      await tx.shift.update({
        where: { id: shift.id },
        data: {
          status: "CLOSED",
          closedAt: now,
          closedByManagerId: managerId,
        },
      });
    });

    invalidateOpenShiftCache(venueId);

    res.json({ ok: true, shiftId: shift.id, closedAt: now });
  })
);
