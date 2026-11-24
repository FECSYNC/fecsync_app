-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "MarketingCampaignScheduleKind" AS ENUM ('once', 'monthly');

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "scheduleKind" "MarketingCampaignScheduleKind" NOT NULL DEFAULT 'once',
    "sendAt" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "sendHour" INTEGER NOT NULL DEFAULT 9,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'draft',
    "nextRunAt" TIMESTAMP(3),
    "currentWindowKey" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaign_recipients" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "status" "MarketingSendStatus" NOT NULL,
    "skipReason" TEXT,
    "sendLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_campaigns_orgId_status_idx" ON "marketing_campaigns"("orgId", "status");

-- CreateIndex
CREATE INDEX "marketing_campaigns_status_nextRunAt_idx" ON "marketing_campaigns"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "marketing_campaign_recipients_orgId_campaignId_windowKey_idx" ON "marketing_campaign_recipients"("orgId", "campaignId", "windowKey");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_campaign_recipients_campaignId_guestProfileId_win_key" ON "marketing_campaign_recipients"("campaignId", "guestProfileId", "windowKey");

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_recipients" ADD CONSTRAINT "marketing_campaign_recipients_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
