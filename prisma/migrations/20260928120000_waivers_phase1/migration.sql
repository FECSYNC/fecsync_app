-- CreateEnum
CREATE TYPE "WaiverDocumentKind" AS ENUM ('liability_waiver', 'membership_contract', 'booking_agreement', 'custom_form', 'inquiry', 'event_form', 'product_addon_form');

-- CreateEnum
CREATE TYPE "WaiverTemplateStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "WaiverRecordStatus" AS ENUM ('pending', 'signed', 'expired', 'declined', 'voided', 'revoked');

-- CreateEnum
CREATE TYPE "WaiverSignerRole" AS ENUM ('adult_self', 'guardian', 'staff_assisted', 'imported');

-- CreateEnum
CREATE TYPE "WaiverCoveredRole" AS ENUM ('adult_self', 'minor', 'guardian');

-- CreateEnum
CREATE TYPE "WaiverSignChannel" AS ENUM ('online', 'email_link', 'sms_link', 'qr', 'kiosk', 'onsite', 'import');

-- CreateEnum
CREATE TYPE "WaiverExpiryRule" AS ENUM ('never', 'days', 'calendar_year', 'visit', 'until_date');

-- CreateEnum
CREATE TYPE "WaiverRequestStatus" AS ENUM ('queued', 'sent', 'failed', 'opened', 'completed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "WaiverKioskStatus" AS ENUM ('active', 'disabled', 'archived');

-- CreateEnum
CREATE TYPE "FormResponseStatus" AS ENUM ('submitted', 'archived');

-- CreateEnum
CREATE TYPE "WaiverRequirementEnforcement" AS ENUM ('warn', 'block');

-- CreateEnum
CREATE TYPE "WaiverLinkTargetType" AS ENUM ('guest', 'booking', 'party_guest', 'pos_sale', 'admission_product', 'pos_product', 'membership_plan', 'party_package', 'all_admissions', 'other');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEntityType" ADD VALUE 'WaiverTemplate';
ALTER TYPE "ActivityEntityType" ADD VALUE 'WaiverRecord';
ALTER TYPE "ActivityEntityType" ADD VALUE 'WaiverRequest';
ALTER TYPE "ActivityEntityType" ADD VALUE 'FormResponse';
ALTER TYPE "ActivityEntityType" ADD VALUE 'WaiverKioskDevice';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'waiver';

-- CreateTable
CREATE TABLE "waiver_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "jurisdictionCode" TEXT NOT NULL DEFAULT 'US-FL',
    "ageOfMajorityYears" INTEGER NOT NULL DEFAULT 18,
    "requireGuardianForMinors" BOOLEAN NOT NULL DEFAULT true,
    "allowAdultSelfSign" BOOLEAN NOT NULL DEFAULT true,
    "allowGroupSigning" BOOLEAN NOT NULL DEFAULT true,
    "maxMinorsPerGuardianSession" INTEGER NOT NULL DEFAULT 8,
    "expiryRule" "WaiverExpiryRule" NOT NULL DEFAULT 'calendar_year',
    "expiryDays" INTEGER,
    "remindBeforeDays" JSONB NOT NULL DEFAULT '[14,3]',
    "retentionYears" INTEGER NOT NULL DEFAULT 7,
    "requireIntentCheckbox" BOOLEAN NOT NULL DEFAULT true,
    "allowTypedSignature" BOOLEAN NOT NULL DEFAULT true,
    "allowDrawnSignature" BOOLEAN NOT NULL DEFAULT true,
    "optionalWitness" BOOLEAN NOT NULL DEFAULT false,
    "blockCheckInWhenMissing" BOOLEAN NOT NULL DEFAULT true,
    "kioskRequireStaffPin" BOOLEAN NOT NULL DEFAULT true,
    "kioskSessionMinutes" INTEGER NOT NULL DEFAULT 5,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_templates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "kind" "WaiverDocumentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "WaiverTemplateStatus" NOT NULL DEFAULT 'draft',
    "currentPublishedVersionId" TEXT,
    "requireResignOnPublish" BOOLEAN NOT NULL DEFAULT false,
    "defaultExpiryRule" "WaiverExpiryRule",
    "defaultExpiryDays" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "waiver_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_template_versions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "localeDefault" TEXT NOT NULL,
    "status" "WaiverTemplateStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "fieldsJson" JSONB,
    "contentSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiver_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_template_locales" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "fieldsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiver_template_locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_requirements" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "templateId" TEXT NOT NULL,
    "targetType" "WaiverLinkTargetType" NOT NULL,
    "targetId" TEXT,
    "enforcement" "WaiverRequirementEnforcement" NOT NULL DEFAULT 'block',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_records" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "status" "WaiverRecordStatus" NOT NULL DEFAULT 'pending',
    "signerRole" "WaiverSignerRole" NOT NULL,
    "channel" "WaiverSignChannel" NOT NULL,
    "locale" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "guardianGuestProfileId" TEXT,
    "guardianRelationship" TEXT,
    "bookingId" TEXT,
    "partyGuestId" TEXT,
    "posSaleId" TEXT,
    "importedFrom" TEXT,
    "publicRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_signers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "waiverRecordId" TEXT NOT NULL,
    "guestProfileId" TEXT,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "role" "WaiverCoveredRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiver_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_signatures" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "waiverRecordId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "intentAccepted" BOOLEAN NOT NULL,
    "typedName" TEXT,
    "drawnSignatureSvg" TEXT,
    "witnessName" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "contentSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waiver_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_requests" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "guestProfileId" TEXT,
    "toEmail" TEXT,
    "toPhone" TEXT,
    "channel" "WaiverSignChannel" NOT NULL,
    "status" "WaiverRequestStatus" NOT NULL DEFAULT 'queued',
    "publicTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "bookingId" TEXT,
    "partyGuestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_kiosk_devices" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "WaiverKioskStatus" NOT NULL DEFAULT 'active',
    "deviceTokenHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "templateIds" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_kiosk_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_responses" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "waiverRecordId" TEXT,
    "guestProfileId" TEXT,
    "status" "FormResponseStatus" NOT NULL DEFAULT 'submitted',
    "payloadJson" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "locale" TEXT NOT NULL,
    "source" "WaiverSignChannel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_compliance_acks" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "guideId" TEXT NOT NULL,
    "acknowledgedById" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "waiver_compliance_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waiver_settings_orgId_idx" ON "waiver_settings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_settings_orgId_locationId_key" ON "waiver_settings"("orgId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_templates_currentPublishedVersionId_key" ON "waiver_templates"("currentPublishedVersionId");

-- CreateIndex
CREATE INDEX "waiver_templates_orgId_locationId_idx" ON "waiver_templates"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "waiver_templates_orgId_kind_status_idx" ON "waiver_templates"("orgId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_templates_orgId_slug_key" ON "waiver_templates"("orgId", "slug");

-- CreateIndex
CREATE INDEX "waiver_template_versions_orgId_templateId_idx" ON "waiver_template_versions"("orgId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_template_versions_templateId_version_key" ON "waiver_template_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "waiver_template_locales_orgId_idx" ON "waiver_template_locales"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_template_locales_versionId_locale_key" ON "waiver_template_locales"("versionId", "locale");

-- CreateIndex
CREATE INDEX "waiver_requirements_orgId_targetType_targetId_idx" ON "waiver_requirements"("orgId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "waiver_requirements_orgId_locationId_idx" ON "waiver_requirements"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "waiver_requirements_templateId_idx" ON "waiver_requirements"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_records_publicRef_key" ON "waiver_records"("publicRef");

-- CreateIndex
CREATE INDEX "waiver_records_orgId_locationId_status_idx" ON "waiver_records"("orgId", "locationId", "status");

-- CreateIndex
CREATE INDEX "waiver_records_orgId_guestProfileId_idx" ON "waiver_records"("orgId", "guestProfileId");

-- CreateIndex
CREATE INDEX "waiver_records_orgId_expiresAt_idx" ON "waiver_records"("orgId", "expiresAt");

-- CreateIndex
CREATE INDEX "waiver_records_orgId_locationId_createdAt_idx" ON "waiver_records"("orgId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "waiver_records_bookingId_idx" ON "waiver_records"("bookingId");

-- CreateIndex
CREATE INDEX "waiver_records_partyGuestId_idx" ON "waiver_records"("partyGuestId");

-- CreateIndex
CREATE INDEX "waiver_signers_orgId_waiverRecordId_idx" ON "waiver_signers"("orgId", "waiverRecordId");

-- CreateIndex
CREATE INDEX "waiver_signers_guestProfileId_idx" ON "waiver_signers"("guestProfileId");

-- CreateIndex
CREATE INDEX "waiver_signatures_orgId_waiverRecordId_createdAt_idx" ON "waiver_signatures"("orgId", "waiverRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_requests_publicTokenHash_key" ON "waiver_requests"("publicTokenHash");

-- CreateIndex
CREATE INDEX "waiver_requests_orgId_locationId_createdAt_idx" ON "waiver_requests"("orgId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "waiver_requests_orgId_status_idx" ON "waiver_requests"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_kiosk_devices_deviceTokenHash_key" ON "waiver_kiosk_devices"("deviceTokenHash");

-- CreateIndex
CREATE INDEX "waiver_kiosk_devices_orgId_locationId_idx" ON "waiver_kiosk_devices"("orgId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_kiosk_devices_orgId_code_key" ON "waiver_kiosk_devices"("orgId", "code");

-- CreateIndex
CREATE INDEX "form_responses_orgId_templateId_submittedAt_idx" ON "form_responses"("orgId", "templateId", "submittedAt");

-- CreateIndex
CREATE INDEX "form_responses_orgId_locationId_idx" ON "form_responses"("orgId", "locationId");

-- CreateIndex
CREATE INDEX "waiver_compliance_acks_orgId_guideId_idx" ON "waiver_compliance_acks"("orgId", "guideId");

-- CreateIndex
CREATE INDEX "membership_agreements_waiverRecordId_idx" ON "membership_agreements"("waiverRecordId");

-- AddForeignKey
ALTER TABLE "membership_agreements" ADD CONSTRAINT "membership_agreements_waiverRecordId_fkey" FOREIGN KEY ("waiverRecordId") REFERENCES "waiver_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_settings" ADD CONSTRAINT "waiver_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_settings" ADD CONSTRAINT "waiver_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_currentPublishedVersionId_fkey" FOREIGN KEY ("currentPublishedVersionId") REFERENCES "waiver_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_template_versions" ADD CONSTRAINT "waiver_template_versions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_template_versions" ADD CONSTRAINT "waiver_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_template_versions" ADD CONSTRAINT "waiver_template_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_template_locales" ADD CONSTRAINT "waiver_template_locales_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_template_locales" ADD CONSTRAINT "waiver_template_locales_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "waiver_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requirements" ADD CONSTRAINT "waiver_requirements_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requirements" ADD CONSTRAINT "waiver_requirements_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requirements" ADD CONSTRAINT "waiver_requirements_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_guardianGuestProfileId_fkey" FOREIGN KEY ("guardianGuestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "waiver_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_partyGuestId_fkey" FOREIGN KEY ("partyGuestId") REFERENCES "party_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signers" ADD CONSTRAINT "waiver_signers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signers" ADD CONSTRAINT "waiver_signers_waiverRecordId_fkey" FOREIGN KEY ("waiverRecordId") REFERENCES "waiver_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signers" ADD CONSTRAINT "waiver_signers_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_waiverRecordId_fkey" FOREIGN KEY ("waiverRecordId") REFERENCES "waiver_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requests" ADD CONSTRAINT "waiver_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requests" ADD CONSTRAINT "waiver_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requests" ADD CONSTRAINT "waiver_requests_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requests" ADD CONSTRAINT "waiver_requests_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_requests" ADD CONSTRAINT "waiver_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_kiosk_devices" ADD CONSTRAINT "waiver_kiosk_devices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_kiosk_devices" ADD CONSTRAINT "waiver_kiosk_devices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "waiver_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "waiver_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_waiverRecordId_fkey" FOREIGN KEY ("waiverRecordId") REFERENCES "waiver_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_compliance_acks" ADD CONSTRAINT "waiver_compliance_acks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_compliance_acks" ADD CONSTRAINT "waiver_compliance_acks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_compliance_acks" ADD CONSTRAINT "waiver_compliance_acks_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Postgres UNIQUE (orgId, locationId) allows multiple NULLs. One org-default row only.
CREATE UNIQUE INDEX IF NOT EXISTS "waiver_settings_org_default_uidx"
ON "waiver_settings" ("orgId")
WHERE "locationId" IS NULL;

