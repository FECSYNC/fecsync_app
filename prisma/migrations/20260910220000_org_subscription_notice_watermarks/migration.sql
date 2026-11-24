-- Ensure all Step 3 company subscription notice watermark columns exist.
-- (14d may already exist from 20260910210000; IF NOT EXISTS is idempotent.)
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticePastDueAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeExpiredAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeRemind14dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeRemind7dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeRemind3dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "subscriptionNoticeRemind1dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opsGrantNoticeRemind14dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opsGrantNoticeRemind7dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opsGrantNoticeRemind3dAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "opsGrantNoticeRemind1dAt" TIMESTAMP(3);
