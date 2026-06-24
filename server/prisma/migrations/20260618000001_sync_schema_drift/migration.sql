-- Catch-up migration: the schema had drifted ahead of the migration history
-- (columns/indexes added on the dev DB via `db push` were never captured as
-- migrations), so a fresh DB built purely from migrations was missing them.
-- Written idempotently (IF NOT EXISTS) so it is safe on a fresh DB AND on a DB
-- that already received these changes out-of-band.

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMIN';

-- AlterTable
ALTER TABLE "LoyaltyTransaction"
  ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "redeemedAmountCzk" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "redeemedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "redeemedInPaymentConfirmationId" TEXT;

-- AlterTable
ALTER TABLE "PaymentConfirmation"
  ADD COLUMN IF NOT EXISTS "billTotalCzk" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "itemsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "loyaltyAppliedCzk" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentRequest"
  ADD COLUMN IF NOT EXISTS "billTotalCzk" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "itemsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "loyaltyAppliedCzk" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "useLoyalty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Table"
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GuestSession_tableId_endedAt_idx" ON "GuestSession"("tableId", "endedAt");
CREATE INDEX IF NOT EXISTS "GuestSession_userId_endedAt_idx" ON "GuestSession"("userId", "endedAt");
CREATE INDEX IF NOT EXISTS "GuestSession_shiftId_endedAt_idx" ON "GuestSession"("shiftId", "endedAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_userId_availableAt_idx" ON "LoyaltyTransaction"("userId", "availableAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_userId_createdAt_idx" ON "LoyaltyTransaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_venueId_createdAt_idx" ON "LoyaltyTransaction"("venueId", "createdAt");
CREATE INDEX IF NOT EXISTS "MenuCategory_venueId_section_sort_idx" ON "MenuCategory"("venueId", "section", "sort");
CREATE INDEX IF NOT EXISTS "MenuItem_categoryId_isActive_sort_idx" ON "MenuItem"("categoryId", "isActive", "sort");
CREATE INDEX IF NOT EXISTS "Order_tableId_status_createdAt_idx" ON "Order"("tableId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_sessionId_createdAt_idx" ON "Order"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_menuItemId_idx" ON "OrderItem"("menuItemId");
CREATE INDEX IF NOT EXISTS "PaymentRequest_tableId_status_createdAt_idx" ON "PaymentRequest"("tableId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentRequest_sessionId_status_createdAt_idx" ON "PaymentRequest"("sessionId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentRequest_confirmedAt_idx" ON "PaymentRequest"("confirmedAt");
CREATE INDEX IF NOT EXISTS "Rating_tableId_createdAt_idx" ON "Rating"("tableId", "createdAt");
CREATE INDEX IF NOT EXISTS "Rating_sessionId_idx" ON "Rating"("sessionId");
CREATE INDEX IF NOT EXISTS "StaffCall_tableId_status_createdAt_idx" ON "StaffCall"("tableId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffCall_tableId_type_status_idx" ON "StaffCall"("tableId", "type", "status");
CREATE INDEX IF NOT EXISTS "StaffCall_sessionId_createdAt_idx" ON "StaffCall"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "Table_venueId_code_idx" ON "Table"("venueId", "code");
CREATE INDEX IF NOT EXISTS "Table_venueId_slug_idx" ON "Table"("venueId", "slug");