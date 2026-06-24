-- OTP brute-force protection: per-code attempt counter.
ALTER TABLE "OtpCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- Performance: indexes for hot dashboard/push queries.
CREATE INDEX "StaffCall_type_status_createdAt_idx" ON "StaffCall"("type", "status", "createdAt");
CREATE INDEX "GuestSession_shiftId_endedAt_tableId_idx" ON "GuestSession"("shiftId", "endedAt", "tableId");
CREATE INDEX "PaymentRequest_tableId_status_confirmedAt_idx" ON "PaymentRequest"("tableId", "status", "confirmedAt");
CREATE INDEX "StaffPushSubscription_venueId_staffId_idx" ON "StaffPushSubscription"("venueId", "staffId");

-- Replaced by the composite (venueId, staffId) index above.
DROP INDEX "StaffPushSubscription_venueId_idx";