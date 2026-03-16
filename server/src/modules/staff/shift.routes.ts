import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { requireStaffAuth, requireStaffRole } from "./staff.middleware";

export const staffShiftRouter = Router();

staffShiftRouter.use(requireStaffAuth);

// текущая активная смена для staff venue
staffShiftRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;

    const shift = await prisma.shift.findFirst({
      where: { venueId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      include: {
        participants: {
          where: { isActive: true },
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
        },
      },
    });

    res.json({ ok: true, shift });
  })
);

// менеджер открывает общую смену
staffShiftRouter.post(
  "/open",
  requireStaffRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const managerId = req.staff!.staffId;

    const existing = await prisma.shift.findFirst({
      where: { venueId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    if (existing) {
      throw new HttpError(409, "SHIFT_ALREADY_OPEN", "Shift is already open");
    }

    const shift = await prisma.shift.create({
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

    res.json({ ok: true, shift });
  })
);

// staff входит в активную смену
staffShiftRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const staffId = req.staff!.staffId;
    const role = req.staff!.role;

    const shift = await prisma.shift.findFirst({
      where: { venueId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    if (!shift) {
      throw new HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
    }

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

// staff выходит из активной смены (менеджера обычно не трогаем, но route общий)
staffShiftRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const staffId = req.staff!.staffId;

    const shift = await prisma.shift.findFirst({
      where: { venueId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    if (!shift) {
      throw new HttpError(409, "SHIFT_NOT_OPEN", "No active shift");
    }

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

// менеджер закрывает смену всем
staffShiftRouter.post(
  "/close",
  requireStaffRole(["MANAGER"]),
  asyncHandler(async (req, res) => {
    const venueId = req.staff!.venueId;
    const managerId = req.staff!.staffId;

    const shift = await prisma.shift.findFirst({
      where: { venueId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

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

    res.json({ ok: true, shiftId: shift.id, closedAt: now });
  })
);
