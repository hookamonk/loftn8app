-- AlterTable
ALTER TABLE "User" ADD COLUMN     "appleSub" TEXT,
ADD COLUMN     "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_appleSub_key" ON "User"("appleSub");


-- Every sign-in and sign-up looks e-mails up in lower case. Addresses saved
-- before that rule existed ("Ivan@Gmail.com ") could never sign in and could
-- be registered a second time — normalise them. A row is skipped when the
-- normalised address already belongs to another account (left for manual
-- review rather than merged blindly).
UPDATE "User" AS u
SET "email" = lower(btrim(u."email"))
WHERE u."email" IS NOT NULL
  AND u."email" <> lower(btrim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "User" AS o
    WHERE o."id" <> u."id"
      AND o."email" IS NOT NULL
      AND lower(btrim(o."email")) = lower(btrim(u."email"))
  );
