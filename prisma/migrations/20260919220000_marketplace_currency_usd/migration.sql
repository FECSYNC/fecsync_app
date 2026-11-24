-- Marketplace v1 primary currency: USD (was NGN).
-- Align Connect account defaults, package catalog, and unsettled bookings.

ALTER TABLE "organization_marketplace_accounts"
  ALTER COLUMN "defaultCurrency" SET DEFAULT 'usd';

UPDATE "organization_marketplace_accounts"
SET "defaultCurrency" = 'usd'
WHERE lower("defaultCurrency") = 'ngn';

ALTER TABLE "booking_packages"
  ALTER COLUMN "currency" SET DEFAULT 'usd';

UPDATE "booking_packages"
SET "currency" = 'usd'
WHERE lower("currency") = 'ngn';

-- Unsettled guest bookings only — leave paid/refunded Stripe history untouched.
UPDATE "marketplace_bookings"
SET "currency" = 'usd'
WHERE lower("currency") = 'ngn'
  AND "status" = 'pending_payment';
