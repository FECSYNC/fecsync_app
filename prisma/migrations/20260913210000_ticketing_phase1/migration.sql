-- Online Booking / Ticketing Phase 1 (additive).
-- Schema was first applied via `prisma db push` where migrate shadow DB fails
-- on historical campaign migrations. On a fresh deploy that already has these
-- objects: `npx prisma migrate resolve --applied 20260913210000_ticketing_phase1`

-- ── Enums (idempotent) ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "AdmissionProductType" AS ENUM (
    'timed_session', 'day_pass', 'group', 'camp_event',
    'party_package', 'add_on', 'pass'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingStatus" AS ENUM (
    'draft', 'hold', 'reserved', 'pending_payment',
    'confirmed', 'cancelled', 'expired', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingChannel" AS ENUM (
    'online', 'phone', 'walk_in', 'pos', 'account'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingCreateMode" AS ENUM ('hold', 'reserve', 'prompt');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CapacityResourceType" AS ENUM (
    'attraction', 'session', 'room', 'lane', 'party_room', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingPaymentTender" AS ENUM (
    'card', 'cash', 'split_component', 'gift_card',
    'stored_card', 'invoice', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingPaymentStatus" AS ENUM (
    'pending', 'completed', 'failed', 'cancelled', 'refunded', 'partial_refund'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM (
    'draft', 'sent', 'paid', 'void', 'cancelled', 'overdue'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TicketCredentialStatus" AS ENUM (
    'unused', 'redeemed', 'void', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PartyInviteStatus" AS ENUM (
    'pending', 'sent', 'accepted', 'declined', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StockPeriodKind" AS ENUM ('available', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingActivityKind" AS ENUM (
    'created', 'edited', 'status', 'payment', 'email', 'sms', 'call',
    'note', 'staff_assign', 'ticket_ids', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PartyGuestRole" AS ENUM ('host', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentLinkChannel" AS ENUM ('email', 'sms');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend existing enums (ignore if already present)
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'booking';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'AdmissionProduct'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'TicketSession'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'Booking'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'BookingInvoice'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'BookingAccount'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'TicketCredential'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "ActivityEntityType" ADD VALUE IF NOT EXISTS 'BookingPayment'; EXCEPTION WHEN others THEN NULL; END $$;

-- ── Tables ───────────────────────────────────────────────────────────────────
-- Full column set matches prisma/schema.prisma ticketing models.
-- CREATE TABLE IF NOT EXISTS so re-runs / resolve after db push are safe.

CREATE TABLE IF NOT EXISTS "booking_settings" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT,
  "defaultCreateMode" "BookingCreateMode" NOT NULL DEFAULT 'hold',
  "holdTtlMinutes" INTEGER NOT NULL DEFAULT 15,
  "reserveTtlHours" INTEGER NOT NULL DEFAULT 24,
  "requireReviewBeforeConfirm" BOOLEAN NOT NULL DEFAULT false,
  "allowOnlinePayLater" BOOLEAN NOT NULL DEFAULT false,
  "payLaterMarksConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "pastEditGraceMinutes" INTEGER NOT NULL DEFAULT 0,
  "cancelCutoffMinutes" INTEGER,
  "defaultTaxExempt" BOOLEAN NOT NULL DEFAULT false,
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_settings_orgId_locationId_key"
  ON "booking_settings"("orgId", "locationId");
-- Partial unique: at most one org-default row (locationId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "booking_settings_org_default_uidx"
  ON "booking_settings"("orgId") WHERE "locationId" IS NULL;
CREATE INDEX IF NOT EXISTS "booking_settings_orgId_idx" ON "booking_settings"("orgId");

CREATE TABLE IF NOT EXISTS "capacity_resources" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "CapacityResourceType" NOT NULL DEFAULT 'other',
  "defaultCapacity" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "capacity_resources_orgId_locationId_idx"
  ON "capacity_resources"("orgId", "locationId");
CREATE INDEX IF NOT EXISTS "capacity_resources_orgId_archivedAt_idx"
  ON "capacity_resources"("orgId", "archivedAt");

CREATE TABLE IF NOT EXISTS "admission_products" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "type" "AdmissionProductType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "resourceId" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "waiverRequired" BOOLEAN NOT NULL DEFAULT false,
  "minGuests" INTEGER,
  "maxGuests" INTEGER,
  "defaultPassExpiryDays" INTEGER,
  "taxExemptDefault" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "admission_products_orgId_locationId_idx"
  ON "admission_products"("orgId", "locationId");
CREATE INDEX IF NOT EXISTS "admission_products_orgId_type_archivedAt_idx"
  ON "admission_products"("orgId", "type", "archivedAt");
CREATE INDEX IF NOT EXISTS "admission_products_orgId_published_idx"
  ON "admission_products"("orgId", "published");

CREATE TABLE IF NOT EXISTS "admission_product_prices" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "minAge" INTEGER,
  "maxAge" INTEGER,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "admission_product_prices_orgId_productId_idx"
  ON "admission_product_prices"("orgId", "productId");
CREATE INDEX IF NOT EXISTS "admission_product_prices_productId_idx"
  ON "admission_product_prices"("productId");

CREATE TABLE IF NOT EXISTS "stock_periods" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "kind" "StockPeriodKind" NOT NULL DEFAULT 'available',
  "quantity" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "stock_periods_orgId_locationId_startsAt_idx"
  ON "stock_periods"("orgId", "locationId", "startsAt");

CREATE TABLE IF NOT EXISTS "admission_addon_links" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "parentProductId" TEXT NOT NULL,
  "addOnProductId" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "maxQty" INTEGER,
  "stockPeriodId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "admission_addon_links_parentProductId_addOnProductId_key"
  ON "admission_addon_links"("parentProductId", "addOnProductId");
CREATE INDEX IF NOT EXISTS "admission_addon_links_orgId_locationId_idx"
  ON "admission_addon_links"("orgId", "locationId");

CREATE TABLE IF NOT EXISTS "stock_period_products" (
  "id" TEXT PRIMARY KEY,
  "stockPeriodId" TEXT NOT NULL,
  "productId" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "stock_period_products_stockPeriodId_productId_key"
  ON "stock_period_products"("stockPeriodId", "productId");
CREATE INDEX IF NOT EXISTS "stock_period_products_productId_idx"
  ON "stock_period_products"("productId");

CREATE TABLE IF NOT EXISTS "ticket_sessions" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "resourceId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER NOT NULL,
  "remaining" INTEGER NOT NULL,
  "priceOverride" DECIMAL(12,2),
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "ticket_sessions_orgId_locationId_startsAt_idx"
  ON "ticket_sessions"("orgId", "locationId", "startsAt");
CREATE INDEX IF NOT EXISTS "ticket_sessions_productId_startsAt_idx"
  ON "ticket_sessions"("productId", "startsAt");
CREATE INDEX IF NOT EXISTS "ticket_sessions_orgId_isClosed_idx"
  ON "ticket_sessions"("orgId", "isClosed");

CREATE TABLE IF NOT EXISTS "booking_accounts" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT,
  "name" TEXT NOT NULL,
  "billingEmail" TEXT,
  "phone" TEXT,
  "taxId" TEXT,
  "notes" TEXT,
  "defaultTaxExempt" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "booking_accounts_orgId_name_idx" ON "booking_accounts"("orgId", "name");
CREATE INDEX IF NOT EXISTS "booking_accounts_orgId_locationId_idx" ON "booking_accounts"("orgId", "locationId");

CREATE TABLE IF NOT EXISTS "booking_account_contacts" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "title" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "booking_account_contacts_accountId_idx" ON "booking_account_contacts"("accountId");
CREATE INDEX IF NOT EXISTS "booking_account_contacts_orgId_idx" ON "booking_account_contacts"("orgId");

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" TEXT PRIMARY KEY,
  "publicId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'draft',
  "channel" "BookingChannel" NOT NULL DEFAULT 'online',
  "createMode" "BookingCreateMode" NOT NULL DEFAULT 'hold',
  "userId" TEXT,
  "accountId" TEXT,
  "primaryContactName" TEXT,
  "primaryContactEmail" TEXT,
  "primaryContactPhone" TEXT,
  "assignedStaffUserId" TEXT,
  "taxExempt" BOOLEAN NOT NULL DEFAULT false,
  "taxExemptReason" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "posNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "holdExpiresAt" TIMESTAMP(3),
  "reservedUntil" TIMESTAMP(3),
  "visitStartsAt" TIMESTAMP(3),
  "visitEndsAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "reactivatedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "updatedById" TEXT,
  "confirmationSentAt" TIMESTAMP(3),
  "viewToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_publicId_key" ON "bookings"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_viewToken_key" ON "bookings"("viewToken");
CREATE INDEX IF NOT EXISTS "bookings_orgId_locationId_status_idx" ON "bookings"("orgId", "locationId", "status");
CREATE INDEX IF NOT EXISTS "bookings_orgId_visitStartsAt_idx" ON "bookings"("orgId", "visitStartsAt");
CREATE INDEX IF NOT EXISTS "bookings_orgId_primaryContactEmail_idx" ON "bookings"("orgId", "primaryContactEmail");
CREATE INDEX IF NOT EXISTS "bookings_accountId_idx" ON "bookings"("accountId");

CREATE TABLE IF NOT EXISTS "booking_lines" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "productId" TEXT,
  "productName" TEXT NOT NULL,
  "productType" "AdmissionProductType" NOT NULL,
  "priceBandCode" TEXT,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(12,2) NOT NULL,
  "resourceId" TEXT,
  "sessionId" TEXT,
  "visitDate" TIMESTAMP(3),
  "passExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "booking_lines_bookingId_idx" ON "booking_lines"("bookingId");
CREATE INDEX IF NOT EXISTS "booking_lines_orgId_productId_idx" ON "booking_lines"("orgId", "productId");

CREATE TABLE IF NOT EXISTS "ticket_credentials" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "qrPayload" TEXT NOT NULL,
  "status" "TicketCredentialStatus" NOT NULL DEFAULT 'unused',
  "customTicketId" TEXT,
  "passExpiresAt" TIMESTAMP(3),
  "redeemedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_credentials_orgId_code_key" ON "ticket_credentials"("orgId", "code");
CREATE INDEX IF NOT EXISTS "ticket_credentials_orgId_locationId_status_idx" ON "ticket_credentials"("orgId", "locationId", "status");
CREATE INDEX IF NOT EXISTS "ticket_credentials_bookingId_idx" ON "ticket_credentials"("bookingId");

CREATE TABLE IF NOT EXISTS "booking_guests" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "bookingLineId" TEXT,
  "name" TEXT,
  "ageBand" TEXT,
  "partyRole" "PartyGuestRole",
  "credentialId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_guests_credentialId_key" ON "booking_guests"("credentialId");
CREATE INDEX IF NOT EXISTS "booking_guests_bookingId_idx" ON "booking_guests"("bookingId");

CREATE TABLE IF NOT EXISTS "booking_holds" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookingId" TEXT,
  "sessionId" TEXT,
  "resourceId" TEXT,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_holds_token_key" ON "booking_holds"("token");
CREATE INDEX IF NOT EXISTS "booking_holds_orgId_locationId_expiresAt_idx" ON "booking_holds"("orgId", "locationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "booking_holds_sessionId_idx" ON "booking_holds"("sessionId");

CREATE TABLE IF NOT EXISTS "gift_cards" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "remainingBalance" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "issuedFromRefundBookingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_orgId_codeHash_key" ON "gift_cards"("orgId", "codeHash");
CREATE INDEX IF NOT EXISTS "gift_cards_orgId_idx" ON "gift_cards"("orgId");

CREATE TABLE IF NOT EXISTS "booking_payments" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "tender" "BookingPaymentTender" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "BookingPaymentStatus" NOT NULL DEFAULT 'pending',
  "stripePaymentIntentId" TEXT,
  "stripeChargeId" TEXT,
  "giftCardId" TEXT,
  "receivedByStaffId" TEXT,
  "splitGroupId" TEXT,
  "receiptEmailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "booking_payments_orgId_bookingId_idx" ON "booking_payments"("orgId", "bookingId");
CREATE INDEX IF NOT EXISTS "booking_payments_orgId_status_idx" ON "booking_payments"("orgId", "status");

CREATE TABLE IF NOT EXISTS "booking_payment_links" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "amountDue" DECIMAL(12,2) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "channel" "PaymentLinkChannel" NOT NULL DEFAULT 'email',
  "sentTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_payment_links_token_key" ON "booking_payment_links"("token");
CREATE INDEX IF NOT EXISTS "booking_payment_links_orgId_bookingId_idx" ON "booking_payment_links"("orgId", "bookingId");

CREATE TABLE IF NOT EXISTS "booking_invoices" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "bookingId" TEXT,
  "accountId" TEXT,
  "number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "dueAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "pdfUrl" TEXT,
  "htmlSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "booking_invoices_orgId_number_key" ON "booking_invoices"("orgId", "number");
CREATE INDEX IF NOT EXISTS "booking_invoices_orgId_status_idx" ON "booking_invoices"("orgId", "status");

CREATE TABLE IF NOT EXISTS "stored_payment_methods" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "userId" TEXT,
  "accountId" TEXT,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePaymentMethodId" TEXT NOT NULL,
  "brand" TEXT,
  "last4" TEXT,
  "expMonth" INTEGER,
  "expYear" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "stored_payment_methods_orgId_userId_idx" ON "stored_payment_methods"("orgId", "userId");
CREATE INDEX IF NOT EXISTS "stored_payment_methods_orgId_accountId_idx" ON "stored_payment_methods"("orgId", "accountId");

CREATE TABLE IF NOT EXISTS "booking_activities" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "locationId" TEXT,
  "bookingId" TEXT NOT NULL,
  "kind" "BookingActivityKind" NOT NULL,
  "payload" JSONB,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "booking_activities_bookingId_createdAt_idx" ON "booking_activities"("bookingId", "createdAt");
CREATE INDEX IF NOT EXISTS "booking_activities_orgId_createdAt_idx" ON "booking_activities"("orgId", "createdAt");

CREATE TABLE IF NOT EXISTS "party_booking_details" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "roomResourceId" TEXT,
  "hostStaffUserId" TEXT,
  "kidCount" INTEGER,
  "packageProductId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "party_booking_details_bookingId_key" ON "party_booking_details"("bookingId");
CREATE INDEX IF NOT EXISTS "party_booking_details_orgId_idx" ON "party_booking_details"("orgId");

CREATE TABLE IF NOT EXISTS "party_guests" (
  "id" TEXT PRIMARY KEY,
  "partyDetailId" TEXT NOT NULL,
  "bookingGuestId" TEXT,
  "name" TEXT,
  "age" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "party_guests_bookingGuestId_key" ON "party_guests"("bookingGuestId");
CREATE INDEX IF NOT EXISTS "party_guests_partyDetailId_idx" ON "party_guests"("partyDetailId");

CREATE TABLE IF NOT EXISTS "party_invitations" (
  "id" TEXT PRIMARY KEY,
  "partyDetailId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "channel" "PaymentLinkChannel" NOT NULL DEFAULT 'email',
  "sentTo" TEXT,
  "status" "PartyInviteStatus" NOT NULL DEFAULT 'pending',
  "sentAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "party_invitations_token_key" ON "party_invitations"("token");
CREATE INDEX IF NOT EXISTS "party_invitations_partyDetailId_status_idx" ON "party_invitations"("partyDetailId", "status");

CREATE TABLE IF NOT EXISTS "party_run_sheet_items" (
  "id" TEXT PRIMARY KEY,
  "partyDetailId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "party_run_sheet_items_partyDetailId_sortOrder_idx"
  ON "party_run_sheet_items"("partyDetailId", "sortOrder");
