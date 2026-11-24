-- Soft account lock for FECSYNC super-admin suspend.
-- Does not delete users, memberships, orders, or company data.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accountSuspended" BOOLEAN NOT NULL DEFAULT false;
