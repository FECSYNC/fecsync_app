# Gift Cards — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 10 — Gift Cards (Module: SELL / stored-value liability)  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 10 + Section E gift-card product type + Arcade KPI “Outstanding Card Liability” + Module SELL.  
**Competitor brief:** `docs/roller-competitor-product-brief.md` Critical #10 Gift Cards.  
**Related slices (consume / share — do not fork vocabularies):**  
- `docs/pos-complete-spec.md` — `GiftCard`, `GiftCardLedger`, `PosProductKind.gift_card`, POS balance/redeem APIs, refund-to-gift-card, liability in company export  
- `docs/online-booking-ticketing-complete-spec.md` — booking tender `gift_card`, thin `GiftCard` substrate, refund method `gift_card`, `BookingPayment.giftCardId`  
- `docs/memberships-complete-spec.md` — multi-venue eligibility pattern (buy one park / redeem eligible parks); do not confuse staff `Membership` with anything gift-card related  
- `docs/guest-crm-complete-spec.md` — optional `GuestProfile` attach for issued-to guest  
- `docs/enterprise-hq-controls.md` — multi-venue HQ rollups / `assertEnterpriseHqEnabled`  
**Control plane:** `.cursor/rules/saas-venue-platform.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`.

---

## How to use this file

1. Paste **PHASE 1 — EXECUTION PROMPT** into Cursor and say or include `START PHASE 1`.
2. When Cursor finishes Phase 1, paste **PHASE 1 — FOLLOW-UP AUDIT PROMPT**.
3. Only after the audit passes, paste **PHASE 2 — EXECUTION PROMPT**, and so on through Phase 5.
4. Every later phase must verify the previous phase first, fix gaps, then continue.
5. Do not ask the user for a feature list — everything required is already inside these prompts.
6. If a previous phase is incomplete, buggy, insecure, or desynced: **FIX IT FIRST**, re-test, then continue. Do not only report.

**Rules that apply to every phase**

- Read and obey: `.cursor/rules/saas-venue-platform.mdc`, `.cursor/rules/customer-vs-tailor-sections.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`, `src/lib/subscriptionPlans.ts`, `README.md` module entitlement contract.
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as park gift cards, gift-card products, gift-card sales, gift-card balances, or gift-card ledgers.
- Do **NOT** treat the fashion shop Wallet as park stored-value. Park gift cards are `GiftCard` + `GiftCardLedger` only.
- Do **NOT** create a second competing gift-card table. The Prisma model `GiftCard` already exists as a **booking tender ledger stub**. **EXTEND** it into the full Feature 10 product. Keep `BookingPayment.giftCardId` and `issuedFromRefundBookingId` working.
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. Gift card online purchase may create or attach a `GuestProfile` if Guest CRM exists; never public client self-reg for operators; never invent shop `client` accounts just to buy a gift card.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker). Public purchase binds to a **published location / purchase token** (or equivalent published park page pattern) — never another tenant’s JWT `orgId`.
- Do **NOT** reuse company SaaS Stripe fields on `Organization` (`stripeCustomerId` / `stripeSubscriptionId` for tenant billing) as the guest gift-card purchase customer. Gift card sales use one-shot Checkout / PaymentIntent with gift-card metadata.
- DEFAULT_ORG / storefront never runs park Gift Cards ops. Demo plan locks Gift Cards. Unpaid / pending / suspended orgs fail closed.
- Gift Cards module entitlement: `assertModuleEnabled(orgId, "gift_cards")` — **Growth + Enterprise only** (`moduleHints` includes `"gift_cards"` or `"all"`). Add `"gift_cards"` to Growth `moduleHints` in this epic. Starter (ticketing hint only) MUST 403. Demo empty + locked.
- Staff Venue Manager lives under `/admin/gift-cards*` and `/api/admin/gift-cards/*` (plus thin `/api/pos/gift-cards/*` and public purchase/redeem routes — register every path in `API_PERMISSIONS`). Customer fashion `/profile` must never get operator gift-card tools. Optional guest “view my gift cards” only if clearly guest-park-account scoped — never merge into tailor studio. Tailor `/tailor/*` gets no Gift Cards ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Public purchase / redeem may use a focused layout but keep brand tokens via `resolveBrandForOrg` / CompanyProfile when the org is known.
- One connected system: ONE issue engine + ONE redeem engine + ONE ledger SSOT under `src/lib/giftCards/**`. Venue Manager, POS adapters, online purchase/redeem, booking tender/refund, HQ reports, and export all call the same libs. Do not invent a second status vocabulary per surface.
- Never store plaintext gift card PAN/codes at rest — store `codeHash` (HMAC) + `last4` only. Raw code returned **once** on issue (and never again except controlled regenerate flows if explicitly implemented and audited).
- Do **not** fake-complete: full Feature 02 POS terminal cart/till, Feature 28 QuickBooks/Xero live GL sync, Intercard/Sacoa/Amusement Connect cashless, ParkWallet as a substitute for gift cards, Feature 01 full public ticketing checkout (only gift-card purchase/redeem hooks), reopen signup, claiming Feature 01/02/07/08 complete merely because gift-card substrate was created.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring (re-inspect at execution time — POS / Check-In / Waivers / Ticketing / CRM / Memberships may have shipped further):

- Control plane **is** shipped: Organization, VenueLocation, Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile, Stripe (`src/lib/stripe.ts`, `src/lib/companyBilling.ts`), mailer/`sendReceipts.ts`, activityLog, companyExport, smoke script pattern, rateLimit, cron (`CRON_SECRET`).
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet, WalletTransaction.
- Prisma already has a **thin** `GiftCard` model (`orgId`, `codeHash`, `remainingBalance`, `currency`, `issuedFromRefundBookingId`) mapped to `gift_cards`, plus `BookingPaymentTender.gift_card` and `BookingPayment.giftCardId`. Comment in schema: “Booking tender ledger only — not a full gift-card shop.” **EXTEND this model** — do not fork `ParkGiftCard` / `VenueGiftCard` parallels.
- There is **no** `GiftCardLedger`, gift-card product/settings/eligibility, gift-card admin UI, gift-card APIs under `src/`, or prior `docs/gift-cards-complete-spec.md` before this file.
- Fashion `Wallet` is user-scoped shop stored-value (`userId` unique, no `orgId`). POS and ticketing specs explicitly forbid reusing it as park gift card / cashless / park wallet. Keep that rule absolute.
- `src/lib/ticketing/giftCards.ts` is named in the ticketing complete-spec as Phase 2+ work and may **not** exist yet. Prefer implementing the shared engine under `src/lib/giftCards/**` and having ticketing import from there (or a thin re-export) so POS and bookings do not diverge.
- Full POS (`PosSale`, till, POS catalog) is **spec-only or partial** — inspect. Gift Cards must ship as a **standalone Venue Manager module** with thin `/api/pos/gift-cards/*` adapters even if the POS UI is absent.
- Guest CRM `GuestProfile` may be absent — inspect. If present, optional `issuedToGuestId`. If absent, store recipient name/email on the card and allow later attach.
- Booking payment capture / refund engine may be incomplete — inspect. Ship `issueFromBookingRefund` / redeem helpers in the gift-card lib; wire live booking routes only when they exist.
- `src/lib/moduleEntitlement.ts` and `assertModuleEnabled` **exist** for ticketing (and possibly others). Extend them. Do not invent a second module-gate helper.
- Growth `moduleHints` today include `ticketing`, `pos`, `waivers`, `loyalty` — **not** `"gift_cards"`. This epic adds `"gift_cards"`. Enterprise `"all"` covers it. Starter remains ticketing-only for this module.
- Admin nav today has no Gift Cards group until this epic lands.
- Company Stripe = tenant subscription. Shop Stripe Checkout = fashion/order pay. Gift card online purchase = separate one-shot payment with gift-card metadata — do not mix.
- Vercel Hobby **≤2 crons** in `vercel.json`. Do **not** add a third Vercel cron. If gift-card expiry reminders are needed, piggyback on the existing daily `/api/cron/remind-company-subscriptions` (same pattern as other modules), plus optional dedicated CLI/GH cron route.
- No SMS/Twilio required. Email via `mailer.ts`. SMS only if a provider is already configured — otherwise email-only and document honesty.
- `actorLocationScope`: when a park is selected, filter park-scoped gift card lists and activity for that park when `locationId` is stamped. Org-wide cards/settings may use `locationId` null. Do not fake-filter fashion Product/Order.
- README “Next epics” may nest gift cards under POS / Feature 10 — keep honesty until Phase 5 completion criteria are met.
- `PROJECT TRANSFORM PLAN.html` does **not** define gift cards; ignore it for this epic. Catalog + this SSOT + POS/ticketing slices are authoritative.

---

## Project understanding (for humans reading this file)

Gift Cards is the **full park stored-value gift card product**: digital and physical cards; preset or custom amounts; terms & conditions; issue at POS, Venue Manager, and online; redeem at POS and online; track remaining balance and liability; refund bookings to gift cards; edit gift card details; resend emails; view balance; export data; track revenue under accrual accounting; bulk issue; multi-venue HQ (buy at one park, spend at eligible parks in the same currency); Gift Card Payable / Receivable accounting; cross-venue gift card activity report in HQ Analytics; search/redeem across eligible venues at POS.

It is **not** the fashion shop Wallet. It is **not** cashless arcade cards (Intercard/Sacoa). It is **not** ParkWallet. It hangs off the company SaaS control plane and shares the extended `GiftCard` row with booking tender/refund and future POS sale lines.

**Surfaces**

- Company admin / Venue Manager: `/admin/gift-cards/*` (primary).
- Thin POS hooks: `/api/pos/gift-cards/*` calling the same engine.
- Online: public purchase + redeem/balance hooks for entitled published parks.
- Booking engine: tender redeem + refund-to-gift-card helpers.
- Enterprise HQ: cross-venue activity + payable/receivable rollups when `assertEnterpriseHqEnabled`.
- Never operator tools on customer fashion `/profile` shop tabs or `/tailor/*`.

**What to reuse / extend / create / replace**

- **Reuse:** Organization, VenueLocation, staff Membership/RBAC patterns, planLimits, demoPlanLock, staffOrg, requirePermissionFresh, permissions patterns, adminNav patterns, activityLog, companyExport, HQ overview honesty, smoke script pattern, rateLimit, mailer, Stripe helpers (without mixing org SaaS customers), CompanyProfile brand, ticketing admin page/API stack patterns.
- **Extend:** existing Prisma `GiftCard`, `BookingPayment.giftCardId`, permissions catalog, adminNav, ActivityEntityType / NotificationType, subscriptionPlans `moduleHints`, hqOverview module status, demoPlanLock allowlist (keep Gift Cards off Demo), actorLocationScope consumers, Stripe webhook router for gift-card sale settle, companyExport, daily cron piggyback if expiry reminders ship.
- **Create:** `GiftCardLedger`, gift-card product/settings/eligibility/accounting report libs, `src/lib/giftCards/**`, admin pages, public purchase UI, POS adapter routes, smokes, this SSOT’s living completion notes.
- **Replace:** nothing of shop Wallet; do not replace booking tender FK — deepen the same `GiftCard` model.

---

## Scope (complete) vs non-goals

**In scope (this epic):**

1. Digital and physical gift cards.
2. Preset denominations and custom amounts (min/max).
3. Terms & conditions (configurable text; acceptance on purchase where applicable).
4. Issue at Venue Manager, online, and POS adapter.
5. Redeem at Venue Manager, online hooks, and POS adapter.
6. Track remaining balance and immutable ledger movements.
7. Track outstanding liability (unredeemed stored value).
8. Refund bookings to gift cards (service + wire when booking refunds exist).
9. Edit gift card details (non-secret metadata).
10. Resend digital gift card emails.
11. View balance (staff + controlled public/POS inquiry).
12. Export data (CSV/JSON — last4 only, never raw codes or hashes).
13. Accrual accounting views: issue increases liability/payable; redeem decreases liability and recognizes revenue.
14. Bulk issue gift cards.
15. Multi-venue gift cards (HQ): buy at one park, spend at eligible parks (same currency).
16. Gift Card Payable / Receivable accounting (internal reports by venue).
17. Cross-venue gift card activity report in HQ Analytics.
18. Search/redeem across eligible venues at POS.
19. Module entitlement, Demo lock, RBAC, tenant isolation, rate limits, activity logging, company export hooks, README honesty.

**Out of scope (do not fake-complete):**

- Full Feature 02 POS terminal (cart, till, kitchen, mixed F&B checkout UI). Thin gift-card POS APIs **are** in scope.
- Fashion shop merchandising of gift cards via `Product` / `Cart` / `Order` / `Wallet`.
- Live QuickBooks / Xero / Feature 28 GL mapping (internal liability reports only).
- Intercard / Sacoa / Amusement Connect cashless; ParkWallet as a gift-card substitute.
- SMS unless a provider is already configured.
- Reopening `/signup` or claiming unrelated modules complete.
- Dynamic pricing engine, OTA, self-service ticket kiosk purchase of unrelated SKUs.

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Gift Cards.
SSOT: docs/gift-cards-complete-spec.md
Execute ONLY Phase 1. Do not implement live issue of spendable codes, redeem, Stripe gift-card purchase settle, bulk issue, POS redeem enforcement, accrual HQ dashboards, or booking refund-to-card money movement yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = staff seat on an Organization (NOT a gift card, NOT a guest membership).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront catalog host — never locked by tenant expiry for shopping, but NEVER runs park Gift Cards ops.
- Primary product = venue SaaS control plane. Public Harewa shop is secondary.
- Surfaces must not merge: Customer (shop + /profile) | Tailor (/tailor/*) | Company admin (/admin/*) | Enterprise HQ (/admin/hq when entitled).

Gift Cards (Feature 10) is the park stored-value liability product: digital & physical cards; preset or custom amounts; T&Cs; issue at POS / Venue Manager / online; redeem at POS & online; balance + liability; refund bookings to gift cards; edit details; resend emails; export; accrual accounting; bulk issue; multi-venue HQ buy/spend; Payable/Receivable; HQ cross-venue activity; POS search/redeem across eligible venues.

Phase 1 founds the module: schema (extend existing GiftCard), ledger table, products/settings/eligibility substrate, entitlement, RBAC, Venue Manager shells, HQ/export honesty. No live stored-value movement yet.

Read and obey before coding:
- .cursor/rules/saas-venue-platform.mdc
- .cursor/rules/customer-vs-tailor-sections.mdc
- docs/saas-module-extension.md
- docs/enterprise-hq-controls.md
- docs/pos-complete-spec.md (GiftCard / GiftCardLedger / POS gift API shapes)
- docs/online-booking-ticketing-complete-spec.md (booking tender substrate — EXTEND, do not fork)
- docs/fec-os-cursor-feature-catalog.md Feature 10
- src/lib/subscriptionPlans.ts
- Existing ticketing admin stack as the pattern to clone (lib → API → services/hooks → Protected admin pages)

HARD RULES FOR PHASE 1
- Do NOT reuse fashion Product / Cart / Order / Wallet / WalletTransaction as gift cards.
- Do NOT create ParkGiftCard / VenueGiftCard / StoreCredit parallel tables. EXTEND prisma model GiftCard.
- Do NOT store plaintext gift codes. Even in Phase 1, schema must have codeHash + last4 fields ready; never add a plaintext code column.
- Do NOT trust client orgId / locationId.
- Do NOT put Gift Cards ops on /tailor/* or fashion /profile operator tabs.
- Do NOT claim Gift Cards complete in README/landing.
- Do NOT implement Phase 2–5 money movement in Phase 1.
- Tenant gate order: Fresh permission → requireActorOrgId → assertOrganizationActive → assertCompanyBillingEntitled → assertModuleEnabled(orgId, "gift_cards") / assertGiftCardsEnabled.
- Every park business row: orgId required + locationId when park-specific (FK VenueLocation; assert venue.orgId === orgId). Org-default settings/products may use locationId null.
- Register every new API path in API_PERMISSIONS. Register admin routes in ADMIN_ROUTE_PERMISSIONS. Add adminNav entries.

Name collisions to avoid:
- shop Wallet ≠ GiftCard
- shop Order ≠ gift card sale / PosSale
- staff Membership ≠ guest membership ≠ gift card
- company Stripe subscription ≠ gift card one-shot purchase (Phase 2)
- booking tender GiftCard stub ≠ “done Feature 10” — Phase 1 extends the stub into a real product foundation

Reuse: Organization, VenueLocation, staff Membership, venueLocations helpers, planLimits, demoPlanLock / demoPlanAssert, actorLocationScope, staffOrg, requirePermissionFresh, permissions.ts, adminNav.ts, activityLog.ts, companyExport.ts, hqOverview.ts, moduleEntitlement.ts, smoke scripts, rateLimit.ts, mailer.ts (templates later), stripe.ts (settle later), TaxSettings, CompanyProfile / resolveBrandForOrg, ticketing page patterns.

Sibling dependency (mandatory, honest):
1. Inspect prisma/schema.prisma for GiftCard, BookingPayment, Wallet, GuestProfile, PosSale, module tables.
2. EXTEND GiftCard. ADD GiftCardLedger + GiftCardProduct + GiftCardSettings + GiftCardVenueEligibility (names may be GiftCardProductConfig if you need clarity — pick one and use consistently; prefer names aligned with POS spec).
3. If GuestProfile exists, optional issuedToGuestId FK. If not, recipient fields on GiftCard only.
4. Put NEW libs under src/lib/giftCards/**. If ticketing expected src/lib/ticketing/giftCards.ts, make it a thin re-export of the shared engine — do not fork logic.
5. Create or extend assertModuleEnabled — one helper for the whole product. Add assertGiftCardsEnabled wrapper.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: open Gift Cards admin shells; configure org/location GiftCardSettings (T&Cs text, allow custom amount, min/max, default expiry days, default currency behavior); CRUD GiftCardProduct catalog (digital and/or physical, preset denominations JSON, allowCustomAmount, archivedAt); configure multi-venue GiftCardVenueEligibility rows (structure + CRUD even if redeem enforcement is Phase 3); see an empty or read-only Gift Cards list shell with filters prepared; open a card detail shell that explains no cards issued yet; fail closed on Demo/Starter/storefront/unpaid/pending/suspended. Full foundation schema is migrated now (even if issue/redeem APIs arrive in Phase 2). HQ/export recognize the module honestly without fake liability KPIs. NO live code issuance, NO redeem, NO Stripe gift purchase, NO bulk issue, NO accrual dashboards in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Extend src/lib/moduleEntitlement.ts assertModuleEnabled(orgId, module) if needed so "gift_cards" works with the same stack:
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden for park Gift Cards ops
  5) plan.moduleHints includes the module OR "all"
- assertGiftCardsEnabled(orgId) thin wrapper used by all Gift Cards APIs.
- Add "gift_cards" to Growth moduleHints in src/lib/subscriptionPlans.ts (keep Enterprise "all"). Keep Demo moduleHints []. Starter must NOT include gift_cards.
- Starter MUST 403 Gift Cards. Demo MUST 403. Unpaid/pending/suspended fail closed via existing billing helpers.
- Update FuturePlanModules / comments / hqOverview FUTURE_MODULE_IDS (or equivalent) so gift_cards is an enforceable module hint, not a silent story-only string.
- Update hqOverview module status vocabulary to include gift_cards honestly (not_enabled until entitled+shipped paths exist — never fake outstanding liability totals in Phase 1).

C2. Plan / meter honesty
- Gift Cards is module-gated (Growth+). Do not invent a fake per-card metered Stripe bill unless you also enforce it.
- Optional soft operational caps in GiftCardSettings (e.g. maxBulkIssuePerDay) are OK as settings fields in Phase 1 without enforcing money APIs yet.
- Multi-venue eligibility editor: Enterprise may manage cross-park eligibility. Growth may configure for a single home venue / limited editor — do NOT leak Enterprise HQ rollup KPIs to non-Enterprise (assertEnterpriseHqEnabled on any HQ rollup routes; Phase 1 may only add honesty hooks).
- Demo plan lock: Gift Cards admin routes must NOT be on the Demo allowlist.

C3. Complete Prisma schema + migration (create ALL Gift Cards foundation tables now even if some APIs arrive later)
All new/extended tables: orgId required, indexed, FK Organization. Park-scoped rows: locationId FK VenueLocation unless noted.

EXTEND ActivityEntityType with: GiftCard, GiftCardProduct, GiftCardLedger, GiftCardSettings, GiftCardVenueEligibility (or equivalent names you chose — keep consistent).
Extend NotificationType if needed for gift_card (or reuse alert/system) for issue/resend later.

Enums (align with POS spec; do not invent contradictory parallels):
- GiftCardKind: digital | physical
- GiftCardStatus: active | pending | disabled | expired | void
- GiftCardLedgerType: issue | redeem | refund | adjust | void
- GiftCardIssueChannel (or string enum): admin | pos | online | booking_refund | bulk | other

EXTEND existing model GiftCard (do not drop booking fields):
- Keep: id, orgId, codeHash, remainingBalance Decimal(12,2), currency, issuedFromRefundBookingId?, createdAt, updatedAt, @@unique([orgId, codeHash]), relations to Organization and BookingPayment[] and issuedFromRefundBooking
- ADD at minimum:
  - locationId? (issue / home venue; FK VenueLocation)
  - last4 String (required once codes exist; in Phase 1 allow placeholder only if no cards — prefer required on create in Phase 2)
  - kind GiftCardKind
  - status GiftCardStatus @default(pending) or active as you document
  - initialBalance Decimal(12,2)? (or mirror first issue ledger amount)
  - expiresAt DateTime?
  - recipientName String?
  - recipientEmail String?
  - personalMessage String?
  - termsVersion String? / termsAcceptedAt DateTime?
  - issuedToGuestId String? (FK GuestProfile if model exists; else omit FK and keep email/name only)
  - issuedByStaffId String? (FK User)
  - productId String? (FK GiftCardProduct)
  - issueChannel GiftCardIssueChannel?
  - issuedSaleId String? (optional opaque link for future PosSale — no fake PosSale required)
  - emailedAt DateTime?
  - disabledAt DateTime?, voidedAt DateTime?, voidReason String?
  - notes String?
  - Indexes: orgId+status, orgId+last4, orgId+locationId, orgId+recipientEmail, orgId+expiresAt
- NEVER add plaintext code column.

GiftCardLedger (CREATE — immutable movement log):
- id, orgId, locationId? (venue where movement happened)
- giftCardId
- type GiftCardLedgerType
- amount Decimal(12,2) (sign convention: document clearly — prefer signed amounts OR type+positive amount with direction; be consistent)
- balanceAfter Decimal(12,2)
- currency String
- idempotencyKey String @unique (or @@unique([orgId, idempotencyKey]))
- actorUserId? / createdById?
- source admin|pos|online|booking|system|bulk
- bookingId? / bookingPaymentId? / saleId? optional links
- meta Json?
- createdAt
- Indexes: orgId+giftCardId+createdAt, orgId+type+createdAt, orgId+locationId+createdAt
- No updates/deletes in app logic (append-only)

GiftCardProduct (CREATE — catalog of sellable gift card configurations):
- id, orgId, locationId? (null = org-default product)
- name, description?
- kind GiftCardKind (or supportsDigital / supportsPhysical booleans — pick one clear model)
- denominations Json (array of preset amounts)
- allowCustomAmount Boolean
- minAmount Decimal?, maxAmount Decimal?
- currency String
- defaultExpiresInDays Int?
- termsAndConditions Text? (or rely on settings T&Cs — if both, document precedence: product override vs org default)
- archivedAt DateTime?
- createdAt, updatedAt
- Indexes: orgId+archivedAt

GiftCardSettings (CREATE — org/location settings):
- id, orgId, locationId? (null = org default; unique per org+location)
- termsAndConditions Text (required for purchase UX later)
- allowCustomAmount Boolean default true
- minAmount / maxAmount
- defaultCurrency String?
- defaultExpiresInDays Int?
- requireTermsAcceptance Boolean default true
- allowOnlinePurchase Boolean default true
- allowOnlineRedeem Boolean default true
- maxBulkIssuePerRequest Int?
- codeHmacSecretRef? DO NOT store raw master secret in DB if env-based — prefer env GIFT_CARD_CODE_HMAC_SECRET with org pepper optional in settings only if secure; document choice. Never commit secrets.
- createdAt, updatedAt

GiftCardVenueEligibility (CREATE — multi-venue foundation):
- id, orgId
- productId? OR org-wide policy row (document: eligibility per product and/or org-wide cards)
- issueLocationId String (where purchased/issued)
- redeemLocationId String (where redeem allowed)
- eligible Boolean @default(true)
- sameCurrencyOnly Boolean @default(true)
- unique suitable composite (e.g. orgId+productId+issueLocationId+redeemLocationId)
- createdAt, updatedAt
- Phase 1: CRUD + storage. Phase 3: enforce on redeem.

Also ensure BookingPayment.giftCardId relation still compiles after GiftCard extension.

C4. Permissions, routes, nav
- Add P.GiftCardsRead, P.GiftCardsWrite, P.GiftCardsManage (and optionally P.GiftCardsRedeem, P.GiftCardsExport if you split — otherwise Manage covers redeem/export with checks). Mirror ticketing/finance preset patterns: finance can read liability later; ops can issue/redeem as you assign.
- Wire ADMIN_ROUTE_PERMISSIONS for:
  - /admin/gift-cards
  - /admin/gift-cards/products
  - /admin/gift-cards/settings
  - /admin/gift-cards/eligibility
  - /admin/gift-cards/[id]
  (and any other Phase 1 shells)
- Wire API_PERMISSIONS for every /api/admin/gift-cards/* route you add.
- Add adminNav group “Gift Cards” (or under Bookings/Sell — prefer clear Gift Cards group) with children: Cards, Products, Settings, Eligibility.
- Soft-upsell UI when module disabled: show locked panel with upgrade messaging; do NOT leak card data.

C5. Library foundation (src/lib/giftCards/**)
- common.ts — org stamp helpers, decimal money helpers, error codes
- assert.ts or assertGiftCardsEnabled in module file
- settings.ts — get/upsert settings (actor org only)
- products.ts — list/create/update/archive products; parse denominations; validate min/max
- eligibility.ts — list/create/update/delete eligibility rows; validate venues belong to org
- cards.ts — listCards filters (status, locationId, last4, email) returning EMPTY list OK; getCardById
- Do NOT implement issue/redeem balance mutation yet (stub NotImplemented only if referenced — prefer omit routes until Phase 2)

C6. Admin APIs (Phase 1)
- GET/PATCH /api/admin/gift-cards/settings
- GET/POST /api/admin/gift-cards/products
- GET/PATCH/DELETE-or-archive /api/admin/gift-cards/products/[id]
- GET/POST/PATCH/DELETE /api/admin/gift-cards/eligibility
- GET /api/admin/gift-cards (list shell)
- GET /api/admin/gift-cards/[id] (404 when missing; empty-state friendly)
- All: force-dynamic, nodejs, requirePermissionFresh, requireActorOrgId, assertGiftCardsEnabled, reject ?orgId=, connectDB, ok/created/badRequest/routeErrorResponse, logStaffActivityEntry on writes

C7. Admin UI shells (Phase 1)
- Pages under src/app/(admin)/admin/gift-cards/** re-exporting components from src/components/Protected/admin/pages/gift-cards/**
- GiftCardsListPage — filters + empty state “No gift cards issued yet”
- GiftCardDetailPage shell — placeholder sections for balance/ledger/actions (disabled with “Available after issue engine” or hide buttons)
- GiftCardProductsPage — full CRUD UI for products (denominations, custom amount, digital/physical, T&Cs override if any)
- GiftCardSettingsPage — T&Cs, min/max, expiry default, online purchase/redeem flags
- GiftCardEligibilityPage — venue matrix / row editor (Growth vs Enterprise honesty copy)
- Use existing gold/stone admin patterns (ticketingUi or shared admin classes). can(P.*) gates CTAs.
- services/giftCards.ts + hooks/useGiftCards.ts (React Query) mirroring ticketing services/hooks

C8. HQ / export / company honesty (Phase 1)
- hqOverview: include gift_cards module status not_enabled or configured without fake liability dollar amounts
- companyExport.ts: include counts for GiftCardProduct / GiftCard / GiftCardLedger when tables exist (0 OK). Omit codeHash. last4 only if exporting card summaries later — Phase 1 counts are enough
- Do not add Outstanding Card Liability KPI numbers until Phase 4 (hook comment OK)

C9. Documentation in-repo
- Keep this SSOT accurate for Phase 1 completion notes
- Do not mark Feature 10 complete in README
- Optionally add a short “Gift Cards (staff foundation)” note under honesty sections if README lists module status — still not complete

C10. Testing / smokes for Phase 1
- Migration applies
- Entitled Growth/Enterprise: settings GET 200, products POST works, list cards 200 empty
- Demo / Starter / storefront actor: 403 on gift cards admin API
- Cross-tenant: org A cannot read org B product/card by id
- Schema: GiftCard still relates to BookingPayment
- Wallet tables untouched by gift-card writes

================================================================================
D. WORKFLOWS PHASE 1 MUST SUPPORT
================================================================================

1. Operator opens /admin/gift-cards → empty list, module entitled.
2. Operator configures Settings (T&Cs, amounts, flags) → saved for actor org.
3. Operator creates Products (preset denominations, custom allowed, digital/physical) → appears in products list; archive hides from future sell pickers (Phase 2).
4. Operator configures Eligibility rows between venues → saved (not enforced on redeem yet).
5. Unauthorized / Demo / Starter / wrong-tenant → denied without data leak.
6. Soft-upsell when plan lacks gift_cards hint.

================================================================================
E. SECURITY / ERRORS / EDGES (PHASE 1)
================================================================================

Security:
- Fresh auth + permissions + Demo lock + module gate + org stamp
- No client orgId trust; venue picker asserts venue.orgId === actor.orgId
- No plaintext code column; no secrets in companyExport

Errors:
- 401/403 auth and module
- 400 validation (bad denominations, min>max, invalid venue)
- 404 cross-tenant as 404 not 403 if that is repo convention for IDOR hardening — follow existing ticketing pattern consistently

Edges:
- Extending GiftCard must not break prisma generate or booking relations
- locationId null org-default product vs park-specific product
- Growth single-venue copy vs Enterprise multi-venue eligibility editor
- GuestProfile absent → skip FK
- Existing thin GiftCard rows (if any seed) must remain valid after migration (backfill kind/status/last4 carefully — use safe defaults + expandable nulls where needed)

================================================================================
F. COMPLETION CRITERIA PHASE 1
================================================================================

Phase 1 is complete ONLY when:
- All C1–C10 done
- Migration applied; GiftCard extended; Ledger/Product/Settings/Eligibility exist
- Growth+ entitled admin can use shells for settings/products/eligibility/empty cards list
- Demo/Starter/storefront/cross-tenant fail closed
- No live issue/redeem/Stripe gift purchase/bulk/HQ liability math
- Shop Wallet and fashion checkout still work
- README does not claim Gift Cards complete

STOP. Do not start Phase 2.
Report: files changed, migration name, residual notes for Phase 2.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
PHASE 1 FOLLOW-UP AUDIT — Gift Cards
SSOT: docs/gift-cards-complete-spec.md

Perform a deep audit of Phase 1 ONLY. Do not implement Phase 2+.

================================================================================
AUDIT MISSION
================================================================================

Verify every Phase 1 requirement. If anything is incomplete, incorrect, partial, disconnected, duplicated, conflicting, insecure, or desynced with the rest of the app: FIX IT. Then re-check the fix, re-test the affected workflow, re-check synchronization, and re-check related functionality. Do not merely report.

================================================================================
VERIFY PREVIOUS CONTEXT
================================================================================

- Re-read Phase 1 execution prompt sections A–F and Features C1–C10.
- Re-inspect prisma GiftCard (must be extended, not forked), GiftCardLedger, GiftCardProduct, GiftCardSettings, GiftCardVenueEligibility.
- Confirm shop Wallet untouched as the gift-card store.
- Confirm BookingPayment.giftCardId still valid.
- Confirm moduleHints includes gift_cards on Growth; Starter/Demo denied.

================================================================================
CHECKLIST (EVERY ITEM)
================================================================================

[ ] C1 Module entitlement assertGiftCardsEnabled + Growth hint + HQ honesty
[ ] C2 Plan/Demo lock honesty; no Demo allowlist for gift cards
[ ] C3 Schema complete: extended GiftCard + Ledger + Product + Settings + Eligibility + enums; no plaintext code column; orgId/locationId rules
[ ] C4 Permissions, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS, adminNav, soft-upsell
[ ] C5 src/lib/giftCards/** settings/products/eligibility/cards list (no money mutation)
[ ] C6 Admin APIs for settings/products/eligibility/list/detail
[ ] C7 Admin UI shells: list, detail, products, settings, eligibility
[ ] C8 hqOverview + companyExport counts; no fake liability KPI dollars
[ ] C9 Docs/README honesty
[ ] C10 Smokes: entitled allow; Demo/Starter deny; cross-tenant deny; wallet regression

Also verify:
[ ] No duplicate gift-card models
[ ] No POS/full issue/redeem accidentally shipped and claimed as Phase 1 complete without criteria
[ ] Customer/Tailor surfaces not polluted with operator gift-card tools
[ ] Naming consistent with POS/ticketing specs

================================================================================
FIX THEN RE-TEST
================================================================================

For every failure: implement the fix, re-run migration if needed, re-test API entitlement matrix, re-open admin shells, re-check prisma relations.

Only when everything passes, reply exactly:
GIFT CARDS PHASE 1 AUDIT PASSED
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Gift Cards.
SSOT: docs/gift-cards-complete-spec.md
Execute ONLY Phase 2. Do not implement bulk issue UI, full multi-venue redeem enforcement matrix UI completion beyond what’s required for single-venue redeem, HQ payable/receivable dashboards, or QuickBooks.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

VERIFY PHASE 1 completely using the Phase 1 audit checklist (C1–C10).
If anything is missing, partial, buggy, insecure, or desynced: FIX IT FIRST, re-test, then continue.
Do not blindly assume Phase 1 is correct.

================================================================================
A. PHASE 2 OBJECTIVE
================================================================================

Ship the core stored-value engine and primary channels so operators and guests can: issue digital and physical gift cards from Venue Manager; sell gift cards online via Stripe one-shot payment that settles into an issued card; inquire balance; redeem (full/partial) at Venue Manager and via online/booking-ready helpers; maintain an immutable GiftCardLedger; send and resend digital emails; edit non-secret gift card details; void/disable cards with ledger trails; enforce T&Cs/amount rules from Phase 1 products/settings. Still NO bulk issue product, NO HQ accrual dashboards, NO full POS cart — thin redeem helper for bookings is OK.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

C1. Cryptographic codes
- Generate high-entropy gift codes on issue.
- Store only codeHash (HMAC with server secret from env, e.g. GIFT_CARD_CODE_HMAC_SECRET) + last4.
- Return raw code ONCE in the issue API response (and show once in VM UI with copy warning).
- Balance/redeem APIs accept raw code from staff/guest input, hash it, look up by orgId+codeHash.
- Never log raw codes. Never put raw codes in activityLog metadata. Never export raw codes or codeHash.

C2. Issue engine (src/lib/giftCards/issue.ts or equivalent)
- issueGiftCard({ orgId, locationId?, productId?, kind, amount, currency, recipientName?, recipientEmail?, personalMessage?, channel, actorUserId?, bookingRefundId?, idempotencyKey, termsAccepted? })
- Validate against GiftCardProduct + GiftCardSettings (preset or custom within min/max; currency; requireTermsAcceptance).
- Create GiftCard row status active (or pending→active on pay settle — document online flow).
- Append GiftCardLedger type=issue with balanceAfter = amount; remainingBalance = amount; initialBalance set.
- Idempotent on idempotencyKey.
- Physical: may omit email; still create last4/hash; mark kind=physical.
- Digital: prefer email send after issue (C6).

C3. Redeem engine (src/lib/giftCards/redeem.ts)
- redeemGiftCard({ orgId, code or giftCardId, amount, locationId?, actorUserId?, source, idempotencyKey, bookingId? })
- Load card; verify status active; not expired (request-time expire → status expired); currency match; sufficient remainingBalance.
- Phase 2 multi-venue: if eligibility rows exist, enforce best-effort OR document that full matrix enforcement is Phase 3 — BUT never allow cross-org. Prefer implementing basic same-org redeem now; if location provided and eligibility table non-empty, enforce eligibility when rows exist.
- Decrement remainingBalance; append ledger type=redeem; balanceAfter correct.
- Reject over-redeem with clear error GIFT_CARD_INSUFFICIENT.
- Idempotent redeem.

C4. Balance inquiry
- getBalance by code (staff permission) and by giftCardId.
- Public/POS-ready function that returns last4, status, remainingBalance, currency, expiresAt — NEVER codeHash.
- Rate-limit public balance endpoints.

C5. Venue Manager issue / redeem / edit / void APIs + UI
- POST /api/admin/gift-cards/issue
- POST /api/admin/gift-cards/redeem
- GET /api/admin/gift-cards/balance (or query on detail)
- PATCH /api/admin/gift-cards/[id] — recipientName, recipientEmail, personalMessage, notes, expiresAt (permissioned); NOT remainingBalance direct edits without adjust ledger
- POST /api/admin/gift-cards/[id]/void or disable — ledger type void/adjust as designed; status void/disabled
- Optional POST adjust (Manage only) with reason — ledger type adjust
- UI: Issue wizard (product, amount, kind, recipient, T&Cs preview); Detail page live balance + ledger timeline; Redeem modal; Edit details; Resend email button; Void/Disable actions with confirm

C6. Digital email + resend
- mailer.ts templates for gift card delivery (code for digital, amount, venue brand via resolveBrandForOrg / CompanyProfile, T&Cs excerpt/link, expiry).
- Send on digital issue when recipientEmail present.
- POST /api/admin/gift-cards/[id]/resend-email — rate limited; stamp emailedAt; do not put code in staff activity logs.
- If raw code cannot be recovered (hash-only), resend must either (a) include a secure one-time reveal link that only works for Manage + audited regenerate, OR (b) resend notice without full code and require regenerate flow. Prefer secure regenerate+resend for digital cards with full audit ledger note “code regenerated” if you cannot decrypt — document clearly. Never email codeHash.

C7. Online purchase (Stripe one-shot)
- Public purchase page/route for published park (token or orgSlug+venueSlug pattern consistent with other public venue flows — inspect waivers/ticketing public patterns).
- Allow only if settings.allowOnlinePurchase and module entitled for that org.
- Amount from product preset or custom within min/max — NEVER trust arbitrary unpaid amount without server validation.
- Create Stripe Checkout Session or PaymentIntent via src/lib/stripe.ts helpers with metadata: purpose=gift_card, orgId, locationId, productId, amount, currency, recipient fields. Do NOT use Organization.stripeSubscriptionId.
- On confirm/webhook success: issueGiftCard idempotently (use Stripe event id / payment intent id as idempotencyKey).
- Extend stripe webhook router carefully alongside company billing + shop order settle — do not break them.
- Success UI shows “email sent” / last4 — show raw code only if digital-on-screen policy is explicit and safe.

C8. Online redeem hooks
- If settings.allowOnlineRedeem: staff or guest redeem API path as designed (guest redeem only against their purchase context or code entry with heavy rate limit).
- Export redeemForBookingPayment helper for ticketing to call when booking payments exist; wire if BookingPayment route already supports gift_card tender; otherwise export and unit-test the helper.

C9. Terms & conditions behavior
- Purchase/issue requires acceptance when settings.requireTermsAcceptance.
- Store termsVersion or hash/snippet reference + termsAcceptedAt on card.
- Display T&Cs on VM issue and online purchase.

C10. Ledger integrity invariants
- remainingBalance must always match the result of applying ledger entries (enforce in issue/redeem/void/adjust single writer).
- No delete/update of ledger rows.
- All money APIs transactional (prisma $transaction).

C11. Permissions & security hardening for money APIs
- Issue/redeem require GiftCardsWrite or Redeem/Manage as you defined in Phase 1 — be consistent.
- Void/adjust require Manage.
- Rate limits on public purchase, balance, redeem.
- Cross-tenant deny on all by id and by code (code hash lookup always scoped by orgId resolved from published context or actor org — never global code search).

C12. Testing / smokes Phase 2
- Issue digital → ledger issue → email attempted → balance correct
- Issue physical → no email required → redeem works
- Redeem partial then full; third redeem fails insufficient
- Expired/void cannot redeem
- Idempotent issue/redeem with same key
- Online Stripe settle path (test mode) issues card once
- Cross-org code cannot redeem
- Shop Wallet balance unchanged by gift card ops
- Direct PATCH remainingBalance not possible without adjust ledger

================================================================================
C. WORKFLOWS PHASE 2 MUST SUPPORT (BEFORE / START / DURING / SUCCESS / FAILURE / REPEAT / REVERSAL)
================================================================================

1. VM digital issue: validate → create hash/last4 → ledger → email → show code once → success; failure rolls back; repeat with new idempotency; void reverses liability via void ledger (not delete).
2. VM physical issue: same without email.
3. Online buy: select product/amount → accept T&Cs → pay Stripe → webhook/confirm issue → email; payment fail → no card; webhook retry → idempotent.
4. Balance inquiry: code → last4+balance; wrong org/code → not found; rate limit.
5. Redeem: code+amount → ledger+balance; insufficient/expired/void fail; repeat idempotent.
6. Resend email: rate limit; audited.
7. Edit details: name/email/notes/expiry; not secret balance.
8. Void/disable: status+ledger; cannot redeem after.

================================================================================
D. INTEGRATIONS PHASE 2
================================================================================

- Stripe webhook + confirm paths
- mailer.ts
- activityLog for issue/redeem/void/resend (no raw codes)
- BookingPayment gift_card helper export
- CompanyProfile branding on emails/public page

================================================================================
E. COMPLETION CRITERIA PHASE 2
================================================================================

Phase 2 is complete ONLY when all B features C1–C12 work, workflows above succeed, Phase 1 still healthy, no bulk/HQ accounting dashboards required yet, and shop Wallet/ticketing catalog still work.

STOP. Do not start Phase 3.
Report residuals for Phase 3 (bulk, eligibility enforcement, POS routes, refund-to-GC wiring).
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
PHASE 2 FOLLOW-UP AUDIT — Gift Cards
SSOT: docs/gift-cards-complete-spec.md

Deep-audit Phase 2. First VERIFY Phase 1 still passes (entitlement, schema foundation, shells, no Wallet reuse). If Phase 1 regressions exist: FIX THEM FIRST.

================================================================================
CHECKLIST (EVERY PHASE 2 FEATURE)
================================================================================

[ ] C1 Codes hashed; raw once; no logs/exports of secrets
[ ] C2 Issue engine digital/physical; product/settings validation; idempotent
[ ] C3 Redeem engine; insufficient/expired/void; idempotent; org-scoped
[ ] C4 Balance inquiry safe payload + rate limit
[ ] C5 VM APIs + UI: issue, redeem, edit, void/disable, ledger timeline
[ ] C6 Email + resend (or secure regenerate+resend) rate limited
[ ] C7 Online Stripe purchase settle → issue; no org SaaS Stripe mix; no shop Order/Wallet
[ ] C8 Online redeem hooks + booking helper exported/wired if possible
[ ] C9 T&Cs acceptance stored
[ ] C10 Ledger append-only; balance invariant; transactions
[ ] C11 Permissions + cross-tenant + rate limits
[ ] C12 Smokes listed in Phase 2 all considered

Trace end-to-end: settings/product → issue/purchase → email → balance → redeem → void.

If anything incomplete/incorrect/partial/disconnected/duplicate/conflicting: FIX IT, re-test money paths, re-check Stripe isolation from company billing, re-check webhook does not break shop/company settle, re-check tenant isolation.

Only when verified reply exactly:
GIFT CARDS PHASE 2 AUDIT PASSED
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Gift Cards.
SSOT: docs/gift-cards-complete-spec.md
Execute ONLY Phase 3. Do not implement full HQ accrual payable/receivable dashboards (Phase 4), QuickBooks, or full POS terminal UI.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

VERIFY PHASE 2 (and Phase 1). Fix any gaps/bugs/security/ledger issues BEFORE new work.
Confirm issue/redeem/balance/email/online purchase still work.

================================================================================
A. PHASE 3 OBJECTIVE
================================================================================

Operators can: bulk-issue gift cards; configure and ENFORCE multi-venue eligibility (buy at one park, redeem at eligible parks, same currency); search and redeem across eligible venues via POS APIs; refund bookings to gift cards through a first-class lib service (wired to booking refund routes when present); keep ONE SSOT engine across admin/POS/online/booking; complete activity logging for bulk and cross-venue actions.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 3 (DO NOT SKIP ANY)
================================================================================

C1. Bulk issue
- POST /api/admin/gift-cards/bulk-issue
- Body: productId, kind, amount or denomination, count OR list of recipients [{email,name}], locationId?, personalMessage?, idempotencyKey/batchId
- Enforce settings.maxBulkIssuePerRequest (and a hard server cap e.g. 100/500 — pick safe default)
- Per-row success/failure report; transactional per card or safe partial with explicit results
- Digital: queue/send emails (rate-aware); Physical: return last4 list / printable summary WITHOUT dumping all raw codes in one log — downloadable one-time codes file for Manage only with audit, or show codes once in UI with warning
- Admin UI: Bulk issue wizard + results table
- activityLog batch summary (counts, not codes)

C2. Multi-venue eligibility enforcement
- Complete Eligibility CRUD UI polish from Phase 1
- redeemGiftCard MUST enforce:
  - same org
  - currency match when sameCurrencyOnly
  - if eligibility rows exist for the product/org, redeem location must be eligible for the issue location (or org-wide allow policy you document)
  - clear errors: GIFT_CARD_VENUE_INELIGIBLE, GIFT_CARD_CURRENCY_MISMATCH
- Growth: honest single-venue or limited cross-venue (document). Enterprise: full cross-park eligibility editor.
- Buy at Park A / spend at Park B when eligible — automated test required
- actorLocationScope filters card lists when a park is selected (location-stamped rows)

C3. POS adapters (even without full POS UI)
- GET /api/pos/gift-cards/balance
- POST /api/pos/gift-cards/redeem
- GET /api/pos/gift-cards/search (by last4, email, code — org-scoped; code via hash; eligible venues aware)
- Register all in API_PERMISSIONS (pos permissions or gift_cards redeem permissions — align with permissions.ts patterns; create P.Pos* only if POS perms already exist, else use GiftCardsRedeem with staff Fresh auth)
- Must call the SAME src/lib/giftCards redeem/balance/search functions as admin
- Stamp ledger locationId to POS venue

C4. Refund bookings to gift cards
- Implement issueFromBookingRefund / creditGiftCardFromBookingRefund in src/lib/giftCards:
  - inputs: orgId, locationId, bookingId, amount, currency, actorUserId, idempotencyKey, recipientEmail?
  - creates/credits gift card; sets issuedFromRefundBookingId; ledger type=refund or issue with meta.reason=booking_refund
- IF booking refund API exists (bookings:refund): wire method "gift_card" to this service
- IF not: export service + admin “Issue from booking refund” action that validates booking belongs to actor org and records linkage; document residual “booking refund UI pending”
- Never issue refund cards cross-org

C5. Cross-venue search/redeem at POS
- Search returns cards redeemable at the cashier’s venue (eligibility-aware), with last4, balance, status, issue venue name
- Redeem uses cashier locationId for eligibility check
- UI optional minimal POS panel under admin if no POS app — e.g. /admin/gift-cards/pos-tools “Balance & Redeem” staff tool calling same APIs

C6. Channel synchronization
- Admin, POS, online, booking helpers: one status enum, one ledger, one balance field
- No second “POS gift credit” table
- If ticketing giftCards.ts re-export exists, ensure it points to shared engine

C7. Activity + notifications
- activityLog for bulk issue, eligibility changes, refund-to-GC, POS redeem
- Optional in-app NotificationType for digital delivery failures (honest)

C8. Testing / smokes Phase 3
- Bulk issue N cards → N ledger issues; partial failure handling
- Eligibility allow Park B; deny Park C; currency mismatch deny
- POS balance/redeem/search match admin balances
- Refund-to-GC creates card linked to booking id
- Cross-tenant POS search deny
- Growth vs Enterprise eligibility editor behavior matches docs
- Regression: Phase 2 single-venue issue/redeem/email/online purchase still pass

================================================================================
C. WORKFLOWS PHASE 3
================================================================================

1. Bulk digital issue to CSV/list of emails → results → emails
2. Bulk physical issue → printable once
3. Configure eligibility A→B → redeem at B succeeds → redeem at C fails
4. POS cashier searches last4 → sees eligible card → redeems
5. Booking refund → gift card issued/credited → customer can redeem
6. Repeat bulk with same batch idempotency key → no duplicates

================================================================================
D. COMPLETION CRITERIA PHASE 3
================================================================================

All B features C1–C8 done; multi-venue enforcement live; POS adapters live; refund-to-GC service live (wired or honestly admin-linked); Phase 2 regressions fixed; no fake full POS terminal claim.

STOP. Do not start Phase 4.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
PHASE 3 FOLLOW-UP AUDIT — Gift Cards
SSOT: docs/gift-cards-complete-spec.md

Re-verify Phases 1–2 first. Fix regressions before auditing Phase 3.

================================================================================
CHECKLIST (EVERY PHASE 3 FEATURE)
================================================================================

[ ] C1 Bulk issue API+UI; caps; per-row results; no secret leakage in logs
[ ] C2 Eligibility enforcement on redeem; errors; Growth/Enterprise honesty; actorLocationScope list filter
[ ] C3 POS balance/redeem/search APIs; same lib SSOT; permissions registered
[ ] C4 Refund-to-gift-card service; booking wire or honest admin linkage; issuedFromRefundBookingId
[ ] C5 Cross-venue search/redeem at POS / staff POS tools
[ ] C6 One engine across channels; no duplicate tables/vocabularies
[ ] C7 Activity logging completeness
[ ] C8 Smokes: bulk, eligibility matrix, POS parity, refund-to-GC, tenant deny, Phase 2 regression

Trace: eligibility config → issue at A → search/redeem at B → deny at C; bulk; booking refund → card.

If anything incomplete/incorrect: FIX IT, re-test multi-venue matrix and POS/admin parity, re-check booking refund linkage, re-check no raw codes in exports/logs.

Only when verified reply exactly:
GIFT CARDS PHASE 3 AUDIT PASSED
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Gift Cards.
SSOT: docs/gift-cards-complete-spec.md
Execute ONLY Phase 4. Do not implement live QuickBooks/Xero Feature 28 connectors. Do not fake-complete full Reporting module beyond gift-card liability/HQ activity.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

VERIFY PHASE 3 (and prior). Fix bulk/eligibility/POS/refund gaps BEFORE accounting work.
Confirm ledger remains append-only and balances correct.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Finance and HQ operators can: view outstanding gift card liability (unredeemed stored value) under accrual accounting; see revenue recognized on redeem; see Gift Card Payable / Receivable across venues for cross-park redemptions; run cross-venue gift card activity reports in HQ Analytics (Enterprise-gated); export safe CSV/JSON; see companyExport liability totals and hqOverview Outstanding Card Liability KPI — all derived from GiftCardLedger SSOT without exposing secrets.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

C1. Accrual accounting model (documented + computed)
- On issue (and refund-credit): increase outstanding liability / Gift Card Payable for the issue venue (or org).
- On redeem: decrease liability; recognize redeemed revenue for the redeem venue (document tax-exclusive vs inclusive honesty using TaxSettings if applicable — do not invent fake tax engine).
- On void/expire: decrease liability per policy (document: void returns liability to zero without revenue; expire same unless escheatment — v1: void/expire clears remaining liability without recognizing revenue, with ledger types void/adjust).
- Provide src/lib/giftCards/accounting.ts that computes from ledger (preferred) rather than fragile cached counters. Optional daily snapshot table only if needed for performance — if added, must reconcile to ledger.

C2. Gift Card Payable / Receivable (cross-venue)
- When issue venue != redeem venue (eligible cross-park spend):
  - Issue venue: Payable (owes the value that was collected but spent elsewhere)
  - Redeem venue: Receivable (served the guest; due from issue venue / HQ clearing)
- Report by venue pair and net positions for a date range
- Same currency only (multi-currency HQ out of scope unless already consistent — do not silently convert)
- Enterprise HQ rollup routes require assertEnterpriseHqEnabled
- Non-Enterprise: soft-upsell panel, no rollup data leak

C3. Outstanding liability views (Venue Manager)
- /admin/gift-cards/liability (or finance section): total outstanding, by status, by venue, by product, aging buckets (e.g. unredeemed 0–30/31–90/90+ days since issue)
- Card-level drill-down uses existing detail page
- Permission: GiftCardsRead and/or finance preset access

C4. HQ Analytics cross-venue gift card activity report
- Route under /admin/hq/... or /admin/gift-cards/hq-activity
- Filters: date range, venues, activity type issue|redeem|refund|void
- Tables/charts simple and on-brand (no fake BI product)
- KPI: Outstanding Card Liability matches catalog Feature KPI naming
- assertEnterpriseHqEnabled on data APIs
- hqOverview.ts: expose outstanding liability meter honestly for Enterprise entitled orgs when module enabled

C5. Export data
- GET /api/admin/gift-cards/export?format=csv (and/or json)
- Columns: public id, last4, kind, status, initialBalance, remainingBalance, currency, issue venue, issuedAt, expiresAt, recipientEmail (if permitted), channel — NEVER codeHash, NEVER raw code, NEVER HMAC secret
- Content-Disposition download; permission GiftCardsManage or GiftCardsExport
- activityLog export performed

C6. companyExport integration
- Include gift card counts + sum of remainingBalance outstanding liability totals (not secrets)
- Include ledger counts
- Redact codeHash

C7. Finance navigation + copy
- Admin nav links to Liability + Export
- Clear copy that this is internal accrual liability reporting, not QuickBooks sync
- README honesty: do not claim Feature 28 accounting integration

C8. Testing / smokes Phase 4
- Issue 100 → liability +100; redeem 40 → liability 60 and revenue 40
- Cross-venue redeem → payable/receivable pair nets correctly
- Void remaining → liability decreases without revenue
- Enterprise HQ report 200; Growth HQ rollup 403/upsell without data
- Export contains last4 not codeHash
- companyExport includes liability totals
- Phase 3 eligibility/POS still pass

================================================================================
C. WORKFLOWS PHASE 4
================================================================================

1. Finance opens Liability → sees outstanding matching sum of active remainingBalance
2. HQ admin runs cross-venue activity → sees issues/redeems by park; payable/receivable nets
3. Operator exports CSV for accountant → safe columns only
4. companyExport download includes gift liability section

================================================================================
D. COMPLETION CRITERIA PHASE 4
================================================================================

All B features C1–C8 done; reports ledger-correct; Enterprise gates hold; exports safe; no QuickBooks fake-complete; prior phases healthy.

STOP. Do not start Phase 5 until user asks (or continue only if user said START PHASE 5).
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
PHASE 4 FOLLOW-UP AUDIT — Gift Cards
SSOT: docs/gift-cards-complete-spec.md

Re-verify Phases 1–3. Fix any money-engine or eligibility regressions first.

================================================================================
CHECKLIST (EVERY PHASE 4 FEATURE)
================================================================================

[ ] C1 Accrual rules documented and computed from ledger (issue/redeem/void/expire)
[ ] C2 Payable/Receivable cross-venue reports; same currency; Enterprise gate; no rollup leak
[ ] C3 Liability admin views + aging
[ ] C4 HQ cross-venue activity report + Outstanding Card Liability KPI; soft-upsell non-Enterprise
[ ] C5 CSV/JSON export redaction
[ ] C6 companyExport liability totals
[ ] C7 Nav/copy honesty (not Feature 28)
[ ] C8 Smokes: liability math, cross-venue AR/AP, HQ deny, export redaction, regressions

Trace: issue → liability up → cross-venue redeem → liability down + payable/receivable → HQ report → export.

If anything incomplete/incorrect: FIX IT, re-test report arithmetic against raw ledger, re-check Enterprise isolation, re-check export secrets.

Only when verified reply exactly:
GIFT CARDS PHASE 4 AUDIT PASSED
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Gift Cards.
SSOT: docs/gift-cards-complete-spec.md
FINAL PHASE — hardening, full synchronization, production readiness.
Do not start unrelated modules.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

VERIFY PHASE 4 (and Phases 1–3). Fix ALL carry-forward defects before polish.
Confirm: foundation, issue/redeem/online, bulk/eligibility/POS/refund-to-GC, liability/HQ/export.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Make Gift Cards production-ready as one connected system: comprehensive smokes, rate limits, indexes, expiry handling, RBAC matrix updates, cross-feature synchronization, documentation/README/landing honesty, residual backlog explicitly listed, and an independent final audit with fixes.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 5 (DO NOT SKIP ANY)
================================================================================

C1. Full smoke suite
- scripts/smoke-gift-cards*.mts (or extend existing smoke runner patterns)
- Cases MUST include:
  1) Entitled Growth allow settings/issue/redeem
  2) Demo deny
  3) Starter deny
  4) Storefront/default org deny park gift ops
  5) Cross-tenant deny by id and by code
  6) Issue → redeem → balance invariant
  7) Online purchase idempotent settle (if test harness allows)
  8) Bulk issue cap + idempotency
  9) Multi-venue eligible allow / ineligible deny / currency mismatch
  10) POS balance/redeem parity with admin
  11) Refund-to-GC linkage
  12) Liability math sample
  13) Enterprise HQ allow / Growth HQ rollup deny
  14) Export redaction (no codeHash)
  15) Fashion Wallet untouched regression
  16) BookingPayment.giftCardId relation still valid

C2. Security hardening pass
- Rate limits on public purchase, balance, redeem, resend, bulk
- Confirm no plaintext codes at rest; raw code not in logs
- Confirm API_PERMISSIONS complete for every route added in Phases 1–4
- IDOR review on [id] routes
- Webhook signature verification still required for Stripe gift settle

C3. Performance / indexes
- Verify indexes: orgId+status, orgId+last4, orgId+codeHash unique, ledger giftCardId+createdAt, eligibility composites, recipientEmail
- List endpoints paginated
- Liability report acceptable on realistic sample sizes (document if snapshot needed)

C4. Expiry automation honesty
- Request-time expiry already required; add piggyback on existing daily cron to mark expired cards AND optional reminder emails if settings say so
- Do NOT add a third Vercel cron; piggyback remind-company-subscriptions or dedicated CLI/GH route only
- Ledger/meta note when auto-expired

C5. Cross-feature synchronization
- Ticketing: gift_card tender helper uses shared engine if booking payments exist
- POS spec routes present and documented
- Memberships/CRM: optional guest attach does not conflict
- HQ overview + companyExport + adminNav + permissions + moduleHints all consistent
- demoPlanLock still blocks Gift Cards
- Customer vs Tailor vs Admin surfaces still clean

C6. Documentation & honesty
- Update docs/gift-cards-complete-spec.md with completion notes / residuals
- README / landing: may say Gift Cards staff module is available for Growth+ ONLY if completion criteria met; otherwise keep roadmap honesty
- Explicit residual backlog examples:
  - Full POS terminal cart UI for gift SKUs inside mixed F&B sale
  - Live QuickBooks/Xero GL sync (Feature 28)
  - SMS delivery
  - Multi-currency FX conversion for cross-venue
  - Guest self-serve “my cards” portal polish if not shipped
  - Escheatment / legal breakage rules by US state (guides only if you add any — not legal advice)

C7. Final independent system audit + fixes
- Re-read Feature 10 catalog description and this SSOT scope list (digital/physical, preset/custom, T&Cs, issue channels, redeem channels, balance/liability, refund-to-GC, edit/resend, export, accrual, bulk, multi-venue HQ, payable/receivable, HQ activity, POS search/redeem)
- Trace full path through the app
- Fix every gap found; re-test; re-audit

C8. RBAC matrix / presets
- Update finance/ops/platform_admin presets appropriately (read vs manage)
- scripts that restore RBAC matrix include new permissions if such scripts exist

================================================================================
C. FINAL SYSTEM COMPLETION CRITERIA (ALL MUST BE TRUE)
================================================================================

1. Digital and physical cards supported with preset/custom amounts and T&Cs
2. Issue works at Venue Manager, online, and POS adapter; redeem works at Venue Manager, online hooks, and POS; balance always ledger-correct
3. Bulk issue works; edit details + resend/regenerate-email flows work
4. Booking refund-to-gift-card service exists and is wired or honestly linked
5. Multi-venue eligibility: buy one park / spend eligible same-currency parks; POS search/redeem across eligible venues
6. Accrual liability + payable/receivable reports; HQ cross-venue activity Enterprise-gated; safe exports; companyExport totals
7. Module entitlement Growth+/Enterprise; Demo/Starter/storefront fail-closed; RBAC registered
8. No fashion Wallet/Order misuse; codes hashed; cross-tenant isolation proven by smokes
9. All 5 phases audited; cross-feature sync done; residuals documented honestly
10. Shop commerce and control plane still operational

When ALL of the above are true, reply exactly:
GIFT CARDS FEATURE COMPLETE — PRODUCTION READY

If anything remains incomplete, do NOT print that string. Fix or list only true blockers after fixing everything fixable in-scope.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
PHASE 5 FOLLOW-UP AUDIT — Gift Cards (FINAL SYSTEM AUDIT)
SSOT: docs/gift-cards-complete-spec.md

Independent system-wide audit. Do not trust prior phase completion reports blindly.

================================================================================
MISSION
================================================================================

Review the final Gift Cards implementation against Feature 10 + this entire SSOT.
Trace: product/settings → eligibility → purchase/issue (online/VM/POS/bulk) → email/resend → balance → redeem (VM/POS/online/eligible venues) → refund-to-GC → ledger → liability/payable/receivable → HQ report → export → companyExport.

Verify every in-scope feature exists and works. Verify out-of-scope items are not fake-completed. Verify security, tenancy, Demo lock, no Wallet reuse, no plaintext codes, sync across ticketing/POS/HQ/admin, smokes present, residuals listed honestly.

If anything is missing, partial, incorrect, disconnected, duplicated, conflicting, insecure, or regressing other apps: FIX IT. Re-test. Re-check synchronization. Re-audit the fix.

================================================================================
MASTER CHECKLIST
================================================================================

Phase 1 foundation: [ ] entitlement [ ] extended GiftCard [ ] ledger/product/settings/eligibility [ ] admin shells [ ] nav/permissions [ ] HQ/export honesty
Phase 2 engine: [ ] issue [ ] redeem [ ] balance [ ] online Stripe purchase [ ] email/resend [ ] edit/void [ ] ledger integrity
Phase 3 ops: [ ] bulk [ ] eligibility enforcement [ ] POS adapters [ ] refund-to-GC [ ] cross-venue search/redeem [ ] one SSOT
Phase 4 finance: [ ] accrual liability [ ] payable/receivable [ ] HQ activity [ ] export [ ] companyExport KPI
Phase 5 harden: [ ] smokes [ ] rate limits [ ] indexes [ ] expiry cron honesty [ ] sync [ ] docs residuals [ ] RBAC presets

Surfaces: [ ] admin only for ops [ ] no tailor pollution [ ] no fashion profile operator tools [ ] Wallet untouched
Security: [ ] Fresh+module+Demo [ ] no client orgId trust [ ] code hashing [ ] export redaction [ ] webhook verify

Only when the product truly meets FINAL SYSTEM COMPLETION CRITERIA, reply exactly:
GIFT CARDS FEATURE COMPLETE — PRODUCTION READY
```

---

## Quick reference — phase order

1. Paste **PHASE 1 — EXECUTION PROMPT** → implement → paste **PHASE 1 — FOLLOW-UP AUDIT PROMPT**  
2. Paste **PHASE 2 — EXECUTION PROMPT** → implement → paste **PHASE 2 — FOLLOW-UP AUDIT PROMPT**  
3. Paste **PHASE 3 — EXECUTION PROMPT** → implement → paste **PHASE 3 — FOLLOW-UP AUDIT PROMPT**  
4. Paste **PHASE 4 — EXECUTION PROMPT** → implement → paste **PHASE 4 — FOLLOW-UP AUDIT PROMPT**  
5. Paste **PHASE 5 — EXECUTION PROMPT** → implement → paste **PHASE 5 — FOLLOW-UP AUDIT PROMPT**  

Never skip a phase. Never skip a feature letter (C1, C2, …) inside a phase. Every later phase begins by verifying the previous phase and fixing gaps before new work.
