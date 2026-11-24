# Digital Waivers — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 05 — Digital Waivers (CHECK-IN / GUESTS) + Waivers, Forms & Documents  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 05 (+ waiver slices of Check-In, Party Tab: Waivers, Automated Email/SMS, Front Desk WAIVER action, Self-Service Kiosk *signing only*).  
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
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as waiver templates, signatures, guests, or form responses.
- Do **NOT** reuse staff `Membership` (org seat) as guest park membership or as a waiver signer identity.
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. Waivers may create `GuestProfile` rows. Never public client self-reg.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker). Public signing binds to a **signing token** (and published orgSlug+venueSlug when present) — never a tenant JWT.
- DEFAULT_ORG / storefront never runs park waivers. Demo plan locks Digital Waivers. Unpaid / pending / suspended orgs fail closed.
- Waivers module entitlement: `assertModuleEnabled(orgId, "waivers")` — **Growth + Enterprise only** (`moduleHints` includes `"waivers"` or `"all"`). Starter has ticketing hint only — **no Digital Waivers**.
- Staff Venue Manager lives under `/admin/waivers*` and `/api/admin/waivers/*` (plus `/api/waivers/*` staff routes if you keep a shorter prefix — register every path in `API_PERMISSIONS`). Customer `/profile` may list **own** signed waivers if the guest email matches the signed-in user — never operator tools. Tailor `/tailor/*` gets no waiver ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav. Public sign + kiosk may use a focused full-height layout but keep brand tokens via `resolveBrandForOrg` / company profile when the org is known from the token.
- One connected system: waiver **validity** is a shared engine (`src/lib/waivers/evaluateWaiver.ts`) that POS check-in, party guest chips, booking `waiverRequired`, and staff verify all call. Do not invent a second status vocabulary per surface.
- Do **not** fake-complete: Feature 07 full check-in scanners, Feature 19 ticket-purchase kiosk, Feature 08 membership recurring billing, Intercard/Sacoa, Kitchen Display, OTAs, dynamic pricing, reopen signup, legal-advice automation, remote online notarization, wet-ink OCR.

---

## Honest current-repo facts (inspect before coding)

As of Digital Waivers Phases 1–5:

- Control plane **is** shipped: Organization, VenueLocation, Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile, Stripe, mailer/`sendReceipts.ts`, activityLog, companyExport, smoke script pattern, rateLimit, cron (`CRON_SECRET`).
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet.
- Online Booking / Ticketing **Phases 1–5** and guest Memberships **Phases 1–5** are shipped. `GuestProfile`, `AdmissionProduct.waiverRequired`, `Booking`, and `PartyGuest` exist — reuse them. There is no `PosSale` table (`WaiverRecord.posSaleId` stays a string).
- `src/lib/moduleEntitlement.ts` exists. `assertWaiversEnabled` wraps `assertModuleEnabled(orgId, "waivers")` after billing, Demo lock, and storefront deny.
- `FuturePlanModules.digitalWaivers` is not a numeric meter. Enforcement is `moduleHints` + `assertModuleEnabled`. Starter stays `["ticketing"]`. Growth includes `"waivers"`. Enterprise `"all"`.
- **Phases 1–5 are shipped:** templates/versions/locales, publish + `contentSha256`, guest signing (link, QR, on-site, kiosk), settings, requirements, desk search/verify/void/import/export, expiry reminders on the daily billing cron (no third Vercel cron), compliance guides, admin nav, booking confirmation waiver links, staff booking waiver status, party waiver list on the party page, HQ signed-record count, `yarn smoke:waivers:p1` through `p5` and `yarn smoke:waivers:all`. Landing `#waivers` describes that desk. The Growth+ POS terminal is a separate shipped module (in-browser card Elements / payment link; Terminal reader collect not wired). The check-in scanner product and the ticket-purchase kiosk stay unbuilt. Residual backlog: full Check-In scanner product, ticket-purchase kiosk, Party Command Center, SMS without Twilio, legal counsel, Postgres RLS. Guest membership billing is the shipped Memberships module, not part of this epic.
- **Not shipped:** check-in scanner blocking.
- SMS sends when Twilio env is set. Email exists (`mailer.ts`). Campaign SMS UI stays separate from waiver reminders.
- Vercel Hobby **≤2 crons** in `vercel.json`. Do **not** add a third Vercel cron. Later reminder sends piggyback on `/api/cron/remind-company-subscriptions` plus a CLI/GH route — not a third Vercel cron.
- `WaiverRecord` is the signed store. `WaiverSignature` is append-only audit, not a second signed store.
- `AdmissionProduct.waiverRequired` is honored by `evaluateWaiver`. The party page lists waiver gaps on read. Do not fake a Party Command Center.

---

## Scope (complete) vs non-goals

**In scope (this epic):**

1. Digital liability waiver capture (online before visit, on-site staff-assisted, QR, kiosk signing).
2. Multi-language templates + electronic signatures + immutable version history.
3. Waiver expiry rules + automated email (and SMS when configured) reminders.
4. Update / publish waiver agreement text (new version; historical signatures stay bound to the signed version).
5. QR code signing links + printable signage.
6. Send waiver requests (email always; SMS if provider env is set).
7. Waiver kiosk **setup + signing mode** (locked station). Not ticket sales kiosk.
8. Booking agreements / membership **contracts** as document kinds (sign + store). Not recurring membership billing.
9. Custom forms (inquiries, events, consent checkboxes) + attach forms to products for extra guest info.
10. View & export form responses; view & manage signed waivers in Venue Manager.
11. Import signed waiver data (CSV).
12. Regional compliance **guides** (Florida and a small set of US-oriented operator checklists) + per-location jurisdiction settings. Not automated legal determination.
13. Staff verification that a guest’s waiver is valid (API + Venue Manager + front-desk verify UI). Shared engine for future Check-In.

**Out of scope (do not fake-complete):**

- Full Feature 07 Check-In scanner app / wristbands / bulk group check-in UI (ship the **gate** only).
- Full Feature 19 self-service kiosk (buy tickets + check-in). Waiver kiosk signing **is** in scope.
- Feature 08 membership engine (recurring billing, dunning, family plan commerce).
- Feature 06 capacity, Feature 02 POS terminal checkout, Feature 01 public ticket purchase (consume them if present).
- Remote online notarization, wet-ink scan OCR, witness-notary workflows beyond an optional typed witness name.
- Claiming “this product makes you legally compliant.”
- OTA, Intercard/Sacoa, KDS, dynamic pricing, reopen `/signup`.

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md
Execute ONLY Phase 1. Do not implement public signing capture, kiosk guest UI, CSV import, reminder cron sends, or check-in verify UI yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for park members or signers).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park waivers. Never locked by tenant expiry.

Digital Waivers is Feature 05. Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "waivers").
- Every park business row: orgId required + locationId required (FK VenueLocation; assert venue.orgId === orgId) except true org-default settings (locationId null = org default).
- Company admin lives under /admin/*. Guest public sign: token pages. Tailor studio: no waivers.

Shop commerce (Product, Cart, Order with cartId + walletId + shipping) is fashion retail. Do NOT store waiver templates or signatures there.

Front desk IA (capability underneath):
CHECK IN | SELL | PARTY | MEMBERSHIP | WAIVER | FOOD | REFUND
This epic ships WAIVER (templates, capture in later phases, Venue Manager, verify). Phase 1 = foundation + templates/versions/locales + settings + requirements + route shells.

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, mailer.ts, TaxSettings, CompanyProfile, activityLog.ts, Notification + notificationService, companyExport.ts, smoke scripts, rateLimit.ts, resolveBrandForOrg.

Do NOT reuse as waiver store: Product, Cart, CartLine, Order (shop), Wallet, TailoringJob, staff Membership.

Guest / related-module dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/moduleEntitlement.ts and src/lib/ticketing/ and src/lib/pos/.
2. IF GuestProfile already exists (POS spec): REUSE it. Add waiver relations only. Do not duplicate park CRM.
3. IF GuestProfile does NOT exist: CREATE it using the POS spec field list (orgId, locationId?, userId?, firstName, lastName, email?, phone?, dateOfBirth?, photoUrl?, postalCode?, bannedAt?, notes, createdAt, updatedAt, createdById; indexes orgId+email, orgId+phone). This is supporting identity for waivers, not a fake POS.
4. IF WaiverRecord exists as POS stub: EXTEND it (add templateVersionId, channel, audit fields, etc.). Do not create a second signed-waiver table.
5. IF AdmissionProduct / Booking / PartyGuest / PosProduct exist: add optional FKs / requirement targets in this phase’s schema. If they do not exist: use WaiverRequirement.targetType + targetId strings (no broken Prisma relations).
6. IF moduleEntitlement.ts exists: add "waivers" to the allowed module ids. If not: create assertModuleEnabled as specified in docs/pos-complete-spec.md / docs/online-booking-ticketing-complete-spec.md (active → billing entitled → Demo lock → storefront deny → moduleHints includes module OR "all") plus assertWaiversEnabled(orgId) thin wrapper.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Growth/Enterprise operators can: enable Digital Waivers for a venue, configure org/location waiver settings (jurisdiction, age of majority, expiry defaults, retention, kiosk PIN policy, reminder days), author multi-language document templates (liability waiver, membership/booking contract, custom form), version and publish agreement text, attach waiver/form requirements to products-or-all-admissions, see admin nav/route shells (templates, signed list empty state, forms, kiosk devices, settings, compliance guides), and fail closed on Demo/Starter/storefront/unpaid. Public signing URLs must still fail (404/403). No signature capture, no SMS send, no CSV import in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden (park waivers are registered-company only)
  5) plan.moduleHints includes the module OR "all"
- assertWaiversEnabled(orgId) thin wrapper. Staff waiver APIs fail if not entitled.
- Starter MUST 403 waivers. Growth + Enterprise allow waivers.

C2. Plan hook
- Keep digitalWaivers out of numeric PlanLimits unless you add a real cap. Enforcement is moduleHints via assertModuleEnabled, not a fake meter.
- Update FuturePlanModules comments so digitalWaivers is no longer “future only / not enforced”.
- Do not rename Growth moduleHints. Do not give Starter waivers.

C3. Complete Prisma schema + migration (create ALL waiver tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped: locationId required, FK VenueLocation, unless noted (settings/templates may be org-default with locationId null).
Extend ActivityEntityType with: WaiverTemplate, WaiverRecord, WaiverRequest, FormResponse, WaiverKioskDevice, GuestProfile (if adding GuestProfile).
Extend NotificationType with: waiver.

Enums (exact names — do not invent parallels):

WaiverDocumentKind: liability_waiver | membership_contract | booking_agreement | custom_form | inquiry | event_form | product_addon_form
WaiverTemplateStatus: draft | published | archived
WaiverRecordStatus: pending | signed | expired | declined | voided | revoked
WaiverSignerRole: adult_self | guardian | staff_assisted | imported
WaiverSignChannel: online | email_link | sms_link | qr | kiosk | onsite | import
WaiverExpiryRule: never | days | calendar_year | visit | until_date
WaiverRequestStatus: queued | sent | failed | opened | completed | cancelled | expired
WaiverKioskStatus: active | disabled | archived
FormResponseStatus: submitted | archived
WaiverRequirementEnforcement: warn | block
WaiverLinkTargetType: guest | booking | party_guest | pos_sale | admission_product | pos_product | membership_plan | party_package | all_admissions | other

Models you MUST create (keep field lists complete enough to implement; indexes on orgId+locationId+createdAt and unique public identifiers).

GuestProfile — IF missing, create POS-compatible hub (see POS spec). Indexes: orgId+email, orgId+phone, orgId+lastName.

WaiverSettings (per location; locationId null = org default; unique orgId+locationId):
id, orgId, locationId?,
jurisdictionCode String default "US-FL" (e.g. US-FL, US-TX, US-CA, US-OTHER, OTHER),
ageOfMajorityYears Int default 18,
requireGuardianForMinors Boolean default true,
allowAdultSelfSign Boolean default true,
allowGroupSigning Boolean default true,
maxMinorsPerGuardianSession Int default 8,
expiryRule WaiverExpiryRule default calendar_year,
expiryDays Int?,
remindBeforeDays Int[] default [14,3] as Json,
retentionYears Int default 7,
requireIntentCheckbox Boolean default true,
allowTypedSignature Boolean default true,
allowDrawnSignature Boolean default true,
optionalWitness Boolean default false,
blockCheckInWhenMissing Boolean default true,
kioskRequireStaffPin Boolean default true,
kioskSessionMinutes Int default 5,
defaultLocale String default "en",
createdAt, updatedAt.

WaiverTemplate:
id, orgId, locationId?, kind WaiverDocumentKind, name, slug (unique per org),
status WaiverTemplateStatus, currentPublishedVersionId?,
requireResignOnPublish Boolean default false,
defaultExpiryRule WaiverExpiryRule?, defaultExpiryDays?,
archivedAt?, createdAt, updatedAt, createdById?.

WaiverTemplateVersion:
id, orgId, templateId, version Int,
localeDefault String,
status draft|published (use WaiverTemplateStatus or a small VersionStatus: draft | published),
publishedAt?, publishedById?,
title, bodyHtml (sanitized rich text),
fieldsJson Json? (custom form field defs: id, type, label, required, options),
contentSha256 String (hash of canonical body+fields+kind),
createdAt.
Unique: templateId+version.

WaiverTemplateLocale:
id, orgId, versionId, locale String (en, es, …),
title, bodyHtml, fieldsJson?,
createdAt.
Unique: versionId+locale.

WaiverRequirement:
id, orgId, locationId?,
templateId,
targetType WaiverLinkTargetType,
targetId String?,
enforcement WaiverRequirementEnforcement default block,
required Boolean default true,
sortOrder Int default 0,
createdAt, updatedAt.
Index orgId+targetType+targetId.

WaiverRecord (the signed/pending instance — extend POS stub if present):
id, orgId, locationId,
guestProfileId,
templateId, templateVersionId,
status WaiverRecordStatus default pending,
signerRole WaiverSignerRole,
channel WaiverSignChannel,
locale String,
signedAt?, expiresAt?,
declinedAt?, voidedAt?, voidReason?, voidedById?,
guardianGuestProfileId?,
guardianRelationship String?,
bookingId String?, partyGuestId String?, posSaleId String?,
importedFrom String?,
publicRef String unique (short code for staff search),
createdAt, updatedAt.
Indexes: orgId+locationId+status, orgId+guestProfileId, orgId+expiresAt, publicRef unique.

WaiverSigner (one row per person covered on a record — adult + each minor):
id, orgId, waiverRecordId, guestProfileId?,
fullName, dateOfBirth?, isMinor Boolean,
role adult_self | minor | guardian,
createdAt.

WaiverSignature (audit — one per signing event; never overwrite):
id, orgId, waiverRecordId,
signedAt, timezone,
intentAccepted Boolean,
typedName String?,
drawnSignatureSvg String? (or storage URL — no plaintext PII in logs),
witnessName String?,
ipHash String? (hash IP; do not store raw IP in export),
userAgent String?,
contentSha256 String (must match template version hash at sign time),
createdAt.

WaiverRequest:
id, orgId, locationId,
templateId, guestProfileId?,
toEmail?, toPhone?,
channel email_link | sms_link,
status WaiverRequestStatus,
publicTokenHash String unique,
expiresAt, sentAt?, lastRemindedAt?,
createdById?, bookingId String?, partyGuestId String?,
createdAt, updatedAt.

WaiverKioskDevice:
id, orgId, locationId, name, code unique per org,
status WaiverKioskStatus,
deviceTokenHash String unique,
pinHash String?,
templateIds Json (array of template ids allowed on this kiosk),
lastSeenAt?, archivedAt?,
createdAt, updatedAt.

FormResponse:
id, orgId, locationId?,
templateId, templateVersionId,
waiverRecordId?,
guestProfileId?,
status FormResponseStatus,
payloadJson Json,
submittedAt, locale,
source channel,
createdAt.
Index orgId+templateId+submittedAt.

WaiverComplianceAck (optional operator checklist stamp — not legal proof):
id, orgId, locationId?,
guideId String (e.g. US-FL),
acknowledgedById, acknowledgedAt,
notes?.

C4. Permissions + presets
Add to P and PERMISSION_CATALOG + API_PERMISSIONS + ADMIN_ROUTE_PERMISSIONS:
- waivers:read — view templates, signed list, form responses, compliance guides
- waivers:write — create/edit draft templates, send requests (later), staff-assisted start (later), form defs
- waivers:verify — evaluate/search validity at front desk
- waivers:void — void/revoke a signed record
- waivers:admin — settings, publish version, kiosk devices, CSV import (later), jurisdiction
- waivers:export — export CSV of signatures/responses

Map presets:
- platform_admin: all waiver bits
- ops_manager: read + write + verify + void + admin + export
- finance: read + export
- catalog_editor: none
- tailor / client: none
Custom RoleTemplate can add bits. Do not invent FRONT_DESK preset unless POS/party already added it — if they did, give that preset waivers:read+write+verify (not admin/void unless they already have manager bits).

C5. Admin nav + routes (shells OK if UI is settings+templates only this phase)
ADMIN_NAV: group “Venue” or “Check-in” children:
- Waivers → /admin/waivers
- Templates → /admin/waivers/templates
- Forms → /admin/waivers/forms
- Kiosk → /admin/waivers/kiosk
- Settings → /admin/waivers/settings
- Compliance guides → /admin/waivers/compliance
Register ADMIN_ROUTE_PERMISSIONS (read for list pages; admin for settings/kiosk; write for template editor).
Dashboard quick link for entitled registered companies.

Pages Phase 1 must actually work (not blank forever):
- /admin/waivers — empty signed list + filters shell + link to templates
- /admin/waivers/templates — list/create/edit draft, locales, publish version (publish writes WaiverTemplateVersion + sha256)
- /admin/waivers/forms — custom form templates (kind custom_form/inquiry/event_form/product_addon_form)
- /admin/waivers/kiosk — device list/create/archive (token shown ONCE at create)
- /admin/waivers/settings — WaiverSettings form
- /admin/waivers/compliance — static guides (Florida + US general + ESIGN/UETA operator checklist) with disclaimer “Not legal advice”
- /admin/waivers/templates/[id] — version history (active + previous)

C6. APIs Phase 1
Staff (Fresh + requireActorOrgId + assertWaiversEnabled + venue belongs to org):
- GET/PUT /api/admin/waivers/settings
- GET/POST /api/admin/waivers/templates
- GET/PATCH /api/admin/waivers/templates/[id]
- POST /api/admin/waivers/templates/[id]/versions (create draft version)
- POST /api/admin/waivers/templates/[id]/publish
- GET /api/admin/waivers/templates/[id]/versions
- GET/POST /api/admin/waivers/requirements
- DELETE /api/admin/waivers/requirements/[id]
- GET/POST /api/admin/waivers/kiosk-devices
- PATCH /api/admin/waivers/kiosk-devices/[id]
- GET /api/admin/waivers/records (empty list OK)
- GET /api/admin/waivers/compliance-guides
Never accept body.orgId. Location picker must assert VenueLocation.orgId === actor.orgId.
When actorLocationScope.locationScoped, filter lists to that locationId (this module stamps locationId — HQ preference IS applied to waiver lists).

C7. Compliance guide content (static, in-repo)
src/lib/waivers/complianceGuides.ts — at minimum:
- US-FL: age of majority 18, guardian for minors, trampoline/amusement operator checklist pointers, record retention, ESIGN/Florida UETA high-level, “consult counsel” disclaimer. Do not paste copyrighted statute text verbatim; summarize + link to official legislature URLs.
- US-GENERAL: ESIGN/UETA, minors, retention, versioning, audit trail fields this product stores.
- Guides are operator education, not a compliance certificate.

C8. companyExport + HQ
- companyExport includes counts (not signature SVGs, not token hashes, not PIN hashes, not raw IP) for WaiverTemplate, WaiverRecord, FormResponse, WaiverKioskDevice, GuestProfile if created here.
- HQ overview: waivers module status becomes "available" only when assertModuleEnabled would pass AND at least one published template exists; otherwise keep honest hook — do NOT invent signed-count KPIs if you have no data. Prefer: modules.waivers.status = "enabled" | "not_enabled" based on entitlement, plus real counts if tables exist.

C9. Shared evaluate stub
src/lib/waivers/evaluateWaiver.ts — implement the function signature and expiry math against WaiverRecord + WaiverSettings even if no signatures exist yet:
evaluateGuestWaivers({ orgId, locationId, guestProfileId, productTargets? }) → { status, records[], missingRequirements[], expiresAt }.
Status enum used everywhere: valid | missing | expired | declined | voided | pending | minor_unsigned.
Phase 1: unit-testable expiry: never / days / calendar_year / until_date. visit = valid only if signedAt is today in venue timezone (or linked booking/visit id when those exist).

C10. Smoke
scripts/smoke-waivers-phase1.mts + yarn smoke:waivers:p1
T1 Growth entitled: create template, locale, publish version, sha256 set
T2 Starter 403
T3 Demo 403
T4 Storefront 403
T5 Cross-tenant template id 403
T6 Unpublished public sign token route 404 if you add the path (or do not create public sign page yet)
T7 Settings unique org+location
T8 Evaluate: no records → missing
T9 /signup still 410/redirect
T10 Fashion Product unchanged

================================================================================
D. SECURITY / ERRORS / EDGE CASES PHASE 1
================================================================================

- Sanitized HTML for bodyHtml (server-side allowlist). No script tags.
- Kiosk deviceTokenHash / pinHash — never return raw token after create response.
- Publish is immutable: you cannot PATCH a published version’s body; create a new version.
- Duplicate slug per org 400.
- Age of majority must be 16–21 range (Florida default 18) to prevent 0/negative.
- Location archived: cannot create kiosk for archived venue.
- Do not log signature fields (none yet) or tokens.

================================================================================
E. COMPLETION GATE PHASE 1
================================================================================

- Schema migrated; Prisma client generates.
- assertWaiversEnabled enforced on staff waiver APIs.
- Starter/Demo/storefront/cross-tenant denied.
- Operators can CRUD templates, locales, publish versions, settings, requirements, kiosk device shells, view compliance guides.
- evaluateWaiver expiry math exists and is tested.
- Public signing still cannot complete.
- smoke:waivers:p1 green.
THEN STOP. Do not start Phase 2.

```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 1 of Digital Waivers. SSOT: docs/digital-waivers-complete-spec.md

Do not start Phase 2. Deep-audit Phase 1 only. If anything is incomplete or incorrect: FIX IT, re-test the affected workflow, re-check tenancy, then continue auditing.

Verify ALL of:
1. assertModuleEnabled("waivers") after billing; Demo lock; storefront deny; Starter 403; Growth/Enterprise allow.
2. Every new table has orgId (+ locationId when park-specific). No client orgId trust.
3. GuestProfile reused or created POS-compatible — not a second CRM and not staff Membership.
4. WaiverRecord is the single signed store (POS stub extended if it existed). No duplicate signature tables.
5. Permissions in P, catalog, API_PERMISSIONS, ADMIN_ROUTE_PERMISSIONS, presets.
6. Admin nav + working template editor, version history, settings, kiosk list, forms list, compliance guides with legal disclaimer.
7. Publish immutability + contentSha256.
8. HTML sanitization.
9. evaluateWaiver exists; missing/expiry rules; visit/calendar_year/days/never.
10. companyExport omits hashes/tokens/PINs/signature blobs.
11. HQ does not invent fake waiver KPIs.
12. No public signing capture shipped.
13. No Feature 07/19/08 fake-complete claim.
14. /signup still closed. Shop Product/Cart/Order untouched as waiver store.
15. smoke:waivers:p1 covers allow + cross-tenant deny + plan deny.
16. No third Vercel cron added.
17. moduleHints not given to Starter.
18. Dead/placeholder pages: either implement or do not register in nav.

If gaps: fix, re-run smoke:waivers:p1, re-check related admin pages. Only then mark Phase 1 complete.

```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md
VERIFY PHASE 1 FIRST. If Phase 1 is missing entitlement, schema, publish flow, or evaluate stub: FIX those before any signing UI.

Execute ONLY Phase 2. Do not build CSV import, reminder cron fan-out, Party Command Center, or full check-in scanners.

================================================================================
A. PHASE 2 OBJECTIVE
================================================================================

Guests can complete real electronic signatures: online before visit (email/QR/public link), on-site staff-assisted, and kiosk signing mode. Minor/guardian group signing works. Custom forms and membership/booking agreements can be submitted/signed. Audit trail is written. Staff can create signing links. Capture is production-quality — not a placeholder checkbox.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 2
================================================================================

B1. Verify Phase 1 (templates publish, settings, GuestProfile, assertWaiversEnabled). Carry-forward fixes first.

B2. Signing token service — src/lib/waivers/signToken.ts
- Create WaiverRequest with hashed public token (HMAC or sha256 of high-entropy secret). Store hash only.
- Token TTL from settings (default 14 days). Single-use when completed (replay → already-signed page, not a second WaiverRecord unless new version/expiry requires re-sign).
- Bind token to orgId+locationId+templateId internally. Public URL: /sign/[token] (token is unguessable). Optional pretty path /sign/[orgSlug]/[venueSlug]/[token] that 404s if slug pair does not match token’s org/venue.
- Never accept JWT orgId as authority on public sign POST.

B3. Public signing UI — /sign/[token]
BEFORE: published template version exists; request not expired; org entitled and active; venue active.
START: load template locale (Accept-Language + picker). Show venue brand (company profile trading name + logo if present).
DURING: identity fields (name, DOB, email, phone); minor/guardian flow; intent checkbox (required if settings.requireIntentCheckbox); drawn and/or typed signature per settings; optional witness; custom form fields from fieldsJson.
SUCCESS: upsert GuestProfile (match email/phone within org; do not create shop User); create WaiverRecord signed + WaiverSigner rows + WaiverSignature audit; set expiresAt from template/settings rule in venue timezone; complete WaiverRequest; email confirmation copy to signer if email present.
FAILURE: validation errors stay on page; expired token 410; entitled-fail (org suspended) 403 generic.
REPEAT: already signed + still valid → confirmation receipt, no duplicate. Expired/voided → prompt re-sign (new record, new version binding).
CANCELLATION: abandoning the form creates no signed record (pending request remains until TTL).
SECURITY: rate limit by IP on GET/POST; CSRF-safe; sanitize; do not echo other guests.

B4. Guardian / minors
- If DOB implies age < ageOfMajorityYears: require guardian name, relationship, guardian DOB proving adult, guardian signature. Minor cannot self-sign.
- Group session: one guardian + N minors (cap maxMinorsPerGuardianSession). One WaiverRecord covering all WaiverSigner rows OR one record per person — pick ONE and use it everywhere: **one WaiverRecord per covered person**, plus shared signature event id if you need grouping (add waiverGroupId on WaiverRecord). Per-person records keep check-in simple.
- Adult self-sign when age ≥ majority.
- Missing DOB: do not assume adult; require confirmation “I am 18+” only if settings allow, else require DOB.

B5. Electronic signature legal-oriented audit (not a law-firm product)
Each WaiverSignature stores: signedAt + venue timezone, intentAccepted, typedName and/or drawnSignatureSvg, contentSha256 matching published version, ipHash, userAgent, locale, templateVersionId.
Drawn signature: canvas on pointer/touch; store SVG or PNG via existing upload/Cloudinary org-prefixed folder `waivers/{orgId}` — uploads:write not required for public sign (public path uses token). Staff-assisted may use uploads if already authed.
Confirmation PDF or HTML receipt optional in Phase 2; email with summary + record publicRef required if mailer configured. If SMTP missing, record still saves; request status sent|failed honest.

B6. QR access
- Staff API GET /api/admin/waivers/templates/[id]/qr?locationId= returns PNG/SVG (or JSON { url }) for the venue’s standing sign URL (long-lived location+template token distinct from per-guest request tokens).
- Standing QR token: WaiverKioskDevice-like or WaiverSignageToken table (orgId, locationId, templateId, tokenHash, kind signage|kiosk). Signage token opens the same public form with channel=qr and creates GuestProfile at submit.
- Printable signage page /admin/waivers/signage?templateId=&locationId= (Phase 2 can ship a simple print view).

B7. On-site staff-assisted
- /admin/waivers/new or terminal action: staff selects template + location, enters guest identity (or search GuestProfile), opens signing on the same device or generates a short-lived QR for the guest’s phone.
- Permission waivers:write. Channel=onsite. Staff userId stored on audit metadata, not as the legal signer (unless they are the guardian — still capture guest/guardian signature).

B8. Kiosk signing mode
- Public/locked route /kiosk/waivers/[deviceToken] — full-screen, no admin chrome, auto-reset after kioskSessionMinutes or after successful submit.
- Device must be active; optional staff PIN gate if kioskRequireStaffPin.
- Templates limited to device.templateIds.
- This is Feature 05 kiosk setup, NOT Feature 19 ticket kiosk. Do not add cart/checkout.

B9. Custom forms + product addon forms
- Public or staff submit for kind custom_form/inquiry/event_form/product_addon_form → FormResponse with payloadJson.
- If attached as WaiverRequirement to a product target, signing flow includes those fields before complete.
- Inquiry forms may be standalone (no signature) — still rate-limited; stamp org from template id.

B10. Booking agreements / membership contracts
- Same signing engine, kind membership_contract | booking_agreement.
- Link guestProfileId; if GuestMembership / Booking tables exist, set optional FKs. If not, leave string ids null.

B11. Email send of waiver requests
- POST /api/admin/waivers/requests { templateId, locationId, toEmail?, toPhone?, guestProfileId?, locale? }
- Email via mailer.ts branded with resolveBrandForOrg. Include CTA link to /sign/[token].
- SMS: src/lib/sms.ts adapter. If TWILIO_* (or existing SMS env) missing, reject SMS channel with 400 “SMS is not configured” — do not mark sent. If present, send and store provider id.
- Rate limit per org.

B12. Multi-language
- Locale picker on public form from WaiverTemplateLocale rows. Fallback en.
- Signed snapshot is the locale they used (store locale on record + hashed content of that locale).

B13. APIs
Public (token, rate-limited):
- GET /api/public/waivers/sign/[token]
- POST /api/public/waivers/sign/[token]
- GET /api/public/waivers/kiosk/[deviceToken]
- POST /api/public/waivers/kiosk/[deviceToken]
Staff:
- POST /api/admin/waivers/requests
- POST /api/admin/waivers/records (staff-assisted create pending + return sign URL)
- GET /api/admin/waivers/records/[id]
- GET /api/admin/waivers/guests/search?q=

B14. Activity log
Log template publish (already), sign complete (entity WaiverRecord), request send, kiosk submit. No signature SVG in metadata.

B15. Smoke scripts/smoke-waivers-phase2.mts + yarn smoke:waivers:p2
T1 Public sign adult success → signed + expiry set
T2 Minor without guardian rejected
T3 Guardian + two minors → two or N per-person records all signed
T4 Expired token 410
T5 Replay token does not double-sign valid waiver
T6 Cross-org token cannot sign other org template
T7 Staff-assisted onsite
T8 Kiosk submit + session
T9 SMS without provider 400
T10 Email request creates hashed token
T11 Custom form response stored
T12 Drawn or typed signature required per settings
T13 Intent checkbox enforced
T14 contentSha256 mismatch rejected if client tampers version id
T15 Suspended org cannot public-sign
T16 Shop checkout still works

================================================================================
C. WORKFLOWS (BEFORE / START / DURING / SUCCESS / FAILURE / REPEAT)
================================================================================

Covered in B3–B8. Also: DECLINED — guest declines → WaiverRecord status declined; check-in evaluate → declined (treat as blocking if enforcement=block). VOID is Phase 3.

================================================================================
D. COMPLETION GATE PHASE 2
================================================================================

- Online, QR, on-site, kiosk signing all persist real WaiverRecord + audit.
- Guardian/minor rules enforced from WaiverSettings.
- Requests email works; SMS honest.
- Public APIs token-scoped, rate-limited, no JWT org trust.
- smoke:waivers:p1 and p2 green.
THEN STOP.

```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 2 of Digital Waivers. SSOT: docs/digital-waivers-complete-spec.md

VERIFY Phase 1 still holds, then deep-audit Phase 2. Fix anything incomplete or incorrect; re-test; do not start Phase 3.

Verify ALL of:
1. Previous-phase entitlement/schema/publish still work.
2. Tokens hashed at rest; raw token only in email/SMS/QR URL.
3. Public POST cannot stamp arbitrary orgId/locationId/templateVersionId (server loads from token).
4. Minor/guardian/group rules; per-person records consistent.
5. Audit: intent, name/signature, sha256, time/timezone, ipHash, userAgent, locale.
6. Replay / already-valid / re-sign-when-expired behavior.
7. Kiosk is signing-only (no ticket cart). PIN/token hashes not re-exposed.
8. SMS fail-closed when unconfigured.
9. Custom forms + contracts use the same engine.
10. Rate limits on public sign.
11. GuestProfile upsert does not create shop User or reopen signup.
12. Signature media not in activity log or company export.
13. Multi-locale snapshot correct.
14. Suspended/unpaid/Demo orgs cannot collect new signatures.
15. smoke:waivers:p2 matrix including cross-tenant and minor rejection.
16. No Feature 07 scanners or Feature 19 ticket kiosk.

Fix gaps, re-run p1+p2 smokes, re-check /admin/waivers templates still publish. Only then mark Phase 2 complete.

```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md
VERIFY PHASE 2 FIRST (signing, guardian, kiosk, tokens). Fix capture bugs before Venue Manager polish.

Execute ONLY Phase 3. Do not claim Check-In or Party Command Center complete. Do not add unrelated marketing campaigns.

================================================================================
A. PHASE 3 OBJECTIVE
================================================================================

Venue Manager can search, view, void, resend, import, and export waivers and form responses. Staff can verify a guest’s waiver at the desk. Expiry reminders send on the daily cron piggyback. QR signage is printable. Product-attached forms collect extra guest info. Operators can use Florida/US compliance guides as checklists.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 3
================================================================================

B1. Verify Phase 2 signing paths. Carry-forward fixes first.

B2. Venue Manager — signed waivers
/admin/waivers
- Search: name, email, phone, publicRef, date range, status, template, location, channel, expiring-within
- Table: guest, template, version, signedAt, expiresAt, status, channel, minors
- Detail /admin/waivers/records/[id]: signers, audit (no raw IP), signature image, void/resend, PDF/HTML print
- Filters persist in query string
- Location scope applied for Enterprise HQ park preference

B3. Staff verification (front desk WAIVER action)
/admin/waivers/verify
- Search guest → evaluateGuestWaivers → chips: VALID / MISSING / EXPIRED / DECLINED / PENDING / MINOR UNSIGNED
- If enforcement=block, show “Do not admit” ; if warn, “Warn — manager may continue”
- Optional: attach newly signed kiosk/onsite from this screen (reuse Phase 2 staff-assisted)
- GET /api/admin/waivers/evaluate?guestProfileId= | ?q=
This is the Feature 07 waiver gate, not the full scanner app.

B4. Send / resend requests + chase
- From detail and list bulk (reasonable cap, e.g. 50): resend email/SMS with new token if previous expired; cancel outstanding requests
- Party/booking chase: IF PartyGuest exists, list missing by partyId and send; ELSE skip UI and keep helper for Phase 4

B5. Expiry + automated reminders
- Cron lib src/lib/waivers/remindExpiring.ts
- Select signed records whose expiresAt is in remindBeforeDays windows, not yet reminded for that window (watermark lastRemindedAt or WaiverReminderWatermark unique recordId+window)
- Email guest; SMS if phone + provider configured
- Idempotent; skip voided/declined/already expired
- Wire into existing daily GET /api/cron/remind-company-subscriptions AFTER billing remind (try/catch isolated, like invite TTL). Do NOT add vercel.json cron #3.
- Dedicated GET/POST /api/cron/waivers-remind (Bearer CRON_SECRET) for CLI/GH + yarn waivers:remind
- Expired records: evaluate returns expired; optional nightly status flip signed→expired or compute live (prefer live compute from expiresAt so you do not need a status cron). UI shows Expired when expiresAt < now.

B6. Import signed waiver data (CSV)
- POST /api/admin/waivers/import (waivers:admin)
- Columns: firstName, lastName, email, phone, dob, signedAt, expiresAt, templateSlug, locale, externalRef, guardianName?
- Preview (dryRun) then commit; per-row errors; max rows bounded (e.g. 2000)
- channel=import, signerRole=imported, audit intentAccepted=true with note “imported historical”
- Idempotency: org+externalRef unique when provided
- Do not overwrite a newer live signature with older import

B7. View & export form responses + waivers
- /admin/waivers/forms/responses
- GET /api/admin/waivers/export?type=records|responses (waivers:export) CSV
- Include template version number, hashes of content (not SVG), guest contact, status
- Rate limit export

B8. Update agreement text (operator workflow complete)
- Version history UI already in P1: ensure staff can diff summary (version, date, publisher) and set requireResignOnPublish
- When requireResignOnPublish, evaluate treats older version as version_stale / missing for requirements that point at that template (include in evaluate output as missingRequirements with reason stale_version)

B9. QR signage
- Print page with venue name, instructions, QR, logo. Gold/stone Harewa layout.

B10. Add forms to products
- Requirements UI: pick target type. If AdmissionProduct/PosProduct lists exist, picker from those APIs; else manual targetId + help text “paste product id when ticketing/POS ships”
- Product addon form fields appear on public sign when requirement matches

B11. Guest /profile (customer surface only)
- If signed-in User.email matches GuestProfile.email in an entitled org’s records, /profile?tab=waivers may list their own records (read-only PDF/receipt). No void. No other guests. If too awkward without org picker, skip profile tab and document that guests use email receipt — do not put Venue Manager on /profile.

B12. Void / revoke
- waivers:void; reason required; status voided; evaluate → voided (blocking)
- Do not delete rows (retention). Never hard-delete signatures.

B13. Notifications
- In-app NotificationType waiver for staff when? optional: daily digest skip. Guest email is enough. Staff in-app on void/import complete optional.

B14. Smoke scripts/smoke-waivers-phase3.mts + yarn smoke:waivers:p3
T1 Search/filter records by email + status
T2 Evaluate valid vs expired vs missing
T3 Void requires permission; finance without void 403
T4 Export CSV
T5 Import dryRun + commit + idempotent externalRef
T6 Remind watermark does not double-send
T7 requireResignOnPublish → stale
T8 Cross-tenant record detail 403
T9 Kiosk still signs
T10 Cron route unauthorized without CRON_SECRET

================================================================================
C. COMPLETION GATE PHASE 3
================================================================================

- Venue Manager list/detail/verify/void/import/export work.
- Reminders piggyback daily cron; no third Vercel cron.
- Compliance guides still visible.
- smoke p1–p3 green.
THEN STOP.

```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 3 of Digital Waivers. SSOT: docs/digital-waivers-complete-spec.md

VERIFY Phase 2 signing still works, then deep-audit Phase 3. Fix issues; re-test; do not start Phase 4.

Verify ALL of:
1. Venue Manager search/filter/detail/print.
2. evaluate + verify UI matches engine (no second status mapping).
3. Void retention (no delete); permissioned.
4. CSV import validation, idempotency, imported channel honesty.
5. Export omits SVG/raw IP/token hashes.
6. Reminder cron piggyback + dedicated route; idempotent watermarks.
7. vercel.json still exactly 2 crons.
8. requireResignOnPublish stale handling.
9. Product form requirements UI honest if ticketing/POS missing.
10. /profile has no operator tools.
11. HQ location scope filters waiver lists when locationScoped.
12. Cross-tenant IDOR on records/export/import.
13. smoke:waivers:p3 + prior smokes.
14. Florida guide disclaimer present.

Fix gaps, re-run smokes, re-sign a public token to prove Phase 2 unregressed. Only then mark Phase 3 complete.

```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md
VERIFY PHASE 3 FIRST (manager, verify, import, reminders). Fix those before cross-module wiring.

This phase is integration, security, reliability, and cross-feature synchronization. Do NOT fake modules that are still unbuilt.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Digital Waivers behaves as one connected system with whatever park modules actually exist: ticketing waiverRequired, POS waiver search/assign, party missing counts, HQ/export/Demo/billing, rate limits, PII, webhooks/activity, landing/README honesty. Split-brain status chips are forbidden.

================================================================================
B. FEATURES / TASKS THAT MUST BE COMPLETE IN PHASE 4
================================================================================

B1. Verify Phase 3. Carry-forward fixes first.

B2. Ticketing (IF AdmissionProduct / Booking / BookingGuest exist)
- Honor waiverRequired: booking confirm and staff booking detail call evaluateGuestWaivers for each guest.
- Online booking confirmation email includes waiver link when missing (reuse WaiverRequest).
- Do not build the public /book wizard if Feature 01 is unbuilt — only wire helpers + call sites that exist.
- If ticketing does not exist: export src/lib/waivers/bookingHooks.ts documented for the ticketing epic; do not stub fake Booking rows.

B3. POS (IF PosSale / check-in redeem exists)
- Replace stub GET /api/pos/waivers/search with real search (same evaluate + records).
- At redemption, warn/block per WaiverRequirement.enforcement / product.waiverRequired.
- Do not build POS terminal if Feature 02 is unbuilt.

B4. Parties (IF PartyGuest / PartyBookingDetail exist)
- Recompute waiverMissingCount and PartyGuest.waiverStatus from evaluate engine on sign/void/expire (live or on read).
- Party detail Waivers tab: list guests + send request. Do NOT claim Party Command Center complete if other tabs are still stubs.
- If parties unbuilt: helper src/lib/waivers/partyHooks.ts only.

B5. Check-in module honesty
- Keep /admin/waivers/verify as the WAIVER front-desk action.
- If POS check-in page exists, embed the same chip component (shared React component).
- Do not ship barcode hardware features.

B6. Guest CRM
- GuestProfile detail (if POS guest page exists) shows linked waivers. If no guest page, add /admin/waivers/guests/[id] read-only or keep data on record detail only.

B7. companyExport / offboard
- Counts + redacted metadata only. No signature SVG, no device tokens, no PIN hashes, no ipHash optional omit.
- Offboard does not hard-delete waiver rows.

B8. HQ
- Location scope filters waiver lists/kiosks/settings-by-location.
- Overview: entitled + published template ⇒ module status enabled; include real signed-count for scoped venues if cheap; never random numbers.

B9. Security hardening
- Public sign rate limits + token entropy
- Staff IDOR tests
- Hash IPs; minimize PII in logs
- Cloudinary/public URLs not listable cross-tenant
- Kiosk token rotation endpoint
- Manager/staff cannot download another org’s CSV

B10. Reliability
- Sign POST idempotency key (header or body) unique per request id to prevent double-submit
- Publish/sign transactions (record + signers + signature)
- Mail/SMS failure does not roll back a successful signature (request status failed vs record signed)

B11. Docs / landing / README
- Enforce waivers moduleHints in prose: Growth+Enterprise live when this ships.
- Landing #waivers: short honest section (signing, QR, minors, verify) WITHOUT claiming POS/ticketing/check-in full apps if those are unbuilt.
- Header: remove “(roadmap)” when module is real; keep other unbuilt modules honest.
- Residual backlog explicit: full Check-In, ticket kiosk, membership billing, SMS if no Twilio, legal counsel, RLS still deferred.

B12. Permissions catalog visible in /admin/users role editor.

B13. Smoke scripts/smoke-waivers-phase4.mts + yarn smoke:waivers:p4
T1 Booking hook or skip-documented
T2 POS search or skip-documented
T3 Party counts or skip-documented
T4 Export redaction
T5 HQ scope
T6 Idempotent double POST sign
T7 Suspended org
T8 Starter still 403
T9 Shop regression
T10 Daily remind still runs billing + waivers without throwing

================================================================================
C. COMPLETION GATE PHASE 4
================================================================================

- Existing modules consume evaluateWaiver; no parallel stub statuses left where those tables exist.
- Unbuilt modules: hooks only, no fake UI.
- Docs honest. p1–p4 smokes green.
THEN STOP.

```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 4 of Digital Waivers. SSOT: docs/digital-waivers-complete-spec.md

VERIFY Phase 3 manager/verify/import/reminders, then deep-audit Phase 4 integrations. Fix issues; do not start Phase 5 until this audit’s fixes are re-tested.

Verify ALL of:
1. evaluateWaiver is the only status engine.
2. Ticketing/POS/Party: wired if present, hooks-only if absent — no fake bookings/POS/parties.
3. POS WaiverRecord stub not left as a second incomplete model.
4. HQ location scope; export redaction; no hard-delete.
5. Idempotent public sign; rate limits; IDOR.
6. vercel.json still 2 crons; remind piggyback cannot fail the billing remind (isolated catch).
7. README/landing/header/HQ match reality.
8. /signup closed; shop intact; tailor unchanged.
9. Demo/Starter/storefront still denied.
10. smoke:waivers:p4 + prior.

Fix gaps, re-run smokes including smoke:company-saas-hardening if you touched cron/export/HQ. Only then mark Phase 4 complete.

```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md
VERIFY PHASE 4 FIRST. Fix integration/docs/tenancy issues before final audit work.

This is the final phase: testing, optimization, honesty, production readiness, independent system audit. Do NOT add unrelated features. Do NOT fake Check-In scanners, ticket kiosk commerce, Intercard, membership dunning, or legal certification.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Digital Waivers is production-ready as a connected module: planned functionality works, supporting pieces exist, control plane agrees, docs are honest, smokes all pass, residual backlog is explicit.

================================================================================
B. FEATURES / TASKS THAT MUST BE COMPLETE IN PHASE 5
================================================================================

B1. Verify Phase 4 smokes + fix remaining gaps from any phase (carry forward).

B2. Full smoke pack
scripts/smoke-waivers-phase5.mts + yarn smoke:waivers:p5 + yarn smoke:waivers:all (p1…p5)
Matrix:
T1 Cross-tenant deny (templates, records, kiosk, export, evaluate)
T2 Demo/storefront/Starter/unpaid/pending/suspended deny
T3 Adult online sign → valid evaluate
T4 Minor rejected; guardian+minors valid
T5 QR/kiosk/onsite channels persist
T6 Token replay / expired token
T7 Expiry rules never/days/calendar_year/visit/until_date
T8 Remind idempotent
T9 Void blocks evaluate
T10 requireResignOnPublish stale
T11 CSV import idempotent
T12 Export redaction
T13 Custom form + product requirement
T14 Contract kind signs
T15 SMS unconfigured 400
T16 Device cap none (no fake meter) but archived kiosk cannot sign
T17 HQ location filter
T18 Double-submit idempotency
T19 Shop checkout + /signup closed
T20 Fashion Product not used as waiver template
T21 Billing remind cron still succeeds if waiver remind throws (isolated)
T22 Permissions: finance export without void; catalog_editor no access
T23 contentSha256 tamper
T24 Group cap maxMinorsPerGuardianSession
T25 Locale es (or second locale) snapshot

B3. README / landing honesty
- Module entitlement: Digital Waivers enforced for Growth+Enterprise.
- Do not claim Feature 07 Check-In, Feature 19 ticket kiosk, Feature 08 memberships, Feature 01/02 complete unless those epics actually shipped.
- Residual backlog listed: full check-in scanners, ticket-purchase kiosk, membership recurring engine, Twilio optional, Party Command Center if unbuilt, RLS deferred, not legal advice.

B4. Performance
Indexes used on guest search, publicRef, token hashes, expiresAt reminders, orgId+locationId+status. Avoid N+1 on record detail (include signers+signature).

B5. Permissions catalog complete in admin Users UI.

B6. Env documentation
NOTIFICATION_EMAIL_*, optional TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM (or whatever adapter you implemented), CRON_SECRET, Cloudinary for signature images.

B7. Independent end-to-end trace (fix as you go)
entitled Growth company → venue → settings (US-FL, majority 18) → publish EN+ES waiver → QR signage → public adult sign → guardian+minor sign → staff verify VALID → void → evaluate blocks → new version requireResign → stale → import CSV → export → kiosk sign → remind dry-run → Demo deny → shop still works.

B8. Re-run company-saas-hardening, plan-limits, venue-locations, enterprise-hq smokes if waivers touched those files.

B9. Independent audit pass of this spec’s in-scope list vs code. Any partial implementation: finish or remove the nav entry. No placeholders.

================================================================================
C. COMPLETION GATE PHASE 5 / SYSTEM COMPLETE
================================================================================

- All 5 phases’ completion gates true.
- In-scope Feature 05 + forms/documents list implemented.
- Cross-feature sync done for modules that exist.
- Security/tenancy/Demo/Starter/storefront correct.
- Tests complete; residual backlog honest.
THEN STOP.

```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 5 / FINAL SYSTEM AUDIT of Digital Waivers.
SSOT: docs/digital-waivers-complete-spec.md

Do not trust earlier completion reports. Independently trace the feature through the app. If anything is incomplete or incorrect: FIX IT, re-test the workflow, re-check synchronization, then continue.

Verify:
1. Every in-scope item in this spec (signing channels, QR, expiry, minors, verify, multi-language, history, update text, requests SMS/email, kiosk setup, contracts, custom forms, product forms, view/export responses, Venue Manager, CSV import, compliance guides).
2. Every out-of-scope item is NOT faked.
3. Files/components/APIs connected; no dead routes in nav.
4. Data consistency: one GuestProfile hub; one WaiverRecord store; evaluateWaiver SSOT.
5. Integrations: cron, export, HQ, mailer, optional SMS, ticketing/POS/party if present.
6. Security, validation, errors, edge cases, regressions (shop, signup, Demo, tailor).
7. Partial/missing/incorrect/disconnected/unused/duplicate/conflicting implementation.
8. smoke:waivers:all green plus control-plane smokes if touched.

After fixes: re-check the fix, re-test affected workflow, re-check related functionality.
Only then mark Digital Waivers complete.

```

---

## Completion criteria (summary)

| Phase | Must be true |
|---|---|
| 1 | Entitlement, schema, templates/versions/locales, settings, requirements, kiosk shells, compliance guides, evaluate stub, smokes, no public capture |
| 2 | Online/QR/kiosk/onsite signing, guardian/minors, audit trail, requests email, honest SMS, custom forms/contracts |
| 3 | Venue Manager, verify, void, import/export, reminders on daily cron, signage, product forms |
| 4 | Wire real sibling modules or hooks only; HQ/export/security/docs sync |
| 5 | Full smokes, performance, honest README, independent audit, residual backlog |

**System complete when:** Growth/Enterprise parks can collect, version, expire, remind, verify, import, and export digital waivers and custom forms with guardian rules and e-sign audit; Starter/Demo/storefront cannot; shop and signup unchanged; Check-In/POS/Parties consume the same engine when those tables exist; docs do not claim legal certification or unbuilt FEC apps.
