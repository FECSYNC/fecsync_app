-- Guest Marketing Automation (Growth+)

CREATE TYPE "MarketingSendStatus" AS ENUM ('sent', 'skipped', 'failed');
CREATE TYPE "GuestSurveyStatus" AS ENUM ('draft', 'published', 'archived');

ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "marketingEmailOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "marketingSmsOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "marketingOptInAt" TIMESTAMP(3);
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "marketingOptInSource" TEXT;
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "newsletterSubscribedAt" TIMESTAMP(3);
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "firstVisitAt" TIMESTAMP(3);
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "lastVisitAt" TIMESTAMP(3);
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "lastMarketingEmailAt" TIMESTAMP(3);
ALTER TABLE "guest_profiles" ADD COLUMN IF NOT EXISTS "welcomeEmailSentAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "guest_profiles_orgId_marketingEmailOptIn_idx" ON "guest_profiles"("orgId", "marketingEmailOptIn");
CREATE INDEX IF NOT EXISTS "guest_profiles_orgId_dateOfBirth_idx" ON "guest_profiles"("orgId", "dateOfBirth");
CREATE INDEX IF NOT EXISTS "guest_profiles_orgId_lastVisitAt_idx" ON "guest_profiles"("orgId", "lastVisitAt");

-- Activity / notification enum extensions (idempotent where supported)
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'marketing_send';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'marketing_lead';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'survey_response';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'automation_run';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'MarketingAutomationSettings';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'MarketingSendLog';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'GuestSurvey';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'GuestSurveyResponse';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'MarketingLead';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "marketing_automation_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "newsletterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeFromNewsletter" BOOLEAN NOT NULL DEFAULT false,
    "birthdayEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reengagementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "postVisitSurveyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeDelayHours" INTEGER NOT NULL DEFAULT 0,
    "birthdayDaysAhead" INTEGER NOT NULL DEFAULT 7,
    "reengagementInactiveDays" INTEGER NOT NULL DEFAULT 90,
    "reengagementCooldownDays" INTEGER NOT NULL DEFAULT 60,
    "postVisitDelayHours" INTEGER NOT NULL DEFAULT 24,
    "fromName" TEXT,
    "replyToEmail" TEXT,
    "partyBookingCtaPath" TEXT,
    "partyCategorySlug" TEXT,
    "websiteCtaUrl" TEXT,
    "promoCodeOrUrl" TEXT,
    "defaultSurveyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_automation_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_settings_orgId_locationId_key" ON "marketing_automation_settings"("orgId", "locationId");
CREATE INDEX IF NOT EXISTS "marketing_automation_settings_orgId_idx" ON "marketing_automation_settings"("orgId");
-- Postgres UNIQUE (orgId, locationId) allows multiple NULLs — one org-default row only.
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_settings_org_default_uidx"
ON "marketing_automation_settings" ("orgId")
WHERE "locationId" IS NULL;

CREATE TABLE IF NOT EXISTS "marketing_automation_templates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_automation_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_templates_orgId_kind_key" ON "marketing_automation_templates"("orgId", "kind");
CREATE INDEX IF NOT EXISTS "marketing_automation_templates_orgId_idx" ON "marketing_automation_templates"("orgId");

CREATE TABLE IF NOT EXISTS "guest_marketing_consents" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_marketing_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guest_marketing_consents_orgId_guestProfileId_channel_key" ON "guest_marketing_consents"("orgId", "guestProfileId", "channel");
CREATE INDEX IF NOT EXISTS "guest_marketing_consents_orgId_channel_optedIn_idx" ON "guest_marketing_consents"("orgId", "channel", "optedIn");

CREATE TABLE IF NOT EXISTS "marketing_send_logs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "guestProfileId" TEXT,
    "toEmail" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "automationKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "MarketingSendStatus" NOT NULL,
    "skipReason" TEXT,
    "templateKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_send_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "marketing_send_logs_orgId_kind_createdAt_idx" ON "marketing_send_logs"("orgId", "kind", "createdAt");
CREATE INDEX IF NOT EXISTS "marketing_send_logs_orgId_guestProfileId_kind_idx" ON "marketing_send_logs"("orgId", "guestProfileId", "kind");

CREATE TABLE IF NOT EXISTS "marketing_automation_runs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_runs_orgId_guestProfileId_kind_windowKey_key" ON "marketing_automation_runs"("orgId", "guestProfileId", "kind", "windowKey");
CREATE INDEX IF NOT EXISTS "marketing_automation_runs_orgId_kind_sentAt_idx" ON "marketing_automation_runs"("orgId", "kind", "sentAt");

CREATE TABLE IF NOT EXISTS "guest_surveys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "GuestSurveyStatus" NOT NULL DEFAULT 'draft',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "thankYouMessage" TEXT,
    "promoUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_surveys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guest_surveys_orgId_slug_key" ON "guest_surveys"("orgId", "slug");
CREATE INDEX IF NOT EXISTS "guest_surveys_orgId_status_idx" ON "guest_surveys"("orgId", "status");
CREATE INDEX IF NOT EXISTS "guest_surveys_orgId_locationId_idx" ON "guest_surveys"("orgId", "locationId");

CREATE TABLE IF NOT EXISTS "guest_survey_invites" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "locationId" TEXT,
    "bookingId" TEXT,
    "visitRef" TEXT,
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_survey_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guest_survey_invites_token_key" ON "guest_survey_invites"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "guest_survey_invites_orgId_visitRef_key" ON "guest_survey_invites"("orgId", "visitRef");
CREATE INDEX IF NOT EXISTS "guest_survey_invites_orgId_surveyId_createdAt_idx" ON "guest_survey_invites"("orgId", "surveyId", "createdAt");
CREATE INDEX IF NOT EXISTS "guest_survey_invites_orgId_guestProfileId_idx" ON "guest_survey_invites"("orgId", "guestProfileId");

CREATE TABLE IF NOT EXISTS "guest_survey_responses" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "inviteId" TEXT,
    "guestProfileId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "rating" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "guest_survey_responses_inviteId_key" ON "guest_survey_responses"("inviteId");
CREATE INDEX IF NOT EXISTS "guest_survey_responses_orgId_surveyId_createdAt_idx" ON "guest_survey_responses"("orgId", "surveyId", "createdAt");

ALTER TABLE "marketing_automation_settings" ADD CONSTRAINT "marketing_automation_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_automation_settings" ADD CONSTRAINT "marketing_automation_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketing_automation_templates" ADD CONSTRAINT "marketing_automation_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_marketing_consents" ADD CONSTRAINT "guest_marketing_consents_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_marketing_consents" ADD CONSTRAINT "guest_marketing_consents_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketing_send_logs" ADD CONSTRAINT "marketing_send_logs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_send_logs" ADD CONSTRAINT "marketing_send_logs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketing_send_logs" ADD CONSTRAINT "marketing_send_logs_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "marketing_automation_runs" ADD CONSTRAINT "marketing_automation_runs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing_automation_runs" ADD CONSTRAINT "marketing_automation_runs_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guest_surveys" ADD CONSTRAINT "guest_surveys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_surveys" ADD CONSTRAINT "guest_surveys_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "guest_survey_invites" ADD CONSTRAINT "guest_survey_invites_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_survey_invites" ADD CONSTRAINT "guest_survey_invites_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "guest_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_survey_invites" ADD CONSTRAINT "guest_survey_invites_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_survey_invites" ADD CONSTRAINT "guest_survey_invites_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "guest_survey_responses" ADD CONSTRAINT "guest_survey_responses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_survey_responses" ADD CONSTRAINT "guest_survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "guest_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_survey_responses" ADD CONSTRAINT "guest_survey_responses_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "guest_survey_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guest_survey_responses" ADD CONSTRAINT "guest_survey_responses_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
