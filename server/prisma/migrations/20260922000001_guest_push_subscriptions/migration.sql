-- Web-push subscriptions of registered guests (order status, calls, payments).
-- Written idempotently so a re-run (or a table created out-of-band) is safe.
CREATE TABLE IF NOT EXISTS "GuestPushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'cs',
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GuestPushSubscription_endpoint_key" ON "GuestPushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "GuestPushSubscription_userId_idx" ON "GuestPushSubscription"("userId");

-- Deleting a guest account removes its device subscriptions with it.
DO $$
BEGIN
    ALTER TABLE "GuestPushSubscription"
        ADD CONSTRAINT "GuestPushSubscription_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
