-- Party Management Step 1 foundation. Additive + data-preserving:
-- new columns are added nullable / defaulted, backfilled, then tightened.

-- CreateEnum
CREATE TYPE "PartyOpsStatus" AS ENUM ('inquiry', 'held', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE "PartyGuestKind" AS ENUM ('honoree', 'kid', 'adult', 'chaperone', 'other');
CREATE TYPE "PartyFoodOrderStatus" AS ENUM ('draft', 'submitted', 'sent_to_kitchen', 'fulfilled', 'cancelled');
CREATE TYPE "PartyDepositDueMode" AS ENUM ('at_booking', 'days_before_event', 'on_arrival');
CREATE TYPE "PartyBalanceDueMode" AS ENUM ('at_booking', 'days_before_event', 'on_arrival');
CREATE TYPE "PartyInvitationChannel" AS ENUM ('email', 'sms', 'link');
CREATE TYPE "PartyMenuItemKind" AS ENUM ('food', 'beverage', 'cake', 'other');

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'PartyBooking';
ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'PartyInvitation';
ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'PartyFoodOrder';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'party';
ALTER TYPE "PartyInviteStatus" ADD VALUE IF NOT EXISTS 'bounced';

-- Party food orders emit kitchen tickets without a POS sale.
ALTER TABLE "kitchen_tickets" ALTER COLUMN "saleId" DROP NOT NULL;

-- ── party_booking_details ────────────────────────────────────────────────
ALTER TABLE "party_booking_details"
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "partyName" TEXT NOT NULL DEFAULT 'Party',
  ADD COLUMN "honoreeName" TEXT,
  ADD COLUMN "honoreeAge" INTEGER,
  ADD COLUMN "honoreeBirthDate" TIMESTAMP(3),
  ADD COLUMN "adultCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "roomNameSnapshot" TEXT,
  ADD COLUMN "hostNotes" TEXT,
  ADD COLUMN "opsStatus" "PartyOpsStatus" NOT NULL DEFAULT 'inquiry',
  ADD COLUMN "depositRequiredCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositDueAt" TIMESTAMP(3),
  ADD COLUMN "balanceDueAt" TIMESTAMP(3),
  ADD COLUMN "foodNotes" TEXT,
  ADD COLUMN "waiverMissingCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "party_booking_details" d
SET
  "locationId" = b."locationId",
  "partyName" = COALESCE(
    NULLIF(btrim(b."primaryContactName"), ''),
    (SELECT p."name" FROM "admission_products" p WHERE p."id" = d."packageProductId"),
    'Party'
  ),
  "opsStatus" = (CASE b."status"::text
    WHEN 'draft' THEN 'inquiry'
    WHEN 'hold' THEN 'held'
    WHEN 'reserved' THEN 'held'
    WHEN 'pending_payment' THEN 'held'
    WHEN 'confirmed' THEN 'confirmed'
    ELSE 'cancelled'
  END)::"PartyOpsStatus",
  "kidCount" = COALESCE(
    d."kidCount",
    (SELECT SUM(l."qty")::int FROM "booking_lines" l
      WHERE l."bookingId" = d."bookingId" AND l."productType" = 'party_package'),
    0
  ),
  "roomNameSnapshot" = (SELECT r."name" FROM "capacity_resources" r WHERE r."id" = d."roomResourceId"),
  "depositPaidCents" = 0
FROM "bookings" b
WHERE b."id" = d."bookingId";

ALTER TABLE "party_booking_details" ALTER COLUMN "locationId" SET NOT NULL;
UPDATE "party_booking_details" SET "kidCount" = 0 WHERE "kidCount" IS NULL;
ALTER TABLE "party_booking_details" ALTER COLUMN "kidCount" SET DEFAULT 0;
ALTER TABLE "party_booking_details" ALTER COLUMN "kidCount" SET NOT NULL;

-- ── party_guests ─────────────────────────────────────────────────────────
ALTER TABLE "party_guests"
  ADD COLUMN "orgId" TEXT,
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "kind" "PartyGuestKind" NOT NULL DEFAULT 'kid',
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "invitationId" TEXT,
  ADD COLUMN "rsvpStatus" "PartyInviteStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "waiverStatus" TEXT NOT NULL DEFAULT 'n/a',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Legacy guests had no kind: under-18 → kid, everyone else → other (only bound by package max / room cap).
UPDATE "party_guests" g
SET
  "orgId" = d."orgId",
  "locationId" = d."locationId",
  "kind" = (CASE WHEN g."age" IS NOT NULL AND g."age" < 18 THEN 'kid' ELSE 'other' END)::"PartyGuestKind"
FROM "party_booking_details" d
WHERE d."id" = g."partyDetailId";

ALTER TABLE "party_guests" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "party_guests" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "party_guests" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ── party_invitations ────────────────────────────────────────────────────
ALTER TABLE "party_invitations"
  ADD COLUMN "orgId" TEXT,
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "guestId" TEXT,
  ADD COLUMN "toEmail" TEXT,
  ADD COLUMN "toPhone" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "channel_v2" "PartyInvitationChannel" NOT NULL DEFAULT 'email';

UPDATE "party_invitations" i
SET
  "orgId" = d."orgId",
  "locationId" = d."locationId",
  "channel_v2" = (i."channel"::text)::"PartyInvitationChannel",
  "toEmail" = CASE WHEN i."channel"::text = 'email' THEN i."sentTo" ELSE NULL END,
  "toPhone" = CASE WHEN i."channel"::text = 'sms' THEN i."sentTo" ELSE NULL END
FROM "party_booking_details" d
WHERE d."id" = i."partyDetailId";

ALTER TABLE "party_invitations" DROP COLUMN "channel";
ALTER TABLE "party_invitations" RENAME COLUMN "channel_v2" TO "channel";
ALTER TABLE "party_invitations" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "party_invitations" ALTER COLUMN "locationId" SET NOT NULL;

-- ── party_run_sheet_items ────────────────────────────────────────────────
ALTER TABLE "party_run_sheet_items"
  ADD COLUMN "orgId" TEXT,
  ADD COLUMN "locationId" TEXT;

UPDATE "party_run_sheet_items" r
SET "orgId" = d."orgId", "locationId" = d."locationId"
FROM "party_booking_details" d
WHERE d."id" = r."partyDetailId";

ALTER TABLE "party_run_sheet_items" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "party_run_sheet_items" ALTER COLUMN "locationId" SET NOT NULL;

-- ── New tables ───────────────────────────────────────────────────────────
CREATE TABLE "party_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "defaultDepositPercent" DECIMAL(5,2),
    "defaultDepositFixedCents" INTEGER,
    "depositDueMode" "PartyDepositDueMode" NOT NULL DEFAULT 'at_booking',
    "depositDaysBefore" INTEGER NOT NULL DEFAULT 0,
    "requireDepositToConfirm" BOOLEAN NOT NULL DEFAULT true,
    "allowConfirmWithoutDeposit" BOOLEAN NOT NULL DEFAULT false,
    "balanceDueMode" "PartyBalanceDueMode" NOT NULL DEFAULT 'on_arrival',
    "balanceDaysBefore" INTEGER NOT NULL DEFAULT 0,
    "defaultPartyDurationMinutes" INTEGER NOT NULL DEFAULT 120,
    "defaultMinKids" INTEGER NOT NULL DEFAULT 1,
    "defaultMaxKids" INTEGER NOT NULL DEFAULT 15,
    "defaultIncludedAdults" INTEGER NOT NULL DEFAULT 2,
    "invitationExpiresHours" INTEGER NOT NULL DEFAULT 168,
    "allowOnlinePartyBooking" BOOLEAN NOT NULL DEFAULT true,
    "allowHostEditGuestList" BOOLEAN NOT NULL DEFAULT true,
    "allowHostEditFood" BOOLEAN NOT NULL DEFAULT false,
    "foodOrderCutoffMinutes" INTEGER NOT NULL DEFAULT 60,
    "sendBalanceReminder" BOOLEAN NOT NULL DEFAULT true,
    "balanceReminderDaysBefore" JSONB NOT NULL DEFAULT '[7,3,1]',
    "hostCancelCutoffHours" INTEGER NOT NULL DEFAULT 48,
    "overrideFields" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "party_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_package_configs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "includedKids" INTEGER NOT NULL,
    "includedAdults" INTEGER NOT NULL,
    "extraKidPriceCents" INTEGER,
    "extraAdultPriceCents" INTEGER,
    "roomResourceId" TEXT,
    "roomAssignedAtBooking" BOOLEAN NOT NULL DEFAULT false,
    "depositPercentOverride" DECIMAL(5,2),
    "depositFixedCentsOverride" INTEGER,
    "includesFood" BOOLEAN NOT NULL DEFAULT false,
    "defaultMenuItemIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "party_package_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_menu_items" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "PartyMenuItemKind" NOT NULL DEFAULT 'food',
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "available" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "posProductId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "party_menu_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_food_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "partyDetailId" TEXT NOT NULL,
    "status" "PartyFoodOrderStatus" NOT NULL DEFAULT 'draft',
    "promisedAt" TIMESTAMP(3),
    "kitchenTicketId" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cutoffOverrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "party_food_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_food_lines" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "foodOrderId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "posProductId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "modifiers" JSONB,
    "unitPriceCents" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "party_food_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_balance_reminders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "partyDetailId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "skippedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "party_balance_reminders_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX "party_booking_details_orgId_locationId_opsStatus_idx" ON "party_booking_details"("orgId", "locationId", "opsStatus");
CREATE INDEX "party_booking_details_orgId_locationId_createdAt_idx" ON "party_booking_details"("orgId", "locationId", "createdAt");
CREATE INDEX "party_booking_details_orgId_locationId_bookingId_idx" ON "party_booking_details"("orgId", "locationId", "bookingId");
CREATE INDEX "party_booking_details_roomResourceId_idx" ON "party_booking_details"("roomResourceId");
CREATE INDEX "party_guests_orgId_locationId_idx" ON "party_guests"("orgId", "locationId");
CREATE INDEX "party_guests_partyDetailId_kind_idx" ON "party_guests"("partyDetailId", "kind");
CREATE INDEX "party_invitations_orgId_locationId_status_idx" ON "party_invitations"("orgId", "locationId", "status");
CREATE INDEX "party_invitations_expiresAt_idx" ON "party_invitations"("expiresAt");
CREATE INDEX "party_run_sheet_items_orgId_locationId_idx" ON "party_run_sheet_items"("orgId", "locationId");
CREATE INDEX "party_settings_orgId_idx" ON "party_settings"("orgId");
CREATE UNIQUE INDEX "party_settings_orgId_locationId_key" ON "party_settings"("orgId", "locationId");
CREATE UNIQUE INDEX "party_package_configs_productId_key" ON "party_package_configs"("productId");
CREATE INDEX "party_package_configs_orgId_locationId_idx" ON "party_package_configs"("orgId", "locationId");
CREATE INDEX "party_menu_items_orgId_locationId_available_archivedAt_idx" ON "party_menu_items"("orgId", "locationId", "available", "archivedAt");
CREATE UNIQUE INDEX "party_food_orders_kitchenTicketId_key" ON "party_food_orders"("kitchenTicketId");
CREATE INDEX "party_food_orders_orgId_locationId_status_idx" ON "party_food_orders"("orgId", "locationId", "status");
CREATE INDEX "party_food_orders_partyDetailId_idx" ON "party_food_orders"("partyDetailId");
CREATE INDEX "party_food_lines_foodOrderId_idx" ON "party_food_lines"("foodOrderId");
CREATE INDEX "party_balance_reminders_scheduledFor_sentAt_idx" ON "party_balance_reminders"("scheduledFor", "sentAt");
CREATE UNIQUE INDEX "party_balance_reminders_partyDetailId_kind_scheduledFor_key" ON "party_balance_reminders"("partyDetailId", "kind", "scheduledFor");

-- ── Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "party_booking_details" ADD CONSTRAINT "party_booking_details_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_booking_details" ADD CONSTRAINT "party_booking_details_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_guests" ADD CONSTRAINT "party_guests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_guests" ADD CONSTRAINT "party_guests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_invitations" ADD CONSTRAINT "party_invitations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_invitations" ADD CONSTRAINT "party_invitations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_invitations" ADD CONSTRAINT "party_invitations_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "party_guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "party_run_sheet_items" ADD CONSTRAINT "party_run_sheet_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_run_sheet_items" ADD CONSTRAINT "party_run_sheet_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_settings" ADD CONSTRAINT "party_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_settings" ADD CONSTRAINT "party_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_package_configs" ADD CONSTRAINT "party_package_configs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_package_configs" ADD CONSTRAINT "party_package_configs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_package_configs" ADD CONSTRAINT "party_package_configs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "admission_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_package_configs" ADD CONSTRAINT "party_package_configs_roomResourceId_fkey" FOREIGN KEY ("roomResourceId") REFERENCES "capacity_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "party_menu_items" ADD CONSTRAINT "party_menu_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_menu_items" ADD CONSTRAINT "party_menu_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_orders" ADD CONSTRAINT "party_food_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_orders" ADD CONSTRAINT "party_food_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_orders" ADD CONSTRAINT "party_food_orders_partyDetailId_fkey" FOREIGN KEY ("partyDetailId") REFERENCES "party_booking_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_orders" ADD CONSTRAINT "party_food_orders_kitchenTicketId_fkey" FOREIGN KEY ("kitchenTicketId") REFERENCES "kitchen_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "party_food_lines" ADD CONSTRAINT "party_food_lines_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_lines" ADD CONSTRAINT "party_food_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_lines" ADD CONSTRAINT "party_food_lines_foodOrderId_fkey" FOREIGN KEY ("foodOrderId") REFERENCES "party_food_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_food_lines" ADD CONSTRAINT "party_food_lines_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "party_menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "party_balance_reminders" ADD CONSTRAINT "party_balance_reminders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_balance_reminders" ADD CONSTRAINT "party_balance_reminders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_balance_reminders" ADD CONSTRAINT "party_balance_reminders_partyDetailId_fkey" FOREIGN KEY ("partyDetailId") REFERENCES "party_booking_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
