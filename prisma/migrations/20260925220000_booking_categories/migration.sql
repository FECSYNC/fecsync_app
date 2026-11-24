-- Booking categories: separate Online Booking folders from shop ProductCategory.
-- Backfill keeps existing admission_products.categoryId values by copying linked
-- ProductCategory rows into booking_categories with the same id.

CREATE TABLE "booking_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_categories_orgId_archivedAt_idx" ON "booking_categories"("orgId", "archivedAt");

CREATE UNIQUE INDEX "booking_categories_orgId_name_key" ON "booking_categories"("orgId", "name");

ALTER TABLE "booking_categories" ADD CONSTRAINT "booking_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy shop categories that admission products still reference (same id).
INSERT INTO "booking_categories" ("id", "orgId", "name", "description", "archivedAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (pc."id")
  pc."id",
  pc."orgId",
  pc."name",
  pc."description",
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "product_categories" pc
INNER JOIN "admission_products" ap ON ap."categoryId" = pc."id"
ORDER BY pc."id";

-- Drop ProductCategory FK; point at BookingCategory with SetNull.
ALTER TABLE "admission_products" DROP CONSTRAINT IF EXISTS "admission_products_categoryId_fkey";

ALTER TABLE "admission_products"
  ADD CONSTRAINT "admission_products_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "booking_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
