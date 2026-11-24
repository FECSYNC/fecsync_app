-- Marketplace Connect payouts (World B) — separate from SaaS stripeCustomerId/subscription.

CREATE TYPE "MarketplaceProvider" AS ENUM ('stripe_connect', 'paystack', 'manual');
CREATE TYPE "MarketplaceOnboardingStatus" AS ENUM ('not_started', 'pending', 'restricted', 'complete', 'disabled');
CREATE TYPE "MarketplaceBookingStatus" AS ENUM ('pending_payment', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled', 'disputed');

CREATE TABLE "organization_marketplace_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "MarketplaceProvider" NOT NULL DEFAULT 'stripe_connect',
    "stripeConnectedAccountId" TEXT,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "requirementsDue" JSONB,
    "payoutBankLast4" TEXT,
    "payoutBankName" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'ngn',
    "onboardingStatus" "MarketplaceOnboardingStatus" NOT NULL DEFAULT 'not_started',
    "disabledReason" TEXT,
    "platformFeeBpsOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_marketplace_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_packages" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketplace_bookings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "packageId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "platformFeeMinor" INTEGER NOT NULL,
    "status" "MarketplaceBookingStatus" NOT NULL DEFAULT 'pending_payment',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeTransferId" TEXT,
    "connectedAccountId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketplace_payment_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bookingId" TEXT,
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadRedacted" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingResult" TEXT NOT NULL,

    CONSTRAINT "marketplace_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketplace_refunds" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "reason" TEXT,
    "actorUserId" TEXT,
    "refundApplicationFee" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_marketplace_accounts_orgId_key" ON "organization_marketplace_accounts"("orgId");
CREATE UNIQUE INDEX "organization_marketplace_accounts_stripeConnectedAccountId_key" ON "organization_marketplace_accounts"("stripeConnectedAccountId");
CREATE INDEX "organization_marketplace_accounts_orgId_idx" ON "organization_marketplace_accounts"("orgId");
CREATE INDEX "organization_marketplace_accounts_stripeConnectedAccountId_idx" ON "organization_marketplace_accounts"("stripeConnectedAccountId");

CREATE UNIQUE INDEX "booking_packages_orgId_slug_key" ON "booking_packages"("orgId", "slug");
CREATE INDEX "booking_packages_orgId_idx" ON "booking_packages"("orgId");
CREATE INDEX "booking_packages_orgId_published_active_idx" ON "booking_packages"("orgId", "published", "active");
CREATE INDEX "booking_packages_locationId_idx" ON "booking_packages"("locationId");

CREATE UNIQUE INDEX "marketplace_bookings_stripeCheckoutSessionId_key" ON "marketplace_bookings"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "marketplace_bookings_stripePaymentIntentId_key" ON "marketplace_bookings"("stripePaymentIntentId");
CREATE UNIQUE INDEX "marketplace_bookings_idempotencyKey_key" ON "marketplace_bookings"("idempotencyKey");
CREATE INDEX "marketplace_bookings_orgId_idx" ON "marketplace_bookings"("orgId");
CREATE INDEX "marketplace_bookings_orgId_status_idx" ON "marketplace_bookings"("orgId", "status");
CREATE INDEX "marketplace_bookings_packageId_idx" ON "marketplace_bookings"("packageId");
CREATE INDEX "marketplace_bookings_customerEmail_idx" ON "marketplace_bookings"("customerEmail");

CREATE UNIQUE INDEX "marketplace_payment_events_providerEventId_key" ON "marketplace_payment_events"("providerEventId");
CREATE INDEX "marketplace_payment_events_orgId_idx" ON "marketplace_payment_events"("orgId");
CREATE INDEX "marketplace_payment_events_bookingId_idx" ON "marketplace_payment_events"("bookingId");

CREATE UNIQUE INDEX "marketplace_refunds_stripeRefundId_key" ON "marketplace_refunds"("stripeRefundId");
CREATE INDEX "marketplace_refunds_orgId_idx" ON "marketplace_refunds"("orgId");
CREATE INDEX "marketplace_refunds_bookingId_idx" ON "marketplace_refunds"("bookingId");

ALTER TABLE "organization_marketplace_accounts" ADD CONSTRAINT "organization_marketplace_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_packages" ADD CONSTRAINT "booking_packages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_bookings" ADD CONSTRAINT "marketplace_bookings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_bookings" ADD CONSTRAINT "marketplace_bookings_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "booking_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketplace_payment_events" ADD CONSTRAINT "marketplace_payment_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_payment_events" ADD CONSTRAINT "marketplace_payment_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "marketplace_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "marketplace_refunds" ADD CONSTRAINT "marketplace_refunds_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_refunds" ADD CONSTRAINT "marketplace_refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "marketplace_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
