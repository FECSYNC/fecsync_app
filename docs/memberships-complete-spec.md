# Memberships — Copy-and-Paste Execution Pack

**Product:** skyline360degree / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 08 — Memberships (Module: GUESTS / SELL) — full guest park membership commerce and entitlement engine  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 08 + Section E (Membership Engine) + Feature 09 Guest CRM hub attachment + Feature 17 membership reporting + Feature 21 Online Customer Account membership self-service; competitor brief Critical #8 Memberships.  
**Related slices (consume / share — do not fork vocabularies):**  
- `docs/pos-complete-spec.md` — `MembershipPlan`, `GuestMembership`, `GuestProfile`, POS sell/upgrade/downgrade/renew, membership line kinds, card print / photo at desk  
- `docs/check-in-complete-spec.md` — membership redemption snapshot, photo verify, custom membership IDs, card print (must call shared entitlement engine — not a second billing product)  
- `docs/digital-waivers-complete-spec.md` — `WaiverDocumentKind` `membership_contract`, link target `membership_plan`  
- `docs/online-booking-ticketing-complete-spec.md` — online checkout discount / verify hooks when booking exists  
- `docs/enterprise-hq-controls.md` — multi-venue HQ eligibility / home venue / rollups  
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
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as membership plans, guest memberships, entitlements, or recurring billing.
- Do **NOT** reuse staff `Membership` (org seat — `src/lib/membership.ts`, prisma `Membership`, scripts `ensure-memberships.mjs`, invite expiry) as guest park membership. Guest memberships are `GuestMembership` + `MembershipPlan` (+ `GuestProfile` hub).
- Do **NOT** reuse company SaaS Stripe fields on `Organization` (`stripeCustomerId` / `stripeSubscriptionId` for tenant billing) as guest membership subscriptions. Guest recurring billing uses `GuestProfile.stripeCustomerId` + `GuestMembership.stripeSubscriptionId` (separate Stripe Customer / Subscription objects).
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. Memberships may create/update `GuestProfile` rows and may optionally link an existing User. Never public client self-reg for operators. Guest online-account self-serve links only to already-authenticated users bound to a GuestProfile.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never runs park Memberships. Demo plan locks Memberships. Unpaid / pending / suspended orgs fail closed.
- Memberships module entitlement: `assertModuleEnabled(orgId, "memberships")` — **Growth + Enterprise only** (`moduleHints` includes `"memberships"` or `"all"`). Add `"memberships"` to Growth `moduleHints` in this epic. Starter (ticketing hint only) MUST 403. Demo empty + locked.
- Staff Venue Manager lives under `/admin/memberships*` and `/api/admin/memberships/*` (plus `/api/memberships/*` and thin `/api/pos/memberships/*` / check-in-compatible hooks — register every path in `API_PERMISSIONS`). Customer online account may manage **own** linked memberships — never operator catalog/billing tools. Tailor `/tailor/*` gets no Memberships ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Guest self-serve and print/wallet surfaces may use focused layouts but keep brand tokens.
- One connected system: ONE billing engine + ONE entitlement engine. POS sell, Check-In redeem, online verify, CRM profile, waivers agreements, and reporting all call the same libs under `src/lib/memberships/**`. Do not invent a second status vocabulary per surface.
- Do **not** fake-complete: Intercard/Sacoa/Amusement Connect, Kitchen Display, Feature 19 self-service ticket kiosk, dynamic pricing engine, OTA, live Apple/Google Wallet success without credentials, live Alvarado, reopen signup, claiming Feature 01/02/07/05 complete merely because substrate was created.

---

## Honest current-repo facts (post Phase 5 ship — re-inspect before extending)

- Control plane **is** shipped: Organization, VenueLocation, Membership (**staff seats**), RBAC, Demo lock, billing entitlement, HQ location scope, Stripe company SaaS, mailer, activityLog, companyExport, cron piggyback.
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet — **never** guest membership commerce.
- Guest park Memberships **Phases 1–5 are shipped**: `GuestProfile`, `MembershipPlan`, `GuestMembership`, payment/dunning/agreement/family/usage tables; `billingEngine` + `entitlementEngine`; admin `/admin/memberships/*`; guest `/api/me/memberships*` + profile tab; thin POS/Check-In adapters; `POST /api/memberships/verify` discount hook (not auto-wired into booking Checkout); `companyExport` includes redacted guest membership ledger tables (usage, payment attempts, family, agreements, cancel alternatives; caps apply).
- Live `Membership` / `src/lib/membership.ts` / invite scripts remain **staff org seats only** — never confuse with `GuestMembership`.
- Growth `moduleHints` include `"memberships"`; Enterprise `"all"` covers it. Demo/Starter/storefront/unpaid fail closed.
- Guest recurring Stripe Subscriptions use World D metadata (`GUEST_MEMBERSHIP_META_TYPE`) — never `Organization.stripeSubscriptionId`.
- Vercel Hobby ≤2 crons — memberships dunning piggybacks `/api/cron/remind-company-subscriptions` + dedicated `/api/cron/memberships-dunning` for CLI/GH.
- SMS dunning / live wallet signing (`.pkpass`/Google JWT not shipped — never `ready`) / Feature 19 kiosk / Postgres RLS / Waivers `membership_contract` deep link: see README Memberships residual backlog (honest, not faked).
- Beta UI: family, pause, cancel alternatives.
- Production smoke: `yarn smoke:memberships:p5` / `yarn smoke:memberships:all` (prefer local Postgres).

---

## Project understanding (for humans reading this file)

Memberships is the **full guest park membership commerce and entitlement engine**: recurring or fixed-term plans, flexible cycles, entitlements/perks, family/group plans, agreements, upgrades/downgrades with pro-rata, pause, cancel alternatives, smart and advanced dunning, self-serve account actions, member photos and custom IDs, card printing, digital wallet passes, recurring payment management, Venue Manager cancel, US click-to-cancel, sell/redeem/verify across POS / Venue Manager / online, upgrade non-membership products to memberships at POS, and multi-venue HQ memberships (buy at one park, redeem at eligible parks, home venue, shared usage, CURRENT / VISITING / INELIGIBLE, local perk customization).

It is **not** staff RBAC seats. It is **not** fashion shop subscriptions. It hangs off the company SaaS control plane and shares `GuestProfile` / plan / membership rows with POS, Check-In, Waivers, CRM, and Reporting.

**Surfaces**

- Company admin / Venue Manager: `/admin/memberships/*` (primary).
- Thin POS / Check-In hooks: shared engine; never a second SSOT.
- Guest online account (Feature 21 slice): manage own memberships only.
- Never operator tools on customer fashion `/profile` tabs that are shop-only, and never on `/tailor/*`. If guest park account lives under a dedicated guest account area, keep it separate from tailor studio and from company HQ tools.

**What to reuse / extend / create / replace**

- **Reuse:** Organization, VenueLocation, staff Membership/RBAC patterns, planLimits, demoPlanLock, staffOrg, requirePermissionFresh, permissions patterns, adminNav patterns, activityLog, companyExport, HQ overview honesty, smoke script pattern, rateLimit, mailer, Stripe helpers (without mixing org SaaS customers), CompanyProfile brand for cards/passes.
- **Extend:** permissions catalog, adminNav, ActivityEntityType / NotificationType, subscriptionPlans `moduleHints`, hqOverview module status, demoPlanLock allowlist (keep Memberships off Demo), actorLocationScope consumers, Stripe webhook router, daily cron piggyback, sibling POS/Check-In/Waivers hooks when present.
- **Create (if absent):** `moduleEntitlement`, `GuestProfile`, `MembershipPlan`, `GuestMembership`, entitlement defs / usage ledger, venue eligibility, settings, payment attempts, billingEngine, entitlementEngine, multiVenueStatus, dunning, admin Memberships UI, guest self-serve, smokes, this SSOT.
- **Replace:** nothing of fashion shop/tailor/staff seats. Do not replace staff Membership with GuestMembership.

---

## Scope (complete) vs non-goals

**In scope (this epic — every item must land inside one of the 5 phases):**

1. Recurring billing OR fixed-term memberships.
2. Flexible membership cycles (interval / billing schedule configuration on plans).
3. Membership entitlements (discounted entry, perks, free products, visit/entry limits).
4. Group and family memberships (**beta** — ship real linked members + shared usage; label UI beta).
5. Membership agreements (**Premium+** mapped to Growth + Enterprise) — contract sign/store; integrate Digital Waivers `membership_contract` when present.
6. Upgrades and downgrades with **pro-rata** charges / credits.
7. Pause memberships (**beta**).
8. Cancel alternatives before churn (**beta**).
9. Smart dunning — failed payment recovery (retries, past_due, recovery).
10. Advanced dunning (plan-dependent — deeper steps / work queue on Enterprise or as documented Growth vs Enterprise split).
11. Self-serve upgrade / renew / cancel via online accounts.
12. Member photos and custom membership IDs.
13. Membership card printing (CSS / `window.print`).
14. Digital wallet membership passes (honest `not_configured` until signed-pass issuance ships — env certs alone never report ready).
15. Recurring payment management (update card, apply credit, reactivate).
16. Cancel memberships from Venue Manager.
17. US click-to-cancel compliance (clear cancel path, no dark patterns, confirmation, audited).
18. Sell at POS; redeem / verify at POS, Venue Manager, and online checkout hooks.
19. Verify member benefits and remaining entitlements.
20. Upgrade non-membership product to membership at POS.
21. Multi-venue memberships (HQ):
    - Buy at one park, redeem at eligible parks.
    - Home venue concept; benefits travel with member when eligible.
    - Shared usage tracking (group-wide visit limits).
    - Member status labels: **CURRENT**, **VISITING**, **INELIGIBLE**.
    - Local benefit customization (remove/add perks per park).
22. Membership reporting (sold, active, churn, past_due, failed payments) + CRM GuestProfile linkage.
23. Entitlements, RBAC, Demo lock, HQ/export honesty, rate limits, cross-tenant isolation, smokes, docs honesty.

**Catalog Section E (must not weaken — map into phases):**

- Recurring Billing  
- Fixed Memberships  
- Family Memberships  
- Member Photos  
- Benefits / Entitlements  
- Membership Discounts  
- Membership Upgrade  
- Membership Downgrade  
- Membership Pause  
- Membership Cancel  
- Card Update  
- Failed-Payment Recovery  
- Digital Membership Card  
- Membership Reporting  
- Membership Customer Self-Service  

**Out of scope (do not fake-complete):**

- Full Intercard / Sacoa / Amusement Connect.
- Feature 19 self-service buy+check-in kiosk as a finished unattended commerce product.
- Dynamic pricing engine / OTA.
- Live Apple Wallet / Google Wallet success without real certificates/credentials.
- Claiming full POS / Check-In / Digital Waivers / Online Booking products complete merely because Memberships created shared substrate.
- Reopening `/signup`.
- Using staff `Membership` seats as park members.
- Mixing company SaaS Stripe subscription with guest membership subscriptions on the same org customer object as the sole guest bill-to (guests need their own Stripe Customer on GuestProfile).

---

## Dependency analysis (honest)

- **Control plane (shipped):** required — reuse.
- **GuestProfile:** required CRM hub. Create POS-compatible shape if absent; extend if present (ensure `stripeCustomerId` exists for Phase 2).
- **MembershipPlan / GuestMembership:** required. Create full Feature 08 shape if absent; if POS/Check-In created a thinner snapshot, EXTEND (statuses, stripe ids, home venue, family, etc.) — do not fork.
- **POS:** optional for Phase 1–2 admin sell. Phase 3 must integrate sell/redeem/upgrade-product hooks when POS exists; otherwise ship admin sell + stable `/api/pos/memberships*` adapters.
- **Check-In:** optional. Phase 3 entitlement verify/redeem must be the engine Check-In calls; if Check-In absent, ship admin redemption desk + compatible APIs.
- **Digital Waivers:** optional. Phase 4 agreements prefer `membership_contract`; else minimal agreement accept/store with honesty note.
- **Online Booking:** optional verify/discount hook in Phase 3/4.
- **Stripe:** required for real recurring when `STRIPE_SECRET_KEY` present; honest pending path when absent.
- **Cron:** piggyback — no third Vercel cron.
- **Enterprise HQ:** multi-venue eligibility + status labels; rollup reports only when `assertEnterpriseHqEnabled`.

**Uncertainty rule:** At Phase 1 start, inspect schema/libs. Prefer extend over duplicate. Map “Premium+” agreements to Growth+Enterprise. Wallet and SMS: honest degradation.

---

## Five-phase roadmap (names only)

- **PHASE 1** — Foundation, Entitlement, Schema, Plan Catalog, Eligibility & Admin Shells  
- **PHASE 2** — Billing & Lifecycle Engine (Sell, Recurring/Fixed, Pro-Rata, Pause, Cancel, Dunning, Payment Management)  
- **PHASE 3** — Entitlements, Family, Multi-Venue HQ, Channel Redeem/Verify, Photos, IDs, Cards, Wallet, Product→Membership  
- **PHASE 4** — Self-Service, Click-to-Cancel, Cancel Alternatives, VM Cancel, Agreements, CRM, Reporting, Advanced Dunning  
- **PHASE 5** — Final System Audit, Smokes, Cross-Feature Sync, Docs Honesty & Production Readiness  

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Memberships (Feature 08 — guest park memberships).
SSOT: docs/memberships-complete-spec.md
Execute ONLY Phase 1. Do NOT implement Stripe subscription charges, dunning retries, guest self-serve portal, digital wallet issuance success, family redemption UI completion, click-to-cancel, cancel alternatives, advanced dunning work queues, or full membership reporting aggregations yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for park members).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park Memberships. Never locked by tenant expiry for storefront catalog, but park modules stay registered-company entitled.

Memberships is Feature 08. Module IA: GUESTS / SELL.
Primary staff surfaces: /admin/memberships*, /api/admin/memberships/* (register all paths). Also prepare thin /api/memberships/* and /api/pos/memberships/* route namespaces as needed — register every path in API_PERMISSIONS.

Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "memberships").
- Every park business row: orgId required + locationId when park-specific (FK VenueLocation; assert venue.orgId === orgId). Org-default plans/settings may use locationId null.
- Company admin under /admin/*. Guest online account: own memberships only (Phase 4). Tailor studio: no Memberships ops.

Shop commerce (Product, Cart, Order, Wallet) is fashion retail. Do NOT store membership plans, guest memberships, entitlements, or recurring invoices there.
Company SaaS Stripe on Organization is tenant billing. Do NOT reuse Organization.stripeCustomerId / stripeSubscriptionId as the guest membership bill-to.

Name collisions to avoid:
- staff Membership ≠ GuestMembership
- shop Order ≠ PosSale / membership invoice
- shop Wallet ≠ membership credit balance
- company Stripe subscription ≠ guest Stripe subscription
- Profile (shop user profile) ≠ GuestProfile (park CRM)

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, activityLog.ts, companyExport.ts, hqOverview.ts, smoke scripts, rateLimit.ts, mailer.ts, stripe.ts helpers (without mixing org SaaS customers), TaxSettings, CompanyProfile / resolveBrandForOrg patterns.

Sibling dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/ for guests, memberships, pos, checkin, waivers, ticketing, moduleEntitlement.
2. IF GuestProfile / MembershipPlan / GuestMembership / PosProduct(membership_plan) already exist: REUSE and EXTEND to full Feature 08 shape. Do not duplicate or invent ParkMember / SeasonPassAccount parallels.
3. IF they do NOT exist: CREATE the foundation models now using the SAME names sibling specs already use (GuestProfile, MembershipPlan, GuestMembership) plus Memberships-native tables (eligibility, settings, entitlement defs/usage, payment attempt stub).
4. Create or extend src/lib/moduleEntitlement.ts assertModuleEnabled — one helper for the whole product.
5. Put NEW guest-membership libs under src/lib/memberships/** — NEVER overload src/lib/membership.ts (staff seats).

Catalog depth you are founding (do not weaken later; Phase 1 only builds the substrate/config):
- Recurring billing or fixed-term
- Flexible membership cycles
- Membership entitlements (discounted entry, perks, free products)
- Group & family memberships (beta) — schema + plan flags in Phase 1; commerce/redeem later
- Membership agreements (Premium+ = Growth+Enterprise) — fields/hooks in Phase 1; signing Phase 4
- Upgrades & downgrades with pro-rata — plan upgradeGroupKey in Phase 1; engine Phase 2
- Pause (beta), cancel alternatives (beta) — status/fields Phase 1–2; alternatives UI Phase 4
- Smart dunning + advanced dunning — tables Phase 1; engine Phase 2; advanced Phase 4
- Self-serve — Phase 4
- Member photos & custom IDs — fields Phase 1; UX Phase 3
- Card printing & digital wallet — Phase 3
- Recurring payment management — Phase 2
- Cancel from Venue Manager + US click-to-cancel — Phase 4 (VM cancel action shell may appear Phase 2 with engine)
- Sell at POS / redeem at POS/VM/online / verify benefits — Phase 2 sell admin + Phase 3 redeem/verify
- Upgrade non-membership product to membership at POS — Phase 3
- Multi-venue HQ: buy one park / redeem eligible parks, home venue, shared usage, CURRENT|VISITING|INELIGIBLE, local perk customization — config Phase 1; enforce Phase 3

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: enable Memberships for the company, open Memberships admin shells, configure org/location MembershipSettings, CRUD MembershipPlan catalog (recurring and fixed, flexible cycles, entitlement JSON, family/group flags, upgrade group keys, agreement-required flags), configure multi-venue MembershipVenueEligibility (eligible parks, local perk add/remove), manage home-venue defaults, search/create minimal GuestProfile CRM hub rows, see an empty or read-only Members list shell, and fail closed on Demo/Starter/storefront/unpaid/pending/suspended. Schema for the FULL membership engine foundation is migrated now (even if billing APIs arrive in Phase 2). HQ/export recognize the module honestly without fake KPIs. NO live Stripe membership charges, NO dunning runner, NO guest self-serve, NO redeem consumption engine in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden for park Memberships ops
  5) plan.moduleHints includes the module OR "all"
- assertMembershipsEnabled(orgId) thin wrapper used by all Memberships APIs.
- Add "memberships" to Growth moduleHints in src/lib/subscriptionPlans.ts (keep Enterprise "all").
- Starter MUST 403 Memberships. Demo MUST 403. Unpaid/pending/suspended fail closed via existing billing helpers.
- Update FuturePlanModules / comments so memberships is an enforceable module hint, not a silent story-only string.
- Update hqOverview module status vocabulary to include memberships honestly (not_enabled until entitled+shipped paths exist — never fake active member counts).

C2. Plan / meter honesty
- Memberships itself is module-gated (Growth+). Do not invent a fake per-member metered bill unless you also enforce it — prefer unlimited members on Growth/Enterprise for v1 OR document a soft operational cap in settings without lying in PlanLimits.
- If you add a PlanLimits resource (e.g. membershipPlans or activeGuestMemberships), enforce it on CREATE and document caps: demo=0, starter=0, growth=<reasonable>, enterprise=null. Prefer not blocking ops with a surprise cap; if unsure, module gate only + no fake meter.
- Multi-venue eligibility editor: Enterprise HQ may manage cross-park eligibility. Growth may sell/redeem at a single home venue with eligibility rows still allowed for future upgrade — do NOT leak Enterprise HQ rollup KPIs to non-Enterprise (assertEnterpriseHqEnabled on HQ rollup routes).

C3. Complete Prisma schema + migration (create ALL Memberships foundation tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped rows: locationId FK VenueLocation unless noted.
Extend ActivityEntityType with: MembershipPlan, GuestMembership, GuestProfile (if new), MembershipVenueEligibility, MembershipSettings, MembershipUsageEvent (or equivalent), MembershipPaymentAttempt (or equivalent), MembershipFamilyLink (or equivalent), MembershipAgreement (if distinct).
Extend NotificationType with: membership (or reuse alert) for lifecycle/dunning later.

Enums (exact names — align with POS spec; do not invent parallels):
- MembershipPlanBilling: recurring | fixed
- GuestMembershipStatus: active | past_due | paused | cancelled | expired | pending
- MembershipVisitStatus (computed and/or stored snapshot for multi-venue): CURRENT | VISITING | INELIGIBLE
- MembershipPaymentAttemptStatus: pending | succeeded | failed | skipped | cancelled (or equivalent clear vocabulary)
- Keep credentialType membership on TicketCredential if that model exists / is created elsewhere — do not fork.

GuestProfile (create if absent; EXTEND if present — park CRM hub):
- id, orgId, locationId?, userId? (optional link to User — do NOT auto-create shop User / do NOT reopen signup)
- firstName, lastName (or displayName compatible with Check-In minimal — prefer first/last + computed display; if Check-In already shipped displayName-only, extend carefully without breaking)
- email?, phone?, dateOfBirth?, photoUrl?, postalCode?
- stripeCustomerId? (REQUIRED column for Phase 2 even if unused in Phase 1)
- bannedAt?, bannedReason?, notes
- createdAt, updatedAt, createdById?
- Indexes: orgId+email, orgId+phone, name search
- Distinct from shop Profile and staff Membership

MembershipPlan:
- orgId, locationId? (null = org-default plan; park-specific plans allowed)
- name, description?, billing MembershipPlanBilling (recurring|fixed)
- intervalCount Int? + intervalUnit enum day|week|month|year (flexible cycles) OR intervalMonths Int? — pick ONE flexible model and document it; support at least monthly and custom month counts
- price, currency
- entitlements Json — MUST be able to express: entries/visits per period, discountPercent, guestCount / family size, perk flags, freeProductRefs / free SKU ids, other perk keys
- familyAllowed boolean (beta feature flag at plan level)
- upgradeGroupKey? (plans that can upgrade/downgrade among themselves)
- agreementRequired boolean (Premium+/Growth+ agreements)
- pauseAllowed boolean default true (beta)
- archivedAt?
- createdAt, updatedAt
- NOT staff Membership

GuestMembership:
- orgId, locationId (sell/home location — home venue; required when park-scoped sell)
- homeLocationId (explicit home venue; may equal locationId — do not omit multi-venue concept)
- guestProfileId, planId
- status GuestMembershipStatus
- startsAt, endsAt?, currentPeriodStart?, currentPeriodEnd?
- stripeSubscriptionId?, stripePriceId? optional
- customMembershipId unique per org
- barcodeOrCode? / qrPayload?
- photoUrl? (may mirror guest photo)
- familyEntitlements Json? (remaining qty / member guest ids) AND/OR normalized MembershipFamilyLink rows
- createdFromSaleId? / source channel enum admin|pos|online|other
- pauseStartsAt?, pauseEndsAt?
- cancelAtPeriodEnd boolean?, cancelledAt?, cancelReason?
- creditBalance? (minor units) or separate credit ledger
- agreementSignedAt?, agreementRecordId?
- createdAt, updatedAt

MembershipFamilyLink (or equivalent — required for family beta foundation):
- orgId, guestMembershipId, guestProfileId, role primary|dependent, createdAt
- unique (guestMembershipId, guestProfileId)

MembershipEntitlementDef (optional normalized) AND/OR plan.entitlements Json as SSOT:
- If normalized: orgId, planId, kind entry|discount|perk|free_product|other, config Json, active
- Prefer one SSOT; Json on plan is OK if entitlementEngine can read it — document choice

MembershipUsageEvent (usage ledger — create now):
- orgId, locationId, guestMembershipId, guestProfileId?
- kind visit|redeem|discount_applied|perk_consumed|free_product|adjustment|undo
- qty, remainingAfter?, meta Json?
- actorUserId?, source admin|pos|checkin|online|system
- createdAt
- Indexes for orgId+guestMembershipId+createdAt

MembershipVenueEligibility:
- orgId, planId, locationId
- eligible boolean
- localPerksAdd Json? (extra perks at this park)
- localPerksRemove Json? (remove base plan perks at this park)
- unique (planId, locationId)

MembershipSettings:
- orgId, locationId? (null = org default)
- requirePhotoOnRedeem boolean?
- requireAgreementBeforeActive boolean?
- dunningEnabled boolean default true
- clickToCancelEnabled boolean default true
- cancelAlternativesEnabled boolean default true (beta)
- graceDays Int?
- allowPause boolean default true
- walletPassEnabled boolean default false
- other Json? for forward compat
- unique org+location default pattern consistent with sibling settings models

MembershipPaymentAttempt (stub table now; write in Phase 2):
- orgId, guestMembershipId, stripeInvoiceId?, stripePaymentIntentId?
- amount, currency, status, attemptNumber, errorCode?, errorMessage?, createdAt

MembershipCancelAlternative (config stub OK in Phase 1; used Phase 4):
- orgId, locationId?, name, kind pause_offer|discount|downgrade|message, config Json, active, sortOrder

MembershipAgreement (minimal if waivers absent):
- orgId, guestMembershipId?, guestProfileId, planId?
- status draft|signed|void, signedAt?, bodyVersion?, storageRef?
- If Digital Waivers models exist, prefer FK to WaiverRecord instead of duplicating signature blobs

C4. Permissions + presets
Add to P and PERMISSION_CATALOG + API_PERMISSIONS + ADMIN_ROUTE_PERMISSIONS (names may be memberships:*):
- memberships:read — view plans, members, reports shells
- memberships:write — create/edit plans, settings, eligibility, guest profiles for memberships
- memberships:sell — sell/renew (Phase 2; register now)
- memberships:billing — upgrade/downgrade/pause/cancel/reactivate/card/credit/dunning ops
- memberships:cancel — explicit cancel permission (VM + self-serve staff assist)
- memberships:redeem — verify/redeem entitlements (Phase 3)
- memberships:admin — module settings / destructive archive

Map presets:
- platform_admin: all
- ops_manager: read+write+sell+billing+cancel+redeem
- finance: read+billing+cancel
- catalog_editor: read+write plans only (no billing) unless you document otherwise
- Prefer RoleTemplate + bits over breaking MembershipRolePreset renames; if you add presets, update every switch.

C5. Nav + routes (shells)
- Admin nav: Memberships group (or under Guests/Sell):
  - Plans `/admin/memberships/plans`
  - Members `/admin/memberships/members`
  - Eligibility (multi-venue) `/admin/memberships/eligibility`
  - Settings `/admin/memberships/settings`
  - Reports `/admin/memberships/reports` (placeholder shell Phase 1 — “reporting ships Phase 4”)
- Register every path in ADMIN_ROUTE_PERMISSIONS. Unknown /admin/* still fail closed.
- Demo lock: none of these are demo-allowed paths.
- Pages Phase 1 = real plan/settings/eligibility CRUD quality; Members list may be empty-state; Reports placeholder OK; no payment capture.

C6. Admin APIs (Phase 1)
All: requirePermissionFresh + requireActorOrgId + assertMembershipsEnabled + venue belongs to org when locationId used. Never client orgId.
- GET/POST /api/admin/memberships/plans
- GET/PATCH/DELETE (archive) /api/admin/memberships/plans/[id]
- GET/PUT /api/admin/memberships/settings
- GET/PUT /api/admin/memberships/eligibility (matrix by plan × location)
- GET/POST /api/admin/memberships/guests (GuestProfile search/create minimal)
- GET /api/admin/memberships/members (list/filter; may return [])
- Do NOT create Stripe subscriptions in Phase 1.

C7. Frontend admin shells
- Plans: create/edit recurring vs fixed, interval/cycle, price, currency, entitlements editor (entries, discount%, guestCount/family, perks, free products), familyAllowed, upgradeGroupKey, agreementRequired, archive
- Eligibility: for each plan, select eligible venues; per venue localPerksAdd / localPerksRemove
- Settings: photo/agreement/dunning/pause/click-to-cancel/cancel-alternatives toggles (even if enforced later)
- Members: search shell + empty state
- Use existing admin gold #D4AF37 / stone layouts

C8. companyExport + HQ honesty
- Export includes memberships module tables when present (no hard-delete).
- HQ overview: module status honest; no fake “Active Members” KPI until Phase 4 reports exist (placeholder 0 / not_ready is OK if labeled honest).

C9. Activity log
- Log plan create/update/archive, settings changes, eligibility changes, guest create from memberships admin.

C10. Smoke + docs
- Smoke script: entitled Growth/Enterprise allow plan CRUD; Demo/Starter/storefront/cross-tenant deny.
- Keep README from claiming Memberships complete. This SSOT is the execution pack.
- Ensure staff seat scripts/libs still work unchanged.

C11. Libraries skeleton (no billing yet)
- src/lib/memberships/types.ts
- src/lib/memberships/plans.ts (CRUD helpers)
- src/lib/memberships/eligibility.ts
- src/lib/memberships/assert.ts (assertMembershipsEnabled re-export)
- Comment stubs for billingEngine.ts / entitlementEngine.ts / dunning.ts to be filled later — OR omit empty files; do not ship fake “complete” engines.

================================================================================
D. WORKFLOWS PHASE 1 MUST SUPPORT
================================================================================

BEFORE: entitled org, at least one VenueLocation for park-scoped eligibility tests.
START: admin opens Memberships → Plans.
DURING: create recurring and fixed plans; set entitlements; set familyAllowed; set upgradeGroupKey; configure eligibility across parks; set home-venue default in settings or plan.
SUCCESS: plans persisted; eligibility rows saved; unauthorized actors 403.
FAILURE: validation errors for missing name/price/billing; location not in org.
REPEAT: archive + recreate; customMembershipId uniqueness reserved for Phase 2 sells.
REVERSAL: archive plan (do not hard-delete if GuestMembership rows may reference later).
SECURITY: only memberships:write/admin.
CONSISTENCY: moduleHints + assertMembershipsEnabled + nav + API all agree.

================================================================================
E. INTEGRATIONS / SECURITY / ERRORS / EDGES / TESTING
================================================================================

Integrations: control plane only; if PosProduct exists, allow membershipPlanId FK linkage read-only or plan picker prep — do not require POS checkout.
Security: Fresh permissions; org isolation; storefront/Demo deny; never trust client orgId/locationId; no PAN storage.
Errors: 403 entitlement, 404 cross-tenant, 400 validation, 409 duplicate eligibility unique.
Edges: Growth single-venue vs Enterprise multi-venue editor; archived plan hidden from sell pickers later; null locationId org-default plan; timezone display uses VenueLocation.timezone where shown.
Testing: unit/assert tests for module gate; API smokes allow/deny; migration applies cleanly; staff Membership invite flow still green.

================================================================================
F. COMPLETION CRITERIA — PHASE 1
================================================================================

1. docs/memberships-complete-spec.md is the SSOT (this file) and matches implementation vocabulary.
2. assertMembershipsEnabled works; Growth has "memberships" hint; Starter/Demo/storefront denied.
3. Prisma models migrated for full foundation listed above.
4. Admin can CRUD plans, settings, eligibility; guests search/create minimal; members list shell works.
5. Permissions + nav registered; export/HQ honest; smokes green.
6. No Stripe guest subscription creates; no redeem consumption; shop + staff seats unchanged.
7. STOP for Phase 1 follow-up audit. Do not start Phase 2.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Memberships Phase 1 ONLY.
SSOT: docs/memberships-complete-spec.md

You are auditing Phase 1 of Feature 08 Memberships. Do not implement Phase 2+.

================================================================================
AUDIT MISSION
================================================================================

Deep-audit EVERY Phase 1 requirement in the Phase 1 execution prompt (sections A–F and every C1–C11 item). Verify features, sub-features, files, components, dependencies, workflows, data consistency, integration points, synchronization, security, access control, validation, error handling, edge cases, regression risks.

Explicitly verify these Phase 1 feature foundations exist and are wired (not merely mentioned):
- Module entitlement "memberships" (Growth+; Demo/Starter/storefront fail closed)
- GuestProfile hub (with stripeCustomerId column) — not shop Profile, not staff Membership
- MembershipPlan recurring|fixed + flexible cycles + entitlements JSON + familyAllowed + upgradeGroupKey + agreementRequired
- GuestMembership full foundation fields including homeLocationId, statuses, customMembershipId uniqueness per org
- MembershipVenueEligibility with local perks add/remove
- MembershipSettings
- Family link model and usage/payment-attempt stubs
- Admin shells: Plans, Members, Eligibility, Settings, Reports placeholder
- Permissions memberships:* + API_PERMISSIONS + adminNav
- companyExport + hqOverview honesty (no fake KPIs)
- Smokes: entitled allow + cross-tenant/Demo/Starter deny
- Libs under src/lib/memberships/** without polluting src/lib/membership.ts staff seats

Hunt for:
- Missing / partial / incorrect / disconnected / unused / duplicate / conflicting implementation
- Client-trusted orgId/locationId
- Parallel tables when reuse of sibling names was required
- Shop Order/Wallet pollution
- Organization Stripe customer reused as guest bill-to
- Staff Membership overloaded as park member
- Fake “billing complete” claims

If ANYTHING is incomplete or incorrect: FIX IT. Do not only report.
After each fix: re-check the fix, re-test the affected workflow, re-check synchronization and related functionality.

Regression check: fashion shop, staff invites/RBAC, company billing still work.

Only when everything is verified reply exactly:
PHASE 1 AUDIT PASSED
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Memberships (Feature 08).
SSOT: docs/memberships-complete-spec.md
Execute ONLY Phase 2.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Verify Phase 1 completely against docs/memberships-complete-spec.md Phase 1 completion criteria and audit expectations.
If you find missing functionality, partial implementation, bugs, incorrect implementation, broken dependencies, data inconsistencies, security issues, workflow issues, integration issues, synchronization problems, regression problems, or testing gaps:
- FIX THEM FIRST
- Re-test the fix
- Confirm Phase 1 is stable
Only then implement Phase 2.
Do not blindly assume Phase 1 was completed correctly.
Do not expand scope beyond Memberships correctness.

================================================================================
A. CONTEXT
================================================================================

Phase 2 ships the billing & lifecycle engine for guest park memberships.
Still forbidden: guest self-serve portal UI (Phase 4), click-to-cancel guest UX (Phase 4), cancel alternatives offers UI (Phase 4), digital wallet pass success theater, full reporting dashboards (Phase 4), claiming POS/Check-In complete.

Staff admin + APIs MUST be able to sell and manage lifecycle now.
If STRIPE_SECRET_KEY is present: create real Stripe Customer on GuestProfile + Subscription for recurring plans.
If absent: honest pending / amount-collected-at-sell path — NEVER fake silent recurring invoice success.

One engine: src/lib/memberships/billingEngine.ts (name may vary but must be singular SSOT).
POS membership sell (if POS exists) MUST call this engine — no second billing path.

================================================================================
B. PHASE 2 OBJECTIVE
================================================================================

A staff operator with memberships:sell / memberships:billing can: sell new memberships (recurring or fixed), renew, upgrade and downgrade with pro-rata charges/credits, pause (beta) and resume, cancel (immediate or end-of-period), reactivate when policy allows, update stored payment method, apply account credit, and recover failed payments via smart dunning (past_due → retries → recover or cancel path). Webhooks and cron piggyback keep status synchronized. Member detail admin UI supports these actions. Family plan sell may attach primary + dependents at sell time if schema ready (full family redeem remains Phase 3).

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

C1. billingEngine core
- sellMembership({ orgId, locationId, homeLocationId, guestProfileId, planId, familyMemberIds?, paymentMethod, collectedAmount?, actorUserId, idempotencyKey, source })
- renewMembership
- upgradeMembership (pro-rata charge)
- downgradeMembership (pro-rata credit / effective-date rules — document immediate vs period-end; implement one clear default + plan settings)
- pauseMembership (beta) / resumeMembership
- cancelMembership({ when: immediate | end_of_period, reason })
- reactivateMembership
- updatePaymentMethod
- applyCredit
- Status transitions must be explicit and invalid transitions must 400

C2. Recurring billing OR fixed-term + flexible cycles
- Recurring: Stripe Subscription aligned to plan intervalCount/intervalUnit (or intervalMonths)
- Fixed: endsAt from cycle rules; no endless silent renew unless plan says renew
- Flexible cycles from Phase 1 plan fields honored
- Write GuestMembership period fields currentPeriodStart/End when applicable

C3. Stripe integration (guest — not company SaaS)
- Ensure GuestProfile.stripeCustomerId created/linked when charging
- GuestMembership.stripeSubscriptionId for recurring
- Webhook metadata.type = guest_membership_subscription (and related events you need: invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted)
- Extend existing Stripe webhook handler; signature verify; idempotent
- NEVER settle fashion shop Order from these events
- NEVER mutate Organization.stripeSubscriptionId from guest events

C4. Pro-rata upgrades & downgrades
- src/lib/memberships/proration.ts
- Compute amount due / credit from remaining period time and plan price difference
- Persist payment attempt + creditBalance updates
- Only among plans sharing upgradeGroupKey (unless admin override permission documented)

C5. Pause (beta)
- Sets status paused; stops benefits consumption in engine flags (entitlementEngine may fully enforce in Phase 3 — Phase 2 must at least set status and billing pause)
- Stripe pause/collection behavior when subscribed; honest manual status if no Stripe
- resume restores active + billing

C6. Cancel + reactivate
- end_of_period: cancelAtPeriodEnd; remain active until period end then cancelled/expired
- immediate: cancelled now; revoke entitlements effective immediately
- reactivate rules: only from cancelled/expired/paused per documented policy; may require new payment

C7. Recurring payment management
- Update card / default payment method (Stripe SetupIntent or Billing Portal session for guest customer — staff-initiated OK in Phase 2)
- Apply credit (manual adjustment audited)
- Reactivate path uses stored method when present

C8. Smart dunning — failed payment recovery
- src/lib/memberships/dunning.ts
- On payment_failed: status past_due; enqueue MembershipPaymentAttempt failed; schedule retries (e.g. day 0/3/5/7 configurable via settings.graceDays)
- On success: restore active; clear past_due
- Exhausted retries: cancel or leave past_due per settings — document choice; default cancelAtPeriodEnd or suspend benefits while past_due
- Email via mailer on fail/recover (SMS only if provider configured)

C9. Cron piggyback (no 3rd Vercel cron)
- Hook daily /api/cron/remind-company-subscriptions (or existing daily cron) to run membership dunning ticks + fixed-term expiry transitions
- Also provide /api/cron/memberships-dunning (CRON_SECRET) for CLI/GH
- Idempotent ticks

C10. Admin APIs + Member detail UI
- POST sell, renew, upgrade, downgrade, pause, resume, cancel, reactivate
- POST payment-method update, apply credit
- GET member detail with plan, status, periods, attempts, credits, family links
- UI: action panels + past_due banners + confirmation modals
- activityLog every money/lifecycle mutation

C11. POS bridge (if POS present)
- Pos line kind membership / product kind membership_plan checkout must call billingEngine.sellMembership / upgrade / downgrade / renew
- If POS absent: document adapter functions exported for POS Phase 2 later

C12. Idempotency & concurrency
- Idempotency keys on sell and payment attempts
- Webhook replay safe
- Double-sell same key does not create two GuestMemberships

C13. Tests
- State machine unit tests
- Proration edge tests (start, mid-cycle, last day)
- Webhook idempotency
- Dunning schedule
- Permission denies
- Stripe missing → honest pending path

================================================================================
D. WORKFLOWS (ANALYZE EACH)
================================================================================

Sell recurring:
BEFORE plan active + guest; START sell; DURING create membership pending/active + Stripe sub; SUCCESS active + attempt succeeded; FAILURE past_due/pending + error; REPEAT idempotent; REVERSAL cancel/refund policy documented (refund may be Phase 4/5 minimal — at least do not corrupt ledgers).

Upgrade:
BEFORE active membership + higher plan same upgradeGroupKey; DURING proration charge; SUCCESS new planId + payment attempt; FAILURE keep old plan.

Pause / Cancel / Dunning:
Cover success, failure, repeat, security (memberships:billing / memberships:cancel), consistency with Stripe and DB status.

================================================================================
E. SECURITY / ERRORS / EDGES
================================================================================

Security: money mutations need memberships:billing (cancel may use memberships:cancel); org isolation; no raw PAN; rate limit sensitive endpoints.
Errors: structured codes (PLAN_ARCHIVED, INVALID_TRANSITION, PRORATION_FAILED, STRIPE_NOT_CONFIGURED, PAYMENT_FAILED, FAMILY_NOT_ALLOWED).
Edges: pause while past_due; cancel already cancelled; upgrade to archived plan; currency mismatch; subscription deleted externally; Demo still 403.

================================================================================
F. COMPLETION CRITERIA — PHASE 2
================================================================================

1. Phase 1 still green after verification/fixes.
2. Admin can sell recurring+fixed, renew, pro-rata up/down, pause/resume, cancel, reactivate, update card, apply credit.
3. Smart dunning + webhooks + cron piggyback keep statuses correct.
4. Stripe honesty without keys.
5. Single billingEngine SSOT; POS bridged if present.
6. Tests/smokes for lifecycle green.
7. STOP for Phase 2 audit. Do not start Phase 3.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Memberships Phase 2 ONLY.
SSOT: docs/memberships-complete-spec.md

First confirm Phase 1 still intact (entitlement, schema, plan catalog, eligibility, admin shells). If not, FIX before continuing the Phase 2 audit.

Then deep-audit EVERY Phase 2 feature — do not skip any:
- billingEngine sell / renew / upgrade / downgrade / pause / resume / cancel / reactivate
- Recurring billing and fixed-term with flexible cycles
- Pro-rata charges/credits
- Pause (beta) behavior + billing pause
- Smart dunning / past_due / retries / recover
- Update payment method, apply credit, reactivate
- Stripe guest Customer/Subscription separation from Organization SaaS billing
- Webhook signature + idempotency + no shop Order settlement
- Cron piggyback (no 3rd Vercel cron)
- Admin member detail UI actions
- POS bridge to same engine if POS exists
- Idempotency / concurrency
- Permissions memberships:sell / billing / cancel
- Error codes and invalid transitions
- Edge cases listed in Phase 2 prompt

Hunt missing/partial/incorrect/disconnected/unused/duplicate/conflicting implementation.
If anything is wrong: FIX IT, re-test money paths, re-check webhook replay and status sync, re-check related Phase 1 config still works.

Do not implement Phase 3+.

Only when fully verified reply exactly:
PHASE 2 AUDIT PASSED
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Memberships (Feature 08).
SSOT: docs/memberships-complete-spec.md
Execute ONLY Phase 3.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Verify Phases 1–2 completely. Fix any carry-forward gaps/bugs/security/sync issues first, re-test, then continue. Do not assume prior phases were perfect.

================================================================================
A. CONTEXT
================================================================================

Phase 3 ships entitlements enforcement, family/group (beta), multi-venue HQ behavior, channel verify/redeem, photos, custom IDs, card printing, digital wallet (honest), and upgrade non-membership product → membership at POS.

ONE entitlementEngine SSOT under src/lib/memberships/. Check-In and POS must call it — never fork remaining-visit math.

================================================================================
B. PHASE 3 OBJECTIVE
================================================================================

Operators can verify member benefits and remaining entitlements; redeem/consume visits/perks at Venue Manager and via POS/Check-In/online hooks; run family/group shared usage (beta); honor multi-venue eligibility with status labels CURRENT / VISITING / INELIGIBLE and local perk customization; capture member photos; assign custom membership IDs; print membership cards; offer digital wallet passes with honest `not_configured` until signed-pass issuance ships (env certs alone never report ready); upgrade a non-membership product/sale line into a membership at POS (or API adapter).

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 3 (DO NOT SKIP ANY)
================================================================================

C1. Benefits / entitlements engine
- src/lib/memberships/entitlementEngine.ts
- verifyBenefits(guestMembershipId, locationId) → remaining entries, discountPercent, perks, free products, pause/past_due/cancelled blocks
- consumeBenefit / redeemVisit with MembershipUsageEvent ledger
- Membership discounts rule application helper for POS/online quote hooks
- Undo/reverse consume when permissioned (align with check-in undo patterns if present)

C2. Group & family memberships (beta)
- Manage dependents via MembershipFamilyLink
- Shared usage tracking (group-wide visit limits from plan.entitlements / familyEntitlements)
- Partial redeem: select which guests consume
- UI labeled beta where appropriate
- Sell path from Phase 2 must remain compatible

C3. Multi-venue memberships (HQ) — ALL sub-bullets mandatory
- Buy at one park (homeLocationId / locationId), redeem at eligible parks per MembershipVenueEligibility
- Home venue concept; benefits travel with member when eligible
- Shared usage tracking across parks for the same membership/family cap
- Compute member status labels at a given venue:
  - CURRENT — acting at home venue (or designated home)
  - VISITING — eligible non-home venue
  - INELIGIBLE — venue not eligible or local rules block
- Local benefit customization: apply localPerksAdd / localPerksRemove when verifying at that park
- Enterprise HQ eligibility management already in Phase 1 — Phase 3 enforces at redeem time

C4. Sell at POS / redeem at POS / VM / online
- Admin/VM redemption desk UI (search membership, show photo, remaining, family select, redeem)
- If POS exists: wire sell (already Phase 2 engine) + redeem/verify into POS check-in/membership actions
- If Check-In exists: replace/extend snapshot redeem to call entitlementEngine (individual + group)
- Online checkout verify hook: API that booking/checkout can call to validate membership discount / eligibility (implement stable route even if booking module absent)

C5. Verify member benefits & remaining entitlements
- Dedicated verify API + UI panel used before redeem
- Clear structured response for blocked reasons (paused, past_due, expired, ineligible venue, exhausted, agreement missing)

C6. Upgrade non-membership product to membership at POS
- API: given a PosSaleLine / product / open sale context (or adapter input if POS absent), convert/upgrade to MembershipPlan sell via billingEngine
- Permissioned; audited; idempotent
- Do not corrupt original sale ledger — follow POS refund/adjust patterns if present; else document compensating sale line

C7. Member photos & custom IDs
- Upload/capture photo on GuestProfile and/or GuestMembership.photoUrl
- Assign/lookup customMembershipId unique per org
- Display on redeem + print

C8. Membership card printing
- Print CSS / window.print card: name, custom membership id, QR/code, org/venue brand from CompanyProfile when available
- Reuse patterns from Check-In/POS specs if those print views exist — one shared component preferred

C9. Digital wallet membership passes
- src/lib/memberships/walletPass.ts
- Generate signed pass (.pkpass / Google Wallet JWT) when signing is implemented
- Until then: always return not_configured / UI message — NEVER fake “added to wallet” success; env cert keys alone must never report ready
- Digital membership card on-screen QR still required even when wallet signing is absent

C10. TicketCredential linkage (if model exists)
- credentialType membership may mirror membership code for scanners
- Keep GuestMembership as entitlement SSOT

C11. Tests
- Entitlement exhaustion
- Concurrent double-redeem (only one success)
- Multi-venue matrix CURRENT/VISITING/INELIGIBLE
- Family shared cap
- Local perk remove blocks perk at park B
- Wallet not_configured path
- Product→membership upgrade idempotency

================================================================================
D. WORKFLOWS
================================================================================

Redeem visiting member:
BEFORE active membership home Park A, Park B eligible; START scan at B; DURING status VISITING + local perks applied; SUCCESS usage event + remaining decrement; FAILURE INELIGIBLE or exhausted.

Family redeem:
BEFORE family links + shared remaining > 0; DURING select dependents; SUCCESS shared remaining reduced; REPEAT until exhausted.

Product→membership:
BEFORE non-membership line; START upgrade action; SUCCESS GuestMembership created via billingEngine; FAILURE validation without partial corrupt sale.

================================================================================
E. SECURITY / ERRORS / EDGES
================================================================================

Security: memberships:redeem for consume; photo upload size/type limits; custom ID unique race handled.
Errors: INELIGIBLE_VENUE, ENTITLEMENT_EXHAUSTED, MEMBERSHIP_NOT_ACTIVE, FAMILY_MEMBER_REQUIRED, WALLET_NOT_CONFIGURED.
Edges: paused members; past_due policy (block or warn per settings); redeem after cancelAtPeriodEnd still active until end; timezone for visit dates.

================================================================================
F. COMPLETION CRITERIA — PHASE 3
================================================================================

1. Phases 1–2 verified/fixed.
2. entitlementEngine enforces benefits; usage ledger accurate.
3. Family beta + multi-venue labels/eligibility/local perks work.
4. Verify/redeem available at VM and hooked to POS/Check-In/online as applicable.
5. Photos, custom IDs, card print, digital card QR work; wallet honest.
6. Product→membership upgrade path exists.
7. STOP for Phase 3 audit. Do not start Phase 4.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Memberships Phase 3 ONLY.
SSOT: docs/memberships-complete-spec.md

Verify Phases 1–2 still correct; FIX carry-forward issues first if found.

Then deep-audit EVERY Phase 3 feature — do not skip any:
- Entitlement verify + consume + discounts/perks/free products
- Family/group shared usage (beta)
- Multi-venue: buy one park / redeem eligible parks
- Home venue; benefits travel
- Shared usage tracking group-wide
- Status labels CURRENT, VISITING, INELIGIBLE
- Local perk add/remove per park
- Sell/redeem/verify at POS, VM, online hooks
- Verify benefits & remaining entitlements UI/API
- Upgrade non-membership product → membership
- Member photos & custom IDs
- Membership card printing
- Digital wallet passes honesty (not_configured)
- Single entitlementEngine (no fork with Check-In/POS)
- Concurrent redeem safety

If anything is incomplete or incorrect: FIX IT, re-test redeem/multi-venue/family paths, re-check POS/Check-In synchronization if those modules exist.

Do not implement Phase 4+.

Only when fully verified reply exactly:
PHASE 3 AUDIT PASSED
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Memberships (Feature 08).
SSOT: docs/memberships-complete-spec.md
Execute ONLY Phase 4.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Verify Phases 1–3 completely. Fix any carry-forward issues first, re-test, then continue.

================================================================================
A. CONTEXT
================================================================================

Phase 4 ships guest self-service, US click-to-cancel, cancel alternatives (beta), Venue Manager cancel UX polish, membership agreements, CRM linkage polish, membership reporting, and advanced dunning (plan-dependent).

Do NOT reopen /signup. Guest self-serve only for authenticated users linked to GuestProfile.
Do NOT put operator tools on /tailor/*.
Do NOT fake legal compliance certification — ship clear cancel UX and agreement storage.

================================================================================
B. PHASE 4 OBJECTIVE
================================================================================

Guests can upgrade/renew/cancel/update card/view entitlements/digital card via online accounts. Cancel flows meet US click-to-cancel expectations (obvious path, clear consequences, confirmation, audited). Cancel alternatives (beta) can intercept churn. Staff can cancel from Venue Manager. Agreements can gate activation (Growth+). Guest CRM profiles show memberships. Reports show sold/active/churn/past_due/failed payments from real data. Advanced dunning adds deeper plan-dependent recovery beyond Phase 2 smart dunning.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

C1. Membership customer self-service (Feature 21 slice)
- Guest online account pages/actions bound User↔GuestProfile (explicit link flow; no public client self-reg)
- View membership status, plan, home venue, remaining entitlements, visit status context
- Self-serve upgrade / renew / cancel / update card / reactivate when allowed
- Digital membership card / QR / wallet link (honest)
- AuthZ: guest can only access own linked profiles/memberships (IDOR tests required)

C2. US click-to-cancel compliance
- Obvious cancel control (not hidden)
- Clear explanation of immediate vs end-of-period effects and access end date
- Confirmation step
- No dark patterns (no forced survey wall that blocks cancel; surveys may be optional)
- Confirmation email + activityLog
- settings.clickToCancelEnabled honored

C3. Cancel alternatives before churn (beta)
- Before final cancel, show configured MembershipCancelAlternative offers (pause suggestion, discount, downgrade, message)
- Accept alternative → executes pause/downgrade/discount credit via billingEngine
- Decline → continue to click-to-cancel
- UI labeled beta; settings.cancelAlternativesEnabled

C4. Cancel memberships from Venue Manager
- Staff cancel UI on member detail (already engine Phase 2) — ensure polished VM path with memberships:cancel, reason codes, audit, optional notify guest
- Bulk cancel not required unless trivial; single-member cancel required

C5. Membership agreements (Premium+ = Growth+Enterprise)
- If Digital Waivers present: use WaiverDocumentKind membership_contract + link target membership_plan / GuestMembership FKs; send/sign/verify before active when agreementRequired
- If waivers absent: MembershipAgreement minimal accept/store + block activation when settings.requireAgreementBeforeActive
- Document honesty if full e-sign kiosk is not duplicated

C6. Customer / Guest CRM linkage (Feature 09 hub slice)
- GuestProfile detail in admin shows memberships list, status, home venue, remaining entitlements, payment health
- Search members by customMembershipId, email, phone, name
- Do not build a second CRM product — extend GuestProfile surfaces

C7. Membership reporting (Feature 17 slice)
- Reports page /api/admin/memberships/reports:
  - Memberships sold in range
  - Active members
  - Churn (cancelled in range)
  - Past due count
  - Failed payments count / amount
- Owner Dashboard KPI hooks if dashboard exists (Memberships Sold, Active Members) — else reports page only
- Enterprise HQ rollup only under assertEnterpriseHqEnabled; no rollup leak to non-Enterprise
- Numbers from DB — never placeholder random

C8. Advanced dunning (plan dependent)
- Growth: keep Phase 2 smart dunning baseline
- Enterprise (or documented higher tier): extra retry steps, admin dunning work queue, escalation notification to finance roles, longer grace configuration
- Implement real differential behavior — not a cosmetic badge

C9. Notifications
- Email: payment failed, recovered, cancel confirm, agreement request, dunning reminders
- SMS only if Twilio/provider already configured; else honest email-only

C10. Tests
- Guest IDOR denied
- Click-to-cancel path completeness
- Alternative accept/decline
- Agreement blocks activation
- Report totals match fixtures
- Advanced dunning steps differ by plan as documented

================================================================================
D. WORKFLOWS
================================================================================

Self-serve cancel with alternatives:
BEFORE active membership linked to user; START cancel; DURING show alternatives (beta); SUCCESS cancelled or alternative applied; FAILURE authZ; REPEAT idempotent cancel.

Agreement-required activate:
BEFORE agreementRequired plan; START sell; DURING pending until signed; SUCCESS active after sign; FAILURE remains pending.

================================================================================
E. SECURITY / ERRORS / EDGES
================================================================================

Security: guest scope checks; staff cancel audited; report routes permissioned memberships:read; no cross-tenant guest link.
Errors: AGREEMENT_REQUIRED, NOT_LINKED_TO_GUEST, CANCEL_ALREADY_SCHEDULED, ALTERNATIVE_INVALID.
Edges: cancel while paused; self-serve upgrade cross upgradeGroupKey denied; unlinked user; Enterprise-only advanced dunning on Growth returns baseline behavior.

================================================================================
F. COMPLETION CRITERIA — PHASE 4
================================================================================

1. Phases 1–3 verified/fixed.
2. Self-serve upgrade/renew/cancel/card/reactivate works with IDOR protection.
3. Click-to-cancel + cancel alternatives (beta) + VM cancel complete.
4. Agreements path works with waivers or minimal store.
5. CRM guest profile shows memberships; reports real.
6. Advanced dunning plan-dependent behavior real.
7. STOP for Phase 4 audit. Do not start Phase 5 except prep notes.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Memberships Phase 4 ONLY.
SSOT: docs/memberships-complete-spec.md

Verify Phases 1–3 still correct; FIX carry-forward issues first if found.

Then deep-audit EVERY Phase 4 feature — do not skip any:
- Self-serve upgrade / renew / cancel / update card / reactivate / digital card
- US click-to-cancel (obvious path, clear consequences, confirmation, audited, no dark patterns)
- Cancel alternatives before churn (beta)
- Cancel from Venue Manager
- Membership agreements (Growth+/waivers or minimal)
- Guest CRM profile membership linkage + search
- Membership reporting (sold, active, churn, past_due, failed payments) honesty
- Advanced dunning plan-dependent behavior
- Notifications email (SMS honesty)
- Guest IDOR / tailor surface pollution checks (/tailor has no ops; no signup reopen)

If anything is incomplete or incorrect: FIX IT, re-test cancel/self-serve/report paths, re-check CRM and billing sync.

Do not implement Phase 5 except fixing Phase 4 gaps.

Only when fully verified reply exactly:
PHASE 4 AUDIT PASSED
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Memberships (Feature 08) — final hardening & production readiness.
SSOT: docs/memberships-complete-spec.md

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Verify Phases 1–4 end-to-end against this SSOT. Fix ANY remaining gaps before/while hardening. Carry forward unfinished work — do not ignore.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Memberships is production-ready as one connected system with POS, Check-In, CRM, Waivers, Reporting, and Online Account hooks; smokes green; docs honest; independent final audit passed.

================================================================================
B. FEATURES / WORK THAT MUST BE COMPLETE IN PHASE 5 (DO NOT SKIP ANY)
================================================================================

B1. Full smoke suite (scripts/smoke-memberships-*.mts or equivalent)
Cover:
- Plan CRUD + eligibility
- Sell recurring + fixed (Stripe or honest pending)
- Upgrade / downgrade pro-rata
- Pause / resume / cancel / reactivate
- Dunning fail → recover
- Redeem multi-venue CURRENT/VISITING/INELIGIBLE
- Family shared usage
- Verify remaining entitlements
- Self-serve cancel + click-to-cancel path
- VM cancel
- Cross-tenant deny
- Demo/Starter/storefront deny
- Guest IDOR deny

B2. Concurrency & idempotency pass
- Double redeem
- Webhook replay
- Double sell same idempotency key

B3. Security pass
- Permissions matrix
- Org isolation
- No PAN/raw card storage
- Guest IDOR
- Storefront/Demo lock
- Staff Membership vs GuestMembership confusion hunt

B4. Cross-feature synchronization audit (update affected code/docs)
- POS sell/redeem/upgrade-product
- Check-In membership redeem/photo/card
- Digital Waivers membership_contract
- Online booking verify/discount hook
- Guest CRM profile
- companyExport fields
- hqOverview honesty + Enterprise rollup gates
- adminNav + moduleHints + README
- Sibling complete-specs residual notes: Memberships engine now owns full billing — Check-In must not claim billing; POS must call shared engines

B5. Performance
- Indexes used for orgId+customMembershipId, orgId+email/phone, membership list pagination
- Avoid N+1 on member detail (attempts, family, usage)

B6. Docs honesty
- README: Memberships guest epic status accurate; residual backlog explicit:
  - Live Apple/Google Wallet certs if not configured
  - SMS dunning if no Twilio
  - Feature 19 kiosk
  - Postgres RLS still deferred
  - Any beta labels (family, pause, cancel alternatives)
- Update this SSOT “honest current-repo facts” if needed after ship

B7. Independent FINAL SYSTEM AUDIT
- Re-read Feature 08 + Section E + expanded multi-venue/commerce list in this file’s Scope section
- Trace: plan → sell → bill → entitle → redeem (multi-venue/family) → self-serve/cancel → report
- Hunt missing/partial/incorrect/disconnected/unused/duplicate/conflicting pieces
- FIX everything found; re-audit fixes; re-test affected workflows

B8. Do NOT add unrelated features. Do NOT fake hardware/wallet/SMS success.

================================================================================
C. FINAL SYSTEM COMPLETION CRITERIA (ALL MUST BE TRUE)
================================================================================

1. All planned in-scope functionality from this SSOT Scope section is implemented OR honestly listed in residual backlog without fake success paths.
2. All supporting functionality required for correctness is implemented (permissions, validation, webhooks, cron piggyback, export, smokes).
3. All 5 phases complete and phase audits passed (fix any failed gates now).
4. Previous-phase gaps corrected.
5. Cross-phase and cross-feature dependencies synchronized (POS/Check-In/Waivers/CRM/Reporting/Online Account).
6. Staff Membership never confused with GuestMembership.
7. Company SaaS Stripe never mixed with guest membership Stripe customers.
8. Shop Product/Cart/Order/Wallet not used as membership commerce.
9. Growth/Enterprise entitled; Demo/Starter/storefront/unpaid fail closed.
10. Recurring/fixed, flexible cycles, entitlements, family beta, agreements, pro-rata up/down, pause beta, cancel alternatives beta, smart+advanced dunning, self-serve, photos/IDs, card print, wallet honesty, payment management, VM cancel, click-to-cancel, POS/VM/online sell/redeem/verify, product→membership upgrade, multi-venue HQ behaviors all present as specified.
11. No known critical partials, authZ holes, or ledger corruptions.
12. Testing complete; final independent audit complete.

When all criteria are met, reply exactly:
MEMBERSHIPS FEATURE COMPLETE — PRODUCTION READY
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Memberships Phase 5 / FINAL SYSTEM AUDIT.
SSOT: docs/memberships-complete-spec.md

Independently re-review the ENTIRE Feature 08 implementation. Do not trust prior phase completion reports blindly.

Verify against:
- This SSOT Scope (complete) list items 1–23
- Catalog Section E membership engine list
- All Phase 1–5 completion criteria
- Expanded multi-venue HQ bullets (buy/redeem eligible parks, home venue, shared usage, CURRENT/VISITING/INELIGIBLE, local perk customization)

Trace end-to-end:
plan catalog → sell → recurring/fixed billing → pro-rata up/down → pause/cancel/dunning → entitle/verify → redeem (family + multi-venue) → photos/IDs/card/wallet → self-serve + click-to-cancel + alternatives → VM cancel → agreements → CRM → reports → export/HQ

Hunt:
- Missing / partial / incorrect / disconnected / unused / duplicate / conflicting implementation
- Staff vs guest Membership confusion
- Entitlement lies / fake KPIs
- Fake wallet/SMS/hardware success
- Shop commerce pollution
- Organization SaaS Stripe mixed with guest subs
- AuthZ / IDOR holes
- Sync drift with POS / Check-In / Waivers
- Cron/webhook idempotency failures
- Demo/Starter/storefront leaks
- Beta features missing while unlabeled or fake-complete

If anything is wrong: FIX IT, re-test, re-check synchronization, re-audit the fix.

Only when fully verified reply exactly:
PHASE 5 AUDIT PASSED — MEMBERSHIPS PRODUCTION READY
```

---

## Completion criteria (summary for humans)

- **Phase 1 done when:** module gate, full foundation schema, plan/settings/eligibility CRUD, admin shells, smokes deny locked plans, no live guest Stripe subs yet.  
- **Phase 2 done when:** sell/lifecycle/pro-rata/pause/cancel/dunning/card/credit/webhooks/cron work via one billingEngine.  
- **Phase 3 done when:** entitlements, family, multi-venue labels/eligibility, redeem/verify channels, photos/IDs/print/wallet honesty, product→membership upgrade work via one entitlementEngine.  
- **Phase 4 done when:** self-serve, click-to-cancel, cancel alternatives, VM cancel, agreements, CRM, reports, advanced dunning work.  
- **Phase 5 done when:** smokes/security/sync/docs/final audit pass and **MEMBERSHIPS FEATURE COMPLETE — PRODUCTION READY**.

---

## Execution control

1. Paste Phase N **EXECUTION** prompt → implement only that phase.  
2. Paste Phase N **FOLLOW-UP AUDIT** prompt → fix until audit passed.  
3. Only then advance to Phase N+1.  
4. Never skip ahead. Never ask the user to re-supply the feature list — it is all in this file.
