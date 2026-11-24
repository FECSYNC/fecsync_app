-- Align admission_products.categoryId delete behavior with ecommerce ProductCategory
-- references: reject category delete while any booking product still links (API SSOT + DB).

ALTER TABLE "admission_products"
  DROP CONSTRAINT IF EXISTS "admission_products_categoryId_fkey";

ALTER TABLE "admission_products"
  ADD CONSTRAINT "admission_products_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
