-- Durable Stripe apply watermark columns (used with transactional ActivityLog apply).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripeBillingLastEventId" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripeBillingLastEventCreated" INTEGER;
