-- CreateEnum
CREATE TYPE "CampaignParticipantRole" AS ENUM ('direct', 'coordinator', 'member');

-- AlterTable
ALTER TABLE "campaign_participants" ADD COLUMN     "canInviteMembers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coordinatorGroupLabel" TEXT,
ADD COLUMN     "invitedByParticipantId" TEXT,
ADD COLUMN     "role" "CampaignParticipantRole" NOT NULL DEFAULT 'direct',
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "campaign_participants_shareToken_key" ON "campaign_participants"("shareToken");

-- CreateIndex
CREATE INDEX "campaign_participants_campaignId_role_idx" ON "campaign_participants"("campaignId", "role");

-- CreateIndex
CREATE INDEX "campaign_participants_invitedByParticipantId_idx" ON "campaign_participants"("invitedByParticipantId");

-- CreateIndex
CREATE INDEX "campaign_participants_shareToken_idx" ON "campaign_participants"("shareToken");

-- AddForeignKey
ALTER TABLE "campaign_participants" ADD CONSTRAINT "campaign_participants_invitedByParticipantId_fkey" FOREIGN KEY ("invitedByParticipantId") REFERENCES "campaign_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing rows (Prisma @default handles new rows)
UPDATE "campaign_participants" SET "role" = 'direct', "canInviteMembers" = false WHERE "role" IS NULL;
