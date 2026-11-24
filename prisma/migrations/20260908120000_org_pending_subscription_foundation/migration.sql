-- Company platform approval + subscription control foundation.
-- pending: registered company awaiting Harewa approval
-- subscription* columns: ready for plan packaging (no billing UI in this migration)

ALTER TYPE "OrgStatus" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'active';

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "subscriptionPlan" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
