-- Registration is e-mail + password only. The phone stays in the schema as an
-- optional detail a guest can add from their profile, and every existing guest
-- keeps the number they already gave.
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;

-- One-time codes are delivered to the e-mail, so that is what they are keyed
-- by. Codes expire after 10 minutes, so dropping the in-flight ones costs
-- nothing and avoids carrying phone-keyed rows that can never be matched.
DELETE FROM "OtpCode";
DROP INDEX IF EXISTS "OtpCode_phone_createdAt_idx";
ALTER TABLE "OtpCode" RENAME COLUMN "phone" TO "email";
CREATE INDEX "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");

-- Guest loyalty card number — shown on the guest card and, later, the value
-- linked into Apple/Google Wallet.
--
-- A sequence-backed DEFAULT makes the number unique BY CONSTRUCTION: no
-- application-side generation, no retry loop, no race between two guests
-- registering at the same moment. Existing guests are numbered in the same
-- run, so nobody ends up without a card.
CREATE SEQUENCE IF NOT EXISTS "User_cardNumber_seq" AS bigint START WITH 100001;

ALTER TABLE "User" ADD COLUMN "cardNumber" TEXT;

UPDATE "User"
SET "cardNumber" = lpad((nextval('"User_cardNumber_seq"'::regclass))::text, 9, '0'::text)
WHERE "cardNumber" IS NULL;

ALTER TABLE "User"
ALTER COLUMN "cardNumber" SET DEFAULT lpad((nextval('"User_cardNumber_seq"'::regclass))::text, 9, '0'::text);

ALTER TABLE "User" ALTER COLUMN "cardNumber" SET NOT NULL;

CREATE UNIQUE INDEX "User_cardNumber_key" ON "User"("cardNumber");
