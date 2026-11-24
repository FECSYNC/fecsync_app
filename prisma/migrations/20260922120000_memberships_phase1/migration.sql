-- CreateEnum
CREATE TYPE "MembershipPlanBilling" AS ENUM ('recurring', 'fixed');

-- CreateEnum
CREATE TYPE "MembershipIntervalUnit" AS ENUM ('day', 'week', 'month', 'year');

-- CreateEnum
CREATE TYPE "GuestMembershipStatus" AS ENUM ('active', 'past_due', 'paused', 'cancelled', 'expired', 'pending');

-- CreateEnum
CREATE TYPE "MembershipVisitStatus" AS ENUM ('CURRENT', 'VISITING', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "MembershipPaymentAttemptStatus" AS ENUM ('pending', 'succeeded', 'failed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "MembershipSellChannel" AS ENUM ('admin', 'pos', 'online', 'other');

-- CreateEnum
CREATE TYPE "MembershipUsageKind" AS ENUM ('visit', 'redeem', 'discount_applied', 'perk_consumed', 'free_product', 'adjustment', 'undo');

-- CreateEnum
CREATE TYPE "MembershipUsageSource" AS ENUM ('admin', 'pos', 'checkin', 'online', 'system');

-- CreateEnum
CREATE TYPE "MembershipFamilyRole" AS ENUM ('primary', 'dependent');

-- CreateEnum
CREATE TYPE "MembershipAgreementStatus" AS ENUM ('draft', 'signed', 'void');

-- CreateEnum
CREATE TYPE "MembershipCancelAlternativeKind" AS ENUM ('pause_offer', 'discount', 'downgrade', 'message');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipPlan';
ALTER TYPE "ActivityEntityType" ADD VALUE 'GuestMembership';
ALTER TYPE "ActivityEntityType" ADD VALUE 'GuestProfile';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipVenueEligibility';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipSettings';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipUsageEvent';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipPaymentAttempt';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipFamilyLink';
ALTER TYPE "ActivityEntityType" ADD VALUE 'MembershipAgreement';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'membership';

-- CreateTable
CREATE TABLE "guest_profiles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "photoUrl" TEXT,
    "postalCode" TEXT,
    "stripeCustomerId" TEXT,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "guest_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billing" "MembershipPlanBilling" NOT NULL,
    "intervalCount" INTEGER,
    "intervalUnit" "MembershipIntervalUnit",
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "familyAllowed" BOOLEAN NOT NULL DEFAULT false,
    "upgradeGroupKey" TEXT,
    "agreementRequired" BOOLEAN NOT NULL DEFAULT false,
    "pauseAllowed" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_memberships" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "homeLocationId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "GuestMembershipStatus" NOT NULL DEFAULT 'pending',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "customMembershipId" TEXT NOT NULL,
    "barcodeOrCode" TEXT,
    "qrPayload" TEXT,
    "photoUrl" TEXT,
    "familyEntitlements" JSONB,
    "createdFromSaleId" TEXT,
    "source" "MembershipSellChannel" NOT NULL DEFAULT 'admin',
    "pauseStartsAt" TIMESTAMP(3),
    "pauseEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "creditBalanceMinor" INTEGER NOT NULL DEFAULT 0,
    "agreementSignedAt" TIMESTAMP(3),
    "agreementRecordId" TEXT,
    "visitStatus" "MembershipVisitStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_family_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestMembershipId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "role" "MembershipFamilyRole" NOT NULL DEFAULT 'dependent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_family_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_usage_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "guestMembershipId" TEXT NOT NULL,
    "guestProfileId" TEXT,
    "kind" "MembershipUsageKind" NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "remainingAfter" INTEGER,
    "meta" JSONB,
    "actorUserId" TEXT,
    "source" "MembershipUsageSource" NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_venue_eligibility" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "localPerksAdd" JSONB,
    "localPerksRemove" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_venue_eligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "requirePhotoOnRedeem" BOOLEAN NOT NULL DEFAULT false,
    "requireAgreementBeforeActive" BOOLEAN NOT NULL DEFAULT false,
    "dunningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "clickToCancelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancelAlternativesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "graceDays" INTEGER,
    "allowPause" BOOLEAN NOT NULL DEFAULT true,
    "walletPassEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultHomeLocationId" TEXT,
    "other" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_payment_attempts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestMembershipId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "MembershipPaymentAttemptStatus" NOT NULL DEFAULT 'pending',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_cancel_alternatives" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "MembershipCancelAlternativeKind" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_cancel_alternatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_agreements" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestMembershipId" TEXT,
    "guestProfileId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "MembershipAgreementStatus" NOT NULL DEFAULT 'draft',
    "signedAt" TIMESTAMP(3),
    "bodyVersion" TEXT,
    "storageRef" TEXT,
    "waiverRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_profiles_orgId_idx" ON "guest_profiles"("orgId");

-- CreateIndex
CREATE INDEX "guest_profiles_orgId_email_idx" ON "guest_profiles"("orgId", "email");

-- CreateIndex
CREATE INDEX "guest_profiles_orgId_phone_idx" ON "guest_profiles"("orgId", "phone");

-- CreateIndex
CREATE INDEX "guest_profiles_orgId_lastName_firstName_idx" ON "guest_profiles"("orgId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "guest_profiles_orgId_locationId_idx" ON "guest_profiles"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "guest_profiles_userId_idx" ON "guest_profiles"("userId");

-- CreateIndex
CREATE INDEX "membership_plans_orgId_idx" ON "membership_plans"("orgId");

-- CreateIndex
CREATE INDEX "membership_plans_orgId_archivedAt_idx" ON "membership_plans"("orgId", "archivedAt");

-- CreateIndex
CREATE INDEX "membership_plans_orgId_locationId_idx" ON "membership_plans"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "membership_plans_orgId_upgradeGroupKey_idx" ON "membership_plans"("orgId", "upgradeGroupKey");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_idx" ON "guest_memberships"("orgId");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_status_idx" ON "guest_memberships"("orgId", "status");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_guestProfileId_idx" ON "guest_memberships"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_planId_idx" ON "guest_memberships"("orgId", "planId");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_locationId_idx" ON "guest_memberships"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "guest_memberships_orgId_homeLocationId_idx" ON "guest_memberships"("orgId", "homeLocationId");

-- CreateIndex
CREATE INDEX "guest_memberships_stripeSubscriptionId_idx" ON "guest_memberships"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_memberships_orgId_customMembershipId_key" ON "guest_memberships"("orgId", "customMembershipId");

-- CreateIndex
CREATE INDEX "membership_family_links_orgId_idx" ON "membership_family_links"("orgId");

-- CreateIndex
CREATE INDEX "membership_family_links_orgId_guestMembershipId_idx" ON "membership_family_links"("orgId", "guestMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_family_links_guestMembershipId_guestProfileId_key" ON "membership_family_links"("guestMembershipId", "guestProfileId");

-- CreateIndex
CREATE INDEX "membership_usage_events_orgId_guestMembershipId_createdAt_idx" ON "membership_usage_events"("orgId", "guestMembershipId", "createdAt");

-- CreateIndex
CREATE INDEX "membership_usage_events_orgId_locationId_createdAt_idx" ON "membership_usage_events"("orgId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "membership_usage_events_orgId_kind_createdAt_idx" ON "membership_usage_events"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "membership_venue_eligibility_orgId_idx" ON "membership_venue_eligibility"("orgId");

-- CreateIndex
CREATE INDEX "membership_venue_eligibility_orgId_planId_idx" ON "membership_venue_eligibility"("orgId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_venue_eligibility_planId_locationId_key" ON "membership_venue_eligibility"("planId", "locationId");

-- CreateIndex
CREATE INDEX "membership_settings_orgId_idx" ON "membership_settings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_settings_orgId_locationId_key" ON "membership_settings"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "membership_payment_attempts_orgId_guestMembershipId_created_idx" ON "membership_payment_attempts"("orgId", "guestMembershipId", "createdAt");

-- CreateIndex
CREATE INDEX "membership_payment_attempts_orgId_status_idx" ON "membership_payment_attempts"("orgId", "status");

-- CreateIndex
CREATE INDEX "membership_cancel_alternatives_orgId_active_sortOrder_idx" ON "membership_cancel_alternatives"("orgId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "membership_agreements_orgId_idx" ON "membership_agreements"("orgId");

-- CreateIndex
CREATE INDEX "membership_agreements_orgId_guestProfileId_idx" ON "membership_agreements"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "membership_agreements_guestMembershipId_idx" ON "membership_agreements"("guestMembershipId");

-- AddForeignKey
ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_profiles" ADD CONSTRAINT "guest_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_memberships" ADD CONSTRAINT "guest_memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_memberships" ADD CONSTRAINT "guest_memberships_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_memberships" ADD CONSTRAINT "guest_memberships_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "venue_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_memberships" ADD CONSTRAINT "guest_memberships_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_memberships" ADD CONSTRAINT "guest_memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_family_links" ADD CONSTRAINT "membership_family_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_family_links" ADD CONSTRAINT "membership_family_links_guestMembershipId_fkey" FOREIGN KEY ("guestMembershipId") REFERENCES "guest_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_family_links" ADD CONSTRAINT "membership_family_links_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usage_events" ADD CONSTRAINT "membership_usage_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usage_events" ADD CONSTRAINT "membership_usage_events_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usage_events" ADD CONSTRAINT "membership_usage_events_guestMembershipId_fkey" FOREIGN KEY ("guestMembershipId") REFERENCES "guest_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_usage_events" ADD CONSTRAINT "membership_usage_events_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_venue_eligibility" ADD CONSTRAINT "membership_venue_eligibility_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_venue_eligibility" ADD CONSTRAINT "membership_venue_eligibility_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_venue_eligibility" ADD CONSTRAINT "membership_venue_eligibility_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_settings" ADD CONSTRAINT "membership_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_settings" ADD CONSTRAINT "membership_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_payment_attempts" ADD CONSTRAINT "membership_payment_attempts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_payment_attempts" ADD CONSTRAINT "membership_payment_attempts_guestMembershipId_fkey" FOREIGN KEY ("guestMembershipId") REFERENCES "guest_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_cancel_alternatives" ADD CONSTRAINT "membership_cancel_alternatives_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_cancel_alternatives" ADD CONSTRAINT "membership_cancel_alternatives_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_guestMembershipId_fkey" FOREIGN KEY ("guestMembershipId") REFERENCES "guest_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

