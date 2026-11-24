-- CreateEnum
CREATE TYPE "MembershipPlanType" AS ENUM ('single', 'group');

-- AlterTable
ALTER TABLE "membership_plans"
ADD COLUMN "membershipType" "MembershipPlanType" NOT NULL DEFAULT 'single',
ADD COLUMN "detailedDescription" TEXT,
ADD COLUMN "physicalPassMessage" TEXT,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "daysValidFromPurchase" INTEGER,
ADD COLUMN "daysValidFromRedemption" INTEGER,
ADD COLUMN "redemptionStartsAt" TIMESTAMP(3),
ADD COLUMN "redemptionEndsAt" TIMESTAMP(3),
ADD COLUMN "customRedemptionDescription" TEXT,
ADD COLUMN "salesStartsAt" TIMESTAMP(3),
ADD COLUMN "salesEndsAt" TIMESTAMP(3),
ADD COLUMN "hideFromOnlineSales" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "addOnsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "alternateAddress" TEXT,
ADD COLUMN "cancellationTerms" TEXT,
ADD COLUMN "formsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "instructions" TEXT,
ADD COLUMN "reportingCategory" TEXT,
ADD COLUMN "overrideTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "termsAndConditions" TEXT,
ADD COLUMN "variations" JSONB NOT NULL DEFAULT '[]'::JSONB;

-- Backfill membershipType from existing familyAllowed
UPDATE "membership_plans"
SET "membershipType" = 'group'
WHERE "familyAllowed" = true;

-- CreateIndex
CREATE INDEX "membership_plans_orgId_hideFromOnlineSales_idx" ON "membership_plans"("orgId", "hideFromOnlineSales");
