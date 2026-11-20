-- A registered guest attached to a table by a waiter or manager (no QR scan):
-- who did it and when, for the shift report's journal.
-- Additive: the running version keeps working while this is applied.
ALTER TABLE "GuestSession" ADD COLUMN "boundById" TEXT;
ALTER TABLE "GuestSession" ADD COLUMN "boundAt" TIMESTAMP(3);
