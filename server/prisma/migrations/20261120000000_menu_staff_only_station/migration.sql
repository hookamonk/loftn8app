-- Menu items only the staff see (sides punched to a dish, rentals) and items
-- made by another station than their category's (a dessert the bar serves).
-- Additive: the running version keeps working while this is applied.
ALTER TABLE "MenuItem" ADD COLUMN "staffOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MenuItem" ADD COLUMN "station" "MenuSection";
