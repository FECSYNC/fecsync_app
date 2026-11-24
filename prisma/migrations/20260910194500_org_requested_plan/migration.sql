-- Persist registration plan interest (landing ?plan=) without entitling creates.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "requestedPlan" TEXT;
