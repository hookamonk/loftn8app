-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "GuestSession" ADD COLUMN "shiftId" TEXT;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "venueId" INTEGER NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openedByManagerId" TEXT NOT NULL,
    "closedByManagerId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftParticipant" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_venueId_status_idx" ON "Shift"("venueId", "status");

-- CreateIndex
CREATE INDEX "Shift_venueId_openedAt_idx" ON "Shift"("venueId", "openedAt");

-- CreateIndex
CREATE INDEX "ShiftParticipant_shiftId_isActive_idx" ON "ShiftParticipant"("shiftId", "isActive");

-- CreateIndex
CREATE INDEX "ShiftParticipant_staffId_isActive_idx" ON "ShiftParticipant"("staffId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftParticipant_shiftId_staffId_key" ON "ShiftParticipant"("shiftId", "staffId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_openedByManagerId_fkey" FOREIGN KEY ("openedByManagerId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closedByManagerId_fkey" FOREIGN KEY ("closedByManagerId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftParticipant" ADD CONSTRAINT "ShiftParticipant_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftParticipant" ADD CONSTRAINT "ShiftParticipant_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;