# Check-In — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 07 — Check-In (Module: CHECK-IN) + Feature 20 — Mobile Check-In + Check-In Wristbands + Access Control / Alvarado **honest hooks**  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 07, Feature 20, Module CHECK-IN, Wristbands; competitor brief Critical #7 Check-In.  
**Related slices (consume / share — do not fork vocabularies):**  
- `docs/pos-complete-spec.md` B3 Check-in & redemption (desk station may later embed this app’s shared panel)  
- `docs/digital-waivers-complete-spec.md` shared `evaluateWaiver` gate  
- `docs/online-booking-ticketing-complete-spec.md` `TicketCredential` status / redeemed non-restore  
- `docs/capacity-management-complete-spec.md` daily actual from redemptions / honest empty  
- `docs/party-management-complete-spec.md` `no_show` after visit start without check-in  
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
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as park tickets, credentials, visits, or check-in sales.
- Do **NOT** reuse staff `Membership` (org seat) as guest park membership. Guest memberships are `GuestMembership` (+ `MembershipPlan` if present).
- Do **NOT** reuse `UserBlacklist` as park banned-guest. Check-In uses `GuestBan`.
- Do **NOT** reuse `src/lib/shipping/booking.ts` as park booking.
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. Check-In may create/update `GuestProfile` rows. Never public client self-reg for operators.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never runs park Check-In as a paying-tenant module playground that bypasses entitlement. Demo plan locks Check-In. Unpaid / pending / suspended orgs fail closed.
- Check-In module entitlement: `assertModuleEnabled(orgId, "pos")` **OR** a dedicated `"checkin"` hint that is enabled for the same Growth + Enterprise plans that include `"pos"` / `"all"`. **Choose ONE vocabulary and document it in code + this file.** Starter (ticketing hint only) MUST 403 full Check-In station. Demo empty + locked.
- Staff Check-In lives under `/admin/check-in*` and `/api/admin/check-in/*` (and/or `/api/check-in/*` if you keep a shorter prefix — register every path in `API_PERMISSIONS`). If `/admin/pos/check-in` exists later, it must **embed or redirect** to the same shared redeem panel/engine — never a second redemption SSOT.
- Customer `/profile` never gets operator check-in tools. Tailor `/tailor/*` gets no Check-In.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Mobile roaming may use a focused full-height layout but keep brand tokens.
- One connected system: redemption writes `TicketCredential` (or compatible) status + immutable `CheckInEvent` visit ledger; waiver validity uses shared `src/lib/waivers/evaluateWaiver.ts`; capacity “actual” and party `no_show` consume check-in/redemption events when those modules exist.
- Do **not** fake-complete: full POS sell/tills/KDS/offline merch queue, public `/book/*` checkout wizard, full Digital Waivers signing/guardian/kiosk signing product (gate + verify/assign at entry only), Feature 08 membership recurring billing/dunning, Feature 19 self-service buy+check-in kiosk, live Alvarado/turnstile vendor SDK success, Intercard/Sacoa/Amusement Connect, dynamic pricing engine, OTA, reopen signup.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring (re-inspect at execution time — ticketing/POS/waivers/capacity/parties may have shipped):

- Control plane **is** shipped: Organization, VenueLocation, Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile, Stripe, mailer/`sendReceipts.ts`, activityLog, companyExport, smoke script pattern, rateLimit.
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet.
- Online Booking / Ticketing, POS, Digital Waivers, Capacity, Party Management are **specified** in `docs/*-complete-spec.md` but **were not present** in `prisma/schema.prisma` at authoring (no Booking / AdmissionProduct / TicketCredential / GuestProfile / GuestBan / WaiverRecord / PosSale / CheckInEvent). **Inspect again.** If those tables/libs exist, REUSE and EXTEND them. If not, this epic creates the **minimum substrate** Check-In needs (credentials, guests, bans, membership snapshot, waiver evaluate + minimal records, visit ledger, devices/settings) using the **same model names** sibling specs already chose — do not invent parallel names.
- `src/lib/moduleEntitlement.ts` and `assertModuleEnabled` **may not exist**. Create or extend them. Do not invent a second module-gate helper.
- `FuturePlanModules.accessControl` exists as a documented boolean hook — **not** enforced as a live gate product. HQ overview lists `access` as `not_enabled`. Landing `#access` is a roadmap stub.
- There is **no** dedicated Alvarado integration anywhere in the repo. Phase 4 ships adapter interface + honest “not connected” only unless real vendor credentials/docs are already in-repo (they are not).
- NFC appears only as an honest stub requirement in POS Phase 3 spec. Check-In must do the same: Web NFC if available, else “NFC not supported — use camera/keyboard”. Never fake NFC reads.
- Admin nav today has no Check-In / POS / Ticketing / Waivers groups until those epics land. This epic adds Check-In.
- `actorLocationScope`: when a park is selected, filter Check-In venue lists, devices, live queues, and reports for that park. Do not fake-filter fashion Product/Order.

---

## Project understanding (for humans reading this file)

Check-In is **arrival processing for guests**: QR/barcode (and honest NFC) scanning, bulk check-in for groups, membership validation at entry, waiver-status gating (block or warn), visit/attendance updates and reporting, member photo verification, banned-guest approval, custom ticket/membership IDs, late/past-date redemption rules, device profiles (desk + mobile), session punctuality / no-show reports, wristband credential kind, and Access Control / Alvarado **hooks** (not fake hardware success).

It is **not** a standalone island. It hangs off the company SaaS control plane and shares credential / guest / waiver / capacity contracts with sibling FEC modules.

**Surfaces**

- Company admin: `/admin/check-in/*` (primary).
- Optional later embed: `/admin/pos/check-in` → same shared UI/engine.
- Mobile Check-In (Feature 20): responsive phone/tablet staff UI of the same app — not a separate native binary in this epic.
- Never on customer `/profile` or tailor `/tailor/*`.

**What to reuse / extend / create / replace**

- **Reuse:** Organization, VenueLocation, staff Membership/RBAC, planLimits, demoPlanLock, staffOrg, requirePermissionFresh, adminNav patterns, activityLog, companyExport, HQ overview honesty, smoke script pattern, rateLimit, mailer if sending waiver links.
- **Extend:** permissions catalog, adminNav, ActivityEntityType / NotificationType, subscriptionPlans moduleHints enforcement, hqOverview module status, demoPlanLock allowlist (keep Check-In off Demo), actorLocationScope consumers, sibling ticketing/waiver/capacity/party hooks when present.
- **Create (if absent):** moduleEntitlement, TicketCredential (minimal), GuestProfile / GuestBan / GuestMembership, WaiverRecord + evaluateWaiver (minimal gate), CheckInEvent visit ledger, CheckInDevice, CheckInSettings (or compatible PosSettings fields), redeemEngine, admin Check-In UI, smokes, this SSOT (already this file).
- **Replace:** nothing of fashion shop/tailor. Do not replace UserBlacklist with GuestBan — they are different.

---

## Scope (complete) vs non-goals

**In scope (this epic — every item must land inside one of the 5 phases):**

1. Ticket redemption (QR / barcode / camera / keyboard wedge; NFC honest stub).
2. Membership redemption (individual and group / family entitlements snapshot — not full recurring billing).
3. Bulk check-in for groups.
4. Waiver-status gating at redemption (block or warn when missing/expired/declined) via shared `evaluateWaiver`.
5. Waiver search / assign / send (or honest unavailable) at check-in.
6. Member photo verification at entry.
7. Banned guest check-in approval workflow (manager override + audit).
8. Custom ticket IDs and membership IDs (capture, lookup, display).
9. Membership card printing (CSS / `window.print` — name, custom id, QR).
10. Late / past-date redemption rules + manager override.
11. Visit records + attendance reporting (checked-in counts, punctuality, no-shows when visit start known).
12. Device profiles in Venue Manager (desk stations + mobile roaming profiles).
13. Check-In settings (grace minutes, past-date policy, waiver enforcement defaults, photo policy, optional requireGateAck default false).
14. Live capacity / schedule **read** at check-in when capacity/session data exists; honest “unavailable” when not — never invent actuals.
15. Wristband as a credential kind (issue/lookup/redeem hooks; no fake hardware printer driver theater).
16. Access Control / Alvarado adapter interface + config UI showing not connected; no fake gate opens.
17. Mobile Check-In responsive staff UI (Feature 20).
18. Entitlements, RBAC, Demo lock, HQ/export honesty, rate limits, cross-tenant isolation, smokes, requirements/configuration docs (this file + README residual honesty).
19. Shared redeem engine so POS can embed later without a second SSOT.
20. Permissioned undo / reverse check-in with compensating visit event (and credential restore only when policy allows; redeemed heads do **not** restore session capacity).

**Out of scope (do not fake-complete):**

- Full POS terminal sell, tills, KDS, offline merch sync queue, split tabs, Stripe Terminal as a finished POS product.
- Full Online Booking public checkout / guest Stripe ticket capture product.
- Full Digital Waivers signing product (templates, guardian multi-minor flows, waiver kiosk signing) beyond what entry gate + verify/assign/send needs.
- Full Memberships recurring billing, dunning, self-service portal.
- Feature 19 self-service kiosk (buy tickets + check-in + waiver as unattended guest product).
- Live Alvarado / turnstile vendor API that pretends gates opened.
- Intercard / Sacoa / Amusement Connect.
- Claiming Access Control module fully shipped when only hooks exist.
- Reopening `/signup`.

---

## Dependency analysis (honest)

- **Control plane (shipped):** required — reuse.
- **TicketCredential / booking visit window:** required to redeem something real. If ticketing not shipped, create minimal credential (+ optional booking link fields) compatible with ticketing spec names.
- **GuestProfile / GuestBan / GuestMembership:** required for photo, ban, membership validation, visit hub. Create minimal if absent.
- **evaluateWaiver + WaiverRecord:** required for gate. Create shared engine + minimal records if waivers epic not shipped; if waivers shipped, REUSE only.
- **Capacity sessions:** optional read. If absent, capacity panel says unavailable.
- **Party bookings:** optional. If present, bulk group + no_show overlay sync in Phase 4.
- **POS settings / manager PIN:** prefer one PIN vocabulary with POS if PosSettings/ManagerPin exist; else CheckInSettings + ManagerPin-compatible verify.
- **Alvarado:** Phase 4 hooks only.

**Uncertainty rule:** At Phase 1 start, inspect schema/libs. Prefer extend over duplicate. If you must create substrate, use sibling spec model names so later epics attach.

---

## Five-phase roadmap (names only)

- **PHASE 1** — Foundation, Schema, Entitlements, Devices & Configuration  
- **PHASE 2** — Redemption Engine, Visit Ledger & Gate Logic (APIs)  
- **PHASE 3** — Staff / Mobile Check-In UI, Bulk Ops, Card Print & Reporting  
- **PHASE 4** — Cross-Feature Sync, Access / Alvarado Hooks, Security Hardening  
- **PHASE 5** — Final System Audit, Smokes, Docs Honesty & Production Readiness  

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Check-In.
SSOT: docs/check-in-complete-spec.md
Execute ONLY Phase 1. Do not implement redeem APIs, scanner UI, bulk check-in UI, reports aggregations, Alvarado adapters, or capacity sync yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for park members).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park Check-In playground that bypasses entitlement. Never locked by tenant expiry for storefront catalog, but park modules stay registered-company entitled.

Check-In is Feature 07 (catalog) + Feature 20 Mobile Check-In. Module IA name: CHECK-IN.
Primary staff surfaces: /admin/check-in*, /api/admin/check-in/* (register all paths).
Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled for Check-In entitlement (Growth+ via pos and/or checkin hint — document ONE choice).
- Every park business row: orgId required + locationId when park-specific (FK VenueLocation; assert venue.orgId === orgId). Org-default settings may use locationId null.
- Company admin under /admin/*. Guest /profile: no operator Check-In. Tailor studio: no Check-In.

Shop commerce (Product, Cart, Order, Wallet) is fashion retail. Do NOT store tickets, visits, or credentials there.

Name collisions to avoid:
- staff Membership ≠ GuestMembership
- UserBlacklist ≠ GuestBan
- shop Order ≠ Booking / PosSale
- shipping/booking.ts ≠ park booking engine
- shop Wallet ≠ park cashless wallet

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, activityLog.ts, companyExport.ts, hqOverview.ts, smoke scripts, rateLimit.ts, bcrypt if manager PIN hashes live here.

Sibling dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/ for ticketing, pos, waivers, guests, checkin.
2. IF TicketCredential / GuestProfile / GuestBan / GuestMembership / WaiverRecord / PosSettings / ManagerPin / booking models already exist: REUSE and EXTEND. Do not duplicate.
3. IF they do NOT exist: CREATE the minimum substrate Check-In needs using the SAME names sibling specs already use (TicketCredential, GuestProfile, GuestBan, GuestMembership, WaiverRecord, and Check-In-native CheckInEvent, CheckInDevice, CheckInSettings). Do NOT build public /book/* wizard, full POS sell, or full waiver signing product in this phase.
4. Create or extend src/lib/moduleEntitlement.ts assertModuleEnabled — one helper for the whole product.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: open Check-In admin shells, configure Check-In settings per org/venue, register Check-In device profiles (desk + mobile) against any device/terminal cap policy you document, see Check-In in admin nav, and fail closed on Demo/Starter/storefront/unpaid/pending/suspended. Schema for credentials, guests, bans, memberships snapshot, waivers minimal, visit events, devices, and settings is migrated. HQ/export recognize the module honestly without fake KPIs. NO redeem engine and NO scanner UI in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden for park Check-In ops
  5) plan.moduleHints includes the module OR "all"
- assertCheckInEnabled(orgId) thin wrapper used by all Check-In APIs.
- Entitlement decision (pick one and document in this file header comment in moduleEntitlement + SSOT):
  Option A (preferred if POS ships same stack): Check-In rides assertModuleEnabled(orgId, "pos") so Growth+ with pos hint / Enterprise all.
  Option B: add "checkin" to Growth moduleHints alongside pos/waivers and assertModuleEnabled(orgId, "checkin").
- Starter MUST 403 Check-In. Demo MUST 403. Unpaid/pending/suspended fail closed via existing billing helpers.

C2. Plan / meter honesty
- If PosDevice / posTerminals already meters devices, Check-In devices should either:
  (a) reuse PosDevice with devicePurpose including checkin, OR
  (b) use CheckInDevice and document whether it shares posTerminals cap or a separate checkInDevices cap.
- Do not silently unlimited-create devices on Growth if POS already caps terminals — stay consistent.
- Do not claim Access Control / Alvarado plan feature is live. FuturePlanModules.accessControl stays a hook until Access Control epic ships; Phase 4 only adds adapter stubs.

C3. Complete Prisma schema + migration (create ALL Check-In foundation tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped rows: locationId FK VenueLocation unless noted.
Extend ActivityEntityType with whatever you create that is audited: CheckInEvent, CheckInDevice, TicketCredential (if new), GuestProfile (if new), GuestBan (if new), GuestMembership (if new), WaiverRecord (if new).
Extend NotificationType if you will notify on ban override / redeem failure storms later (checkin or reuse alert).

Minimum models / fields (align names with sibling specs when they exist):

TicketCredential (minimal if absent):
- orgId, locationId?, bookingId?, bookingLineId?, guestProfileId?, code unique per org (or org+code unique), qrPayload?, status enum unused|redeemed|void|expired, paidRequiredForRedeem boolean default true, redeemedAt?, redeemedByUserId?, customTicketId?, credentialType enum ticket|pass|membership|wristband|other, sessionStartsAt?, sessionEndsAt?, visitDate?, metadata Json?

GuestProfile (minimal if absent):
- orgId, locationId?, displayName, email?, phone?, photoUrl?, dateOfBirth?, notes?, externalIds Json?, createdAt, updatedAt
- searchable by name/email/phone/custom ids

GuestBan (minimal if absent):
- orgId, locationId?, guestProfileId, reason, severity, active boolean, createdByUserId, expiresAt?, createdAt
- distinct from UserBlacklist

GuestMembership (minimal if absent — entitlement snapshot, NOT full billing engine):
- orgId, locationId?, guestProfileId, planName or membershipPlanId?, status active|expired|suspended|cancelled, customMembershipId?, photoUrl?, familyEntitlements Json? (remaining qty / member guest ids), validFrom?, validTo?, barcodeOrCode?

WaiverRequirement / WaiverRecord (minimal if waivers absent):
- Enough for evaluateWaiver: guestProfileId, status signed|missing|expired|declined|void, signedAt?, expiresAt?, templateName?, enforcement at product/requirement level block|warn
- If digital-waivers-complete-spec models exist, REUSE them entirely.

CheckInEvent (visit ledger — required):
- orgId, locationId, deviceId?, actorUserId, credentialId?, guestProfileId?, guestMembershipId?, bookingId?, partyId?
- outcome enum checked_in|denied|warned_override|undo|manager_override_ban|manager_override_late|manager_override_past
- waiverResult enum ok|missing|expired|declined|warned|blocked
- banResult enum ok|banned|overridden
- photoVerified boolean?
- source enum desk|mobile|pos_embed|api|gate_adapter
- denialCode? (ALREADY_REDEEMED, UNPAID, etc.)
- notes?, metadata Json?, createdAt
- Prefer append-only ledger. Undo creates a new compensating event; do not hard-delete history.

CheckInDevice:
- orgId, locationId, name, deviceType enum desk|mobile|kiosk_roaming|other, publicId, status active|archived|suspended, lastSeenAt?, settingsOverride Json?, createdAt, updatedAt

CheckInSettings (or extend PosSettings if present — ONE settings SSOT for overlapping fields):
- orgId, locationId? (null = org default)
- lateRedemptionGraceMinutes int
- allowPastDateRedemption boolean default false
- waiverEnforcementDefault enum block|warn
- requirePhotoVerification boolean default false
- allowUndoMinutes int?
- requireGateAck boolean default false
- blockWhenBanned boolean default true
- managerPinPolicy notes / reuse ManagerPin
- offlineRedeemEnabled boolean default false (Phase 3 must fail honestly if false; do not build offline redeem queue in this epic unless already trivial)

AccessGateConfig (may wait for Phase 4 tables — if you create now, keep provider default none):
- orgId, locationId?, provider enum none|alvarado|other, status not_configured|configured|error, config Json? (no secrets in plaintext if possible), updatedAt

C4. Permissions + presets
Add to P and PERMISSION_CATALOG + API_PERMISSIONS + ADMIN_ROUTE_PERMISSIONS.
Prefer aligning with POS bits if POS already defined them — ONE vocabulary, no duplicates:
- If POS bits exist: reuse pos:checkin, pos:read, pos:manager_override, pos:admin for overlapping actions; still register Check-In routes to those bits.
- If POS bits do NOT exist, add:
  - checkin:read — view check-in UI, search, reports
  - checkin:redeem — redeem tickets/memberships/bulk
  - checkin:override — manager override for ban/late/past/waiver-warn confirm policy
  - checkin:configure — settings + devices
  - checkin:report — attendance reports
  - checkin:undo — reverse check-in
- Document a Front Desk role template mapping: sell(optional)+checkin+guests/waivers verify. Prefer RoleTemplate + bits over breaking MembershipRolePreset renames; if you add presets, update every switch.

C5. Admin nav + route shells
- Admin nav group Check-In (or under Operations): 
  - Check-In workspace /admin/check-in
  - Devices /admin/check-in/devices
  - Settings /admin/check-in/settings
  - Reports /admin/check-in/reports
- Prefetch helpers if the app uses prefetchAdminRoute.
- Demo allowlist: Check-In paths must NOT be in isDemoAllowedAdminPath.
- Shells may be empty-state “Configure devices/settings first” — not fake scanner metrics.

C6. Settings + devices APIs (real persistence)
- GET/PUT settings for org default and optional per-location override.
- CRUD devices: create/list/update/archive; assert venue belongs to org; enforce device cap policy.
- All routes: requirePermissionFresh → requireActorOrgId → assertOrganizationActive → assertCompanyBillingEntitled → assertCheckInEnabled → assertActorOrgMatch / venue org match.
- Never trust client orgId.

C7. HQ + export honesty
- hqOverview FUTURE_MODULE_IDS: when Check-In foundation ships, module status for check-in/access must remain honest:
  - check-in / pos-related: enabled only if assertCheckInEnabled would pass for that org AND foundation routes exist
  - access: still not_enabled until Access Control epic (Phase 4 hooks ≠ enabled product)
- companyExport: may include redacted device counts / settings present flags — no fake attendance KPIs yet (events empty until Phase 2).

C8. SSOT / docs touch-ups
- This file is SSOT. If you discover entitlement Option A vs B choice, write the chosen option into the “Rules that apply to every phase” section via a short note at top of implementation comments; optionally patch this markdown entitlement bullet to the chosen option.
- Do NOT claim Check-In complete in README or landing.

C9. Phase 1 smoke script
- scripts/smoke-checkin-phase1.mts (or equivalent) + package.json script smoke:checkin:p1
- Cases: entitled Growth/Enterprise create+list device + read/write settings; Demo deny; Starter deny; storefront deny; cross-tenant device access deny; unpaid/suspended deny if fixtures exist.

================================================================================
D. TECHNICAL IMPLEMENTATION NOTES
================================================================================

- Follow docs/saas-module-extension.md checklist.
- Migrations must be safe for Postgres.
- Indexes: (orgId, code) on credentials; (orgId, guestProfileId); (orgId, locationId, createdAt) on CheckInEvent; devices by orgId+locationId.
- Defaults for settings must be safe (block banned, no past-date, grace minutes sensible e.g. 15–30, photo optional).

================================================================================
E. WORKFLOWS IN PHASE 1
================================================================================

BEFORE: entitled company, at least one VenueLocation.
START: admin opens Check-In settings/devices.
DURING: save settings; register device profile for desk or mobile.
SUCCESS: persisted rows; nav works; locked states for Demo.
FAILURE: 403/404 with clear errors.
REPEAT: updating settings is idempotent.
REVERSAL: archive device (no hard delete required).

================================================================================
F. SECURITY / ERROR HANDLING / EDGE CASES
================================================================================

- Cross-tenant deny on every detail route.
- Enterprise location scope: device lists filter when park selected.
- Device with wrong locationId rejected.
- Missing settings row → return defaults and/or auto-create org defaults on first GET.

================================================================================
G. TESTING
================================================================================

- Phase 1 smoke green.
- Typecheck/lint touched files.
- Manual: login as entitled admin, open four Check-In routes, save settings, create device.

================================================================================
H. COMPLETION GATE PHASE 1
================================================================================

Phase 1 is complete ONLY when ALL of C1–C9 are true, schema migrated, Demo locked, no redeem routes implemented as fake always-200 stubs, shop/tailor/control plane untouched except intentional shared extensions, smoke:checkin:p1 green.

STOP. Do not start Phase 2.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of Check-In Phase 1.
SSOT: docs/check-in-complete-spec.md Phase 1.
VERIFY every item in section C (C1–C9) of the Phase 1 execution prompt.

Deep-audit checklist (do not skip):
1. Module entitlement assertCheckInEnabled / assertModuleEnabled exists and is called on Check-In APIs.
2. Demo / Starter / storefront / unpaid fail closed; Growth/Enterprise entitled path works.
3. Prisma models exist for credentials (or reused), GuestProfile, GuestBan, GuestMembership, waiver minimal or reused, CheckInEvent, CheckInDevice, CheckInSettings (or PosSettings overlap documented).
4. orgId on all business tables; locationId rules correct; indexes present.
5. Permissions registered; admin nav + four route shells; Demo paths not allowlisted.
6. Settings + devices CRUD real (not placeholders); tenant isolation verified.
7. HQ/export honest (no fake attendance KPIs; access not falsely enabled).
8. No redeem/scanner UI claimed complete; no second tenancy model; no UserBlacklist used as GuestBan.
9. Name collisions avoided; fashion Product/Order/Wallet not used.
10. smoke:checkin:p1 green.

If ANYTHING is missing, partial, incorrect, disconnected, unused-dead, duplicated, or conflicting: FIX IT.
After each fix: re-check the fix, re-run affected smoke, re-check Demo lock and cross-tenant deny.
Only then mark Phase 1 complete.
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Check-In.
SSOT: docs/check-in-complete-spec.md
Execute ONLY Phase 2. Do not build the full scanner UI, reports charts UI, Alvarado vendor integration, or POS sell terminal.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

1. Re-verify Phase 1 completion gate (C1–C9) against the live repo.
2. Run smoke:checkin:p1 (or equivalent). If it fails, fix Phase 1 first.
3. If anything from Phase 1 is missing, partial, buggy, insecure, or desynced: FIX IT, re-test, then continue.
4. Do not assume Phase 1 was correct.

================================================================================
A. PHASE 2 OBJECTIVE
================================================================================

Ship the sole redemption engine and staff APIs so arrival processing is correct at the service layer: lookup/scan payload → validate paid/window/ban/waiver/photo/late/past → redeem ticket or membership (individual/group) → write CheckInEvent visit ledger → support bulk with partial failure reporting → permissioned undo → structured error codes. NFC capability helper is honest. No requirement to finish polished camera UI yet (Phase 3), but APIs must be UI-ready.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

B1. Shared redeem engine SSOT
- Implement src/lib/checkin/redeemEngine.ts (or src/lib/redemption/redeemEngine.ts if you intentionally share with POS — ONE engine).
- ALL redeem/undo routes call this engine. No route-local status flips.
- Transactional updates: credential unused → redeemed only if still unused (optimistic concurrency / updateMany count).

B2. Shared waiver evaluate SSOT
- Implement or reuse src/lib/waivers/evaluateWaiver.ts exactly as digital-waivers spec intends.
- Check-In must NOT invent a second waiver status vocabulary.
- Returns enough for UI chips: ok | missing | expired | declined | void (+ enforcement block|warn).

B3. Ticket redemption API
- POST redeem by code / qrPayload / customTicketId / credential id.
- Rules:
  - Not found → 404 NOT_FOUND (do not leak other tenants — always scope by actor orgId)
  - Already redeemed → 400 ALREADY_REDEEMED
  - void/expired → 400 VOID/EXPIRED
  - unpaid when paidRequiredForRedeem → 403 UNPAID
  - outside visit window / late beyond grace → 403 LATE (overrideable)
  - past visit date when allowPastDateRedemption false → 403 PAST_DATE (overrideable)
- On success: credential redeemedAt/redeemedBy set; CheckInEvent outcome checked_in; source desk|mobile|api as provided.

B4. Membership redemption API (individual + group)
- Redeem GuestMembership by code / customMembershipId / id.
- Individual: validate active + date window + not suspended.
- Group/family: consume familyEntitlements Json honestly (qty remaining / selected guest ids); fail when exhausted (ENTITLEMENT_EXHAUSTED).
- Write CheckInEvent with guestMembershipId + guestProfileId(s).
- Do NOT build Stripe recurring membership billing, dunning, or plan catalog commerce here.

B5. Bulk group check-in API
- Accept list of credentialIds and/or guestProfileIds and/or bookingId expansion if booking guests exist.
- Process in a defined order; return per-item success/failure with error codes.
- Partial success allowed; do not hide failures.
- Optional allOrNothing query/body flag default false.

B6. Waiver gate at redemption
- Before commit, evaluateWaiver for each covered guest.
- If enforcement block and not ok → DENY with WAIVER_BLOCK (no redeem).
- If enforcement warn and not ok → require confirmWarn=true from client or return WAIVER_WARN without redeeming.
- Declined treated as blocking when enforcement is block.
- Search WaiverRecord API for staff assign/link at redemption (assign endpoint may attach existing signed record to guest; do not build full signing wizard).

B7. Banned guest workflow
- If active GuestBan for guest → BANNED deny unless override.
- Override requires checkin:override (or pos:manager_override) + manager PIN verify (bcrypt ManagerPin or org override PIN).
- On override: CheckInEvent outcome manager_override_ban; activity log; never log raw PIN; never put PIN in URL/query.

B8. Member photo verification
- If requirePhotoVerification or membership/guest has photo policy on: API accepts photoVerified=true after staff confirm.
- If required and photoVerified not true → 403 PHOTO_REQUIRED.
- If photoUrl missing and required → 403 PHOTO_MISSING (override only if you explicitly allow — default deny without override bit).

B9. Custom ticket IDs & membership IDs
- Lookup by customTicketId / customMembershipId.
- Permissioned assign/update custom ids (unique per org).
- Display fields returned on search/redeem payloads.

B10. Late / past-date rules
- Read CheckInSettings / PosSettings lateRedemptionGraceMinutes + allowPastDateRedemption.
- Overrides require override permission + PIN when settings demand PIN for overrides (default: PIN required for ban/past/late overrides).

B11. Visit ledger + undo
- Every attempt that reaches a terminal decision writes CheckInEvent (success or denied), except pure validation GETs.
- Undo endpoint: permission checkin:undo; within allowUndoMinutes if set; creates compensating event; restores credential to unused ONLY when policy allows AND capacity rules say redeemed heads do not get session remaining restored (align ticketing: redeemed qty does not restore capacity). Document behavior in code comments.
- Repeat undo / undo after window → clear error.

B12. Search APIs
- Search credentials by code, custom id, guest name, booking ref (if any).
- Search guests.
- Search waivers.
- Search memberships.
- All org-scoped; location filter when scope set.

B13. NFC capability helper
- src/lib/checkin/nfcCapability.ts (or client helper documented): returns supported/unsupported.
- No fake NFC read fixtures that claim success in production paths.

B14. Error code contract (stable)
Document and use consistently:
ALREADY_REDEEMED, UNPAID, EXPIRED, VOID, NOT_FOUND, WAIVER_BLOCK, WAIVER_WARN, BANNED, PAST_DATE, LATE, PHOTO_REQUIRED, PHOTO_MISSING, ENTITLEMENT_EXHAUSTED, OVERRIDE_REQUIRED, INVALID_PIN, UNDO_WINDOW_EXPIRED, DEVICE_REQUIRED (if settings require deviceId), FORBIDDEN, DEMO_LOCKED, MODULE_DISABLED.

B15. Fixtures + Phase 2 smokes
- Dev/smoke helpers to create: unused paid credential, unpaid credential, expired, redeemed, guest with ban, guest missing waiver, membership with family qty, past-date credential, late credential.
- scripts/smoke-checkin-phase2.mts + smoke:checkin:p2 covering happy path + each major error code + bulk partial + cross-tenant code deny + Demo deny + override ban success with PIN + undo.

B16. Activity / audit
- Log manager overrides and undos via activityLog with entity CheckInEvent / GuestBan as appropriate.

================================================================================
C. WORKFLOWS (ENGINE MUST SUPPORT FULL LIFECYCLE)
================================================================================

BEFORE: unused paid credential or valid membership; guest; settings; optional waiver/ban/photo.
START: staff/API submits code + deviceId + optional confirms/PIN.
DURING: load org-scoped entities; evaluate gates; transactional redeem.
SUCCESS: redeemed + CheckInEvent checked_in (+ optional adapter hook stub no-op).
FAILURE: structured error + denied CheckInEvent when appropriate.
CANCELLATION: client abort before POST — no writes.
REPEAT: second redeem → ALREADY_REDEEMED.
REVERSAL: undo compensating event.
DEPENDENCIES: capacity remaining not increased on redeem; cancel of booking later must not restore redeemed heads (hook/docs).
CONSISTENCY: credential status and ledger agree.

================================================================================
D. SECURITY
================================================================================

- Always filter by actor.orgId first on code lookup.
- Rate-limit redeem/search (reuse rateLimit.ts).
- PIN verify constant-time compare via bcrypt; lockout fields if ManagerPin supports failedAttempts.
- No secrets in responses.

================================================================================
E. COMPLETION GATE PHASE 2
================================================================================

Phase 2 complete ONLY when B1–B16 are true, redeemEngine is the only writer of redemption+ledger commits, smokes p1+p2 green, and no polished camera UI is required yet.

STOP. Do not start Phase 3.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of Check-In Phase 2.
SSOT: docs/check-in-complete-spec.md Phase 2.
VERIFY Phase 1 still holds, then verify EVERY Phase 2 feature B1–B16.

Walk API flows (fix if missing):
1. Unused paid credential → redeemed + CheckInEvent.
2. Double redeem → ALREADY_REDEEMED.
3. Unpaid → UNPAID.
4. Waiver missing block → WAIVER_BLOCK; warn path → WAIVER_WARN then confirmWarn redeems.
5. Banned guest → BANNED; override+PIN → success + audit; bad PIN → INVALID_PIN; PIN not in logs/URLs.
6. Past-date / late → blocked then override paths.
7. Membership individual + group entitlement exhaustion.
8. Bulk partial success/failure reporting.
9. Custom id lookup/assign uniqueness per org.
10. Photo required enforcement.
11. Undo within window; undo after window fails; ledger append-only.
12. Cross-tenant code collision cannot redeem another org’s credential.
13. Demo/Starter still denied.
14. evaluateWaiver is shared; no second vocabulary.
15. NFC helper does not fake reads.

If anything is wrong: FIX IT. Re-test. Re-check Phase 1 entitlements and devices/settings.
Phase 2 complete only when every B1–B16 item is true.
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Check-In.
SSOT: docs/check-in-complete-spec.md
Execute ONLY Phase 3. Do not implement Alvarado vendor API, full POS sell, full waiver signing product, or offline redeem queues (unless settings already demand and you can do an honest minimal queue — default is online-only fail).

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

1. Re-verify Phases 1–2 against live repo. Run smoke:checkin:p1 and smoke:checkin:p2.
2. Fix any gaps/bugs/security issues first. Re-test. Then continue.
3. Carry forward unfinished Phase 1–2 work that blocks UI correctness.

================================================================================
A. PHASE 3 OBJECTIVE
================================================================================

Deliver operable desk Check-In and Feature 20 mobile roaming UI plus attendance reporting: operators can select a device profile, scan or search, redeem tickets/memberships, bulk check-in groups, see waiver chips, verify photos, approve banned guests with PIN, manage custom IDs, print membership cards, view capacity honestly, and run punctuality/no-show/attendance reports from real CheckInEvents.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 3 (DO NOT SKIP ANY)
================================================================================

B1. Primary workspace /admin/check-in
- Focused staff layout (ok to reduce bulky nav chrome) keeping gold #D4AF37 / admin tokens.
- Location context + device selector (device must belong to org; persist deviceId in localStorage).
- States: loading, empty (no device), error, entitlement locked, ready.
- Sections or tabs as needed: SCAN | SEARCH | GROUP | MEMBERSHIP | WAIVERS | CAPACITY (read) — progressive disclosure OK.

B2. QR / barcode scanning
- Camera scan via BarcodeDetector and/or video + jsQR (or equivalent already used in repo).
- Keyboard wedge / manual code entry always available.
- On detect → call Phase 2 lookup/redeem flow with confirm step showing guest/credential summary + gate chips.
- Camera permission denied → show wedge-only instructions (no dead end).

B3. NFC
- If Web NFC available, allow scan.
- Else show: “NFC not supported — use camera/keyboard” (honest, not fake).

B4. Ticket redemption UI
- Show credential status, visit window, customTicketId, guest, paid state.
- Map Phase 2 error codes to clear operator messages.
- Success confirmation; ready for next scan quickly (front-desk speed).

B5. Membership redemption UI (individual + group)
- Lookup membership; show photo if any; family entitlements remaining; select guests for group redeem.
- Prevent over-consume in UI using API errors as SSOT.

B6. Bulk check-in for groups
- Load group via bookingId/partyId/search multi-select if those records exist; else multi-select credentials/guests from search.
- Preview per-guest gate status (waiver/ban/photo) before submit.
- Submit bulk API; show per-row results; allow retry failed rows.

B7. Waiver at check-in
- Shared WaiverStatusChip component (exportable for POS/parties later).
- Search waivers; assign/link; send/resend request if waivers module supports it; else honest “waiver request unavailable” with verify-only path.
- Block/warn UX must match evaluateWaiver enforcement (confirmWarn modal).

B8. Member photo verification
- Display GuestMembership.photoUrl or GuestProfile.photoUrl.
- Staff confirm checkbox/button sets photoVerified.
- If missing photo and required → clear operator guidance.

B9. Banned guest approval prompts
- Modal with reason; manager PIN field; submit override; success/failure; audit happens server-side.

B10. Custom ticket IDs & membership IDs UI
- Lookup + display; assign/edit for permitted roles; uniqueness errors shown.

B11. Membership card printing
- Print CSS / window.print card: name, custom membership id, QR/code, org/venue brand if available from CompanyProfile.
- No dependency on external printer SDK.

B12. Late / past-date UX
- Show why blocked; offer override only if user has override permission; PIN modal.

B13. Capacity read panel
- If capacity/session APIs or TicketSession remaining exist: show live schedule/remaining for location; optional deep-link to reschedule only if booking reschedule API exists.
- If absent: show “Unavailable until capacity/check-in data exists” or “—” — NEVER invent actual headcounts.
- Do not oversell from this panel (read-only unless reschedule API is real).

B14. Attendance / punctuality / no-show reports (/admin/check-in/reports)
- Checked-in counts by day/location from CheckInEvent.
- Punctuality: checked-in relative to session/visit start when known.
- No-shows: visit/booking start in the past with no successful check-in event (only when visit start known; otherwise honest empty).
- Filters: date range, location, device, source.
- Export CSV optional but recommended if export patterns exist.

B15. Mobile Check-In (Feature 20)
- Same routes responsive for phone/tablet: large tap targets, camera-first scan, device profile type mobile.
- Do not ship a separate native app store binary in this epic.
- Document in SSOT that Mobile Check-In = responsive staff UI + mobile device profiles.

B16. Permissions in UI
- Hide/disable override, configure, undo, report actions without bits.
- Never rely on UI alone for security.

B17. Wiring settings/devices pages
- Finish usable settings forms and devices management UX (not shells only).

B18. Phase 3 tests
- smoke:checkin:p3 for route permission + critical API regressions through UI-called endpoints.
- Document manual camera/wedge checklist in this file residual or under docs/check-in-complete-spec.md testing notes.
- If Playwright harness exists, add a minimal redeem happy path; else manual checklist is acceptable if API smokes are strong.

================================================================================
C. WORKFLOWS TO IMPLEMENT END-TO-END IN UI
================================================================================

Desk happy path: select device → scan → review gates → confirm photo if needed → redeem → next.
Group path: load group → review chips → bulk redeem → retry failures.
Membership path: search membership → verify photo → redeem individual/group.
Ban path: scan banned guest → manager PIN override → audited check-in.
Mobile path: phone camera scan same APIs.
Report path: open reports → see today’s check-ins from real events.

================================================================================
D. COMPLETION GATE PHASE 3
================================================================================

Phase 3 complete ONLY when B1–B18 are true, desktop and narrow mobile viewports can complete redeem flows against real APIs, reports read real events, capacity panel is honest, NFC is honest, no placeholder CTAs, smokes p1–p3 green (or p3 documented with p1–p2 green + manual checklist explicitly checked off in the PR/notes).

STOP. Do not start Phase 4.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of Check-In Phase 3.
SSOT: docs/check-in-complete-spec.md Phase 3.
VERIFY Phases 1–2 still hold (re-run smokes). Then verify EVERY Phase 3 feature B1–B18.

Walk the UI:
1. Device select + persistence.
2. Camera and/or wedge scan → redeem success.
3. Double-scan shows already redeemed.
4. Bulk group preview + partial results.
5. Membership individual/group.
6. Waiver chip block/warn/confirm.
7. Photo verify required path.
8. Banned guest PIN override (and denial without PIN).
9. Custom IDs assign/lookup.
10. Membership card print layout.
11. Late/past override UX.
12. Capacity panel real or honest unavailable (no invented numbers).
13. Reports show real CheckInEvents; no-show only when visit start known.
14. Mobile narrow viewport usable.
15. No check-in tools on /profile or /tailor.
16. No client-side bypass of gates.
17. NFC message honest if unsupported.

If anything is wrong: FIX IT. Re-test affected workflows and API smokes.
Phase 3 complete only when every B1–B18 item is true.
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Check-In.
SSOT: docs/check-in-complete-spec.md
Execute ONLY Phase 4. Do not fake-complete live Alvarado gate opens, Feature 19 kiosk, full POS sell, or full waiver signing.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-verify Phases 1–3. Fix gaps first. Re-test. Carry forward unfinished work. Then implement Phase 4.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Connect Check-In to sibling modules as one system; add Access Control / Alvarado adapter hooks that fail honestly; harden security; sync capacity actuals and party no-shows when those modules exist; wristband credential kind; POS embed/redirect contract; HQ/export honesty; location scope; regression safety for shop/tailor/control plane.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

B1. Capacity synchronization
- IF capacity daily actual / TicketSession remaining APIs or UI exist: feed actual headcounts from CheckInEvent successes / credential redemptions.
- IF absent: leave honest empty; document hook for capacity epic.
- Redeemed heads must NOT increase remaining on cancel (coordinate with ticketing cancel helpers if present).

B2. Party no-show overlay
- IF party bookings with visitStartsAt exist: no_show overlay when visit start passed without successful check-in (align party spec).
- IF absent: export a small helper parties can call later.

B3. Ticketing cancel / refund interaction
- Document + enforce: unused cancel may restore capacity; redeemed does not.
- Undo check-in policy remains Phase 2 rules.

B4. Wristbands
- credentialType wristband supported in issue/lookup/redeem paths.
- Optional staff action “issue wristband code” that creates a TicketCredential type wristband linked to guest/booking if entitlements allow — without claiming hardware printer integration.
- Scan wristband codes same as tickets.

B5. Access Control / Alvarado hooks (honest)
- Implement AccessControlAdapter interface: validateEntry(payload), openGate(payload) → result.
- Default NotConfiguredAdapter: returns not_configured; openGate does not pretend success.
- AccessGateConfig UI under Check-In settings or /admin/check-in/access: provider none|alvarado|other, status not connected.
- If requireGateAck=true (default false): software redeem waits for adapter ack; if not configured → clear error.
- If requireGateAck=false: software check-in succeeds even when gate disconnected (typical).
- Do NOT call a fake Alvarado cloud that returns success. Real vendor integration is residual backlog / Access Control epic.
- HQ module `access` remains not_enabled as a product; hooks ≠ shipped Access Control.

B6. POS embed contract
- IF /admin/pos exists: /admin/pos/check-in embeds shared Check-In panel OR redirects to /admin/check-in with device context — ONE redeemEngine.
- IF POS absent: document the embed contract in SSOT for later.

B7. Notifications / activity
- Ensure overrides, undos, and ban approvals are auditable.
- Optional notification to managers on ban override if notificationService pattern is easy; else activity log is enough.

B8. Rate limits + abuse
- Redeem and search endpoints rate-limited per actor/device.
- Concurrent double-scan still safe (Phase 2 concurrency).

B9. Enterprise HQ location scope
- When park selected, Check-In lists/reports/devices filter to that location.
- companyWideView does not invent a park.

B10. Export / HQ
- companyExport includes redacted check-in counts / device counts for entitled orgs.
- hqOverview shows check-in enabled when module truly entitled and shipped; access still honest.

B11. Landing / README honesty
- Do not claim Alvarado or Access Control complete.
- Check-In may be mentioned as shipped only after Phase 5 — in Phase 4 keep README from over-claiming if still mid-epic; at minimum do not claim hardware gates.

B12. Regression suite
- Shop Product/Cart/Order/Wallet still work.
- Tailor routes untouched.
- /signup still closed.
- Demo lock still holds.
- Billing entitlement still holds.

B13. Phase 4 smokes
- smoke:checkin:p4: capacity hook or skip-honest; adapter not_configured; cross-tenant; location scope; POS embed route if present; export/HQ smoke if patterns exist.

================================================================================
C. COMPLETION GATE PHASE 4
================================================================================

Phase 4 complete ONLY when B1–B13 are true, no fake gate opens, no duplicate redeem engines, sibling sync honest, regressions clean, smokes p1–p4 green.

STOP. Do not start Phase 5.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of Check-In Phase 4.
SSOT: docs/check-in-complete-spec.md Phase 4.
VERIFY Phases 1–3 still hold. Then verify EVERY Phase 4 feature B1–B13.

Check specifically:
1. Capacity actual real or honest empty — never invented.
2. Party no_show hook or helper.
3. Redeemed non-restore rule.
4. Wristband credential type works in redeem/lookup.
5. AccessControlAdapter / AccessGateConfig: not connected; no fake openGate success.
6. requireGateAck default false behavior correct.
7. Single redeemEngine; POS embed/redirect without fork.
8. Rate limits present.
9. HQ/export/location scope correct; access module not falsely “enabled” as full product.
10. Shop/tailor/signup/Demo/billing regressions clean.

If anything is wrong: FIX IT. Re-test cross-feature paths.
Phase 4 complete only when every B1–B13 item is true.
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Check-In.
SSOT: docs/check-in-complete-spec.md
Final phase. No new scope expansion beyond audit fixes and production readiness.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-verify Phases 1–4 end-to-end. Fix any carried defects first. Re-test. Then perform final audit work.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Independent system-wide audit of Check-In; complete smoke pack; performance sanity; docs/README/landing honesty; residual backlog list; FIX every critical gap found; re-audit fixes until stable. Production-ready Check-In for entitled tenants.

================================================================================
B. FEATURES / TASKS THAT MUST BE COMPLETE IN PHASE 5 (DO NOT SKIP ANY)
================================================================================

B1. End-to-end trace (fix and fix)
Configure settings/device → fixture/create credential + guest → scan/redeem → waiver block/warn → ban override → photo → late/past → custom ids → card print → bulk group → membership redeem → visit event visible in reports → undo → capacity/party overlays if present → adapter not_configured path.

B2. Completeness vs original product intent
Confirm all in-scope items from this SSOT “Scope (complete)” list are implemented or explicitly deferred ONLY if they were marked out-of-scope. In-scope items must not be silently skipped.

Must still be true:
- Ticket redemption QR/barcode/wedge + NFC honest
- Membership redemption individual/group
- Bulk group check-in
- Waiver gating block/warn + search/assign/send-or-honest
- Visit/attendance records + punctuality/no-show reports
- Member photo verification
- Banned guest approval
- Custom ticket/membership IDs
- Membership card printing
- Late/past-date rules
- Device profiles desk+mobile
- Mobile responsive Check-In
- Wristband credential kind
- Access/Alvarado hooks honest
- Capacity read honest
- Shared engine / POS embed contract
- Entitlement/Demo/security

B3. Full smoke pack
- Consolidate or keep phase scripts; ensure yarn/npm scripts documented:
  smoke:checkin:p1, p2, p3, p4, and smoke:checkin (all).
- All green in CI-local run.

B4. Performance sanity
- Credential lookup by orgId+code indexed.
- Redeem path avoids full-table scans.
- Report queries bounded by date/location filters.

B5. Security final pass
- Cross-tenant tests.
- PIN never logged.
- No client orgId trust.
- Demo/Starter/storefront deny.
- Permission bits enforced on API not only UI.

B6. Docs honesty
- Update README residual backlog: live Alvarado integration, Feature 19 kiosk, full POS (if unbuilt), full waiver signing (if unbuilt), Postgres RLS deferred. **Guest membership billing is owned by Feature 08** (`docs/memberships-complete-spec.md`) — Check-In must call shared `entitlementEngine` / adapters and must **not** claim a second billing product.
- Landing #access remains roadmap unless Access Control epic shipped.
- This SSOT completion gates marked done in a short “Status” note at top ONLY if truly complete after audit.

B7. Dead code / duplicates / conflicts
- Remove or wire any disconnected placeholders.
- Ensure no second waiver evaluator or second redeem status machine.
- Ensure no duplicate GuestBan vs UserBlacklist misuse.

B8. Final regression
- Fashion shop checkout still works.
- Tailor studio still works.
- Company registration /signup closed invariants hold.
- HQ still honest.

B9. Re-audit loop
- After each fix: re-test affected workflow + related smokes + sync assumptions.

================================================================================
C. FINAL SYSTEM COMPLETION CRITERIA (ALL MUST BE TRUE)
================================================================================

1. Entitled Growth/Enterprise staff can configure devices/settings and redeem at /admin/check-in (desktop + mobile viewport).
2. QR/barcode/wedge works; NFC honest if unsupported.
3. Bulk group check-in works.
4. Membership validation at entry works for individual/group entitlements without requiring full membership billing product.
5. Waiver gate blocks/warns via shared evaluateWaiver.
6. Visit/attendance events power reports (punctuality/no-show where visit start known).
7. Photo verification, banned-guest approval, custom IDs, late/past rules, card print work or fail with clear policy errors.
8. Capacity actual real or honestly unavailable.
9. Alvarado/access is interface-only unless truly integrated — never fake gate success.
10. Demo/Starter/storefront/cross-tenant denials hold; shop/tailor/control plane regress clean.
11. Phases 1–5 audits passed; unfinished earlier-phase work was fixed before later phases continued / fixed in carry-forward.
12. README/spec residual backlog is honest.

================================================================================
D. COMPLETION GATE PHASE 5
================================================================================

Phase 5 (and the Check-In epic) is complete ONLY when section C criteria 1–12 are all true, smoke:checkin all green, and a final independent pass finds no critical gaps.

STOP after the gate. Do not expand into out-of-scope epics.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
FOLLOW-UP AUDIT of Check-In Phase 5 / FINAL SYSTEM AUDIT.
SSOT: docs/check-in-complete-spec.md Phase 5 and Final System Completion Criteria.

Independently re-audit the entire Check-In feature. Do not trust earlier “phase complete” claims blindly.

Verify:
- Every in-scope feature from this document’s Scope list
- Every Phase 1–4 feature list item still holds
- Every relevant file/component/API/workflow/data path
- Integration + synchronization with ticketing/waivers/capacity/parties/POS if present
- Security, access control, validation, error handling, edge cases
- Partial / missing / incorrect / disconnected / unused / duplicate / conflicting implementations
- Regression risks to shop, tailor, billing, Demo lock, /signup closed
- Docs/README honesty (no fake Alvarado/kiosk/POS/Access Control claims)

If anything is incomplete or incorrect: FIX IT.
After fixing: re-check the fix, re-test the affected workflow, re-check synchronization and related functionality.
Only when Final System Completion Criteria 1–12 are all true is Check-In complete.
```

---

## Testing notes (manual camera checklist)

Use after Phase 3+ when browser camera is available:

1. Allow camera permission → point at a QR for an unused credential → lookup appears → redeem succeeds.  
2. Deny camera permission → wedge/manual entry still works.  
3. Redeem same code again → already redeemed message.  
4. Narrow mobile viewport: scan button reachable; device selector works.  
5. NFC: either works or shows unsupported message (never silent fake success).

---

## Residual backlog (honest — not this epic’s fake-complete list)

- Live Alvarado / turnstile vendor API and full Access Control product  
- Feature 19 self-service guest kiosk (buy + check-in + waiver)  
- Full POS sell / tills / KDS / offline merch (if not shipped separately)  
- Full Digital Waivers signing / guardian / kiosk signing product (if not shipped separately)  
- Full Memberships recurring billing / dunning / self-service  
- Hardware wristband printer SDKs  
- Postgres RLS (deferred per `docs/postgres-rls.md`)  
- Native App Store / Play Store Check-In binaries (Phase 3 mobile web is the Feature 20 delivery here)

---

## Status

**Implementation status:** Spec / execution pack only until Phase 1 is started.  
When Phase 5 final audit passes, update this line to: `SHIPPED — Check-In Phases 1–5 complete (Access Control/Alvarado live integration still residual).`
