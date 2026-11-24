# POS (Point of Sale) — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 02 — POS (Point of Sale) — staff-facing on-site sell + check-in station  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 02 (+ POS-station slices of Check-In, Cash/Till, Gift Cards, F&B, Refund/Manager Controls).  
**Control plane:** `.cursor/rules/saas-venue-platform.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`.

---

## How to use this file

1. Paste **PHASE 1 — EXECUTION PROMPT** into Cursor and say or include `START PHASE 1`.
2. When Cursor finishes Phase 1, paste **PHASE 1 — FOLLOW-UP AUDIT PROMPT**.
3. Only after the audit passes, paste **PHASE 2 — EXECUTION PROMPT**, and so on through Phase 5.
4. Every later phase must verify the previous phase first, fix gaps, then continue.
5. Do not ask the user for a feature list — everything required is already inside these prompts.

**Rules that apply to every phase**

- Read and obey: `.cursor/rules/saas-venue-platform.mdc`, `.cursor/rules/customer-vs-tailor-sections.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`, `src/lib/subscriptionPlans.ts`, `README.md` module entitlement contract.
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as POS catalog, cart, sale, gift card, cashless, or park wallet.
- Do **NOT** reuse staff `Membership` (org seat) as guest park membership. Guest memberships are `GuestMembership` + `MembershipPlan`.
- **Feature 08 Memberships owns guest billing** (`billingEngine` / `entitlementEngine`). POS must call shared engines via `/api/pos/memberships*` adapters — do not invent a second membership commerce ledger.
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. POS may create `GuestProfile` rows (and optional User only via existing ops/invite patterns — never public client self-reg).
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never runs park POS. Demo plan locks POS. Unpaid / pending / suspended orgs fail closed.
- POS module entitlement: `assertModuleEnabled(orgId, "pos")` — **Growth + Enterprise only** (`moduleHints` includes `"pos"` or `"all"`). Starter has ticketing hint only — **no POS**.
- Staff POS lives under `/admin/pos*` and `/api/pos/*`. Customer `/profile` never gets operator POS. Tailor `/tailor/*` gets no POS.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Terminal may use a focused full-height layout (hide bulky catalog nav) but keep brand tokens.
- One connected system: POS sales that book admissions **must** go through the shared booking engine (`src/lib/ticketing/bookingEngine.ts`) with `channel=pos`. If that engine/schema is missing, **create the shared park-booking substrate** in Phase 1 (same model names as `docs/online-booking-ticketing-complete-spec.md`) and POS-channel APIs — do **not** build public `/book/*` checkout (Feature 01).
- Do **not** fake-complete: Intercard/Sacoa/Amusement Connect, Kitchen Display UI, self-service kiosk, OTA, dynamic pricing engine, BOGO promo engine, cash recyclers, public online booking wizard, full Digital Waivers signing/guardian UI, Feature 08 membership self-service/failed-payment portal.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring:

- Control plane **is** shipped: Organization, VenueLocation, Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile receipts, Stripe (`src/lib/stripe.ts`), mailer/`sendReceipts.ts`/`sendInvoice.ts`, activityLog, companyExport, smoke script pattern.
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet (guest shop stored-value).
- Online Booking / Ticketing is **specified** in `docs/online-booking-ticketing-complete-spec.md` but **not present** in `prisma/schema.prisma` (no Booking / AdmissionProduct / TicketCredential). No `src/lib/ticketing/**`, no `/api/pos/**`.
- `FuturePlanModules.posTerminals` exists as a documented hook — **not** in `PlanLimits` / `planLimits.ts` yet. Move it into enforceable limits when POS ships.
- `UserBlacklist` is storefront/ops user blocklist — **not** park banned-guest. POS needs `GuestBan` (org+location guest CRM).

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of POS (Point of Sale).
SSOT: docs/pos-complete-spec.md
Execute ONLY Phase 1. Do not implement POS terminal checkout, Stripe Terminal capture, till open/close cash count, offline sync, or check-in scan UI yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for park members).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park POS. Never locked by tenant expiry.

POS is Feature 02. Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "pos").
- Every park business row: orgId required + locationId required (FK VenueLocation; assert venue.orgId === orgId) except true org-default settings (locationId null = org default).
- Company admin lives under /admin/*. Guest /profile: no POS. Tailor studio: no POS.

Shop commerce (Product, Cart, Order with cartId + walletId + shipping) is fashion retail. Do NOT store F&B SKUs, gift cards, till sessions, or POS sales there.

Front desk IA (capability underneath, progressive disclosure):
CHECK IN | SELL | PARTY | MEMBERSHIP | WAIVER (search/assign) | FOOD | REFUND
This epic ships the staff POS terminal for those actions (Phase 3 UI). Phase 1 = foundation + catalogs + settings + route shells.

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, stripe.ts, mailer.ts / sendReceipts.ts / sendInvoice.ts, TaxSettings, CompanyProfile, activityLog.ts, Notification + notificationService, companyExport.ts, smoke scripts, rateLimit.ts, bcrypt for manager PIN hashes.

Do NOT reuse as POS store: Product, Cart, CartLine, Order (shop), Wallet, TailoringJob.

Ticketing dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/ticketing/.
2. IF Booking / AdmissionProduct / TicketSession / TicketCredential / BookingHold / BookingPayment already exist AND bookingEngine.ts exists: REUSE them. Add POS-channel wrappers only. Do not duplicate catalogs.
3. IF they do NOT exist: CREATE the shared park-booking models and a POS-usable bookingEngine (hold / confirm / cancel / capacity remaining / POS notes) using the model names and enums from docs/online-booking-ticketing-complete-spec.md Phase 1 schema. Staff POS-channel create APIs may live under /api/pos/bookings. Do NOT build public /book/* wizard, guest Stripe checkout pages, or claim Feature 01 complete.
4. Either way, POS Phase 1 must be able to list sellable admission + party_package products for a venue (published, not archived) and preview session availability via staff API.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: enable POS for a venue, register POS devices against the posTerminals cap, configure POS menus/device templates/global+per-device settings (including guest zip capture), manage POS retail/F&B/open-price/package/gift/membership/cashless/wallet SKUs with modifiers, configure manager PIN policy, see POS admin nav/route shells, and fail closed on Demo/Starter/storefront/unpaid. Public purchase of park POS goods must still fail. No sale capture, no till cash count, no check-in scan in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden (park POS is registered-company only)
  5) plan.moduleHints includes the module OR "all"
- assertPosEnabled(orgId) thin wrapper. Staff POS APIs fail if not entitled.
- Starter (ticketing hint only) MUST 403 POS. Growth + Enterprise allow POS.

C2. Plan meter posTerminals
- Move posTerminals into PlanLimits in src/lib/subscriptionPlans.ts and enforce in planLimits.ts PlanResource.
- Caps: demo=0, starter=0, growth=5, enterprise=null (unlimited).
- Count active (not archived) PosDevice rows per org. Enforce on DEVICE CREATE.
- Update FuturePlanModules comments so posTerminals is no longer “future only”.
- Keep ticketsPerMonth as specified by ticketing spec IF you create booking confirm in later phases; if booking engine is created here, add ticketsPerMonth to PlanLimits too (demo=0, starter=2000, growth=10000, enterprise=null) so confirm can meter in Phase 2.

C3. Complete Prisma schema + migration (create ALL POS tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped: locationId required, FK VenueLocation, unless noted.
Extend ActivityEntityType with: PosSale, PosDevice, TillSession, GiftCard, GuestProfile, GuestMembership, GuestTab, TicketCredential (if not present), Booking (if not present).
Extend NotificationType with: pos (and booking if creating booking engine).

Enums (exact names — do not invent parallels):

PosProductKind: admission_proxy | food | beverage | merchandise | open_price | package | party_package_proxy | add_on | gift_card | membership_plan | cashless_card | park_wallet | gratuity | other
PosSaleStatus: open | parked | held_booking | unpaid | completed | voided | refunded | partially_refunded
PosLineKind: sku | open_price | modifier | package_component | booking | gift_card_issue | gift_card_redeem | membership | cashless | wallet | discount | tip | round | other
PosTenderType: card | cash | split_component | gift_card | park_wallet | cashless | stored_card | payment_link | other
PosPaymentStatus: pending | authorized | completed | failed | cancelled | refunded | partial_refund
TillSessionStatus: open | counting | closed | closed_no_count | void
TillMovementKind: open_float | cash_in | cash_out | sale_cash | refund_cash | tip | drop | pickup | other
GiftCardStatus: active | pending | disabled | expired | void
GiftCardKind: digital | physical
GuestMembershipStatus: active | past_due | paused | cancelled | expired | pending
MembershipPlanBilling: recurring | fixed
CashlessAccountStatus: active | disabled | void
ParkWalletStatus: active | disabled | void
GuestTabStatus: open | authorized | settled | voided | split_child
PosOfflineMutationStatus: queued | syncing | applied | conflict | failed | discarded
RedemptionStatus: unused | redeemed | void | expired
WaiverRecordStatus: missing | signed | expired | declined  (stub records only — no signing UI)
KitchenTicketStatus: queued | sent | accepted | fulfilled | void  (emit records; no KDS screen)

IF ticketing models are missing, ALSO create ticketing enums/models from docs/online-booking-ticketing-complete-spec.md Phase 1 section C3 (AdmissionProductType, BookingStatus, BookingChannel including pos, TicketCredentialStatus, etc.) so POS can sell admissions without a parallel booking schema.

Models you MUST create (POS-native). Keep field lists complete enough to implement; add indexes on orgId+locationId+createdAt and unique public identifiers.

PosSettings (per location; locationId null = org default; unique orgId+locationId):
id, orgId, locationId?, captureGuestPostcode (bool default false), postcodeRequired (bool default false), requireGuestOnSale (bool default false), allowOpenPrice (bool default true), allowParkedCarts (bool default true), allowUnpaidBookings (bool default true), defaultReceiptEmail (bool), printTicketsOnSale (bool), showExpectedTillTotals (bool default true), tipPromptEnabled (bool default true), tipSuggestedPercents Json (e.g. [15,18,20]), managerPinRequiredForDiscount (bool default true), managerPinRequiredForRefund (bool default true), managerPinRequiredForVoid (bool default true), managerPinRequiredForWastage (bool default true), offlineEnabled (bool default true), lateRedemptionGraceMinutes Int default 0, allowPastDateRedemption (bool default false), bannedGuestPrompt (bool default true), createdAt, updatedAt.

PosDevice:
id, orgId, locationId, name, code (unique per org), templateKey, registeredAt, lastSeenAt, archivedAt?, settingsOverride Json?, printEnabled, cashDrawerEnabled, stripeTerminalId?, createdAt, updatedAt.
Active device count = posTerminals meter.

PosMenu / PosMenuItem / PosMenuCategory:
orgId, locationId, name, deviceTemplateKey?, sortOrder, productId (PosProduct), hidden, color/icon optional. Menus assignable to devices.

PosProduct:
orgId, locationId, kind, name, description, sku?, openPrice (bool), taxExemptDefault, trackInventory (bool), onHand Int?, suspendSales (bool default false), archivedAt, images[], kitchenRoute? (string station name — for ticket emit, not KDS UI), membershipPlanId?, giftCardDefaultAmount?, createdAt, updatedAt.

PosModifierGroup / PosModifier:
orgId, locationId, productId, name, required, minSelect, maxSelect, priceDelta, stockTrack optional.

PosProductLink (packages / add-ons):
parentProductId, childProductId, required, maxQty.

MembershipPlan:
orgId, locationId?, name, billing recurring|fixed, interval months?, price, currency, entitlements Json (entries per period, discountPercent, guestCount), upgrade/downgrade group key, archivedAt.
NOT staff Membership.

GiftCardProduct config may live on PosProduct kind=gift_card (denominations Json, allowCustomAmount, physical vs digital).

GuestProfile (park CRM hub for POS):
id, orgId, locationId?, userId? (optional link to User — do not auto-create shop User), firstName, lastName, email?, phone?, dateOfBirth?, photoUrl?, postalCode?, bannedAt?, bannedReason?, notes, createdAt, updatedAt, createdById.
Indexes: orgId+email, orgId+phone, orgId+name search.

GuestBan:
orgId, guestProfileId, reason, createdById, createdAt, active bool. Banned guest approval prompt at POS.

GuestMembership:
orgId, locationId, guestProfileId, planId, status, startsAt, endsAt?, stripeSubscriptionId?, customMembershipId unique per org, photoUrl?, createdFromSaleId?.

GiftCard:
orgId, locationId?, codeHash (never store raw PAN/code in plaintext — store last4 + hmac), last4, kind digital|physical, status, balance, currency, issuedToGuestId?, issuedSaleId?, expiresAt?.

GiftCardLedger:
giftCardId, orgId, type issue|redeem|refund|adjust|void, amount, saleId?, createdById, createdAt. Idempotency key unique.

CashlessAccount:
orgId, locationId, codeHash/last4, guestProfileId?, balance, status, issuedSaleId?. Internal stored-value ONLY — no Intercard/Sacoa API.

ParkWallet:
orgId, locationId, guestProfileId, balance, status. Distinct from shop Wallet.

ParkWalletTxn:
walletId, orgId, type issue|topup|redeem|refund|adjust, amount, saleId?, reference unique.

PosCart / PosCartLine:
staff session cart; orgId, locationId, deviceId, cashierUserId, guestProfileId?, status open|parked, bookingHoldIds[], expiresAt?, lines with kind, product snapshot, qty, unitPrice, modifiers Json, sessionId?, booking fields.

PosSale / PosSaleLine / PosSalePayment / PosSaleRefund:
immutable-enough completed documents; publicId unique; orgId, locationId, deviceId, tillSessionId?, cashierUserId, guestProfileId?, postalCodeCaptured?, status, subtotal, discountTotal, taxAmount, tipAmount, total, amountPaid, amountDue, parkedFromCartId?, bookingIds[], receiptEmail?, notes, posNotes (staff).
Payments: tender, amount, status, stripePaymentIntentId?, giftCardId?, idempotencyKey unique.

TillSession / TillMovement:
orgId, locationId, deviceId, openedById, closedById?, status, openingFloat, expectedCash, countedCash?, variance, notes, closedAt, reconciledAt?, editedAfterCloseAt?, editReason?.
Phase 1: tables exist; open/close APIs in Phase 4. Optional read-only list shell OK.

GuestTab / GuestTabLine:
orgId, locationId, guestProfileId?, tableLabel?, status, preauthPaymentIntentId?, parentTabId? (split), saleId? when settled.
Phase 1: tables only.

PosWastage:
orgId, locationId, productId, qty, reason, recordedById, managerOverrideId?, createdAt.

ManagerPin:
per staff Membership: pinHash, pinSetAt, failedAttempts, lockedUntil?. Never store PIN plaintext. Verify via bcrypt. Optional org-level override PIN on PosSettings (hash).

WaiverRecord (minimal stub for POS search/assign — NOT signing UI):
orgId, locationId, guestProfileId, status, signedAt?, expiresAt?, externalRef?. Searchable at POS.

KitchenTicket:
orgId, locationId, saleId, station, items Json, status. Emitted on F&B sale in Phase 2/3; no KDS page.

PosOfflineMutation:
orgId, locationId, deviceId, clientMutationId unique, payload Json, status, appliedSaleId?, error?, createdAt, syncedAt?.

TicketCredential / Booking* : as ticketing spec if creating shared substrate.
Include customTicketId, customMembershipId uniqueness per org.

C4. Permissions + presets
Add to P and PERMISSION_CATALOG + API_PERMISSIONS + ADMIN_ROUTE_PERMISSIONS:
- pos:sell — operate terminal, create carts/sales
- pos:read — view sales, receipts, capacity, search guests
- pos:refund — refund from POS (manager PIN still required by settings)
- pos:void — void open sale
- pos:discount — apply discount codes / discretionary discount
- pos:cash — cash tender + cash drawer kick
- pos:till_open, pos:till_close, pos:till_no_count, pos:till_edit
- pos:wastage
- pos:admin — menus, devices, settings, suspend stock
- pos:manager_override — verify manager PIN / approve banned guest / past redemption
- pos:checkin — redeem tickets/memberships
- pos:tabs — guest tabs
- pos:guests_write — create/edit GuestProfile at POS
If creating booking APIs: bookings:read, bookings:write, bookings:overbook, bookings:refund (match ticketing spec names if that file’s permissions already defined — do not create a second bookings permission vocabulary).

Map presets:
- platform_admin: all
- ops_manager: POS operate + till + refund + admin
- finance: pos:read + refund + till_edit + till_close
- catalog_editor: no POS sell (unless custom)
- Add optional role-template labels in catalog copy: Front desk ≈ sell+checkin+guests; F&B ≈ sell+wastage. Do NOT rename existing MembershipRolePreset enum values in a breaking way; new presets (front_desk, fb, manager) MAY be added if you update every preset switch. Prefer mapping via RoleTemplate + permission bits if adding enum values is too invasive — but then ship at least one documented “POS cashier” role template seed path. Document the choice in permissions.ts header inventory.

C5. Nav + routes (shells)
- Admin nav Operations (or new Sell group): POS terminal `/admin/pos`, POS check-in `/admin/pos/check-in`, POS admin `/admin/pos/admin` (menus, devices, settings), Tills `/admin/pos/tills`, Sales history `/admin/pos/sales`.
- Register every path in ADMIN_ROUTE_PERMISSIONS. Unknown /admin/* still fail closed.
- Demo lock: none of these are demo-allowed paths.
- Pages may be “configure catalog / settings” quality in Phase 1; terminal sell grid can be a non-functional layout shell that says sales engine ships Phase 2 — OR list products read-only. Do not capture payments.

C6. Admin APIs (Phase 1)
All: requirePermissionFresh + requireActorOrgId + assertPosEnabled + venue belongs to org. Never client orgId.
- GET/PUT /api/admin/pos/settings?locationId=
- GET/POST /api/admin/pos/devices  POST enforces posTerminals
- GET/PATCH/DELETE /api/admin/pos/devices/[id]
- GET/POST /api/admin/pos/menus + items
- GET/POST/PATCH /api/admin/pos/products (+ modifiers, package links)
- POST /api/admin/pos/products/[id]/suspend  (suspend stock/sales)
- GET/POST /api/admin/pos/membership-plans
- POST /api/admin/pos/manager-pin  (self set PIN) + POST /api/pos/manager-pin/verify (exists, used later)
- GET/POST /api/admin/pos/guests  (create guest records)
- GET /api/pos/catalog?locationId=&deviceId=  (menu-resolved sellable SKUs + admission products)
- GET /api/pos/availability  (sessions/resources — booking engine or 501 only if you have ZERO admission products; prefer real availability)
- GET /api/pos/waivers/search?q=  (returns empty list if none — must not 404)
Staff catalog for admissions: if ticketing admin APIs already exist, reuse GET /api/admin/ticketing/products. If not, add minimal GET/POST /api/admin/ticketing/products + sessions + resources sufficient for POS to sell timed/day/group/party/add-on (full ticketing admin UI is Feature 01 — minimal staff catalog is required so POS has something to sell).

C7. Manager PIN storage
- Hash with bcrypt. Verify constant-time compare via bcrypt.compare.
- Do not log PIN. Rate-limit verify (src/lib/rateLimit.ts).
- Settings flags exist; enforcement on discount/refund/void happens Phase 2–4.

C8. Zip/postcode configuration
- PosSettings.captureGuestPostcode / postcodeRequired.
- GuestProfile.postalCode and PosSale.postalCodeCaptured fields exist.
- Enforcement on checkout is Phase 3; config UI is Phase 1.

C9. Export + HQ honesty
- companyExport.ts includes counts (not secrets) for PosDevice, PosProduct, GuestProfile, TillSession when tables exist. Omit PIN hashes, gift card code hashes, Stripe ids if you consider them secrets — include last4 only.
- Do not claim POS complete in README/landing. Landing #pos may stay a marketing anchor.

C10. Tests Phase 1
scripts/smoke-pos-phase1.mts + package.json smoke:pos:p1
Must assert:
- Storefront staff 403 POS
- Demo company 403 POS
- Starter entitled 403 POS (moduleHints)
- Growth/Enterprise entitled 200 list settings/devices
- Cross-tenant device/product 403
- Device create over cap 403
- Fashion Product table unchanged by POS product create
- /signup still 410/redirect
- Manager PIN hashed not returned on GET

================================================================================
D. TECHNICAL IMPLEMENTATION NOTES
================================================================================

- Next.js app router under src/app/(admin)/admin/pos/** and src/app/api/pos/**, src/app/api/admin/pos/**.
- Prisma migrate (yarn db:migrate) — do not only db push in docs; follow repo convention.
- Idempotency keys on all future sale/payment writes (column exists now).
- Tax: reuse org TaxSettings for POS line tax unless taxExemptDefault. Do not create a second tax engine.
- Currency: follow venue/org; default USD like plans unless Tax/CompanyProfile implies otherwise. Store ISO currency on sale.
- Search guests: ILIKE/contains on name/email/phone; keep queries indexed.

================================================================================
E. COMPLETION GATE PHASE 1
================================================================================

Entitled Growth/Enterprise can configure POS settings, devices (capped), menus, POS products+modifiers, membership plans, guests, manager PIN. Shared booking substrate exists OR is reused. Demo/Starter/storefront/cross-tenant denied. Shop still works. No payment capture. Smokes green. Then STOP for Phase 1 audit.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of POS Phase 1.
SSOT: docs/pos-complete-spec.md Phase 1.

Independently verify (do not trust the implementation summary):

1. assertModuleEnabled("pos") + assertPosEnabled on every POS admin/API. Starter 403. Growth/Enterprise 200. Demo 403. Storefront 403. Pending/suspended/unpaid fail closed.
2. posTerminals in PlanLimits and planLimits.ts; device create meters active devices; over-cap 403.
3. ALL Phase 1 models/enums exist with orgId (+ locationId when park-scoped). No fashion Product/Cart/Order/Wallet reuse. No staff Membership reuse for guest members.
4. Ticketing: either reused booking models/engine OR created shared substrate (not a second parallel booking schema). Public /book/* still not a fake-complete Feature 01.
5. Permissions in P, PERMISSION_CATALOG, API_PERMISSIONS, ADMIN_ROUTE_PERMISSIONS, nav, Demo lock.
6. Settings, devices, menus, products, modifiers, suspend, membership plans, guests, manager PIN, catalog GET, waiver search stub, zip config UI.
7. Export omits PIN hashes and raw gift codes.
8. Cross-tenant deny. No client orgId trust.
9. smoke:pos:p1 green. Shop checkout still works. /signup still closed.

If ANY item is missing, partial, incorrect, disconnected, duplicate, or insecure: FIX IT. Re-test the affected workflow. Re-check tenancy and shop regression.

Phase 1 is complete only when every C1–C10 item is true.
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of POS (Point of Sale).
SSOT: docs/pos-complete-spec.md
VERIFY PHASE 1 FIRST. If Phase 1 is missing, partial, or broken: FIX, test, then continue. Do not assume Phase 1 is correct.

Execute ONLY Phase 2. Do not polish the full terminal UI, offline IndexedDB client, till cash-count close, or hardware drawer kick yet. APIs + engine must be complete for sell.

================================================================================
A. PHASE 2 OBJECTIVE
================================================================================

A staff cashier (API-complete) can build a POS cart and check out one transaction that may mix: admissions (incl. multiple sessions), F&B/merchandise with modifiers, open price, packages/party packages/add-ons, gift cards (issue/redeem/balance), memberships (sell/upgrade/downgrade/renew, recurring + fixed), cashless (sell/top-up/balance), park wallets (issue/redeem/top-up), discounts (manager PIN when required), split tenders, unpaid/hold bookings, guest attach/create, tips as line items. Payments persist on PosSale (not shop Order). Kitchen tickets EMIT for F&B. Booking engine used for park bookings (hold cart). Idempotent payments.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

B1. Previous-phase verification
Re-run smoke:pos:p1. Fix failures. Confirm schema/permissions/entitlement.

B2. POS sale engine
src/lib/pos/saleEngine.ts — single engine for:
- open cart, add/update/remove lines, park cart (hold booking capacity via bookingEngine holds), resume parked cart, abandon (release holds)
- quote totals (tax via TaxSettings, discounts, tips)
- checkout: convert cart → PosSale in a transaction: inventory decrement, gift/wallet/cashless ledger, membership writes, booking confirm/hold/unpaid, payments, kitchen tickets, credentials
- void open sale (permission + PIN if settings)
- refund (permission + PIN if settings; original tender and/or gift card ledger)
- adjust booking items via booking engine (API used by Phase 3 UI)
Idempotency: client Idempotency-Key / body.idempotencyKey unique per org.

B3. Sell all product types (engine + APIs)
- Admission_proxy / party_package_proxy: must call bookingEngine with channel=pos. Support book multiple sessions in one cart/transaction. Capacity remaining transactional. Overbook only with bookings:overbook + manager override.
- Open price: cashier amount required; reject <=0 unless permissioned.
- Stock/merchandise + modifiers: validate modifier groups; decrement onHand when trackInventory; reject if suspendSales.
- Packages / add-ons: explode package components; party add-ons respect stock periods if ticketing StockPeriod exists.
- Gift cards: issue (digital code returned once; physical mark issued), redeem (PIN/code), balance inquiry. Ledger every movement. Cannot redeem more than balance. Refund-to-gift-card supported.
- Memberships: sell new, upgrade, downgrade, renew via thin `/api/pos/memberships*` + `posAdapter` → shared `billingEngine` / `entitlementEngine` (Feature 08 owns guest billing — do not invent a second membership commerce ledger). Recurring: create Stripe subscription IF STRIPE_SECRET_KEY present; otherwise record pending + amount collected at POS (honest: do not fake invoice recurrence). Fixed: endsAt from plan. Write GuestMembership + customMembershipId through the shared engine only.
- Cashless: sell card, top-up, balance. Internal ledger only.
- Park wallets: issue, redeem, top-up. Distinct from shop Wallet.

B4. Discount codes
Minimal POS promo engine (not full Feature 11 BOGO):
- PosDiscountCode: orgId, locationId?, code unique per org, percentOff or amountOff, minSubtotal, startsAt, endsAt, maxRedemptions, archivedAt, requiresManagerPin.
- Apply on cart; persist on sale lines.
- If settings.managerPinRequiredForDiscount or code.requiresManagerPin: require verified manager PIN in the same request (header X-Manager-Pin or body.managerPin — hashed server-side, never stored on sale).

B5. Payments
POST /api/pos/sales/[id]/payments
Tenders: cash (requires pos:cash), card, split_component, gift_card, park_wallet, cashless, stored_card, payment_link.
- Split payments: multiple tenders until amountDue=0; sale remains unpaid if due>0 (unpaid booking allowed if settings.allowUnpaidBookings and lines are bookings).
- Card: Stripe PaymentIntent (metadata type=pos_sale, posSaleId, orgId, locationId). Do NOT use shop createCheckoutSession orderId path. Webhook in Phase 4 can confirm; Phase 2 must complete when PaymentIntent succeeded (confirm endpoint).
- Stored card: charge Stripe customer on GuestProfile if stripeCustomerId present; permission pos:refund is NOT the right bit — use a pos:sell + existing payments pattern; add pos:charge_stored if needed.
- Payment link: create Stripe Checkout or Payment Link; POST /api/pos/sales/[id]/payment-link { sendVia email/sms skip SMS if no provider }. Sale unpaid until paid.
- Cash: record tender; drawer kick is Phase 4 (emit PosDrawerEvent row now).
- Apple Pay / Google Pay: enable via Stripe PaymentIntent automatic_payment_methods if possible; do not fake native wallet SDKs if Stripe handles it. Document if not configured.
Never write shop Order rows for POS.

B6. Booking channel from POS
- POST /api/pos/bookings (channel pos) or saleEngine booking lines.
- Hold cart: park cart creates/extends BookingHold; TTL from BookingSettings.holdTtlMinutes if present else 15.
- Unpaid bookings: status pending_payment / amountDue; credentials unused until paid policy: unpaid admission MUST NOT redeem in Phase 3 (enforce flag paidRequiredForRedeem default true).
- Reschedule/adjust APIs exist (used Phase 3): POST /api/pos/bookings/[id]/reschedule, POST /api/pos/bookings/[id]/adjust-items. Past-lock from BookingSettings if present.

B7. Guests
- Attach GuestProfile to cart/sale.
- Create guest at POS POST /api/pos/guests (pos:guests_write).
- Banned guest: if GuestBan active, checkout requires pos:manager_override + PIN and writes activity.

B8. Recurring & fixed memberships
Covered in B3. Upgrade/downgrade proration: simple remaining-value credit as discount line (document formula). Do not build Feature 08 pause/self-service portal.

B9. Wastage API
POST /api/pos/wastage { productId, qty, reason, managerPin? } — inventory decrement without sale. PIN if settings.

B10. Kitchen tickets
On completed sale with F&B lines: create KitchenTicket queued/sent. No KDS UI.

B11. Receipts data
Sale must have enough data for email/reprint in Phase 3 (lines, tenders, QR payload = publicId or credential ids).

B12. Routes
POST /api/pos/carts
GET/PATCH /api/pos/carts/[id]
POST /api/pos/carts/[id]/park
POST /api/pos/carts/[id]/checkout
GET /api/pos/sales / GET /api/pos/sales/[id]
POST /api/pos/sales/[id]/void
POST /api/pos/sales/[id]/refunds
POST /api/pos/sales/[id]/payments
POST /api/pos/sales/[id]/payment-link
GET /api/pos/gift-cards/balance
POST /api/pos/gift-cards/redeem
GET /api/pos/cashless/balance
GET /api/pos/wallets/balance
POST /api/pos/discounts/preview
GET /api/pos/memberships/lookup

B13. Activity
Log sale complete/void/refund/discount override/banned guest override on ActivityLog.

B14. Tests Phase 2
scripts/smoke-pos-phase2.mts + smoke:pos:p2
- Mixed cart: merch + open price + gift issue + cash tender → completed sale, inventory down, gift ledger issue
- Admission hold then checkout confirm decrements session remaining (no oversell on double checkout)
- Multi-session one sale
- Split cash+card
- Gift redeem + insufficient balance 400
- Discount without PIN 403 when required; with PIN 200
- Cross-tenant cart 403
- Shop Order count unchanged
- Unpaid booking sale amountDue>0 status unpaid
- Membership sell writes GuestMembership
- Suspended product cannot add to cart
- Wastage decrements onHand
- Starter still 403

================================================================================
C. COMPLETION GATE PHASE 2
================================================================================

Engine+APIs can sell every listed product type, split pay, hold/unpaid bookings, stored value, memberships, discounts+PIN, guest attach, wastage, kitchen ticket rows. No requirement for polished terminal chrome. Smokes p1+p2 green. Then STOP for Phase 2 audit.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of POS Phase 2.
SSOT: docs/pos-complete-spec.md Phase 2. VERIFY Phase 1 still holds.

Trace: entitled cashier → cart → mixed lines → quote → PIN discount → split pay → sale complete → ledgers/inventory/booking/membership/gift consistent.

Check: missing/partial/incorrect engine paths; shop Order leakage; fashion Wallet leakage; staff Membership used as guest member; oversell; idempotency; PIN logged; gift code plaintext at rest; cross-tenant; Demo/Starter; unpaid redeemable credentials (must NOT be redeemable if paidRequiredForRedeem).

If anything is wrong: FIX IT. Re-test. Re-check shop + tenancy.

Phase 2 complete only when every B2–B14 item is true and smoke:pos:p1 + p2 pass.
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of POS (Point of Sale).
SSOT: docs/pos-complete-spec.md
VERIFY PHASE 2 FIRST (and Phase 1). Fix gaps before new UI work.

Execute ONLY Phase 3: complete staff terminal workflows + check-in + tabs + receipts + offline client + booking ops UI. Till cash-count close and drawer hardware integration are Phase 4 (terminal may show till status read-only if session exists).

================================================================================
A. PHASE 3 OBJECTIVE
================================================================================

A cashier can run the POS terminal in the browser like a real front desk: search/add SKUs from custom menu, attach/create guest (zip if configured), sell mixed carts, checkout with split tenders, email/reprint receipts with QR, send payment links, refund/reschedule/adjust bookings, redeem tickets/memberships (camera barcode/QR; NFC stub), waiver search/assign, member photo verification, custom IDs, membership card print, banned-guest prompt, late/past-date redemption rules, live capacity view, guest tabs (split + preauth marked beta), offline queue UI when offlineEnabled.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 3 (DO NOT SKIP ANY)
================================================================================

B1. Verify Phase 2 smokes. Fix engine bugs first.

B2. POS terminal UI `/admin/pos`
Focused layout: location + device selector (device must belong to org; persist localStorage deviceId).
Tabs/sections: SELL | CHECK IN | TABS | CAPACITY | GUEST
Sell grid from PosMenu for this device template; search SKUs; open price dialog; modifiers; packages; gift issue/redeem; membership sell/upgrade/downgrade/renew; cashless/wallet; add booking products with session picker (availability); multi-session; park/hold cart; unpaid; discount code; tip prompt (suggested percents); split pay pad (cash/card/gift/wallet); manager PIN modal; guest search/create; postcode field if settings.captureGuestPostcode (required if postcodeRequired).
Empty, error, loading, entitlement locked states.

B3. Check-in & redemption `/admin/pos/check-in` (also embed in terminal)
- Ticket redemption: scan QR/barcode (BarcodeDetector or video + jsQR or equivalent; keyboard wedge input). NFC: if Web NFC available use it; else show “NFC not supported — use camera/keyboard” (honest, not fake).
- Membership redemption individual/group (qty / family entitlements Json).
- Waiver assignment at redemption: search WaiverRecord, bulk assign selected guests; if missing, warn/block per product.waiverRequired if that field exists.
- Member photo verification: show GuestMembership.photoUrl / GuestProfile.photoUrl; staff confirm.
- Custom ticket IDs & membership IDs: lookup + display; staff with permission can assign (reuse ticketing ticket-ids API or POST /api/pos/credentials/custom-ids).
- Membership card printing: print CSS / window.print card with name, custom id, QR.
- Banned guest approval prompts (manager PIN).
- Late/past-date redemption: PosSettings.lateRedemptionGraceMinutes + allowPastDateRedemption; else 403 without manager override.
- Search waivers at POS (already API; wire UI).

B4. POS capacity view
Live schedule for location: sessions/resources remaining, closed flags. Reschedule from this view into booking reschedule API. Do not oversell.

B5. Tabs & tables
- Open guest tab, add items, settle to sale (payment flow).
- Split tabs for group orders: feature flag PosSettings or query beta=1; mark UI “Beta”. Split creates child tabs; settle independently.
- Card pre-authorization for tabs: Stripe PaymentIntent amount capture later; UI “Beta”. If Stripe cannot auth, fail honestly (no fake auth).

B6. Receipts
- Email receipt via sendReceipts.ts brand (CompanyProfile). Include QR of sale publicId and ticket credential codes.
- Reprint receipt/tickets (permission pos:read / pos:sell).
- QR on receipts (svg or image).
- Send payment link from POS UI (Phase 2 API).

B7. Refund / reschedule / adjust from POS
Wire Phase 2 APIs with PIN gates. Confirm capacity restore on unused refund/cancel.

B8. Offline mode
When PosSettings.offlineEnabled:
- Service worker or client queue writing PosOfflineMutation via POST /api/pos/offline/sync when back online.
- Offline: allow CASH + already-priced merch/F&B/open-price only. Do NOT oversell admissions/capacity offline (queue as conflict if session remaining insufficient on sync).
- clientMutationId uuid. Server applies idempotently.
- UI banner online/offline/sync errors/conflicts (cashier must resolve: retry/discard).

B9. Upsell prompts (lightweight)
After adding admission, suggest add-ons linked on product (socks/food) — not a separate ML engine.

B10. Tests Phase 3
scripts/smoke-pos-phase3.mts + smoke:pos:p3
API-level: redeem unused paid credential → redeemed; double redeem 400; unpaid cannot redeem; past-date blocked; waiver missing warn; tab open/add/settle; offline sync idempotent; payment-link creates unpaid sale.
UI: Playwright optional; if no e2e harness, document manual terminal checklist in docs/pos-complete-spec.md residual and still API-smoke the routes the UI calls.
If browser tools exist during implementation, exercise SELL + CHECK IN + receipt email path.

================================================================================
C. COMPLETION GATE PHASE 3
================================================================================

Terminal workflows exist and call real APIs (no placeholders). Check-in, tabs, receipts, QR, payment links, refund/reschedule/adjust, capacity, offline queue, zip capture, banned guest, photo verify, card print all work or fail honestly. Smokes p1–p3 green. Then STOP for Phase 3 audit.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of POS Phase 3.
SSOT: docs/pos-complete-spec.md Phase 3. VERIFY Phases 1–2 still hold.

Walk the front desk: SELL mixed cart → pay → receipt QR → CHECK IN redeem → CAPACITY reschedule → TAB settle → offline merch cash sync.

Look for: placeholder buttons, disconnected APIs, check-in without paid gate, NFC faked as working, KDS faked, shop wallet used, PIN in logs/URLs, missing zip enforcement when required, split tabs not marked beta, oversell from capacity UI.

If anything is wrong: FIX IT. Re-test. Re-check engine invariants from Phase 2.

Phase 3 complete only when every B2–B10 item is true.
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of POS (Point of Sale).
SSOT: docs/pos-complete-spec.md
VERIFY PHASE 3 FIRST. Fix terminal/engine gaps before till/hardware/sync work.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Till lifecycle is real (open/close/reconcile/cash in-out/notes/expected totals/close without count/edit reconciled). Tipping assignable to staff (incl. multiple). Cash drawer + Stripe Terminal integration contracts work when configured. POS synchronizes with billing entitlement, HQ location scope, export, Stripe webhooks, rate limits, Demo/suspend/archive, tax, activity completeness. Hardware absence fails honestly.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

B1. Verify Phase 3. Redeem/sale/tab regressions fixed first.

B2. Till & cash
- Open till session: opening float, device, cashier (pos:till_open). One open session per device.
- Cash in/out movements (reason + amount).
- Expected totals visibility: if PosSettings.showExpectedTillTotals, show expected cash from movements+sales; else hide from cashier (manager/finance can still read).
- Close with cash count: counted vs expected → variance (pos:till_close).
- Close without cash count: pos:till_no_count.
- Edit reconciled sessions: pos:till_edit (admin/finance); activity + editReason required.
- Till notes on open and close.
- Cash sales/refunds must attach tillSessionId when a session is open; if none open and tender=cash → 400 TILL_REQUIRED (unless settings allow — default require till for cash).

B3. Cash drawer integration
- POST /api/pos/devices/[id]/drawer-kick (pos:cash). Persist PosDrawerEvent.
- Integration: ESC/POS via optional print agent URL on PosDevice.settingsOverride, or window print fallback. If no agent: return 200 with { kicked: false, reason: "NO_DRAWER_AGENT" } and UI instruction — do NOT pretend the drawer opened.
- Cash recyclers: do not implement (postponed).

B4. Tipping / gratuities
- Tip prompt on POS checkout and card terminal (Stripe amount with tip if Terminal; else POS tip line before capture).
- Assign tips to one or many staff Memberships (same org): PosTipAllocation saleId, userId, amount. Sum must equal tipAmount.

B5. Stripe Terminal (in-person card)
- If STRIPE_TERMINAL / connection token env present: POST /api/pos/terminal/connection-token (entitled POS).
- PaymentIntent on_behalf of POS sale. Document env keys.
- If not configured: card path uses PaymentIntent + payment link; UI says “Card terminal not configured”.

B6. Stripe webhooks
Extend existing Stripe webhook handler: metadata.type pos_sale / pos_tab_preauth / pos_membership_subscription. Confirm sale pay, fail, refund. Ignore shop order events incorrectly (do not settle Order). Signature verify. Idempotent.

B7. Control plane sync
- actorLocationScope: POS lists (sales, devices, tills) filter by selected HQ location when locationScoped; company-wide when All locations. Still stamp locationId on writes from the cashier’s selected venue — never from a spoofed body.
- Demo/suspend/archive venue: no new sales; reads may 403/400 with clear message.
- ticketsPerMonth: if booking confirm in POS, enforce meter.
- companyExport includes till variance summaries, sale counts, gift liability totals (not raw codes).
- Rate-limit PIN verify, payment-link, refund.
- TaxSettings changes apply to new quotes only (existing sales keep snapshot).

B8. POS admin role UX
- /admin/pos/admin complete: menus, templates, global+device settings, zip config, suspend stock, wastage log, devices.
- Permission pos:admin gated.

B9. Reliability
- Webhook + checkout race: sale must not double-complete.
- Offline sync vs till: cash offline sales apply to open till or create movement with note “offline-sync”.
- Gift card concurrent redeem: transactional row lock; no negative balance.

B10. Tests Phase 4
scripts/smoke-pos-phase4.mts + smoke:pos:p4
- Open till → cash sale → expected increases → close count variance
- Close without count permission 403 vs 200
- Edit reconciled
- Cash sale without till 400
- Webhook settles payment_link sale
- HQ location filter (if enterprise fixtures exist; else unit the helper)
- Cross-tenant till 403
- Tip split two staff sums
- Drawer-kick honest NO_DRAWER_AGENT
- Re-run p1–p3

================================================================================
C. COMPLETION GATE PHASE 4
================================================================================

Till+tips+drawer honesty+webhooks+HQ/export/Demo gates synchronized. Smokes p1–p4 green. Then STOP for Phase 4 audit.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of POS Phase 4.
SSOT: docs/pos-complete-spec.md Phase 4. VERIFY Phases 1–3.

Trace cash: open till → sell cash → in/out → expected → close → variance → export. Trace card: payment link or Terminal → webhook → sale completed once. Trace HQ park filter vs write stamp.

Look for: shop Order settled by POS webhook, drawer faked, till skippable on cash, PIN/rate-limit gaps, Demo POS leak, double capture, negative gift balance.

If anything is wrong: FIX IT. Re-test. Re-check Phases 2–3 workflows.

Phase 4 complete only when every B2–B10 item is true.
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of POS (Point of Sale).
SSOT: docs/pos-complete-spec.md
VERIFY PHASE 4 FIRST. Fix till/webhook/tenancy issues before final audit work.

This is the final phase: testing, optimization, honesty, production readiness, independent system audit. Do NOT add unrelated features. Do NOT fake Intercard, KDS UI, kiosk, public booking, waiver signing, cash recyclers.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

POS is production-ready as a connected module: all planned POS functionality works, supporting pieces exist, control plane agrees, docs are honest, smokes all pass, residual backlog is explicit.

================================================================================
B. FEATURES / TASKS THAT MUST BE COMPLETE IN PHASE 5
================================================================================

B1. Verify Phase 4 smokes + fix remaining gaps from any phase (carry forward).

B2. Full smoke pack
scripts/smoke-pos-phase5.mts + smoke:pos:p5 + smoke:pos:all (p1…p5)
Matrix:
T1 Cross-tenant deny (devices, sales, tills, guests, gift redeem)
T2 Demo/storefront/Starter/unpaid deny
T3 Last remaining session double-checkout no oversell
T4 Hold expires before checkout
T5 Discount/refund/void without PIN when required
T6 Split cash+card+gift
T7 Gift issue + redeem + balance + refund-to-gift
T8 Membership sell recurring-or-fixed + upgrade
T9 Cashless + park wallet top-up/redeem
T10 Unpaid booking cannot redeem
T11 Check-in double redeem
T12 Past-date redemption rules
T13 Banned guest without override
T14 Tab settle + beta split does not break parent
T15 Till required for cash; variance recorded
T16 Close no-count permission
T17 Offline merch cash sync idempotent; admission offline conflict
T18 Payment link webhook settle once
T19 Wastage + suspend
T20 Zip required enforcement
T21 ticketsPerMonth on booking confirm if engine present
T22 HQ location filter
T23 Export omits hashes/PINs/raw codes
T24 Shop checkout still works; shop Wallet unchanged by park wallet
T25 /signup still closed
T26 Fashion Product not listed on POS catalog
T27 Device cap
T28 Tip allocations sum
T29 KitchenTicket created for F&B (no KDS page required)
T30 Manager PIN lockout after brute force (rate limit)

B3. README / landing honesty
- Module entitlement: POS enforced for Growth+Enterprise.
- Do not claim Feature 01 / waivers / Intercard / KDS / kiosk complete.
- Residual backlog listed: Digital waiver signing, Intercard/Sacoa, KDS UI, self-service kiosk, full promo BOGO engine, dynamic pricing, OTAs, cash recyclers, NFC hardware dependence.

B4. Performance
Indexes used on sale list, credential lookup (code/custom id), gift last4+org, guest search. Avoid N+1 on cart quote.

B5. Permissions catalog complete in admin Users UI.

B6. Env documentation
STRIPE_SECRET_KEY, optional Stripe Terminal keys, NOTIFICATION_EMAIL_*, optional POS_PRINT_AGENT_URL, optional BOOKING_SMS_PROVIDER.

B7. Independent end-to-end trace (fix as you go)
entitled Growth company → venue → POS device → menu → guest create → mixed sale → pay split → receipt email/QR → check-in redeem → till close variance → refund PIN → export → Demo deny → shop still works.

B8. Re-run company-saas-hardening, plan-limits, venue-locations, enterprise-hq smokes if POS touched those files.

================================================================================
C. COMPLETION GATE PHASE 5 / SYSTEM COMPLETE
================================================================================

Every Phase 1–4 completion gate still true. smoke:pos:all green. Honest non-goals unfaked. Then STOP — POS is production-ready.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT (FINAL)

Copy everything inside the fence below:

```text
FINAL AUDIT of POS after Phase 5.
SSOT: docs/pos-complete-spec.md entire document.

Independently re-trace POS through the existing application:

entitled company (Growth/Enterprise) → venue → device cap → catalog (admissions via booking engine + POS SKUs + modifiers + packages + gift + membership + cashless + wallet + open price) → terminal cart → guest/zip → discount PIN → split pay → hold/unpaid/multi-session booking → receipt email/QR/reprint/payment link → refund/reschedule/adjust → check-in QR/barcode/membership/photo/waiver search/banned guest/late rules/custom ids/card print → capacity view → tabs/split beta/preauth beta → offline sync → till open/in-out/expected/close/no-count/edit/notes/drawer honesty/tips → wastage/suspend → HQ/export/Demo/Starter/storefront deny → shop Order/Wallet/Product untouched → /signup closed.

Look for: missing, partial, incorrect, disconnected, unused, duplicate, conflicting implementation; oversell; authZ holes; entitlement lies; fake hardware; shop commerce pollution; staff Membership vs GuestMembership mixup; plaintext gift codes/PINs; webhook double settle.

If you find ANY relevant issue: FIX IT. Then re-audit the fix. Re-test the affected workflow. Re-check synchronization with billing, HQ, shop, tailor, ticketing substrate.

Feature is COMPLETE only when every phase gate is true, smoke:pos:all is green, and honest non-goals remain unfaked.

Do not mark complete if critical sale/pay/capacity/till/tenant bugs remain.
```

---

## Honest non-goals (keep in every phase — do not fake)

- Public online booking wizard `/book/*` / Feature 01 completeness (shared booking substrate for POS channel is in scope)
- Full Digital Waivers signing / guardian flows (search/assign + status only)
- Intercard / Sacoa / Amusement Connect
- Kitchen Display System UI (KitchenTicket rows are in scope)
- Self-service kiosk / mobile roaming check-in app as a separate product (POS station check-in is in scope)
- Owner Dashboard KPI suite / accounting QuickBooks-Xero
- Dynamic pricing rule engine / BOGO promo engine
- OTA / Viator / Klook / GetYourGuide / Trip.com
- Cash recyclers
- Reopening `/signup`
- Using fashion Product/Cart/Order/Wallet as POS

---

## EXECUTION CONTROL

```
Paste PHASE 1 EXECUTION → implement → Paste PHASE 1 AUDIT → fix until pass
→ Paste PHASE 2 EXECUTION (verify 1 first) → Paste PHASE 2 AUDIT
→ Paste PHASE 3 EXECUTION (verify 2 first) → Paste PHASE 3 AUDIT
→ Paste PHASE 4 EXECUTION (verify 3 first) → Paste PHASE 4 AUDIT
→ Paste PHASE 5 EXECUTION (verify 4 first) → Paste PHASE 5 FINAL AUDIT
```

Never auto-skip phases. Never start coding until the user pastes START PHASE 1 / the Phase 1 execution prompt.

---

**End of copy-and-paste execution pack.**
