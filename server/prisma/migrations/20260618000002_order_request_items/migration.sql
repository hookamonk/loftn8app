-- Store the guest's menu selection alongside an order request so staff can see
-- what was picked and place the actual order. Idempotent for safety.
ALTER TABLE "StaffCall" ADD COLUMN IF NOT EXISTS "requestedItemsJson" JSONB;