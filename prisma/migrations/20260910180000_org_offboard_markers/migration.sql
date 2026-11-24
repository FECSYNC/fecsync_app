-- Step 4: soft workspace offboard markers (no hard-delete of orders/payments/users).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "offboardRequestedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "offboardedAt" TIMESTAMP(3);
