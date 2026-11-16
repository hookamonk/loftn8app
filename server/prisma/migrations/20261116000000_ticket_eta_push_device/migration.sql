-- Station ready-time (busy hours) and the device a staff push subscription belongs to.
-- Both nullable: nothing changes for existing rows.
ALTER TABLE "StationTicket" ADD COLUMN "etaAt" TIMESTAMP(3);
ALTER TABLE "StationTicket" ADD COLUMN "etaMinutes" INTEGER;
ALTER TABLE "StaffPushSubscription" ADD COLUMN "deviceId" TEXT;
