-- Company SaaS Step 4: indexes for expiry reconcile + storefront/company filters.
CREATE INDEX IF NOT EXISTS "organizations_status_subscriptionEndsAt_idx"
  ON "organizations"("status", "subscriptionEndsAt");

CREATE INDEX IF NOT EXISTS "organizations_isDefault_status_idx"
  ON "organizations"("isDefault", "status");
