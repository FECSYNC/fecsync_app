-- Optional ProductCategory FK on admission (ticketing) products.
-- Reuses existing product_categories; does not create a second category table.
-- Existing admission rows remain uncategorized (NULL) until staff assigns.

ALTER TABLE "admission_products"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

CREATE INDEX IF NOT EXISTS "admission_products_orgId_categoryId_idx"
  ON "admission_products"("orgId", "categoryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admission_products_categoryId_fkey'
  ) THEN
    ALTER TABLE "admission_products"
      ADD CONSTRAINT "admission_products_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
