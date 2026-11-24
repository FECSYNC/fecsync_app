-- Prevent concurrent duplicate price bands per product (Phase 1 edge-case hardening).
-- Idempotent: skip if constraint already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admission_product_prices_productId_code_key'
  ) THEN
    -- Collapse any existing duplicate (productId, lower(code)) rows before unique.
    DELETE FROM admission_product_prices a
    USING admission_product_prices b
    WHERE a."productId" = b."productId"
      AND lower(a.code) = lower(b.code)
      AND a.id > b.id;

    ALTER TABLE admission_product_prices
      ADD CONSTRAINT admission_product_prices_productId_code_key
      UNIQUE ("productId", code);
  END IF;
END $$;
