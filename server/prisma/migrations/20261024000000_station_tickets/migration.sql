-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'ACCEPTED', 'READY', 'SERVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffRole" ADD VALUE 'KITCHEN';
ALTER TYPE "StaffRole" ADD VALUE 'BAR';
ALTER TYPE "StaffRole" ADD VALUE 'HOOKAH_ZONE';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "ticketId" TEXT;

-- CreateTable
CREATE TABLE "StationTicket" (
    "id" TEXT NOT NULL,
    "venueId" INTEGER NOT NULL,
    "tableId" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "station" "MenuSection" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "isAddon" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "acceptedById" TEXT,
    "readyById" TEXT,
    "servedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StationTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemCancellation" (
    "id" TEXT NOT NULL,
    "venueId" INTEGER NOT NULL,
    "tableId" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "ticketId" TEXT,
    "menuItemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "comment" TEXT,
    "reason" TEXT,
    "cancelledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StationTicket_shiftId_station_status_idx" ON "StationTicket"("shiftId", "station", "status");

-- CreateIndex
CREATE INDEX "StationTicket_status_lastRemindedAt_idx" ON "StationTicket"("status", "lastRemindedAt");

-- CreateIndex
CREATE INDEX "StationTicket_orderId_idx" ON "StationTicket"("orderId");

-- CreateIndex
CREATE INDEX "StationTicket_tableId_shiftId_idx" ON "StationTicket"("tableId", "shiftId");

-- CreateIndex
CREATE INDEX "OrderItemCancellation_ticketId_idx" ON "OrderItemCancellation"("ticketId");

-- CreateIndex
CREATE INDEX "OrderItemCancellation_orderId_idx" ON "OrderItemCancellation"("orderId");

-- CreateIndex
CREATE INDEX "OrderItemCancellation_venueId_createdAt_idx" ON "OrderItemCancellation"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_ticketId_idx" ON "OrderItem"("ticketId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "StationTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_readyById_fkey" FOREIGN KEY ("readyById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationTicket" ADD CONSTRAINT "StationTicket_servedById_fkey" FOREIGN KEY ("servedById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "StationTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemCancellation" ADD CONSTRAINT "OrderItemCancellation_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Orders that were still open before station tickets existed have no ticket a
-- station could accept, so nobody could ever finish them (and the guest could
-- not pay from the app). Close them out; deploy outside an open shift.
UPDATE "Order"
SET "status" = 'DELIVERED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('NEW', 'ACCEPTED', 'IN_PROGRESS');
