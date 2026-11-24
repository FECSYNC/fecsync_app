-- Checkout term interest (months). Never entitles creates alone.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "requestedDurationMonths" INTEGER;
