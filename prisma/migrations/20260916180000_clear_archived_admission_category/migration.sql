-- Soft-archived admission products must not trap ProductCategory deletion (Restrict FK).
-- Archive now disconnects category; clear any legacy archived links.

UPDATE "admission_products"
SET "categoryId" = NULL
WHERE "archivedAt" IS NOT NULL
  AND "categoryId" IS NOT NULL;
