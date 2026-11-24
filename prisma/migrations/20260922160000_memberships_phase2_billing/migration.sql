-- Memberships Phase 2: sell idempotency + dunning schedule + payment attempt keys.

ALTER TABLE "guest_memberships" ADD COLUMN IF NOT EXISTS "sellIdempotencyKey" TEXT;
ALTER TABLE "guest_memberships" ADD COLUMN IF NOT EXISTS "dunningNextAt" TIMESTAMP(3);
ALTER TABLE "guest_memberships" ADD COLUMN IF NOT EXISTS "dunningFailCount" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "guest_memberships_orgId_sellIdempotencyKey_key"
ON "guest_memberships"("orgId", "sellIdempotencyKey");

CREATE INDEX IF NOT EXISTS "guest_memberships_orgId_dunningNextAt_idx"
ON "guest_memberships"("orgId", "dunningNextAt");

ALTER TABLE "membership_payment_attempts" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "membership_payment_attempts_orgId_idempotencyKey_key"
ON "membership_payment_attempts"("orgId", "idempotencyKey");
