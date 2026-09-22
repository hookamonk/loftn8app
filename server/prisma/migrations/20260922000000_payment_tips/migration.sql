-- Optional tip on top of the bill. Kept separate from amountCzk so cashback and
-- revenue keep being computed from the bill only. Idempotent for safety.
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "tipCzk" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentConfirmation" ADD COLUMN IF NOT EXISTS "tipCzk" INTEGER NOT NULL DEFAULT 0;
