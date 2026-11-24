-- Step 3: per-franchise-park Connect merchant + ledger destination snapshots

CREATE TABLE IF NOT EXISTS "venue_location_marketplace_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "provider" "MarketplaceProvider" NOT NULL DEFAULT 'stripe_connect',
    "stripeConnectedAccountId" TEXT,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "requirementsDue" JSONB,
    "payoutBankLast4" TEXT,
    "payoutBankName" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'usd',
    "onboardingStatus" "MarketplaceOnboardingStatus" NOT NULL DEFAULT 'not_started',
    "disabledReason" TEXT,
    "platformFeeBpsOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_location_marketplace_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "venue_location_marketplace_accounts_locationId_key"
  ON "venue_location_marketplace_accounts"("locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "venue_location_marketplace_accounts_stripeConnectedAccountId_key"
  ON "venue_location_marketplace_accounts"("stripeConnectedAccountId");
CREATE INDEX IF NOT EXISTS "venue_location_marketplace_accounts_orgId_idx"
  ON "venue_location_marketplace_accounts"("orgId");
CREATE INDEX IF NOT EXISTS "venue_location_marketplace_accounts_stripeConnectedAccountId_idx"
  ON "venue_location_marketplace_accounts"("stripeConnectedAccountId");

DO $$ BEGIN
  ALTER TABLE "venue_location_marketplace_accounts"
    ADD CONSTRAINT "venue_location_marketplace_accounts_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "venue_location_marketplace_accounts"
    ADD CONSTRAINT "venue_location_marketplace_accounts_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "booking_payments"
  ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER;

ALTER TABLE "membership_payment_attempts"
  ADD COLUMN IF NOT EXISTS "locationId" TEXT,
  ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER;

CREATE INDEX IF NOT EXISTS "membership_payment_attempts_orgId_locationId_idx"
  ON "membership_payment_attempts"("orgId", "locationId");

ALTER TABLE "pos_sale_payments"
  ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER;
