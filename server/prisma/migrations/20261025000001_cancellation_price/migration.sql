-- The shift report shows the value of cancelled lines; keep the unit price.
ALTER TABLE "OrderItemCancellation" ADD COLUMN "priceCzk" INTEGER NOT NULL DEFAULT 0;
