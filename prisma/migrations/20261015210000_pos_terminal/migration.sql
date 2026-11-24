-- POS terminal foundation. Extends gift cards. Does not duplicate bookings, guests, or shop commerce.

ALTER TYPE "ActivityEntityType" ADD VALUE 'PosSale';
ALTER TYPE "ActivityEntityType" ADD VALUE 'PosDevice';
ALTER TYPE "ActivityEntityType" ADD VALUE 'TillSession';
ALTER TYPE "ActivityEntityType" ADD VALUE 'GiftCard';
ALTER TYPE "ActivityEntityType" ADD VALUE 'GuestTab';

ALTER TYPE "NotificationType" ADD VALUE 'pos';

CREATE TYPE "GiftCardKind" AS ENUM ('digital', 'physical');
CREATE TYPE "GiftCardStatus" AS ENUM ('active', 'pending', 'disabled', 'expired', 'void');
CREATE TYPE "GiftCardLedgerType" AS ENUM ('issue', 'redeem', 'refund', 'adjust', 'void');
CREATE TYPE "PosProductKind" AS ENUM ('admission_proxy', 'food', 'beverage', 'merchandise', 'open_price', 'package', 'party_package_proxy', 'add_on', 'gift_card', 'membership_plan', 'cashless_card', 'park_wallet', 'gratuity', 'other');
CREATE TYPE "PosCartStatus" AS ENUM ('open', 'parked');
CREATE TYPE "PosSaleStatus" AS ENUM ('open', 'parked', 'held_booking', 'unpaid', 'completed', 'voided', 'refunded', 'partially_refunded');
CREATE TYPE "PosLineKind" AS ENUM ('sku', 'open_price', 'modifier', 'package_component', 'booking', 'gift_card_issue', 'gift_card_redeem', 'membership', 'cashless', 'wallet', 'discount', 'tip', 'round', 'other');
CREATE TYPE "PosTenderType" AS ENUM ('card', 'cash', 'split_component', 'gift_card', 'park_wallet', 'cashless', 'stored_card', 'payment_link', 'other');
CREATE TYPE "PosPaymentStatus" AS ENUM ('pending', 'authorized', 'completed', 'failed', 'cancelled', 'refunded', 'partial_refund');
CREATE TYPE "TillSessionStatus" AS ENUM ('open', 'counting', 'closed', 'closed_no_count', 'void');
CREATE TYPE "TillMovementKind" AS ENUM ('open_float', 'cash_in', 'cash_out', 'sale_cash', 'refund_cash', 'tip', 'drop', 'pickup', 'other');
CREATE TYPE "CashlessAccountStatus" AS ENUM ('active', 'disabled', 'void');
CREATE TYPE "ParkWalletStatus" AS ENUM ('active', 'disabled', 'void');
CREATE TYPE "ParkWalletTxnType" AS ENUM ('issue', 'topup', 'redeem', 'refund', 'adjust');
CREATE TYPE "GuestTabStatus" AS ENUM ('open', 'authorized', 'settled', 'voided', 'split_child');
CREATE TYPE "PosOfflineMutationStatus" AS ENUM ('queued', 'syncing', 'applied', 'conflict', 'failed', 'discarded');
CREATE TYPE "KitchenTicketStatus" AS ENUM ('queued', 'sent', 'accepted', 'fulfilled', 'void');
CREATE TYPE "PosDrawerResult" AS ENUM ('kicked', 'not_kicked');

ALTER TABLE "memberships" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "memberships" ADD COLUMN "pinSetAt" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "memberships" ADD COLUMN "pinLockedUntil" TIMESTAMP(3);

ALTER TABLE "gift_cards" ADD COLUMN "last4" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "kind" "GiftCardKind" NOT NULL DEFAULT 'digital';
ALTER TABLE "gift_cards" ADD COLUMN "status" "GiftCardStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "gift_cards" ADD COLUMN "locationId" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "issuedToGuestId" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "issuedSaleId" TEXT;
ALTER TABLE "gift_cards" ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "booking_payments" ADD COLUMN "posSaleId" TEXT;

CREATE INDEX "gift_cards_orgId_last4_idx" ON "gift_cards"("orgId", "last4");
CREATE INDEX "gift_cards_orgId_locationId_idx" ON "gift_cards"("orgId", "locationId");

CREATE TABLE "pos_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "captureGuestPostcode" BOOLEAN NOT NULL DEFAULT false,
    "postcodeRequired" BOOLEAN NOT NULL DEFAULT false,
    "requireGuestOnSale" BOOLEAN NOT NULL DEFAULT false,
    "allowOpenPrice" BOOLEAN NOT NULL DEFAULT true,
    "allowParkedCarts" BOOLEAN NOT NULL DEFAULT true,
    "allowUnpaidBookings" BOOLEAN NOT NULL DEFAULT true,
    "paidRequiredForRedeem" BOOLEAN NOT NULL DEFAULT true,
    "defaultReceiptEmail" BOOLEAN NOT NULL DEFAULT true,
    "printTicketsOnSale" BOOLEAN NOT NULL DEFAULT true,
    "showExpectedTillTotals" BOOLEAN NOT NULL DEFAULT true,
    "tipPromptEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tipSuggestedPercents" JSONB NOT NULL DEFAULT '[15,18,20]',
    "managerPinRequiredForDiscount" BOOLEAN NOT NULL DEFAULT true,
    "managerPinRequiredForRefund" BOOLEAN NOT NULL DEFAULT true,
    "managerPinRequiredForVoid" BOOLEAN NOT NULL DEFAULT true,
    "managerPinRequiredForWastage" BOOLEAN NOT NULL DEFAULT true,
    "offlineEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cashRequiresOpenTill" BOOLEAN NOT NULL DEFAULT true,
    "lateRedemptionGraceMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowPastDateRedemption" BOOLEAN NOT NULL DEFAULT false,
    "bannedGuestPrompt" BOOLEAN NOT NULL DEFAULT true,
    "managerOverridePinHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_devices" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL DEFAULT 'default',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "settingsOverride" JSONB,
    "printEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cashDrawerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeTerminalId" TEXT,
    "printAgentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_menus" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceTemplateKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_menus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_menu_categories" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "icon" TEXT,
    CONSTRAINT "pos_menu_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_products" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "PosProductKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "openPrice" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptDefault" BOOLEAN NOT NULL DEFAULT false,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "onHand" INTEGER,
    "suspendSales" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kitchenRoute" TEXT,
    "membershipPlanId" TEXT,
    "admissionProductId" TEXT,
    "giftCardDefaultAmount" DECIMAL(12,2),
    "denominations" JSONB,
    "allowCustomAmount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_menu_items" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "categoryId" TEXT,
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "icon" TEXT,
    CONSTRAINT "pos_menu_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_modifier_groups" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "pos_modifier_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_modifiers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stockTrack" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "pos_modifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_product_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "childProductId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "maxQty" INTEGER,
    CONSTRAINT "pos_product_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_discount_codes" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT,
    "code" TEXT NOT NULL,
    "percentOff" DECIMAL(12,2),
    "amountOff" DECIMAL(12,2),
    "minSubtotal" DECIMAL(12,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "requiresManagerPin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_discount_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_carts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "cashierUserId" TEXT NOT NULL,
    "guestProfileId" TEXT,
    "status" "PosCartStatus" NOT NULL DEFAULT 'open',
    "bookingHoldIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_cart_lines" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "PosLineKind" NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "modifiers" JSONB,
    "sessionId" TEXT,
    "admissionProductId" TEXT,
    "priceBandCode" TEXT,
    "membershipPlanId" TEXT,
    "membershipAction" TEXT,
    "giftAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_cart_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "till_sessions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "status" "TillSessionStatus" NOT NULL DEFAULT 'open',
    "openingFloat" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "countedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "editedAfterCloseAt" TIMESTAMP(3),
    "editReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "till_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sales" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tillSessionId" TEXT,
    "cashierUserId" TEXT NOT NULL,
    "guestProfileId" TEXT,
    "postalCodeCaptured" TEXT,
    "status" "PosSaleStatus" NOT NULL DEFAULT 'open',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "receiptEmail" TEXT,
    "notes" TEXT,
    "posNotes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "PosLineKind" NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "modifiers" JSONB,
    "productId" TEXT,
    "refId" TEXT,
    CONSTRAINT "pos_sale_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sale_payments" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tender" "PosTenderType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PosPaymentStatus" NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "giftCardId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sale_refunds" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tender" "PosTenderType" NOT NULL,
    "giftCardId" TEXT,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_sale_refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_sale_bookings" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    CONSTRAINT "pos_sale_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "till_movements" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "TillMovementKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "saleId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "till_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_tabs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "guestProfileId" TEXT,
    "tableLabel" TEXT,
    "status" "GuestTabStatus" NOT NULL DEFAULT 'open',
    "preauthPaymentIntentId" TEXT,
    "parentTabId" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "guest_tabs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_tab_lines" (
    "id" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guest_tab_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cashless_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "last4" TEXT,
    "guestProfileId" TEXT,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CashlessAccountStatus" NOT NULL DEFAULT 'active',
    "issuedSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cashless_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "park_wallets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ParkWalletStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "park_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "park_wallet_txns" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "ParkWalletTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "saleId" TEXT,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "park_wallet_txns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_wastage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "managerOverrideId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_wastage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_tip_allocations" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "pos_tip_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kitchen_tickets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" "KitchenTicketStatus" NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_offline_mutations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PosOfflineMutationStatus" NOT NULL DEFAULT 'queued',
    "appliedSaleId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),
    CONSTRAINT "pos_offline_mutations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_drawer_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "saleId" TEXT,
    "requestedById" TEXT NOT NULL,
    "result" "PosDrawerResult" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_drawer_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gift_card_ledger" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "GiftCardLedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "saleId" TEXT,
    "bookingId" TEXT,
    "createdById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gift_card_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_bans" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestProfileId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guest_bans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_settings_orgId_locationId_key" ON "pos_settings"("orgId", "locationId");
CREATE INDEX "pos_settings_orgId_idx" ON "pos_settings"("orgId");
CREATE UNIQUE INDEX "pos_devices_orgId_code_key" ON "pos_devices"("orgId", "code");
CREATE INDEX "pos_devices_orgId_locationId_createdAt_idx" ON "pos_devices"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_devices_orgId_archivedAt_idx" ON "pos_devices"("orgId", "archivedAt");
CREATE INDEX "pos_menus_orgId_locationId_createdAt_idx" ON "pos_menus"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_menu_categories_menuId_idx" ON "pos_menu_categories"("menuId");
CREATE INDEX "pos_menu_categories_orgId_idx" ON "pos_menu_categories"("orgId");
CREATE INDEX "pos_menu_items_menuId_idx" ON "pos_menu_items"("menuId");
CREATE INDEX "pos_menu_items_orgId_productId_idx" ON "pos_menu_items"("orgId", "productId");
CREATE INDEX "pos_products_orgId_locationId_createdAt_idx" ON "pos_products"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_products_orgId_kind_archivedAt_idx" ON "pos_products"("orgId", "kind", "archivedAt");
CREATE INDEX "pos_products_orgId_admissionProductId_idx" ON "pos_products"("orgId", "admissionProductId");
CREATE INDEX "pos_modifier_groups_productId_idx" ON "pos_modifier_groups"("productId");
CREATE INDEX "pos_modifier_groups_orgId_idx" ON "pos_modifier_groups"("orgId");
CREATE INDEX "pos_modifiers_groupId_idx" ON "pos_modifiers"("groupId");
CREATE INDEX "pos_modifiers_orgId_idx" ON "pos_modifiers"("orgId");
CREATE UNIQUE INDEX "pos_product_links_parentProductId_childProductId_key" ON "pos_product_links"("parentProductId", "childProductId");
CREATE INDEX "pos_product_links_orgId_idx" ON "pos_product_links"("orgId");
CREATE UNIQUE INDEX "pos_discount_codes_orgId_code_key" ON "pos_discount_codes"("orgId", "code");
CREATE INDEX "pos_discount_codes_orgId_locationId_idx" ON "pos_discount_codes"("orgId", "locationId");
CREATE INDEX "pos_carts_orgId_locationId_createdAt_idx" ON "pos_carts"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_carts_orgId_deviceId_status_idx" ON "pos_carts"("orgId", "deviceId", "status");
CREATE INDEX "pos_cart_lines_cartId_idx" ON "pos_cart_lines"("cartId");
CREATE INDEX "pos_cart_lines_orgId_idx" ON "pos_cart_lines"("orgId");
CREATE UNIQUE INDEX "pos_sales_publicId_key" ON "pos_sales"("publicId");
CREATE UNIQUE INDEX "pos_sales_orgId_idempotencyKey_key" ON "pos_sales"("orgId", "idempotencyKey");
CREATE INDEX "pos_sales_orgId_locationId_createdAt_idx" ON "pos_sales"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_sales_orgId_status_idx" ON "pos_sales"("orgId", "status");
CREATE INDEX "pos_sale_lines_saleId_idx" ON "pos_sale_lines"("saleId");
CREATE INDEX "pos_sale_lines_orgId_idx" ON "pos_sale_lines"("orgId");
CREATE UNIQUE INDEX "pos_sale_payments_orgId_idempotencyKey_key" ON "pos_sale_payments"("orgId", "idempotencyKey");
CREATE INDEX "pos_sale_payments_saleId_idx" ON "pos_sale_payments"("saleId");
CREATE INDEX "pos_sale_payments_orgId_stripePaymentIntentId_idx" ON "pos_sale_payments"("orgId", "stripePaymentIntentId");
CREATE UNIQUE INDEX "pos_sale_refunds_orgId_idempotencyKey_key" ON "pos_sale_refunds"("orgId", "idempotencyKey");
CREATE INDEX "pos_sale_refunds_saleId_idx" ON "pos_sale_refunds"("saleId");
CREATE UNIQUE INDEX "pos_sale_bookings_saleId_bookingId_key" ON "pos_sale_bookings"("saleId", "bookingId");
CREATE INDEX "pos_sale_bookings_orgId_bookingId_idx" ON "pos_sale_bookings"("orgId", "bookingId");
CREATE INDEX "till_sessions_orgId_locationId_createdAt_idx" ON "till_sessions"("orgId", "locationId", "createdAt");
CREATE INDEX "till_sessions_deviceId_status_idx" ON "till_sessions"("deviceId", "status");
CREATE UNIQUE INDEX "till_sessions_one_open_per_device" ON "till_sessions"("deviceId") WHERE "status" = 'open';
CREATE INDEX "till_movements_sessionId_idx" ON "till_movements"("sessionId");
CREATE INDEX "till_movements_orgId_createdAt_idx" ON "till_movements"("orgId", "createdAt");
CREATE INDEX "guest_tabs_orgId_locationId_createdAt_idx" ON "guest_tabs"("orgId", "locationId", "createdAt");
CREATE INDEX "guest_tabs_orgId_status_idx" ON "guest_tabs"("orgId", "status");
CREATE INDEX "guest_tab_lines_tabId_idx" ON "guest_tab_lines"("tabId");
CREATE UNIQUE INDEX "cashless_accounts_orgId_codeHash_key" ON "cashless_accounts"("orgId", "codeHash");
CREATE INDEX "cashless_accounts_orgId_locationId_createdAt_idx" ON "cashless_accounts"("orgId", "locationId", "createdAt");
CREATE UNIQUE INDEX "park_wallets_orgId_locationId_guestProfileId_key" ON "park_wallets"("orgId", "locationId", "guestProfileId");
CREATE INDEX "park_wallets_orgId_locationId_createdAt_idx" ON "park_wallets"("orgId", "locationId", "createdAt");
CREATE UNIQUE INDEX "park_wallet_txns_orgId_reference_key" ON "park_wallet_txns"("orgId", "reference");
CREATE INDEX "park_wallet_txns_walletId_idx" ON "park_wallet_txns"("walletId");
CREATE INDEX "pos_wastage_orgId_locationId_createdAt_idx" ON "pos_wastage"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_tip_allocations_saleId_idx" ON "pos_tip_allocations"("saleId");
CREATE INDEX "pos_tip_allocations_orgId_userId_idx" ON "pos_tip_allocations"("orgId", "userId");
CREATE INDEX "kitchen_tickets_orgId_locationId_createdAt_idx" ON "kitchen_tickets"("orgId", "locationId", "createdAt");
CREATE INDEX "kitchen_tickets_saleId_idx" ON "kitchen_tickets"("saleId");
CREATE UNIQUE INDEX "pos_offline_mutations_deviceId_clientMutationId_key" ON "pos_offline_mutations"("deviceId", "clientMutationId");
CREATE INDEX "pos_offline_mutations_orgId_locationId_createdAt_idx" ON "pos_offline_mutations"("orgId", "locationId", "createdAt");
CREATE INDEX "pos_drawer_events_orgId_deviceId_createdAt_idx" ON "pos_drawer_events"("orgId", "deviceId", "createdAt");
CREATE UNIQUE INDEX "gift_card_ledger_orgId_idempotencyKey_key" ON "gift_card_ledger"("orgId", "idempotencyKey");
CREATE INDEX "gift_card_ledger_giftCardId_createdAt_idx" ON "gift_card_ledger"("giftCardId", "createdAt");
CREATE INDEX "guest_bans_orgId_guestProfileId_createdAt_idx" ON "guest_bans"("orgId", "guestProfileId", "createdAt");

ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_menus" ADD CONSTRAINT "pos_menus_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_menus" ADD CONSTRAINT "pos_menus_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_menu_categories" ADD CONSTRAINT "pos_menu_categories_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "pos_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_admissionProductId_fkey" FOREIGN KEY ("admissionProductId") REFERENCES "admission_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_menu_items" ADD CONSTRAINT "pos_menu_items_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "pos_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_menu_items" ADD CONSTRAINT "pos_menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "pos_menu_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_menu_items" ADD CONSTRAINT "pos_menu_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "pos_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_modifier_groups" ADD CONSTRAINT "pos_modifier_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "pos_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_modifiers" ADD CONSTRAINT "pos_modifiers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "pos_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_product_links" ADD CONSTRAINT "pos_product_links_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "pos_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_product_links" ADD CONSTRAINT "pos_product_links_childProductId_fkey" FOREIGN KEY ("childProductId") REFERENCES "pos_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_discount_codes" ADD CONSTRAINT "pos_discount_codes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_discount_codes" ADD CONSTRAINT "pos_discount_codes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_carts" ADD CONSTRAINT "pos_carts_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_cart_lines" ADD CONSTRAINT "pos_cart_lines_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "pos_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "till_sessions" ADD CONSTRAINT "till_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_tillSessionId_fkey" FOREIGN KEY ("tillSessionId") REFERENCES "till_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_sale_lines" ADD CONSTRAINT "pos_sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sale_payments" ADD CONSTRAINT "pos_sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sale_payments" ADD CONSTRAINT "pos_sale_payments_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_sale_refunds" ADD CONSTRAINT "pos_sale_refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sale_bookings" ADD CONSTRAINT "pos_sale_bookings_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_sale_bookings" ADD CONSTRAINT "pos_sale_bookings_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "till_movements" ADD CONSTRAINT "till_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "till_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guest_tabs" ADD CONSTRAINT "guest_tabs_parentTabId_fkey" FOREIGN KEY ("parentTabId") REFERENCES "guest_tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "guest_tab_lines" ADD CONSTRAINT "guest_tab_lines_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "guest_tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashless_accounts" ADD CONSTRAINT "cashless_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashless_accounts" ADD CONSTRAINT "cashless_accounts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashless_accounts" ADD CONSTRAINT "cashless_accounts_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "park_wallets" ADD CONSTRAINT "park_wallets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "park_wallets" ADD CONSTRAINT "park_wallets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "park_wallets" ADD CONSTRAINT "park_wallets_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "park_wallet_txns" ADD CONSTRAINT "park_wallet_txns_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "park_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_wastage" ADD CONSTRAINT "pos_wastage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_wastage" ADD CONSTRAINT "pos_wastage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_wastage" ADD CONSTRAINT "pos_wastage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "pos_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_tip_allocations" ADD CONSTRAINT "pos_tip_allocations_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_offline_mutations" ADD CONSTRAINT "pos_offline_mutations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_offline_mutations" ADD CONSTRAINT "pos_offline_mutations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_offline_mutations" ADD CONSTRAINT "pos_offline_mutations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_drawer_events" ADD CONSTRAINT "pos_drawer_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_card_ledger" ADD CONSTRAINT "gift_card_ledger_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "gift_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_card_ledger" ADD CONSTRAINT "gift_card_ledger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_bans" ADD CONSTRAINT "guest_bans_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_bans" ADD CONSTRAINT "guest_bans_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "guest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "venue_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_issuedToGuestId_fkey" FOREIGN KEY ("issuedToGuestId") REFERENCES "guest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_issuedSaleId_fkey" FOREIGN KEY ("issuedSaleId") REFERENCES "pos_sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
