-- Czech translations for menu content (base name/description stay English).
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "nameCs" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "descriptionCs" TEXT;
ALTER TABLE "MenuCategory" ADD COLUMN IF NOT EXISTS "nameCs" TEXT;