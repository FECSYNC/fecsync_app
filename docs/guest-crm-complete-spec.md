# Customer / Guest CRM — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 09 — Customer / Guest CRM (Module: GUESTS) — park guest profile hub for relationship data  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 09 (Customer/Guest CRM) + Feature 25 (Guest Segmentation) + Feature 21 (Online Customer Account) guest-account slice + Feature 18 Owner Dashboard guest KPI hooks + Feature 31 API/Webhooks guests surface; competitor brief Critical #9 Profiles / visits / spend / birthdays / waivers / memberships.  
**Related slices (consume / share — do not fork vocabularies):**  
- `docs/pos-complete-spec.md` — canonical `GuestProfile` / `GuestBan` field lists; POS create guest; banned guest checkout prompt; `pos:guests_write`  
- `docs/check-in-complete-spec.md` — visit ledger via `CheckInEvent.guestProfileId`; ban gate; photo; never reuse `UserBlacklist` as park ban  
- `docs/digital-waivers-complete-spec.md` — upsert `GuestProfile` on sign; linked waivers on guest detail  
- `docs/memberships-complete-spec.md` — `GuestProfile.stripeCustomerId`; memberships list on CRM hub; do not build a second CRM  
- `docs/party-management-complete-spec.md` — party guest lists should link `guestProfileId` when CRM exists  
- `docs/online-booking-ticketing-complete-spec.md` — B2B `BookingAccount` / `BookingAccountContact`; booking contact → guest upsert  
- `docs/enterprise-hq-controls.md` — HQ location scope; Enterprise-only cross-venue segment rollups; no rollup leak  
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
- Do **NOT** reuse fashion shop `User` profile tabs, shop `Profile`, `Order`, `Wallet`, or `customerInsights` as the park Guest CRM hub.
- Do **NOT** reuse staff `Membership` (org seat — `src/lib/membership.ts`, prisma `Membership`) as guest park membership or as CRM identity.
- Do **NOT** reuse `UserBlacklist` as park banned-guest. Park bans are `GuestBan` (+ optional `GuestProfile.bannedAt` / `bannedReason` snapshot fields).
- Do **NOT** reuse `TailorClient` / `CampaignParticipant` as park CRM.
- Do **NOT** reuse SaaS `Organization` / `CompanyProfile` as B2B booking companies. B2B is `BookingAccount` + `BookingAccountContact`.
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. CRM may create/update `GuestProfile` rows and may optionally link an **existing** User. Never public client self-reg for operators. Google OAuth must not create new client accounts for CRM.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never runs park Guest CRM operator tools. Demo plan locks Guest CRM apps. Unpaid / pending / suspended orgs fail closed.
- Guest CRM module entitlement: `assertModuleEnabled(orgId, "guests")` — **Growth + Enterprise** for full CRM (`moduleHints` includes `"guests"` or `"all"`). Add `"guests"` to Growth `moduleHints` in this epic. Demo empty + locked. Starter: fail closed for full CRM UI (segments, bans admin, merge, online account, HQ segments, B2B CRM). If ticketing later needs a minimal guest upsert for booking contacts, that must go through shared guest libs with ticketing entitlement — do not open full `/admin/guests` CRM on Starter.
- Staff CRM lives under `/admin/guests*` and `/api/admin/guests/*` (plus thin `/api/pos/guests` create/search compatibility and guest self-serve APIs — register every path in `API_PERMISSIONS`). Customer fashion `/profile` never gets operator CRM. Tailor `/tailor/*` gets no Guest CRM ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Guest online account may use a focused layout but keep brand tokens — do not merge into fashion `/profile` shop tabs or tailor studio.
- One connected system: ONE `GuestProfile` hub. POS, Check-In, Waivers, Memberships, Parties, Ticketing, Segments, Online Account, Reporting hooks all call the same libs under `src/lib/guests/**`. Do not invent parallel guest identity tables (`ParkMember`, `CustomerCrm`, second email directory).
- Catalog “Pro+” / competitor “Premium+” maps to **Growth + Enterprise** in this repo’s plan SSOT (`demo | starter | growth | enterprise` only — do not invent a Pro SKU).
- Do **not** fake-complete: live Salesforce / ROLLER Connect sync, Campaign Monitor push, T2 Connect email marketing API, Patch Retention integration, full Automated Email/SMS engine (Feature 24), full Reporting / Owner Dashboard product (Feature 17/18), Marketing Tracking pixels product (Feature 26), or claim POS / Check-In / Waivers / Memberships / Ticketing / Parties complete merely because CRM substrate or hooks were created.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring (re-inspect at execution time — POS / Check-In / Waivers / Ticketing / Memberships / Parties may have shipped):

- Control plane **is** shipped: Organization, VenueLocation, Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile, Stripe (`src/lib/stripe.ts`, `src/lib/companyBilling.ts`), mailer, activityLog, companyExport, smoke script pattern, rateLimit, cron (`CRON_SECRET`).
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet, `/profile`.
- Guest CRM is **catalogued** (Feature 09) and **named** as the shared hub in sibling specs, but there was **no** `docs/guest-crm-complete-spec.md` before this file, and **no** `GuestProfile` / `GuestBan` / segment / BookingAccount Prisma models at authoring (confirm with `prisma/schema.prisma`).
- Closest live pieces that are **NOT** the park CRM: `User` + shop `Profile`, `UserBlacklist`, `TailorClient`, `CampaignParticipant`, shop analytics / `customerInsights`, staff `/admin/users`, company `/admin/registered-companies`.
- `src/lib/moduleEntitlement.ts` and `assertModuleEnabled` **may not exist**. Create or extend them. Do not invent a second module-gate helper.
- Growth `moduleHints` today include `ticketing`, `pos`, `waivers`, `loyalty` — **not** `"guests"`. This epic adds `"guests"`. Enterprise `"all"` covers it.
- Admin nav today has no Guests / CRM group until this epic lands.
- Soft privacy patterns today: `User.accountDeleted`, `User.accountSuspended`, company offboard soft stamps, workspace JSON export — **no** guest GDPR erase API. Privacy page copy is not an implementation.
- CSV export precedent: campaign participants export (formula-injection escape). Reuse that pattern for guest CSV.
- Campaign Monitor, T2 Connect, Patch Retention: **not documented** elsewhere in this repo. Salesforce / ROLLER Connect: **explicit V1 postpone** in the feature catalog. Ship honest `not_configured` stubs only — never fake sync success.
- README “Next epics” may not list Guest CRM as its own line — keep honesty until Phase 5 completion criteria are met; do not claim Feature 09 complete early.
- `actorLocationScope`: when a park is selected, filter park-scoped guest lists and visit/spend views for that park when `locationId` is stamped. Company-wide guest search remains org-scoped. HQ cross-venue segment rollups only under `assertEnterpriseHqEnabled`. Do not fake-filter fashion Product/Order.

---

## Project understanding (for humans reading this file)

Customer / Guest CRM is the **central guest profile system** for park relationship data. Each `GuestProfile` stores identity, visit history, lifetime/period spend, birthdays, linked waivers, and memberships. It is used by marketing segmentation, party guest lists, check-in, POS guest attach, owner analytics hooks, and (Growth+) online guest accounts.

It is **not** the fashion shop customer directory. It is **not** staff seats. It is **not** tailor clients. It hangs off the company SaaS control plane and is the shared hub sibling modules already named.

**Surfaces**

- Company admin / Venue Manager: `/admin/guests/*` (primary) — list, detail hub, segments, B2B companies, merge, export, GDPR actions, settings stubs.
- Thin POS hooks: create/search guests; ban prompt helpers.
- Guest online account (Feature 21 slice): manage own linked bookings/passes/memberships when those modules exist.
- Never operator CRM tools on fashion `/profile`, never on `/tailor/*`, never storefront DEFAULT_ORG.

**What to reuse / extend / create / replace**

- **Reuse:** Organization, VenueLocation, staff Membership/RBAC patterns, planLimits, demoPlanLock, staffOrg, requirePermissionFresh, permissions patterns, adminNav patterns, activityLog, companyExport, HQ overview honesty, smoke script pattern, rateLimit, mailer, CSV escape helpers, soft-delete/offboard patterns (as patterns only).
- **Extend:** permissions catalog, adminNav, ActivityEntityType / NotificationType, subscriptionPlans `moduleHints`, hqOverview module status, demoPlanLock allowlist (keep Guest CRM off Demo), actorLocationScope consumers, sibling POS/Check-In/Waivers/Memberships/Party/Ticketing hooks when present.
- **Create (if absent):** `moduleEntitlement`, `GuestProfile`, `GuestBan`, marketing consent, guest flags/notes as needed, `GuestSegment` (+ membership), `BookingAccount`, `BookingAccountContact`, guest libs, admin Guests UI, online account link, GDPR workflows, smokes, this SSOT.
- **Replace:** nothing of fashion shop/tailor/staff seats/blacklist. Do not replace `UserBlacklist` with `GuestBan` or vice versa — they solve different problems.

---

## Scope (complete) vs non-goals

**In scope (this epic — every item must land inside one of the 5 phases):**

1. Central guest database (`GuestProfile`) — create, edit, search, filter.
2. Auto-create / upsert guests from bookings, waivers, forms, POS when those modules exist (shared upsert helpers always).
3. Contact details, booking/visit history, total/lifetime and period spend, signed waivers linkage, memberships linkage.
4. Birthday tracking for campaigns (field + segment inputs).
5. Edit guest records.
6. Merge duplicate records (org-scoped, audited).
7. Export guest data (CSV) — formula-injection safe.
8. Guest flags — warn / ban guests (`GuestBan`, distinct from `UserBlacklist`).
9. Banned guest alerts — checkout, activity center, POS (helpers + wiring when modules exist).
10. Guest segments for marketing (Feature 25 core): members, birthdays, lapsed customers, frequent visitors (+ practical custom rules).
11. Companies & contacts (corporate/B2B) — `BookingAccount` + `BookingAccountContact`.
12. Create guest records at POS (`/api/pos/guests` or equivalent).
13. Online accounts (Growth+ / “Pro+”) — guests manage passes, memberships, bookings when those modules exist; explicit User↔GuestProfile link only.
14. Marketing opt-in / subscriber settings.
15. HQ guest segments — build segments across all venues from Enterprise HQ (no leak to non-Enterprise).
16. GDPR guest data handling & deletion (export + soft erase; retain financial/visit integrity per SSOT; org-scoped).
17. Integration settings stubs only: Campaign Monitor push, T2 Connect, ROLLER Connect / Salesforce, Patch Retention — status `not_configured` (no live sync in V1).
18. Entitlements, RBAC, Demo lock, HQ/export honesty, rate limits, cross-tenant isolation, smokes, docs honesty.
19. Owner Dashboard / reporting **hooks** for Guests and Revenue/Guest inputs — not the full Reporting epic.

**Out of scope (do not fake-complete):**

- Live Salesforce / ROLLER Connect guest+booking sync.
- Live Campaign Monitor audience push.
- Live T2 Connect email marketing API add-on.
- Live Patch Retention integration.
- Full Automated Email/SMS product (Feature 24) — CRM supplies audiences/consent only.
- Full Reporting / Owner Dashboard product UI (Features 17/18) — hooks only.
- Marketing Tracking Meta/TikTok/Google product (Feature 26).
- Reopening `/signup` or creating shop users from CRM.
- Using `UserBlacklist` as park ban.
- Using staff `Membership` or shop `Profile` as GuestProfile.
- Claiming POS / Check-In / Waivers / Memberships / Ticketing / Parties complete because CRM created shared substrate or empty linked tabs.

---

## Dependency analysis (honest)

- **Control plane (shipped):** required — reuse.
- **GuestProfile / GuestBan:** required hub. Create POS-compatible shape if absent; EXTEND if present (ensure `dateOfBirth`, notes, photo, postal, optional `stripeCustomerId`, ban fields/relation).
- **POS / Check-In / Waivers / Memberships / Ticketing / Parties:** optional at CRM start. Phase 2+ must use table-existence / module adapters: wire live reads/writes when present; otherwise honest empty states and stable helper APIs siblings can call later.
- **Enterprise HQ:** required for cross-venue segment rollups only when `assertEnterpriseHqEnabled`.
- **Stripe:** optional on `GuestProfile.stripeCustomerId` for later memberships/POS stored-card — do not mix with Organization SaaS Stripe customer.
- **Email:** mailer for GDPR/ops notices if needed; no SMS required.
- **Uncertainty rule:** At Phase 1 start, inspect schema/libs. Prefer extend over duplicate. Map Pro+ online accounts to Growth+Enterprise. External marketing syncs: honest `not_configured`.

---

## Five-phase roadmap (names only)

- **PHASE 1** — Foundation, SSOT Alignment, Schema, Module Entitlement, Permissions & Admin Shells  
- **PHASE 2** — Core Guest Hub (CRUD, Profile Detail, Visits/Spend, Bans, Auto-Create, POS Create)  
- **PHASE 3** — Segments, Marketing Consent, B2B Companies, Merge Duplicates, CSV Export, HQ Segments, Integration Stubs  
- **PHASE 4** — Online Accounts, GDPR Export/Erase, Banned-Guest Alerts, Cross-Module Sync & Analytics Hooks  
- **PHASE 5** — Final System Audit, Smokes, Cross-Feature Sync, Docs Honesty & Production Readiness  

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Customer / Guest CRM (Feature 09 — park GuestProfile hub).
SSOT: docs/guest-crm-complete-spec.md
Execute ONLY Phase 1. Do NOT implement full guest list CRUD UX beyond shells, visit/spend rollup engines, merge wizard, CSV export UI, segment evaluator, online guest account portal, GDPR erase workflow, live Campaign Monitor/Salesforce sync, or banned-guest POS alert UI completion yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for park guests or CRM identity).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park Guest CRM operator tools. Never locked by tenant expiry for storefront catalog, but park modules stay registered-company entitled.

Customer / Guest CRM is Feature 09. Module IA: GUESTS.
Primary staff surfaces: /admin/guests*, /api/admin/guests/* (register all paths). Also prepare thin /api/pos/guests and future guest self-serve namespaces as needed — register every path in API_PERMISSIONS.

Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "guests").
- Every park business row: orgId required + locationId when park-specific (FK VenueLocation; assert venue.orgId === orgId). Org-wide guest rows may use locationId null (home/create park optional).
- Company admin under /admin/*. Guest online account: own linked profile only (Phase 4). Tailor studio: no Guest CRM ops. Fashion /profile: no operator CRM.

Shop commerce (Product, Cart, Order, Wallet) is fashion retail. Do NOT store park guest CRM, bans, segments, or B2B booking accounts there.
Company SaaS Stripe on Organization is tenant billing. Do NOT reuse Organization.stripeCustomerId as the guest bill-to. Guest Stripe customer (when needed later) lives on GuestProfile.stripeCustomerId.

Name collisions to avoid:
- staff Membership ≠ GuestMembership ≠ GuestProfile
- shop Profile ≠ GuestProfile
- UserBlacklist ≠ GuestBan
- TailorClient / CampaignParticipant ≠ GuestProfile
- SaaS Organization / CompanyProfile ≠ BookingAccount (B2B)
- shop Order ≠ PosSale / park booking spend
- company Stripe subscription ≠ guest Stripe customer

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, activityLog.ts, companyExport.ts, hqOverview.ts, smoke scripts, rateLimit.ts, mailer.ts, CSV escape patterns from campaign participant export.

Sibling dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/ for guests, pos, checkin, waivers, memberships, ticketing, party, moduleEntitlement.
2. IF GuestProfile / GuestBan already exist: REUSE and EXTEND to full Feature 09 hub shape. Do not duplicate or invent ParkMember / CustomerCrm / VenueGuest parallels.
3. IF they do NOT exist: CREATE them using the SAME names and field parity sibling specs already chose (POS / Check-In / Waivers / Memberships), plus CRM-native tables (consent, segments, B2B accounts, merge audit fields).
4. Create or extend src/lib/moduleEntitlement.ts assertModuleEnabled — one helper for the whole product.
5. Put NEW guest CRM libs under src/lib/guests/** — never overload shop profile libs or staff membership.ts.

Catalog / product depth you are founding (do not weaken later; Phase 1 only builds substrate/config/shells):
- Central guest database (auto-created later from bookings, waivers, forms)
- Contact details, booking history, total spend, signed waivers, memberships (hub fields + relations now; rollups/UI Phase 2+)
- Edit & merge duplicate records (schema + merge fields Phase 1; merge UX Phase 3)
- Export guest data CSV (permission + route shell Phase 1; exporter Phase 3)
- Guest flags — warn/ban (GuestBan schema Phase 1; ops UX Phase 2; alerts Phase 4)
- Banned guest alerts at checkout, activity center, POS (NotificationType / helpers Phase 1–4)
- Guest segments for marketing (tables Phase 1; evaluator/UI Phase 3)
- Companies & contacts corporate/B2B (schema Phase 1; UI Phase 3)
- Create guest at POS (API shell/permission Phase 1; working create Phase 2)
- Online accounts Pro+/Growth+ (link field Phase 1; portal Phase 4)
- Marketing opt-in / subscriber settings (consent model Phase 1; UI Phase 3)
- Birthday tracking for campaigns (dateOfBirth Phase 1; segments Phase 3)
- Push segments to Campaign Monitor / T2 Connect / Salesforce / Patch Retention — stubs not_configured only (Phase 3 settings)
- HQ guest segments across venues (Enterprise) — foundation Phase 1; builder Phase 3
- GDPR guest data handling & deletion — permission + model flags Phase 1; workflows Phase 4

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: open Guest CRM admin shells (Guests, Segments, Companies/B2B, Settings stubs), see empty/honest states, and fail closed on Demo/Starter full-CRM/storefront/unpaid/pending/suspended. Schema for the FULL Guest CRM foundation is migrated now (even if CRUD/segment/merge/GDPR APIs arrive in later phases). Module entitlement "guests" is enforced. Permissions and nav are registered. HQ/export recognize the module honestly without fake guest KPIs. NO full guest CRUD product UI, NO merge, NO CSV dump of real rows beyond shells, NO segment evaluation, NO online account portal, NO live ESP/CRM sync in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden (park Guest CRM is registered-company only)
  5) plan.moduleHints includes the module OR "all"
- assertGuestsEnabled(orgId) thin wrapper. Staff Guest CRM APIs fail if not entitled.
- Add "guests" to Growth moduleHints in src/lib/subscriptionPlans.ts (keep Enterprise "all").
- Starter MUST 403 full Guest CRM admin apps. Growth + Enterprise allow full CRM.
- Keep Guest CRM off Demo allowlist in demoPlanLock / demoPlanAssert.

C2. Permissions catalog
Add and wire Fresh permission bits (names may match repo style; keep consistent):
- guests:read
- guests:write
- guests:ban
- guests:export
- guests:merge
- guests:segments
- guests:gdpr
- guests:admin (or map admin preset to the above)
Register every new /api/admin/guests* and /api/pos/guests* and future guest self-serve path in API_PERMISSIONS / ADMIN_ROUTE_PERMISSIONS.
Align role presets (Owner/GM/Manager get broader access; cashier may get write/search only — follow existing RBAC preset patterns).

C3. Complete Prisma schema + migration (create ALL CRM foundation tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped rows: locationId optional or required per model rules below; when set, FK VenueLocation and venue.orgId === orgId.
Extend ActivityEntityType with: GuestProfile, GuestBan, GuestSegment, BookingAccount, BookingAccountContact, GuestMerge (or equivalent), GuestConsent (or equivalent) as applicable.
Extend NotificationType with: guest_ban_alert (and guest_gdpr / guest_segment if useful).

GuestProfile (park CRM hub — MUST match sibling POS/Memberships field parity; EXTEND if present):
id, orgId, locationId? (home/create park), userId? (optional link to existing User — do NOT auto-create shop User), firstName, lastName, email?, phone?, dateOfBirth?, photoUrl?, postalCode?, bannedAt?, bannedReason?, notes, stripeCustomerId?, marketingEmailOptIn? / or separate consent table, marketingSmsOptIn?, mergedIntoId? (nullable self-FK for merge tombstone), deletedAt? / erasedAt? for GDPR soft erase, externalIds Json?, createdAt, updatedAt, createdById.
Indexes: orgId+email, orgId+phone, orgId+lastName+firstName (or name search strategy), orgId+dateOfBirth, orgId+mergedIntoId, orgId+locationId.

GuestBan:
id, orgId, locationId?, guestProfileId, reason, active bool, createdById, createdAt, liftedAt?, liftedById?.
Banned guest approval prompt at POS/check-in later — CRM owns the record.

GuestFlag or notes/flags strategy:
Either a GuestFlag model (orgId, guestProfileId, kind warn|note|custom, message, createdById, createdAt, active) OR document that warn uses GuestFlag and ban uses GuestBan while notes stay on GuestProfile.notes. Pick one coherent approach and stick to it across phases.

GuestMarketingConsent (if not columns on GuestProfile):
orgId, guestProfileId, channel email|sms|push, optedIn bool, source, capturedAt, updatedAt. Unique orgId+guestProfileId+channel.

GuestSegment:
id, orgId, locationId? (null = company-wide; HQ cross-venue uses org-wide + Enterprise gate), name, description?, ruleJson (members | birthdays | lapsed | frequent | custom), isHqScoped bool default false, createdById, createdAt, updatedAt, archivedAt?.

GuestSegmentMembership (materialized optional) OR compute on the fly in Phase 3 — if table exists, include guestProfileId, segmentId, orgId, computedAt.

BookingAccount (B2B corporate — NOT SaaS Organization):
id, orgId, locationId?, name, legalName?, email?, phone?, billingEmail?, notes, archivedAt?, createdAt, updatedAt, createdById.

BookingAccountContact:
id, orgId, bookingAccountId, guestProfileId?, firstName, lastName, email?, phone?, title?, isPrimary bool, createdAt, updatedAt.

GuestMergeAudit (recommended):
id, orgId, sourceGuestProfileId, targetGuestProfileId, mergedById, mergedAt, payloadJson (what was merged), reversedAt?.

IF sibling modules already created thinner GuestProfile: EXTEND with missing CRM columns (dateOfBirth, stripeCustomerId, mergedIntoId, erasedAt, consent). Do not fork.

C4. Libraries skeleton
- src/lib/guests/assert.ts (assertGuestsEnabled)
- src/lib/guests/types.ts
- src/lib/guests/profile.ts (stubs/helpers for later CRUD)
- src/lib/guests/bans.ts (stubs)
- src/lib/guests/segments.ts (stubs)
- src/lib/guests/accounts.ts (B2B stubs)
- Comment stubs for merge.ts / exportCsv.ts / gdpr.ts / upsertFromChannel.ts / onlineAccount.ts / spendRollup.ts / visitRollup.ts — OR omit empty engines; do not ship fake “complete” engines.

C5. Admin nav + route shells
Add Guests group to adminNav (permission-filtered):
- Guests → /admin/guests
- Segments → /admin/guests/segments
- Companies → /admin/guests/companies (B2B)
- Settings → /admin/guests/settings (integration stubs placeholder)
Create page shells with honest empty states (“Guest CRM foundation ready — records in Phase 2”). No fake KPI cards.

C6. Minimal foundation APIs (shells / health — not full product)
All: requirePermissionFresh + requireActorOrgId + assertGuestsEnabled + venue belongs to org when locationId used. Never client orgId.
- GET /api/admin/guests/health or settings GET that returns module enabled + integration statuses not_configured
- Optional read-only GET /api/admin/guests that returns [] with pagination meta (allowed) — do not fake guest rows
- Do NOT implement merge/export/segment preview/GDPR erase in Phase 1.

C7. companyExport + HQ honesty
- Export includes GuestProfile / GuestBan / GuestSegment / BookingAccount counts (redacted — no raw PII dumps in workspace export unless already the export pattern; prefer counts + metadata).
- HQ overview: module status honest; no fake “Total Guests” / “Revenue per Guest” KPI until Phase 4 hooks exist (placeholder 0 / not_ready is OK if labeled honest).

C8. Activity log
- Ensure entity types exist so Phase 2+ can log guest create/update/ban/merge/export/erase.

C9. Smoke + docs
- Smoke script: entitled Growth/Enterprise allow opening guests health/shell; Demo/Starter/storefront/cross-tenant deny.
- Keep README from claiming Guest CRM complete. This SSOT is the execution pack.
- Ensure staff Membership / UserBlacklist / fashion profile still work unchanged.

C10. Integration stub records (settings only)
On /admin/guests/settings shell, list:
- Campaign Monitor — status not_configured
- T2 Connect — status not_configured
- Salesforce / ROLLER Connect — status not_configured (V1 postpone)
- Patch Retention — status not_configured
Do not call external APIs.

================================================================================
D. WORKFLOWS PHASE 1 MUST SUPPORT
================================================================================

BEFORE: entitled Growth/Enterprise org (not Demo, not storefront).
START: admin opens Guests nav group.
DURING: lands on shells; settings show not_configured integrations; health/module gate succeeds.
SUCCESS: shells render; unauthorized actors 403; Demo locked.
FAILURE: pending/suspended/unpaid fail closed with existing billing messages.
REPEAT: reload shells remain empty/honest.
REVERSAL: n/a (no guest writes required in Phase 1 beyond migration).
SECURITY: only guests:* permissions; never trust client orgId/locationId.
CONSISTENCY: moduleHints + assertGuestsEnabled + nav + API all agree.

================================================================================
E. INTEGRATIONS / SECURITY / ERRORS / EDGES / TESTING
================================================================================

Integrations: control plane only; sibling modules may be absent — schema names reserved for them.
Security: Fresh permissions; org isolation; storefront/Demo deny; never trust client orgId/locationId; no PAN storage; do not log raw emails/phones in verbose logs.
Errors: 403 entitlement, 404 cross-tenant, 400 validation (when APIs exist).
Edges: Growth single-venue vs Enterprise multi-venue later; locationId null org-wide guests; actorLocationScope prepared but full list filtering enforced when list APIs arrive in Phase 2.
Testing: module gate unit/assert tests; API smokes allow/deny; migration applies cleanly; staff seats + UserBlacklist unchanged.

================================================================================
F. COMPLETION CRITERIA — PHASE 1
================================================================================

1. docs/guest-crm-complete-spec.md is the SSOT and matches implementation vocabulary.
2. assertGuestsEnabled works; Growth has "guests" hint; Demo/Starter full-CRM/storefront denied.
3. Prisma models migrated for GuestProfile, GuestBan, consent, segments, B2B accounts, merge audit foundation.
4. Admin Guests/Segments/Companies/Settings shells exist; permissions + nav registered; export/HQ honest; smokes green.
5. Integration stubs show not_configured only.
6. No fake guest rows, no merge, no CSV of PII, no online account portal, no live ESP sync.
7. Shop Profile, staff Membership, UserBlacklist unchanged in responsibility.
8. STOP for Phase 1 follow-up audit. Do not start Phase 2.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Customer / Guest CRM Phase 1 ONLY.
SSOT: docs/guest-crm-complete-spec.md

You are auditing Phase 1 of Feature 09 Customer / Guest CRM. Do not implement Phase 2+.

================================================================================
AUDIT MISSION
================================================================================

Deep-audit EVERY Phase 1 requirement in the Phase 1 execution prompt (sections A–F and every C1–C10 item). Verify features, sub-features, files, components, dependencies, workflows, data consistency, integration points, synchronization, security, access control, validation, error handling, edge cases, regression risks.

Explicitly verify these Phase 1 feature foundations exist and are wired (not merely mentioned):
- Module entitlement "guests" (Growth+; Demo/Starter full-CRM/storefront fail closed)
- GuestProfile hub with sibling field parity (identity, dateOfBirth, photo, postal, notes, ban snapshot fields, optional userId/locationId/stripeCustomerId, merge/erase fields)
- GuestBan distinct from UserBlacklist
- Marketing consent storage (columns or GuestMarketingConsent)
- GuestSegment foundation (+ optional membership table)
- BookingAccount + BookingAccountContact (B2B ≠ Organization)
- GuestMergeAudit (or equivalent merge tombstone fields)
- Permissions guests:* + API_PERMISSIONS + adminNav Guests group shells
- companyExport + hqOverview honesty (no fake guest KPIs)
- Integration settings stubs not_configured (Campaign Monitor, T2, Salesforce/ROLLER Connect, Patch Retention)
- Smokes: entitled allow + cross-tenant/Demo/Starter deny
- Libs under src/lib/guests/** without polluting shop profile or staff membership.ts

Hunt for:
- Missing / partial / incorrect / disconnected / unused / duplicate / conflicting implementation
- Client-trusted orgId/locationId
- Parallel guest tables when reuse of GuestProfile was required
- Shop Profile / TailorClient / UserBlacklist / staff Membership overloaded as park CRM
- Organization reused as B2B BookingAccount
- Fake “CRM complete” claims or fake guest KPI numbers
- /signup reopened

If ANYTHING is incomplete or incorrect: FIX IT. Do not only report.
After each fix: re-check the fix, re-test the affected workflow, re-check synchronization and related functionality.

Regression check: fashion shop, staff invites/RBAC, UserBlacklist, company billing still work.

Only when everything is verified reply exactly:
PHASE 1 AUDIT PASSED
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Customer / Guest CRM (Feature 09).
SSOT: docs/guest-crm-complete-spec.md
Execute ONLY Phase 2. Do NOT implement segment builder/evaluator UI, merge wizard, CSV export product, B2B companies UI completion, online account portal, GDPR erase, HQ cross-venue segment builder, or live Campaign Monitor/Salesforce sync yet.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Verify Phase 1 completely against docs/guest-crm-complete-spec.md Phase 1 completion criteria and audit expectations.
If you find missing functionality, partial implementation, bugs, incorrect implementation, broken dependencies, data inconsistencies, security issues, workflow issues, integration issues, synchronization problems, regression problems, or testing gaps:
- FIX THEM FIRST
- Re-test the fix
- Confirm Phase 1 is stable
Only then implement Phase 2.
Do not blindly assume Phase 1 was completed correctly.
Do not expand scope beyond Guest CRM correctness.

================================================================================
A. CONTEXT
================================================================================

Phase 2 delivers the CORE guest hub operators use daily:
- Central guest database CRUD + search/filter
- Profile detail hub with identity, birthday, notes/flags, visit history, lifetime/period spend, linked waivers, linked memberships
- Guest warn flags + GuestBan
- Auto-create/upsert helpers from bookings, waivers, forms, POS (wire when modules exist)
- Create guest records at POS API
- Honest empty states when sibling modules are not installed

Still one GuestProfile hub. Still Growth+ for full CRM. Still Demo locked. Still no /signup.

================================================================================
B. PHASE 2 OBJECTIVE
================================================================================

Entitled Growth/Enterprise staff can create, search, edit, and open guest profiles; see birthday and notes; warn or ban guests; view visit history and spend rollups when CheckInEvent/PosSale/Booking data exists (otherwise honest empty); see linked waivers/memberships when those tables exist (otherwise honest empty); create guests from POS API; and auto-upsert helpers are available for sibling channels. Banned state is stored on GuestBan / profile snapshot and is NOT UserBlacklist.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

C1. Guest CRUD + search APIs
- GET /api/admin/guests — list/search/filter (name, email, phone, location, banned, birthday month optional), pagination, actorLocationScope when park selected
- POST /api/admin/guests — create GuestProfile (stamp orgId from actor; validate locationId in org)
- GET /api/admin/guests/[id] — detail including ban status, consent summary if present, merge tombstone if merged
- PATCH /api/admin/guests/[id] — edit identity, DOB, photoUrl, postalCode, notes, location home park, optional link/unlink existing userId (existing User only)
- Soft-hide merged-away profiles from default list (mergedIntoId set) unless explicitly queried
- Validation: require first+last or displayable name rules per SSOT; email/phone format; DOB not in future; never trust client orgId

C2. Admin Guests list UI (/admin/guests)
- Search box, filters, banned badge, birthday indicator, empty state, create guest form/modal
- Row click → detail
- Permission-aware actions (read vs write vs ban)

C3. Guest profile hub UI (/admin/guests/[id])
Tabs / sections that MUST exist:
1) Overview — identity, contacts, DOB/birthday, home venue, notes, photo, linked user (if any), marketing consent summary (read-only OK if edit lands Phase 3)
2) Visits — timeline from CheckInEvent (or equivalent) when table exists; else honest empty “Check-In not installed / no visits yet”
3) Spend — lifetime total + period filters (e.g. 30/90/365/all) from PosSale / Booking payments attributed to guestProfileId when tables exist; else honest empty
4) Waivers — linked WaiverRecord rows when exist; else honest empty / link to waivers module note
5) Memberships — linked GuestMembership rows when exist; else honest empty
6) Flags & bans — warn flags + ban/unban with reason; history
Do not invent fake visit or spend numbers.

C4. Visit history adapter
- src/lib/guests/visitRollup.ts (or equivalent): if CheckInEvent (or visit ledger) exists, query by guestProfileId+orgId (+ location filter); sort newest first; include location name when available
- If absent: return [] and uiReason = module_missing | no_data

C5. Spend rollup adapter
- src/lib/guests/spendRollup.ts: sum completed park sales/bookings for guestProfileId with period bounds
- Currency from org/sale records; do not mix fashion shop Order totals into park spend unless SSOT explicitly says so (default: park modules only)
- If absent: return zeros with honest empty UI (not fake $1,000 demos)

C6. Guest flags + GuestBan ops
- POST/DELETE or PATCH endpoints for warn flags
- POST /api/admin/guests/[id]/ban and /unban (guests:ban)
- Set/clear GuestProfile.bannedAt/bannedReason snapshot consistently with GuestBan.active
- ActivityLog on ban/unban/flag
- NEVER write UserBlacklist for park bans

C7. Auto-create / upsert helpers (central guest database from channels)
- src/lib/guests/upsertFromChannel.ts (name flexible) with channel = booking | waiver | form | pos | manual
- Match within org by email then phone then (optional) externalIds; create if missing; update empty fields cautiously (do not blindly overwrite richer data)
- Export callable functions siblings can import
- IF Booking / WaiverRecord / POS guest create paths exist: wire them to call this helper
- IF they do not exist: ship helper + unit tests; document hook points in SSOT comments / README honesty note

C8. Create guest at POS
- POST /api/pos/guests (and optional GET search) with assertGuestsEnabled OR compatible POS gate that still uses shared GuestProfile
- Permission: pos:guests_write if present in POS epic, else guests:write — support both if POS permissions already shipped
- Same upsert rules; return guest id + ban status for POS attach

C9. Birthday tracking (field + display)
- dateOfBirth editable on create/edit
- Detail shows next birthday / age band if useful (no need for full campaign sender)
- Index usable later by Phase 3 birthday segments

C10. Cross-feature synchronization
- If POS/Check-In/Waivers/Memberships admin pages already show a thin guest widget, point them at GuestProfile detail route — no second CRM page
- companyExport counts remain accurate as rows are created
- actorLocationScope filters list/detail location-sensitive data when park selected

C11. Error handling + edges
- Duplicate email/phone: soft-warn in UI + API warning payload; do not hard-block create until merge Phase 3 (or offer “possible duplicate” list)
- Guest with no email and no phone allowed if SSOT permits (name-only) — document rule; POS zip capture remains optional
- Banned guest still visible in CRM with clear banner
- Merged tombstones not editable except via future reverse (Phase 3)
- Cross-tenant id → 404
- Rate-limit write endpoints reasonably

C12. Testing for Phase 2
- CRUD isolation across orgs
- Ban ≠ UserBlacklist
- Rollups empty-safe when sibling tables missing
- POS create guest permission matrix
- Demo/Starter/storefront deny
- Search by email/phone/name
- ActivityLog entries for create/ban
- Regression: fashion /profile, staff members, blacklist

================================================================================
D. WORKFLOWS PHASE 2 MUST SUPPORT
================================================================================

BEFORE: Phase 1 foundation; entitled staff; preferably ≥1 VenueLocation.
START: Admin opens Guests → Create, or POS calls POST /api/pos/guests.
DURING: validate → upsert/create → indexable search → open hub → optional ban.
SUCCESS: guest persisted; hub shows identity/birthday; linked tabs honest; activity logged.
FAILURE: 400 validation; 403 entitlement/permission; 404 cross-tenant.
CANCELLATION: abandon create modal — no partial corrupt row.
REPEAT: creating same email soft-warns duplicates.
REVERSAL: unban restores active=false / clears snapshot fields per rules; edits overwrite fields with audit.
DEPENDENCIES: visit/spend/waivers/memberships tabs reflect sibling reality.
SECURITY: guests:write / guests:ban / pos:guests_write as applicable.
CONSISTENCY: one GuestProfile id used everywhere.

================================================================================
E. COMPLETION CRITERIA — PHASE 2
================================================================================

1. Operators can CRUD/search guests and open a real profile hub.
2. Birthday, notes/flags, ban/unban work; GuestBan ≠ UserBlacklist.
3. Visit + spend adapters work or honest-empty.
4. Linked waivers/memberships tabs work or honest-empty.
5. Upsert helpers exist and are wired when sibling channels exist.
6. POS create guest API works.
7. Demo/Starter/storefront still fail closed; smokes updated.
8. STOP for Phase 2 follow-up audit. Do not start Phase 3.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Customer / Guest CRM Phase 2 ONLY.
SSOT: docs/guest-crm-complete-spec.md

You are auditing Phase 2 of Feature 09. Do not implement Phase 3+.

================================================================================
AUDIT MISSION
================================================================================

First re-verify Phase 1 still holds. Then deep-audit EVERY Phase 2 requirement (C1–C12 and workflows).

Explicitly verify:
- Guest list/search/create/edit APIs + /admin/guests UI
- Profile hub tabs: Overview, Visits, Spend, Waivers, Memberships, Flags/Bans
- dateOfBirth birthday display/edit
- Visit rollup adapter empty-safe
- Spend rollup adapter empty-safe (no fake numbers; no accidental fashion Order pollution unless explicitly documented)
- GuestBan + warn flags + ActivityLog; NOT UserBlacklist
- upsertFromChannel helper + wiring when siblings exist
- POST /api/pos/guests create/search compatibility
- actorLocationScope list filtering
- Duplicate soft-warn behavior
- Permissions + Demo/Starter/storefront gates
- No merge/CSV/segment evaluator/online account/GDPR erase leaked incomplete into Phase 2 as fake-complete

Hunt for missing/partial/incorrect/disconnected/duplicate/conflicting implementation and tenant leaks.

If ANYTHING is incomplete or incorrect: FIX IT. Do not only report.
After each fix: re-check, re-test, re-sync related functionality.

Regression: shop, tailor, staff seats, UserBlacklist, company billing.

Only when everything is verified reply exactly:
PHASE 2 AUDIT PASSED
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Customer / Guest CRM (Feature 09).
SSOT: docs/guest-crm-complete-spec.md
Execute ONLY Phase 3. Do NOT implement online guest account portal, GDPR erase workflow completion, live Campaign Monitor/Salesforce/T2/Patch Retention sync, or full Automated Email/SMS campaign sender.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Verify Phase 2 completely (and Phase 1). If gaps/bugs/security issues/desync: FIX FIRST, re-test, then continue.
Do not blindly assume prior phases were completed correctly.

================================================================================
A. CONTEXT
================================================================================

Phase 3 turns the guest DB into a marketing/ops CRM:
- Marketing opt-in / subscriber settings
- Guest segments (members, birthdays, lapsed, frequent + custom rules)
- HQ guest segments across all venues (Enterprise only)
- Companies & contacts (B2B BookingAccount)
- Merge duplicate records
- Export guest data CSV
- Birthday campaign segment support (data/rules — not email engine)
- External integration settings remain not_configured stubs (Campaign Monitor, T2 Connect, Salesforce/ROLLER Connect, Patch Retention)

================================================================================
B. PHASE 3 OBJECTIVE
================================================================================

Entitled staff can manage consent, build/preview/save segments (including birthday segments), manage B2B companies/contacts, merge duplicates with audit, export CSV, and (Enterprise HQ) build cross-venue segments — without fake external sync success.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 3 (DO NOT SKIP ANY)
================================================================================

C1. Marketing opt-in / subscriber settings
- Edit email/SMS (and push if modeled) opt-in on guest detail
- API PATCH consent; ActivityLog on changes
- Segment rules must be able to filter opted-in only when specified
- Default: unset ≠ opted-in (lawful/marketing-safe default: require explicit opt-in for marketing segments)

C2. Guest segments for marketing (Feature 25 core)
Built-in rule kinds that MUST work:
- members — guests with active GuestMembership when table exists; else honest empty/disabled with reason
- birthdays — upcoming N days / month-of-birth based on dateOfBirth
- lapsed — no visit/sale within X days (adapter-based; configurable X)
- frequent — visit or spend count ≥ threshold in period
- custom — practical AND filters on fields/consent/ban/location (keep rules JSON documented; not a full BI product)
APIs:
- GET/POST /api/admin/guests/segments
- GET/PATCH/DELETE(archive) /api/admin/guests/segments/[id]
- POST preview → counts + sample guest ids (capped)
UI: /admin/guests/segments list + builder + preview
Permission: guests:segments

C3. HQ guest segments across all venues
- isHqScoped / org-wide segments that include guests across locations
- Gate with assertEnterpriseHqEnabled for create/preview of HQ-scoped segments and HQ rollup counts
- Non-Enterprise: 403 on HQ-scoped operations; no rollup leak
- Respect actorLocationScope for non-HQ company segments when a park is selected

C4. Companies & contacts (corporate/B2B)
- CRUD BookingAccount under /admin/guests/companies
- CRUD BookingAccountContact; optional link to GuestProfile
- Search companies; archive companies
- APIs under /api/admin/guests/companies* (register permissions)
- Do NOT use Organization as the B2B account

C5. Edit & merge duplicate records
- Merge wizard UI: select source → target (surviving record)
- POST /api/admin/guests/merge (guests:merge)
- Transaction: repoint FKs when sibling tables exist (CheckInEvent, WaiverRecord, GuestMembership, PosSale, PartyGuest, BookingGuest, BookingAccountContact, etc. — detect dynamically)
- Move/merge notes, prefer non-null contact fields with conflict report
- Consent: surviving record keeps most-permissive documented rule OR explicit operator choice — document and implement one coherent rule
- Ban: if either banned, surviving stays banned unless operator explicitly lifts (default safer: keep banned)
- Set source.mergedIntoId = target.id; exclude source from default search
- GuestMergeAudit row with payload
- Do not cross orgs; do not merge already-erased without GDPR rules

C6. Export guest data (CSV)
- GET or POST /api/admin/guests/export (guests:export)
- Columns: id, names, email, phone, DOB, location, banned, consent flags, lifetime spend (if available), last visit (if available), createdAt
- Formula-injection escape (leading = + - @)
- Optional segmentId filter or current search filter
- Cap rows / stream; Content-Type text/csv; filename guests-YYYYMMDD.csv
- ActivityLog export requested
- Never export other orgs; never export erased PII fields that were scrubbed

C7. Birthday tracking for campaigns
- Birthday segment kind usable for “birthdays in next 7/14/30 days”
- Profile still shows DOB from Phase 2
- Do NOT build Campaign Monitor send — only audience definition

C8. Push segments to Campaign Monitor / T2 / Salesforce / Patch Retention (STUBS ONLY)
- Settings UI fields for API keys/list ids MAY exist but must store as not_configured / disabled unless you also implement real sync (DO NOT implement real sync in V1)
- Any “Push” button must return honest not_configured / postponed message
- Catalog postpone: Salesforce / ROLLER Connect — do not build sync
- Document non-goals in settings help text

C9. Cross-feature sync
- Party guest lists / booking contacts: if PartyGuest/BookingGuest exist without guestProfileId, add optional FK and backfill helper when email/phone matches (best-effort)
- Memberships/Waivers admin “open in CRM” links
- HQ overview may show segment count / guest count as real counts (not marketing fake)

C10. Testing for Phase 3
- Segment preview counts for each built-in kind (with and without sibling tables)
- Enterprise HQ segment allow vs Growth deny
- Merge FK integrity + audit
- CSV escape + permission
- Consent default not opted-in
- B2B CRUD isolation
- External push stub honesty
- Demo lock still holds

================================================================================
D. WORKFLOWS PHASE 3 MUST SUPPORT
================================================================================

Segment: create rule → preview count → save → reopen → export CSV filtered by segment.
Merge: find duplicates → merge source into target → source hidden → target has combined history.
B2B: create company → add contacts → optional link guest → archive company.
Consent: opt-in email → appear in opted-in segment filter; opt-out removes.
HQ: Enterprise user builds all-venues birthday segment; Growth user cannot.
Failure paths: invalid rules JSON 400; merge cross-tenant 404; export without permission 403.

================================================================================
E. COMPLETION CRITERIA — PHASE 3
================================================================================

1. Consent editable and respected by segments.
2. Built-in segments work (members/birthdays/lapsed/frequent) with honest degradation.
3. HQ cross-venue segments Enterprise-only.
4. B2B companies/contacts work.
5. Merge duplicates works with audit + FK repointing when possible.
6. CSV export works and is safe.
7. External integrations remain not_configured (no fake sync).
8. STOP for Phase 3 follow-up audit. Do not start Phase 4.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Customer / Guest CRM Phase 3 ONLY.
SSOT: docs/guest-crm-complete-spec.md

You are auditing Phase 3 of Feature 09. Do not implement Phase 4+.

================================================================================
AUDIT MISSION
================================================================================

Re-verify Phases 1–2. Then deep-audit EVERY Phase 3 requirement (C1–C10).

Explicitly verify:
- Marketing opt-in/subscriber settings (default not opted-in)
- Segments: members, birthdays, lapsed, frequent, custom preview/save/list
- HQ guest segments gated by assertEnterpriseHqEnabled (no leak)
- BookingAccount + contacts UI/APIs (not Organization)
- Merge duplicates + GuestMergeAudit + FK repoints / tombstone
- CSV export formula-safe + guests:export
- Birthday campaign segment support
- Campaign Monitor / T2 / Salesforce / Patch Retention = not_configured only
- Party/Booking guestProfileId optional sync/backfill when models exist

If ANYTHING is incomplete or incorrect: FIX IT. Do not only report.
After each fix: re-check, re-test, re-sync.

Watch for fake “synced to Campaign Monitor/Salesforce” success paths — remove/fix if present.

Only when everything is verified reply exactly:
PHASE 3 AUDIT PASSED
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Customer / Guest CRM (Feature 09).
SSOT: docs/guest-crm-complete-spec.md
Execute ONLY Phase 4. Do NOT implement live Salesforce/Campaign Monitor/T2/Patch Retention sync, full Reporting epic UI, or full Automated Email/SMS engine.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Verify Phase 3 completely (and Phases 1–2). Fix gaps first, re-test, then continue.

================================================================================
A. CONTEXT
================================================================================

Phase 4 closes the relationship loop:
- Online accounts (Growth+ / Pro+) — guests manage passes, memberships, bookings when modules exist
- GDPR guest data handling & deletion (export + soft erase)
- Banned guest alerts at checkout, activity center, POS
- Deep cross-module synchronization
- Owner analytics / dashboard guest KPI hooks (not full Reporting product)

================================================================================
B. PHASE 4 OBJECTIVE
================================================================================

Linked authenticated users can open a guest self-serve account shell for their GuestProfile. Staff can run GDPR export/erase. Ban hits emit activity-center alerts and helpers block/warn POS/checkout/check-in flows when those modules exist. Party/booking/membership/waiver linkages stay synchronized. Owner Dashboard can read honest guest metrics hooks.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

C1. Online accounts (Growth+ / Pro+)
- Explicit link flow: staff or verified self-serve claim binds existing User ↔ GuestProfile.userId (one active primary link rule — document: 1 user to 1 profile per org OR allow many-with-primary; pick one and enforce)
- NEVER reopen /signup; NEVER auto-create client users via Google OAuth for this
- Guest self-serve routes (choose a dedicated surface, e.g. /account/guest or /guest/account — NOT tailor, NOT company /admin, and do not overload fashion shop /profile tabs with operator tools). If you place read-only “My park visits” inside an existing customer area, keep it clearly separated from shop orders/wishlist and from tailor studio.
- Self-serve views:
  - Profile summary (own PII limited edit if allowed: phone/email with verification rules — or read-only + request change; document)
  - Bookings list when Booking exists
  - Passes / tickets when TicketCredential exists
  - Memberships when GuestMembership exists (card update / cancel links only if Memberships module exposes safe guest actions; otherwise read-only + honesty)
- Growth+ only: assertGuestsEnabled + plan Growth/Enterprise for portal APIs
- Demo/Starter deny portal operator-equivalent APIs; unlinked users see link instructions only

C2. GDPR guest data handling & deletion
- Staff GDPR panel on guest detail (guests:gdpr)
- Export package: JSON or CSV+JSON of guest PII, consent, bans, segment memberships, linked record references (ids), NOT other guests
- Soft erase:
  - Scrub/redact PII fields (name→“Erased”, clear email/phone/DOB/photo/postal/notes/externalIds)
  - Keep row id for referential integrity of PosSale/CheckInEvent/payments
  - Set erasedAt; exclude from marketing segments and default search
  - Anonymize consent; deactivate bans or retain ban reason without PII per legal note in SSOT comments
- Block erase when required financial holds exist ONLY if SSOT says so; otherwise allow erase with anonymized ledgers
- ActivityLog + optional email receipt to requester
- Org-scoped only; rate-limit
- companyExport remains redacted counts — do not dump erased PII

C3. Banned guest alerts (checkout, activity center, POS)
- Helper src/lib/guests/banGate.ts: given orgId + guestProfileId (or email/phone lookup), return { banned, reason, banId }
- When POS checkout / check-in / booking checkout paths exist: call banGate; if banned, require manager override permission/PIN if those exist; always write ActivityLog + Notification (guest_ban_alert) to activity center
- Activity center UI: show ban alert notifications for entitled roles
- If POS/Check-In/Ticketing absent: ship helper + admin “test ban check” and notification emission on manual ban attempt simulation — plus document hook points

C4. Cross-module synchronization (mandatory pass)
- Ensure GuestProfile is the only park guest identity SSOT
- Backfill/link PartyGuest.guestProfileId and BookingGuest.guestProfileId when those models exist
- Waivers B6: guest CRM detail shows linked waivers (already Phase 2 tab — verify still correct)
- Memberships C6: guest detail shows memberships list/status/home venue/payment health when fields exist
- UpsertFromChannel used by any remaining unwired sibling entrypoints discovered in audit
- Online account reads same tables — no second guest copy

C5. Owner analytics / reporting hooks
- src/lib/guests/metrics.ts (or extend hqOverview): guestCount, newGuestsInPeriod, bannedCount, optedInCount, revenuePerGuest when spend adapter available
- Expose to /api/analytics or HQ overview ONLY with honest labels; no fabricated demos
- Do not build full Feature 17 report gallery

C6. Notifications + activity
- NotificationType guest_ban_alert wired end-to-end
- Optional guest_gdpr_erased / guest_merged notifications for admins
- Prefer existing notificationService patterns

C7. Security / edges
- Guest self APIs: can only read/write own linked profile
- Staff GDPR requires guests:gdpr
- Erase is irreversible for PII (no silent un-erase that restores scrubbed email)
- Linking conflict if userId already bound to another profile in org
- Banned guest online account: can view status but cannot book if banGate enforced on booking create

C8. Testing for Phase 4
- Online account Growth+ allow / Demo deny / unlinked behavior
- GDPR export contents + erase scrub + segment exclusion
- Ban alert notification created; banGate true/false
- FK sync when sibling tables present
- Metrics hooks honest with empty siblings
- Regression across shop/tailor/staff

================================================================================
D. WORKFLOWS PHASE 4 MUST SUPPORT
================================================================================

Online account: staff links user → guest signs in → sees bookings/passes/memberships or honest empties → cannot see other guests.
GDPR: staff requests export → downloads package → confirms erase → PII scrubbed → marketing segments exclude guest → ledgers remain referential.
Ban alert: banned guest presented at POS/check-in/checkout → alert in activity center → override path if permitted → activity logged.
Sync: party/booking guest rows gain guestProfileId when matched.

================================================================================
E. COMPLETION CRITERIA — PHASE 4
================================================================================

1. Online accounts work for Growth+ linked users without reopening signup.
2. GDPR export + soft erase work and are org-scoped.
3. Banned guest alerts/helpers work; activity center receives alerts.
4. Cross-module GuestProfile sync verified for present siblings.
5. Analytics/HQ hooks honest.
6. STOP for Phase 4 follow-up audit. Do not start Phase 5 until audit passes.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT — Customer / Guest CRM Phase 4 ONLY.
SSOT: docs/guest-crm-complete-spec.md

You are auditing Phase 4 of Feature 09. Do not implement Phase 5 yet (except fixes).

================================================================================
AUDIT MISSION
================================================================================

Re-verify Phases 1–3. Then deep-audit EVERY Phase 4 requirement (C1–C8).

Explicitly verify:
- User↔GuestProfile online account link; Growth+ portal; no /signup; no Google auto-client creation
- Self-serve bookings/passes/memberships honest when modules missing
- GDPR export + soft erase; erased guests excluded from segments/search; referential ids kept
- banGate helper; activity center guest_ban_alert; POS/checkout/check-in wiring or documented hooks
- Party/Booking guestProfileId sync when models exist
- Metrics hooks without fake Reporting UI
- Permissions guests:gdpr and self-scope isolation

If ANYTHING is incomplete or incorrect: FIX IT. Do not only report.
After each fix: re-check, re-test, re-sync.

Only when everything is verified reply exactly:
PHASE 4 AUDIT PASSED
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Customer / Guest CRM (Feature 09).
SSOT: docs/guest-crm-complete-spec.md
Execute ONLY Phase 5 after verifying Phase 4.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Verify Phase 4 completely (and Phases 1–3). Fix ALL carry-forward issues first. Re-test. Then harden.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Production readiness: comprehensive smokes, performance, security pass, cross-feature regression, docs/README/HQ honesty, removal of dead/fake code, and a final independent system-wide audit with fixes.

================================================================================
B. FEATURES / WORK THAT MUST BE COMPLETE IN PHASE 5 (DO NOT SKIP ANY)
================================================================================

C1. Smoke / acceptance suite covering:
- Module gates: Demo deny, Starter full-CRM deny, Growth allow, Enterprise allow, storefront deny, unpaid/pending/suspended deny
- Guest CRUD/search/edit
- Ban ≠ UserBlacklist
- Visit/spend adapters empty-safe AND live when sibling fixtures exist (if you can seed)
- Consent + segments (members/birthdays/lapsed/frequent)
- HQ segments Enterprise-only
- B2B companies/contacts
- Merge + audit
- CSV export escape
- POS create guest
- Online account link + self-scope
- GDPR export/erase
- Ban alerts/notifications
- External integrations still not_configured
- Cross-tenant isolation on every guests API

C2. Performance
- Confirm indexes used for email/phone/name/DOB/org list
- Segment preview capped; export capped/streamed
- Avoid N+1 on guest detail linked tabs

C3. Security pass
- No client-trusted orgId/locationId
- PII not in logs
- GDPR permission enforced
- Online account cannot read other profiles
- Demo lock intact
- Rate limits on export/merge/erase/create

C4. Cross-feature regression
- Fashion shop /profile orders/wishlist unchanged
- Tailor clients/campaigns unchanged
- Staff Membership invites/RBAC unchanged
- UserBlacklist still auth blocklist only
- Company billing/Stripe org subscription unchanged
- Sibling modules (if present) still compile and call shared GuestProfile

C5. Docs honesty
- README / hqOverview / this SSOT / catalog alignment: Feature 09 implemented as hub; external syncs postponed
- Remove “coming soon” lies that claim Salesforce/Campaign Monitor live
- Ensure admin nav labels match routes

C6. Dead code / placeholder cleanup
- Remove fake KPIs, disconnected buttons, TODO engines that claim complete
- Keep intentional not_configured stubs only where required

C7. Final system-wide audit (independent)
Trace Guest CRM through the app. Look for missing/partial/incorrect/disconnected/duplicate/conflicting implementation; data inconsistencies; workflow holes; authZ holes; validation gaps; error-handling gaps; edge-case failures; sync problems; performance issues; production-readiness problems.
If found: FIX, re-test, re-audit the fix.

================================================================================
C. FINAL SYSTEM COMPLETION CRITERIA (ALL MUST BE TRUE)
================================================================================

1. GuestProfile is the single park CRM hub (no parallel guest identity systems).
2. Profiles store identity, birthday, notes, bans, consent; show visits/spend and linked waivers/memberships (live or honest empty).
3. Auto-upsert helpers, POS create, merge, CSV export, segments (incl. HQ on Enterprise), B2B accounts/contacts all work.
4. Online accounts work for Growth+ linked users without public signup.
5. GDPR export/erase is org-scoped and integrity-safe.
6. Banned guest state drives alerts/hooks and is not UserBlacklist.
7. Plan/Demo/permission/tenant gates are consistent everywhere.
8. Salesforce / Campaign Monitor / T2 / Patch Retention are postponed or not_configured — never fake-complete.
9. Fashion shop, tailor, and staff membership surfaces remain separate.
10. All five phases audited; known critical gaps fixed; system behaves as one connected product.

================================================================================
D. STOP CONDITION
================================================================================

When C1–C7 and final completion criteria are met, reply exactly:
PHASE 5 COMPLETE — GUEST CRM PRODUCTION READY

List residual postponed items (Salesforce, Campaign Monitor, T2, Patch Retention, full Email/SMS engine, full Reporting UI) as explicit non-goals remaining outside this epic.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FINAL FOLLOW-UP AUDIT — Customer / Guest CRM (all phases).
SSOT: docs/guest-crm-complete-spec.md

You are performing the FINAL independent audit of Feature 09 Customer / Guest CRM after Phase 5 work.

================================================================================
AUDIT MISSION
================================================================================

Do not trust prior “PASSED” claims blindly. Re-audit the entire epic end-to-end against this SSOT.

Verify every in-scope item from the Scope section of docs/guest-crm-complete-spec.md:
1) Central guest DB
2) Auto-create/upsert from channels
3) Contacts, visit history, spend, waivers, memberships
4) Birthday tracking
5) Edit guests
6) Merge duplicates
7) CSV export
8) Warn/ban flags (GuestBan ≠ UserBlacklist)
9) Banned guest alerts (checkout/activity/POS hooks)
10) Guest segments (members/birthdays/lapsed/frequent)
11) B2B companies & contacts
12) Create guest at POS
13) Online accounts Growth+
14) Marketing opt-in
15) HQ guest segments Enterprise-only
16) GDPR export/deletion
17) Integration stubs not_configured only
18) Entitlements/RBAC/Demo/HQ/export/smokes/docs honesty
19) Owner analytics hooks (not full Reporting product)

Also verify out-of-scope items were NOT fake-completed.

Hunt for: missing, partial, incorrect, disconnected, unused, duplicate, conflicting implementations; tenant leaks; signup reopen; shop/tailor/staff surface merges; fake sync; fake KPIs.

If ANYTHING fails: FIX IT, re-test, re-audit the fix. Repeat until clean.

Only when the Final System Completion Criteria are all true reply exactly:
GUEST CRM FINAL AUDIT PASSED — PRODUCTION READY
```

---

## Quick phase checklist (human)

1. Paste Phase 1 execution → wait → paste Phase 1 audit → require `PHASE 1 AUDIT PASSED`  
2. Paste Phase 2 execution → wait → paste Phase 2 audit → require `PHASE 2 AUDIT PASSED`  
3. Paste Phase 3 execution → wait → paste Phase 3 audit → require `PHASE 3 AUDIT PASSED`  
4. Paste Phase 4 execution → wait → paste Phase 4 audit → require `PHASE 4 AUDIT PASSED`  
5. Paste Phase 5 execution → wait → paste Phase 5 final audit → require `GUEST CRM FINAL AUDIT PASSED — PRODUCTION READY`  

Never skip a phase. Never skip an audit. Carry forward and fix unfinished work before continuing.
