-- AlterTable
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeRemind14dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opsGrantNoticeRemind14dAt" TIMESTAMP(3);
