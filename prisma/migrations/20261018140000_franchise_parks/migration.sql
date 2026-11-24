-- Step 2: franchise parks under one Organization (Option A).
-- VenueLocation franchise flag + park profile; Membership.franchiseParkManager.

ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "isFranchise" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "franchiseDisplayName" TEXT;
ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "franchiseSupportPhone" TEXT;
ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "franchiseSupportEmail" TEXT;
ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "franchiseCode" TEXT;
ALTER TABLE "venue_locations" ADD COLUMN IF NOT EXISTS "franchiseNotes" TEXT;

ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "franchiseParkManager" BOOLEAN NOT NULL DEFAULT false;
