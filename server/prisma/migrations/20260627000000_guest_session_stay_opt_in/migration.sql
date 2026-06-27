-- Add the post-payment "stay & order more" opt-in flag.
ALTER TABLE "GuestSession" ADD COLUMN "stayOptIn" BOOLEAN NOT NULL DEFAULT false;
