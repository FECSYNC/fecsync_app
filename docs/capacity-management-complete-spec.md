# Capacity Management — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 06 — Capacity Management (BOOKINGS) — real-time inventory of bookable capacity  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 06.  
**Competitor brief:** `docs/roller-competitor-product-brief.md` row 6 (Critical) — attractions, sessions, rooms, lanes, party rooms, real-time availability.  
**Shared substrate names:** `docs/online-booking-ticketing-complete-spec.md` (CapacityResource, TicketSession, StockPeriod, bookingEngine capacity rules).  
**Consumers (reuse contracts, do not fake-complete):** `docs/pos-complete-spec.md`, `docs/party-management-complete-spec.md`, `docs/digital-waivers-complete-spec.md` (waivers only consume capacity if present — do not build waiver signing here).  
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
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` / `Product.quantity` / `remainingInStock` as park capacity, sessions, rooms, or holds.
- Do **NOT** reuse staff `Membership` (org seat) as a guest or as a capacity “slot.”
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker). Public availability is venue/token scoped — never a tenant JWT as write authority.
- DEFAULT_ORG / storefront never runs tenant Capacity Management admin. Demo plan locks capacity/ticketing admin. Unpaid / pending / suspended orgs fail closed.
- Capacity module entitlement rides **ticketing**: `assertModuleEnabled(orgId, "ticketing")` then billing entitlement. Starter, Growth, and Enterprise allow capacity. Demo does not. Do **not** invent a separate paid `capacity` SKU.
- Staff Capacity / Ticketing capacity surfaces live under `/admin/capacity*` and `/admin/ticketing/resources|sessions|…` (plus `/api/admin/capacity/*` and shared `/api/admin/ticketing/*` capacity routes). Register every path in `API_PERMISSIONS`. Customer `/profile` never gets operator capacity tools. Tailor `/tailor/*` gets no capacity ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav.
- One connected system: **`TicketSession.remaining` (+ resource busy windows for rooms/lanes/party rooms)** is the SSOT. Online booking, POS, and front desk MUST call `src/lib/ticketing/capacity.ts` / `bookingEngine.ts` — never invent a second remaining counter per channel.
- Shared model/enum names MUST match `docs/online-booking-ticketing-complete-spec.md` when creating the park-booking substrate. If those models already exist, REUSE them. Do **not** claim Feature 01 (Online Booking), Feature 02 (POS), Feature 04 (Party Management), or Feature 05 (Digital Waivers) complete.
- Do **not** fake-complete: full public `/book/*` checkout wizard, Stripe guest ticket capture as a finished product, full POS terminal/till/KDS, Party Command Center, digital waiver signing / guardian / QR waiver forms, Feature 07 check-in scanner hardware UI, OTA / Viator / Klook / GetYourGuide, Intercard/Sacoa, dynamic pricing engine, promo codes, reopen signup.

**IMPORTANT — description bleed:** Any prompt text elsewhere that mentions on-site waiver signing, QR waiver forms, waiver expiration, minor/guardian signing, or staff waiver verification belongs to **Feature 05 Digital Waivers**, not Capacity Management. Ignore that bleed here.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring (re-inspect at execution time — ticketing/POS/parties may have shipped):

- Control plane **is** shipped: Organization, VenueLocation (including **timezone**), Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile, Stripe, mailer, activityLog, companyExport, smoke script pattern, rateLimit, cron (`CRON_SECRET`).
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet. Shop stock is **not** park capacity.
- Online Booking / Ticketing, POS, Party Management, and Digital Waivers are **specified** in `docs/*-complete-spec.md` but **were not present** in `prisma/schema.prisma` at authoring (no CapacityResource / TicketSession / Booking / BookingHold). **Inspect again.** If those tables exist, REUSE them. If not, this epic creates the capacity substrate (and minimal booking/hold models required for capacity) using ticketing SSOT names.
- `src/lib/moduleEntitlement.ts` and `assertModuleEnabled` **may not exist**. Create or extend them. Do not invent a second module-gate helper name.
- `moduleHints`: Demo `[]`; Starter `["ticketing"]`; Growth includes `"ticketing"`; Enterprise `"all"`. Capacity rides ticketing — Starter allowed; Demo locked.
- `FuturePlanModules.ticketsPerMonth` is a documented hook — move into enforceable `PlanLimits` only when confirm burns tickets; otherwise leave as documented hook and do not fake-meter.
- No `/admin/capacity`, `/admin/ticketing`, `src/lib/ticketing/**`, or capacity smoke scripts at authoring.
- Landing may mention live capacity as roadmap copy only. HQ overview may list future modules as `not_enabled` — keep honest.
- Vercel Hobby **≤2 crons** in `vercel.json`. Prefer piggybacking hold expiry on an existing cron path **or** a dedicated `/api/cron/expire-booking-holds` runnable via CLI/GH Actions with `CRON_SECRET` — do not break the 2-cron Vercel limit without an explicit existing pattern.

---

## Scope (complete) vs non-goals

**In scope (this epic — Feature 06 + Resources / Schedules / Capacity):**

1. Resources — jump zones / attractions, party rooms, lanes, arenas, climbing walls / walls as resource types (map to CapacityResourceType: `attraction | session | room | lane | party_room | other`).
2. Operating hours — venue-wide; bulk schedule updates.
3. Product schedules — linked to operating hours or fully custom session series.
4. Real-time capacity — synced across online, POS, front desk (and ready for OTAs later without implementing OTA connectors).
5. Daily capacity view — expected vs actual headcount, redemptions.
6. Calendar view — monthly (and day/week) bookings / occupancy.
7. Block / reduce capacity temporarily on resources (and sessions / date ranges).
8. Overbooking — permission-based (`bookings:overbook` only; guests never).
9. Buffer times — especially for party packages / room turnovers.
10. Split bookings across resources (multi-line / atomic resource move).
11. Session punctuality / no-show tracking.
12. Booking item limits (qty vs remaining + product min/max).
13. Prevent double-booking of party rooms.
14. Live availability APIs for online booking, POS, and front desk so oversell is prevented unless an authorized override is used.
15. Holds with TTL, confirm/cancel/reactivate capacity effects, expire-holds job, redeemed heads do not restore capacity.
16. Module entitlement, RBAC, Demo lock, tenant isolation, HQ location-scope honesty, smokes, docs honesty.

**Out of scope (do not fake-complete):**

- Full Feature 01 public booking wizard + guest Stripe checkout as a finished Online Booking product (ship capacity + availability + hold/confirm **capacity** contracts they will call).
- Full Feature 02 POS terminal (cart, till, KDS, offline hardware) — ship POS/front-desk **availability / capacity snapshot** APIs (and a thin capacity panel only if it calls real data).
- Full Feature 04 Party Command Center (invites, food, deposits UI) — ship party_room conflict + buffer rules on the shared engine.
- Feature 05 Digital Waivers signing / guardian / QR waiver forms / staff waiver verify UI.
- Feature 07 check-in scanner hardware app (use redemption events for “actual” when credentials exist; honest labeling when check-in is absent).
- OTA / Viator / Klook / GetYourGuide / Trip.com connectors.
- Intercard / Sacoa / Amusement Connect, dynamic pricing engine, promo codes, reopen `/signup`.

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md
Catalog: docs/fec-os-cursor-feature-catalog.md Feature 06
Shared names: docs/online-booking-ticketing-complete-spec.md Phase 1 §C3
Execute ONLY Phase 1. Do not implement transactional overbook engine, hold TTL expire job, daily expected-vs-actual board, calendar occupancy polish, POS capacity tab, public checkout wizard, waiver signing, or OTA connectors yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for guests or capacity slots).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER tenant Capacity Management admin. Never locked by tenant expiry.

Capacity Management is Feature 06 — real-time inventory of bookable capacity for attractions, timed sessions, rooms, lanes, and party rooms. Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "ticketing").
- Every park business row: orgId required + locationId required (FK VenueLocation; assert venue.orgId === orgId) except true org-default settings (locationId null = org default) where the ticketing SSOT already allows org defaults.
- Company admin lives under /admin/*. Public may later read availability by venue/token. Tailor studio: no capacity ops.
- Expose live availability to online booking, POS, and front desk in later phases so oversell is prevented unless an authorized override is used.

Shop commerce (Product, Cart, Order with cartId + walletId + shipping) is fashion retail. Do NOT store park capacity, sessions, or holds there. Do NOT use Product.quantity / remainingInStock as park inventory.

IGNORE waiver-signing / QR waiver / guardian / waiver-verify text if it appears in any pasted Capacity description — that is Feature 05.

Reuse: Organization, VenueLocation (timezone), Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, activityLog.ts, Notification + notificationService, companyExport.ts, smoke scripts, rateLimit.ts, resolveBrandForOrg / CompanyProfile patterns.

Do NOT reuse as capacity store: Product, Cart, CartLine, Order (shop), Wallet, TailoringJob, staff Membership-as-guest, Fabric stock.

Shared park-booking substrate dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/moduleEntitlement.ts and src/lib/ticketing/ and /admin/ticketing and /admin/capacity.
2. IF CapacityResource / TicketSession / StockPeriod (and minimal Booking / BookingHold / BookingLine if needed) ALREADY exist AND capacity helpers exist: REUSE them. Extend with operating hours, buffer fields, punctuality/no-show fields, capacity admin routes as needed. Do not duplicate schemas.
3. IF they do NOT exist: CREATE the shared park-booking models required for Capacity using the EXACT enum/model names from docs/online-booking-ticketing-complete-spec.md Phase 1 section C3 that capacity needs (listed in C3 below). Create capacity.ts read helpers now. Hold/confirm mutate paths may wait for Phase 2, but remaining field MUST exist and initialize to capacity. Do NOT build public /book/* wizard. Do NOT claim Feature 01 / 02 / 04 complete.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Starter/Growth/Enterprise operators can: enable capacity ops via ticketing entitlement, configure venue operating hours (including bulk weekday updates), manage capacity resources (attraction, session, room, lane, party_room, other), create product-linked or custom TicketSession schedules (series), see Capacity / Ticketing capacity nav and route shells, preview remaining (= capacity initially), and fail closed on Demo/storefront/unpaid/pending/suspended. Public cannot mutate capacity. No overbook engine, no daily board, no POS capacity tab, no waiver UI in Phase 1.

================================================================================
C. TECHNICAL IMPLEMENTATION — PHASE 1 (DO ALL OF THIS)
================================================================================

C1. moduleEntitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, moduleId).
- Create src/lib/ticketing/assertTicketingEnabled.ts (thin wrapper) used by capacity.
- Optionally src/lib/capacity/assertCapacityEnabled.ts that calls assertTicketingEnabled — do not invent a separate paid capacity SKU.
- Starter + Growth + Enterprise: allowed. Demo: denied. Unpaid/pending/suspended: fail closed via existing Fresh/billing asserts.
- Do not enforce moduleHints inside planLimits until modules ship — but this epic SHIPS capacity foundation, so assertModuleEnabled("ticketing") IS enforced for capacity routes.

C2. Prisma — all new tables: orgId required, indexed, FK Organization. Park-scoped: locationId required (or null only for true org-default settings), FK VenueLocation.

Enums (exact names where from ticketing SSOT):
- CapacityResourceType: attraction | session | room | lane | party_room | other
- StockPeriodKind: available | blocked
- BookingStatus (if creating Booking now): draft | hold | reserved | pending_payment | confirmed | cancelled | expired | refunded
- BookingChannel (if creating Booking now): online | phone | walk_in | pos | account
- BookingCreateMode (if needed): hold | reserve | prompt
- Add capacity-ops enums as needed, e.g. AttendanceOutcome: on_time | late | no_show | unknown (or equivalent string enum) for Phase 3 use — nullable columns OK in Phase 1.

Models you MUST create or reuse:

CapacityResource:
id, orgId, locationId, name, type CapacityResourceType,
defaultCapacity Int (>=0),
bufferMinutes Int default 0 (for turnovers / party packages),
archivedAt DateTime?,
createdAt, updatedAt.
Timezone inherited from VenueLocation — do not duplicate timezone on resource unless you have a strong existing pattern.

VenueOperatingHours (name may be VenueHours / OperatingHours — pick one and use consistently):
id, orgId, locationId,
weekday Int 0–6 (document Sunday=0 or Monday=0 clearly in code comments + UI),
opensAt local time string or minutes-from-midnight,
closesAt,
isClosed Boolean default false,
createdAt, updatedAt.
Unique per orgId+locationId+weekday (or allow multiple ranges per day if you support split shifts — document which).

VenueHoursException (recommended for bulk/real ops):
id, orgId, locationId, date (date-only or DateTime UTC date),
isClosed Boolean, opensAt?, closesAt?, reason?,
createdAt, updatedAt.

CapacityScheduleRule (optional but preferred for “product schedules linked to operating hours OR fully custom”):
id, orgId, locationId,
admissionProductId? (if AdmissionProduct exists; else defer product link and allow resource-only sessions),
resourceId,
mode inherit_hours | custom,
slotDurationMinutes?, capacityOverride?,
weekdays Int[], 
archivedAt?,
createdAt, updatedAt.
If you defer this table, you MUST still support: (a) generate sessions from venue hours, (b) fully custom session series CRUD.

AdmissionProduct (create minimal if missing and you need product-linked sessions; otherwise allow TicketSession.productId optional and document):
Use ticketing SSOT fields that capacity needs: orgId, locationId, type, name, resourceId?, published, minGuests, maxGuests, archivedAt.
Do NOT build full catalog UI for all product types in Phase 1 unless required — minimum is enough to attach sessions. Prefer creating AdmissionProduct if missing so Sessions can link productId.

TicketSession:
id, orgId, locationId,
startsAt, endsAt,
capacity Int (>=0),
remaining Int (MUST initialize = capacity on create; Phase 2 mutates transactionally),
resourceId, productId?,
priceOverride Int?,
isClosed Boolean default false,
createdAt, updatedAt.
Indexes: (orgId, locationId, startsAt), (resourceId, startsAt, endsAt), (productId, startsAt).

StockPeriod:
id, orgId, locationId,
startsAt, endsAt,
kind StockPeriodKind (available | blocked),
quantity Int? (optional cap),
resourceId? and/or productId? as needed,
createdAt, updatedAt.
Phase 1: CRUD foundation for blocked/available periods. Phase 3 uses these heavily for temporary blocks.

Booking / BookingHold / BookingLine (create MINIMAL now only if needed for coherent FKs and Phase 2 readiness):
- Booking: publicId, orgId, locationId, status, channel, createMode?, holdExpiresAt?, visitStartsAt?, visitEndsAt?, createdById?, …
- BookingHold: TTL, sessionId?/resourceId?, qty claimed, token, orgId, locationId, expiresAt
- BookingLine: product snapshot fields as needed, qty, resourceId?, sessionId?, visit date
Do NOT implement Stripe booking payments, invoices, or public checkout in Phase 1.

Capacity settings (optional org/location defaults):
e.g. defaultBufferMinutes, defaultHoldTtlMinutes (may live on BookingSettings from ticketing SSOT — if you create BookingSettings, match ticketing field names: defaultCreateMode, holdTtlMinutes, reserveTtlHours, …).

Punctuality / no-show placeholders (nullable OK in Phase 1 for Phase 3):
- On Booking or a CapacityAttendance row: attendanceOutcome?, markedAt?, markedById?
Do not build the daily board UI yet.

ActivityEntityType / NotificationType:
Extend ActivityEntityType with CapacityResource, TicketSession, and Booking-related types if creating them.
Extend NotificationType only if you send capacity notices in later phases — not required in Phase 1.

C3. Permissions — add ALL of these to src/lib/auth/permissions.ts (P object, PERMISSION_CATALOG, ROLE_PRESETS, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS). If keys already exist from another epic, REUSE — do not invent a second vocabulary.

- ticketing:read — view catalog, sessions, resources, hours, capacity read
- ticketing:write — create/edit resources, slots/sessions, hours, stock periods, buffers
- ticketing:manage — default booking/capacity behavior settings, TTLs
- bookings:read — list/detail/search/calendar capacity views
- bookings:write — create/edit/cancel holds/bookings notes (Phase 2+)
- bookings:assign — assign staff (register now if creating booking perms set)
- bookings:overbook — confirm beyond capacity (register now; enforce in Phase 2)
- bookings:export — export capacity/booking data (register; use in later phase if CSV added)
- bookings:read_own / bookings:write_own — client profile (register if booking substrate created; no operator tools on profile)

Preset grants (align with ticketing SSOT):
- platform_admin: all
- ops_manager: ticketing read; bookings read/write/assign; NO overbook, NO export (unless finance-like — follow ticketing: ops_manager NO overbook)
- catalog_editor: ticketing read/write; bookings read only
- finance: ticketing read; bookings read; export yes; NO overbook unless ticketing SSOT says otherwise
- client: *_own only
- tailor: none for ticketing/bookings/capacity

C4. Admin routes — register ADMIN_ROUTE_PERMISSIONS and add to ADMIN_REGISTERED_COMPANY_ONLY_PATHS. Demo must NOT allow these paths (not in isDemoAllowedAdminPath).

Working UIs in Phase 1:
- /admin/capacity — Capacity home / overview shell (links to daily/calendar shells + resources/hours/sessions)
- /admin/capacity/resources — OR /admin/ticketing/resources — CapacityResource CRUD (Name, Type, Venue, Default capacity, Buffer minutes, Archived, Actions Edit/Archive)
- /admin/capacity/hours — OR under venue/capacity — Venue operating hours editor + bulk weekday update + exceptions
- /admin/capacity/sessions — OR /admin/ticketing/sessions — calendar + table; create series (weekdays, start/end, capacity); close session; remaining display
- /admin/capacity/settings — defaults (buffer, hold TTL if BookingSettings created)

Shell-only (must exist in nav/permissions; may be empty/placeholder until Phase 3):
- /admin/capacity/daily — daily expected vs actual (Phase 3)
- /admin/capacity/calendar — occupancy calendar (Phase 3)
- /admin/capacity/blocks — temporary block/reduce UI (Phase 3) — OR implement blocks under resources if you prefer one page (still register a clear route)

You MAY mirror ticketing paths from the ticketing spec (/admin/ticketing/resources, /admin/ticketing/sessions) AND add /admin/capacity as the Feature 06 operator home. Prefer one SSOT list component reused by both routes if both exist — do not maintain two divergent CRUDs.

C5. Admin sidebar (src/lib/adminNav.ts) — Capacity group (registered-company):
Capacity → /admin/capacity
Daily → /admin/capacity/daily
Calendar → /admin/capacity/calendar
Resources → /admin/capacity/resources (or ticketing/resources)
Sessions → /admin/capacity/sessions (or ticketing/sessions)
Hours → /admin/capacity/hours
Blocks → /admin/capacity/blocks
Capacity settings → /admin/capacity/settings
Add Dashboard quick link: Capacity.
Extend prefetchAdminRoute.ts stubs for these paths.
Add icon key if needed (reuse "operations" if you do not want a new icon).

C6. Staff APIs for Phase 1 (register every method+path in API_PERMISSIONS; reject ?orgId= and body orgId):
GET/POST /api/admin/capacity/resources  (and/or /api/admin/ticketing/resources)
GET/PATCH/DELETE /api/admin/capacity/resources/[id]  (soft-archive)
GET/PUT /api/admin/capacity/hours
POST /api/admin/capacity/hours/bulk
GET/POST /api/admin/capacity/hours/exceptions
GET/POST /api/admin/capacity/sessions  (and/or /api/admin/ticketing/sessions)
PATCH /api/admin/capacity/sessions/[id]  (edit capacity while remaining==capacity or carefully adjust; close session)
POST /api/admin/capacity/sessions/series  (generate series from custom times OR inherit operating hours)
GET /api/admin/capacity/stock-periods
POST /api/admin/capacity/stock-periods
GET /api/admin/capacity/availability/preview  — staff read-only remaining preview (not public mutate)
GET/PATCH /api/admin/capacity/settings

Every staff create/mutate: requirePermissionFresh + requireActorOrgId + assertOrganizationActive + assertCompanyBillingEntitled + assertTicketingEnabled + venue belongs to org. When actorLocationScope.locationScoped, filter lists to that locationId.

C7. Resource rules
- Types: attraction | session | room | lane | party_room | other (UI labels may say jump zone, arena, climbing wall — map into these types).
- defaultCapacity >= 0; bufferMinutes >= 0.
- Name unique per location (case-insensitive) recommended.
- Archived resources cannot get NEW sessions (or sessions create warns and blocks — pick fail-closed: block).
- party_room is first-class for later double-book prevention.

C8. Operating hours rules
- Venue-wide hours per location.
- Bulk schedule updates: set Mon–Sun in one submit.
- Exceptions override a single date.
- closesAt must be after opensAt unless isClosed.
- Session series “inherit hours” uses these hours + venue timezone.

C9. Session / product schedule rules
- Custom series: weekdays, start/end, capacity, resource, optional product.
- Inherit hours: generate slots from VenueOperatingHours for a date range + slot duration.
- On create: remaining = capacity.
- isClosed=true: availability later returns unavailable.
- Editing capacity after sales is Phase 2 concern — in Phase 1, prefer allow edit only when remaining === capacity OR only allow close.

C10. Capacity rules (catalog level now; engine Phase 2)
- Availability preview must only return slots with remaining >= requestedQty (Phase 1 preview).
- Prefer documenting the future transactional UPDATE remaining = remaining - qty WHERE remaining >= qty.
- Day-pass style pools may use resource+date or all-day session — if not building day_pass products yet, document hook and support timed sessions fully.

C11. Lib files to create in Phase 1:
src/lib/moduleEntitlement.ts (if missing)
src/lib/ticketing/assertTicketingEnabled.ts
src/lib/ticketing/capacity.ts (read/preview helpers; initializeRemaining)
src/lib/ticketing/resources.ts
src/lib/ticketing/sessions.ts
src/lib/ticketing/operatingHours.ts (or src/lib/capacity/operatingHours.ts)
src/lib/ticketing/stockPeriods.ts
src/lib/ticketing/settings.ts (if BookingSettings / capacity settings)
Services/hooks: src/services/capacity.ts, src/hooks/useCapacity.ts (as needed)
UI: src/components/Protected/admin/pages/capacity/** (and ticketing pages if mirrored)

C12. Demo / pending / suspended / soft-hold / archived venue
- Demo: capacity admin locked; public later 403/404
- Pending/suspended: Fresh fail
- past_due still entitled: Allowed per existing billing rules
- Soft-hold unpaid paid-plan: creates denied
- Archived venue: no new resources/sessions/hours mutations
- Storefront: no capacity admin (registered-company paths)

C13. HQ location scope
When actorLocationScope().locationScoped, resource/session/hours/capacity lists filter to that locationId. Creates stamp scoped venue or require validated picker when company-wide. Do not fake-filter shop Product/Order.

C14. Honest product copy
Do NOT claim Capacity Management, Online Booking, POS, or Parties complete in README or landing yet. You may note “Capacity foundation in progress” only if accurate — prefer no false “shipped” claims until Phase 5.

C15. Testing Phase 1
Create scripts/smoke-capacity-phase1.mts + package.json script smoke:capacity:p1 covering:
- same-org resource/hours/session allow
- cross-tenant deny
- Demo deny
- storefront deny
- Starter allow (ticketing entitled)
- session series initializes remaining === capacity
- inherit-hours generation respects timezone and closed weekdays
- location scope filter
- invalid hours (close <= open) 400
- archived resource cannot create new session
Run it. Fix. STOP. Do not start Phase 2.

================================================================================
D. WORKFLOWS PHASE 1 MUST SUPPORT
================================================================================

BEFORE: Entitled company + at least one VenueLocation with timezone.
START: Staff opens Capacity → Resources / Hours / Sessions.
DURING: Create hours (bulk), create resource with type+capacity+buffer, generate session series (custom or inherit hours).
SUCCESS: Sessions show remaining=capacity; preview API returns them.
FAILURE: Wrong org, Demo, invalid hours, archived venue/resource — clear 4xx.
CANCELLATION: Soft-archive resource; close session.
REPEAT: Bulk hours update replaces weekday template idempotently.
REVERSAL: Unarchive only if you support it; otherwise keep soft-archive permanent and document.
DATA: All rows stamped orgId+locationId from actor, never client.
SECURITY: permissions + module gate + Demo lock.
CONSISTENCY: No shop stock changed.

================================================================================
E. COMPLETION CRITERIA
================================================================================

Staff in an entitled non-Demo company with a venue can configure operating hours, capacity resources (all types including party_room), session schedules (custom and/or inherit hours), see Capacity nav and shells (daily/calendar/blocks registered), and staff availability preview. Permissions/Demo lock/module entitlement work. Public cannot mutate. Shop/tailor/billing/venues/HQ still work. smoke:capacity:p1 passes. Then STOP and wait for Phase 1 audit.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 1 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md

Perform a deep audit of the completed Phase 1. Do not implement Phase 2.

Verify EVERY Phase 1 requirement and feature — do not skip any:

FEATURES / SCOPE CHECKLIST
[ ] CapacityResource types: attraction, session, room, lane, party_room, other
[ ] defaultCapacity + bufferMinutes fields exist and are editable
[ ] Venue operating hours + bulk weekday update + exceptions
[ ] Product/session schedules: custom series AND inherit-from-hours (or documented equivalent that both work)
[ ] TicketSession.capacity + remaining initialized equal on create
[ ] StockPeriod foundation (available|blocked) exists
[ ] Capacity admin nav: home, resources, hours, sessions, settings, shells for daily/calendar/blocks
[ ] Staff availability preview API (read-only)
[ ] Minimal Booking/Hold/Line only if required — no fake payments/checkout
[ ] Punctuality/no-show columns or Attendance model placeholders ready for Phase 3
[ ] assertModuleEnabled("ticketing") / assertTicketingEnabled enforced
[ ] Permissions registered: ticketing:read|write|manage, bookings:read|write|overbook (+ others as specified)
[ ] ADMIN_ROUTE_PERMISSIONS, ADMIN_REGISTERED_COMPANY_ONLY_PATHS, Demo paths NOT allowed
[ ] API_PERMISSIONS for every method+path
[ ] orgId+locationId on park rows; no client orgId trust
[ ] HQ location scope filters capacity lists when scoped
[ ] Archived resource cannot create new sessions
[ ] Invalid hours rejected
[ ] Venue timezone used for series generation
[ ] Shop Product/Order/Wallet untouched as capacity store
[ ] /signup still closed
[ ] README does not claim Feature 01/02/04/05/06 complete falsely
[ ] smoke:capacity:p1 green

Also hunt for: partial CRUD, placeholder save buttons that do not persist, duplicate capacity systems, unused dead routes, conflicting remaining semantics, missing indexes, Demo allowlist mistakes, storefront leakage.

If anything is missing/partial/incorrect/insecure/disconnected/duplicate/conflicting: FIX IT, re-test the affected workflow, re-run smoke:capacity:p1. Do not only report.

Re-check: fashion shop, tailor, billing, venues, HQ, Demo dashboard still work.

Only after everything is verified declare Phase 1 complete.
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md
Execute ONLY Phase 2 after verifying Phase 1.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-audit Phase 1 against docs/capacity-management-complete-spec.md Phase 1 completion criteria and smoke:capacity:p1.

If you find missing functionality, partial implementation, bugs, incorrect implementation, broken dependencies, data inconsistencies, security issues, workflow issues, integration issues, synchronization problems, regression problems, or testing gaps that are relevant to Capacity Management:
- DO NOT IGNORE THEM
- DO NOT ONLY REPORT THEM
- FIX THEM FIRST
- Re-verify the fix
- Re-run affected Phase 1 tests

Only after Phase 1 is correct and stable, continue with Phase 2.

Do NOT start Phase 3 daily/calendar polish, POS capacity tab UI mega-build, public /book checkout, waiver signing, or OTAs in this phase.

================================================================================
A. PHASE 2 OBJECTIVE
================================================================================

Build the complete CAPACITY ENGINE so the server can: hold capacity, confirm capacity, release capacity on cancel/expire, reactivate with re-hold, permissioned overbook, prevent party-room double-booking, enforce buffer times, enforce booking item limits, split/move bookings across resources atomically, and compute live availability for online / POS / front desk consumers. UI polish for daily/calendar boards is Phase 3 — APIs and engine must be complete; minimal staff create-via-API (and a thin staff hold/confirm tool) must work.

================================================================================
B. FEATURES INCLUDED IN PHASE 2 (ALL REQUIRED)
================================================================================

1. Transactional real-time remaining (SSOT TicketSession.remaining)
2. Booking holds with TTL + expire job that restores remaining
3. Confirm / cancel / reactivate capacity effects
4. Permission-based overbooking (bookings:overbook); guests NEVER overbook
5. Prevent double-booking of party rooms (and resource overlap conflicts)
6. Buffer times for party packages / resource turnovers (busy until endsAt + bufferMinutes)
7. Booking item limits (requested qty vs remaining; product minGuests/maxGuests)
8. Split bookings across resources / atomic resource move
9. Live availability computation APIs (staff + public-shaped read + reusable POS function)
10. Redeemed heads do NOT restore capacity on cancel/refund (when TicketCredential/redeemed qty exists; otherwise enforce hook + document)
11. Activity/audit for overbook, hold, expire, conflict overrides
12. Channel tags on holds/bookings: online | phone | walk_in | pos | account

================================================================================
C. TECHNICAL IMPLEMENTATION — PHASE 2
================================================================================

C1. Engine files
Create/complete:
- src/lib/ticketing/capacity.ts — allocate, release, preview, assertAvailable, applyBufferWindow
- src/lib/ticketing/holds.ts — createHold, expireHold, extendHold if needed
- src/lib/ticketing/bookingEngine.ts — hold / confirm / cancel / reactivate / moveResource / overbook paths focused on capacity (payments may stub)
- src/lib/ticketing/expireHolds.ts — idempotent expire
- src/lib/ticketing/availability.ts — compute slots for product/date/qty/channel
- Cron or secured route: GET/POST /api/cron/expire-booking-holds with CRON_SECRET (respect Vercel cron limit — piggyback if required)

C2. Authoritative capacity rules
1. Capacity is authoritative; overbook only with bookings:overbook.
2. Prefer transactional: UPDATE remaining = remaining - qty WHERE remaining >= qty; check rowCount.
3. Online guests CANNOT overbook. Error OVERBOOK_FORBIDDEN.
4. Staff with allowOverbook:true + permission: remaining may go negative; activity log overbook; UI warning later.
5. Redeemed tickets: do not restore capacity for redeemed heads on cancel/refund.
6. Closed sessions (isClosed) are unavailable unless overbook explicitly allowed for staff ops (default: unavailable).
7. StockPeriod kind=blocked removes availability for that window (foundation from Phase 1 — enforce in availability now).

C3. Status vs capacity (align ticketing SSOT)
- draft: capacity NOT held; staff only
- hold: capacity held; TTL holdTtlMinutes
- reserved: capacity held; longer TTL reserveTtlHours if settings exist
- pending_payment: capacity held
- confirmed: capacity sold
- expired: capacity released; idempotent
- cancelled: capacity released if unused (minus redeemed)
- refunded: capacity released if unused (minus redeemed)
reactivate: cancelled → draft/hold/reserved only if capacity available OR overbook permission

C4. Party room + resource conflicts
- Assigning/holding a party_room (or room/lane as configured) must detect overlapping confirmed/held intervals on the same resource.
- Include bufferMinutes: busy window is [startsAt, endsAt + bufferMinutes).
- Error 409 PARTY_ROOM_CONFLICT or RESOURCE_CONFLICT unless overbook.
- Prevent double-booking of party rooms is MANDATORY.

C5. Buffer times
- CapacityResource.bufferMinutes (and/or product/party package override if present).
- Availability and conflict checks must honor buffers.
- Especially important for party packages.

C6. Booking item limits
- Reject qty < minGuests or qty > maxGuests when product caps exist (error ITEM_LIMIT_EXCEEDED or VALIDATION).
- Reject qty > remaining without overbook (SOLD_OUT).
- Support multi-line bookings where each line has its own session/resource qty.

C7. Split bookings across resources
- BookingLine.resourceId / sessionId per line.
- POST move-resource (or equivalent): atomic capacity release on old + allocate on new; 409 RESOURCE_CONFLICT unless overbook.
- Split across resources in one booking must not oversell either resource.

C8. APIs (register all in API_PERMISSIONS)
Staff:
POST /api/admin/bookings (or /api/admin/capacity/holds) — create hold/draft
POST /api/admin/bookings/[id]/confirm
POST /api/admin/bookings/[id]/cancel
POST /api/admin/bookings/[id]/reactivate
POST /api/admin/bookings/[id]/overbook OR allowOverbook on confirm
POST /api/admin/bookings/[id]/move-resource
GET  /api/admin/capacity/availability ?productId&date&qty&locationId
POST /api/admin/capacity/holds/expire (admin test) + cron route

Public-shaped (read + hold contract for Feature 01 later — implement capacity-correct behavior):
GET  /api/public/booking/availability ?productId&date&qty  (or /api/public/capacity/availability — pick one; document; prefer ticketing SSOT path if building substrate)
POST /api/public/booking/holds — hold only; NEVER overbook

POS-shaped (for Feature 02 consumers):
GET  /api/pos/availability (or export function used by /api/pos/* when POS routes exist)
POS channel holds must use bookingEngine channel=pos
If POS module entitlement is Growth+ and assertModuleEnabled("pos") exists, gate /api/pos/* accordingly; capacity substrate itself remains ticketing-gated.

C9. Error codes (stable strings)
SOLD_OUT, OVERBOOK_FORBIDDEN, RESOURCE_CONFLICT, PARTY_ROOM_CONFLICT, BUFFER_CONFLICT, HOLD_EXPIRED, ITEM_LIMIT_EXCEEDED, SESSION_CLOSED, MODULE_DISABLED, DEMO_LOCKED

C10. Minimal staff UI for engine exercise
- Thin “Create hold / Confirm / Cancel” tool on a session or booking shell that shows remaining before/after.
- Overbook checkbox visible ONLY if actor has bookings:overbook.
- Sold out blocks without overbook.
Do NOT build the full Phase 3 daily board here.

C11. Activity log
Log: hold create/expire, confirm, cancel, reactivate, overbook, resource move, conflict override.

C12. Testing Phase 2
scripts/smoke-capacity-phase2.mts + smoke:capacity:p2 covering:
- parallel last-seat race: only one winner without overbook
- overbook without permission 403; with permission remaining can go negative
- party room double-book 409; with overbook allowed
- buffer conflict
- item limit min/max
- hold expire restores remaining exactly once (idempotent)
- cancel restores unused only
- public overbook attempt forbidden
- cross-tenant deny
- Demo deny
Run p1+p2. Fix. STOP for Phase 2 audit.

================================================================================
D. WORKFLOWS (BEFORE / START / DURING / SUCCESS / FAILURE / CANCEL / REPEAT / REVERSAL)
================================================================================

HOLD
BEFORE: Session remaining >= qty (or overbook path)
START: Create hold token + decrement remaining
DURING: TTL countdown
SUCCESS: Hold row exists; remaining reduced
FAILURE: SOLD_OUT / SESSION_CLOSED / BUFFER_CONFLICT
CANCEL: Release hold; restore remaining
REPEAT: Second hold on last seat fails
EXPIRE: Job restores remaining once

CONFIRM
BEFORE: Valid hold or staff confirm path
START: Transition to confirmed; capacity stays sold
FAILURE: HOLD_EXPIRED → must re-check availability
REVERSAL: Cancel releases unused

OVERBOOK
BEFORE: bookings:overbook
START: Confirm beyond remaining
SUCCESS: remaining negative allowed; activity logged
FAILURE: OVERBOOK_FORBIDDEN for guests / unprivileged staff

PARTY ROOM
BEFORE: Room free for [start, end+buffer)
FAILURE: PARTY_ROOM_CONFLICT
SUCCESS: Room busy for others

================================================================================
E. COMPLETION CRITERIA
================================================================================

Engine prevents oversell without overbook; party rooms cannot double-book without overbook; buffers and item limits enforced; holds TTL expire and restore; cancel/reactivate/move respect capacity; availability APIs match remaining SSOT; public cannot overbook; smokes p1–p2 green; shop/tailor/billing still work. Then STOP and wait for Phase 2 audit. Do not claim Feature 01/02/04 complete.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 2 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md

First confirm Phase 1 is still healthy. Then deep-audit Phase 2. Do not implement Phase 3.

Verify EVERY Phase 2 feature — do not skip any:

[ ] Transactional remaining decrement/increment (no naive read-modify-write races)
[ ] Concurrent last-seat: only one success without overbook
[ ] Holds TTL + expire job/route idempotent restore
[ ] Confirm / cancel / reactivate capacity semantics correct
[ ] bookings:overbook gated; public OVERBOOK_FORBIDDEN; activity logged; remaining may go negative when allowed
[ ] Party room double-booking prevented (PARTY_ROOM_CONFLICT / RESOURCE_CONFLICT)
[ ] Buffer times enforced on availability + conflicts
[ ] Booking item limits (min/max + remaining)
[ ] Split / move across resources atomic
[ ] Availability APIs (staff + public-shaped + POS function/route) match SSOT
[ ] StockPeriod blocked windows remove availability
[ ] Closed sessions unavailable by default
[ ] Redeemed heads do not restore capacity (or honest hook enforced when credentials exist)
[ ] Channel tags work; no per-channel second inventory
[ ] Error codes stable
[ ] Minimal staff hold/confirm UI calls real engine (no fake buttons)
[ ] Demo/tenant/module gates intact
[ ] Shop Product.quantity still not used as park capacity
[ ] smoke:capacity:p1 and smoke:capacity:p2 green

If anything is missing/partial/incorrect/insecure/disconnected/duplicate/conflicting: FIX IT, re-test affected workflows (especially concurrency, room conflict, expire, overbook), re-run smokes. Do not only report.

Re-check synchronization with Phase 1 catalog (resources/hours/sessions still work).

Only after everything is verified declare Phase 2 complete.
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md
Execute ONLY Phase 3 after verifying Phase 2.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-verify Phase 2 (and Phase 1). Fix any engine, race, conflict, buffer, overbook, or restore bugs BEFORE building operator boards.

Then implement Phase 3 only.

================================================================================
A. PHASE 3 OBJECTIVE
================================================================================

Give venue operators complete Capacity Management operator workflows and interfaces: daily capacity view (expected vs actual headcount + redemptions), calendar view (day/week/month occupancy and bookings), temporary block/reduce capacity on resources, session punctuality / no-show tracking, and polished schedule tools (hours-linked vs custom). Everything must write through the Phase 2 engine / capacity services — no parallel inventory.

================================================================================
B. FEATURES INCLUDED IN PHASE 3 (ALL REQUIRED)
================================================================================

1. Daily capacity view — expected vs actual headcount, redemptions
2. Calendar view — monthly bookings / occupancy (also day/week)
3. Block / reduce capacity temporarily on resources (and sessions / date ranges)
4. Session close + bulk schedule updates polished
5. Session punctuality / no-show tracking (mark, filter, rollup on daily view)
6. Clear UX for product schedules linked to operating hours OR fully custom
7. Occupancy colors / sold-out / overbook badges for staff
8. Activity entries for blocks, reductions, no-show marks

================================================================================
C. TECHNICAL IMPLEMENTATION — PHASE 3
================================================================================

C1. Daily capacity view
Route: /admin/capacity/daily
API: GET /api/admin/capacity/daily?locationId&date
Show per resource and/or per session:
- Expected: held qty + confirmed qty (heads)
- Actual: redeemed / checked-in heads when TicketCredential or check-in events exist
- If check-in/redemption data is absent: show Actual as “—” or “Unavailable until check-in” — do NOT invent fake actuals
- Remaining / capacity
- Redemptions count
- No-show / late counts when marked
Filters: venue/location, date, resource type, resource

C2. Calendar view
Route: /admin/capacity/calendar
API: GET /api/admin/capacity/calendar?locationId&from&to&view=day|week|month
- Sessions as blocks with remaining/capacity
- Occupancy color scale
- Click → bookings/holds for that slot (list)
- Monthly bookings overview

C3. Block / reduce capacity temporarily
Route: /admin/capacity/blocks (and/or actions on resource/session)
APIs:
POST /api/admin/capacity/blocks  (creates StockPeriod kind=blocked and/or session capacity reduction)
PATCH/DELETE as needed
Rules:
- Blocking a window removes availability via engine
- Reducing session.capacity below sold (capacity - remaining already sold) without overbook MUST fail closed
- With bookings:overbook, allow dangerous reduce only with explicit confirm + activity log
- Temporary blocks support resource-level and date-range

C4. Punctuality / no-show tracking
- Staff can mark booking/session attendance: on_time | late | no_show
- API: POST /api/admin/capacity/attendance or PATCH booking attendance fields
- Daily view rollups
- Filters on daily/calendar lists
- Does not automatically restore capacity on no-show unless you explicitly document a “release no-show capacity” action — default: marking no-show does NOT auto-restore sold capacity (operator may cancel separately)

C5. Schedule polish
- Hours editor + bulk update remains excellent
- Session series create explains inherit vs custom
- Close session action obvious
- Edit future sessions safely

C6. Frontend components
src/components/Protected/admin/pages/capacity/daily/**
src/components/Protected/admin/pages/capacity/calendar/**
src/components/Protected/admin/pages/capacity/blocks/**
Reuse existing admin table/filter patterns; Harewa gold #D4AF37; HqScopePolicyBanner when location-scoped.

C7. Testing Phase 3
scripts/smoke-capacity-phase3.mts + smoke:capacity:p3 covering:
- daily aggregates match engine counts for a seeded day
- calendar range returns sessions with correct remaining/capacity
- block removes availability
- reduce below sold without overbook fails; with overbook succeeds + logged
- no-show mark persists and appears on daily rollup
- location scope + Demo deny
Run p1–p3. Fix. STOP for Phase 3 audit.

================================================================================
D. WORKFLOWS
================================================================================

DAILY BOARD
BEFORE: Sessions + bookings/holds exist for the date
START: Staff opens /admin/capacity/daily
DURING: Reads expected/actual/remaining/redemptions
SUCCESS: Numbers match SSOT
FAILURE: Unauthorized / Demo / wrong location

BLOCK CAPACITY
BEFORE: Resource/session identified
START: Create block or reduce
DURING: Availability recompute
SUCCESS: New holds cannot take blocked window
FAILURE: Would invalidate sold seats without overbook
REVERSAL: Delete/end block restores future availability (not past confirmed)

NO-SHOW
BEFORE: Confirmed booking for session
START: Mark no_show
SUCCESS: Visible on daily view
REPEAT: Idempotent update
DATA: Does not silently change remaining unless separate cancel

================================================================================
E. COMPLETION CRITERIA
================================================================================

Operators can run daily capacity ops, calendar occupancy, temporary blocks/reductions, and punctuality/no-show tracking with real data wired to the Phase 2 engine. Smokes p1–p3 green. Then STOP and wait for Phase 3 audit.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 3 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md

Confirm Phases 1–2 still healthy. Then deep-audit Phase 3. Do not implement Phase 4.

Verify EVERY Phase 3 feature — do not skip any:

[ ] Daily capacity view: expected vs actual, redemptions, remaining/capacity
[ ] Actual headcount honest when check-in/redemption absent (no fake numbers)
[ ] Calendar day/week/month occupancy + drill-down to slot bookings
[ ] Temporary block/reduce on resources/sessions/date ranges
[ ] Blocks change availability immediately via engine/StockPeriod
[ ] Cannot undercut sold seats without bookings:overbook
[ ] Overbooked reduce logged
[ ] Session punctuality / no-show mark + filters + daily rollup
[ ] No-show does not silently restore capacity (unless separate explicit cancel flow)
[ ] Hours vs custom schedule UX clear
[ ] No placeholder buttons; all actions hit real APIs
[ ] Timezone correct on daily/calendar
[ ] Demo/tenant/module gates intact
[ ] Phase 2 concurrency smoke still green
[ ] smoke:capacity:p1–p3 green

If anything is missing/partial/incorrect/insecure/disconnected: FIX IT, re-test daily + block + calendar + no-show paths, re-run smokes. Do not only report.

Only after everything is verified declare Phase 3 complete.
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md
Execute ONLY Phase 4 after verifying Phase 3.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-verify Phases 1–3. Fix daily/calendar/block/engine gaps BEFORE channel synchronization work.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Expose one live availability / capacity contract to online booking, POS, and front desk; keep all channels synchronized to TicketSession.remaining; enforce cross-feature rules (redemption restore, Demo/HQ/tenant, party room conflicts for consumers); document honest contracts for sibling modules without fake-completing them.

================================================================================
B. FEATURES INCLUDED IN PHASE 4 (ALL REQUIRED)
================================================================================

1. Real-time capacity synced across online, POS, and front desk (same SSOT)
2. Stabilized public availability + hold contract for Online Booking consumers
3. POS availability + capacity snapshot APIs (CAPACITY tab contract from POS spec)
4. Front-desk / staff live capacity widget or session remaining in bookings list
5. Channel-tagged holds competing correctly (online | pos | phone | walk_in | account)
6. Redemption / check-in interaction: redeemed qty does not restore on cancel
7. HQ location preference honesty for capacity lists
8. Activity + export hooks for capacity events (if companyExport/booking export hooks exist — extend)
9. Sync docs/contracts for Parties room conflicts and Online Booking/POS consumers
10. Offline POS guidance: never oversell admissions offline (enforce if offline queue exists; otherwise document fail-closed online-only)

================================================================================
C. TECHNICAL IMPLEMENTATION — PHASE 4
================================================================================

C1. One inventory SSOT
- No per-channel remaining counters
- Online hold and POS hold race on same remaining — concurrency safe
- Front desk reads same preview/availability helpers

C2. Online Booking consumer contract
- GET /api/public/booking/availability (preferred SSOT path) returns only bookable slots
- Public holds never overbook
- Do NOT build full /book wizard or Stripe guest checkout UI as “Feature 01 complete”
- If public booking pages already exist from another epic, wire them to this engine and fix desync

C3. POS / front desk consumer contract
- GET /api/pos/availability and GET /api/pos/capacity (or single documented endpoint returning sessions remaining + resource occupancy)
- If /admin/pos or POS terminal shell exists, wire CAPACITY tab/panel to real API
- If POS does not exist, still ship the API/lib exports Parties/POS will call; add a Front Desk capacity panel under /admin/capacity or bookings that uses the same API
- Gate /api/pos/* with assertModuleEnabled("pos") when POS module gate exists (Growth+). Capacity admin remains ticketing-gated.

C4. Front desk
- Staff can see live remaining when picking sessions for walk-in/phone booking flows (minimal picker if full booking wizard not present)
- Overbook checkbox only with permission

C5. Cross-feature synchronization
- Party Management: party_room conflicts already in engine — ensure party APIs if present call bookingEngine (if parties not present, keep helper export)
- Waivers: do not build signing; if waiverRequired exists on products, ignore for capacity math
- Check-in: daily “actual” continues to use redemption when present
- Shop Order/Product: still untouched
- Enterprise HQ: capacity resource/session lists respect location scope; no rollup leak to non-Enterprise; HQ module card may stay not_enabled for full ticketing product but capacity routes work for entitled ticketing orgs

C6. Export / activity
- Capacity block/overbook/session close appear in activity
- If companyExport supports module tables, include CapacityResource + TicketSession (+ hours) without hard-delete semantics

C7. Documentation
- Add docs/capacity-management.md short operator/dev pointer OR finalize this SSOT file’s “shipped contracts” section in Phase 5
- README next-epics: Capacity Management inventory layer — Online Booking/POS/Parties/Waivers/OTAs not falsely complete

C8. Testing Phase 4
scripts/smoke-capacity-phase4.mts + smoke:capacity:p4 covering:
- online hold vs POS hold last-seat contention
- public overbook deny
- POS/front-desk availability matches admin remaining
- Demo deny + storefront deny + cross-tenant deny
- location scope filter
- redeemed non-restore path (seed redeemed credential if model exists)
Run p1–p4. Fix. STOP for Phase 4 audit.

================================================================================
D. COMPLETION CRITERIA
================================================================================

One capacity SSOT is visible and correctly contended across online, POS, and front-desk contracts; oversell prevented without authorized override; Demo/HQ/tenant rules hold; sibling modules not fake-completed; smokes p1–p4 green. Then STOP and wait for Phase 4 audit.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 4 of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md

Confirm Phases 1–3 still healthy. Then deep-audit Phase 4. Do not implement Phase 5 hardening yet except fixes required for sync correctness.

Verify EVERY Phase 4 feature — do not skip any:

[ ] Online, POS, and front desk read/write the SAME remaining SSOT
[ ] Cross-channel last-seat contention correct
[ ] Public availability + hold contract correct; public cannot overbook
[ ] POS availability/capacity snapshot API real (UI shell only if wired)
[ ] Front-desk live remaining visible for staff session pick
[ ] Channel-tagged holds; no second inventory
[ ] Redeemed qty non-restore on cancel
[ ] HQ location scope honesty; Demo/billing/module/storefront fail-closed
[ ] Party room conflict still enforced for consumers
[ ] No fake-complete claims for Online Booking / POS / Parties / Waivers / OTAs
[ ] Shop/tailor/billing regressions clean
[ ] smoke:capacity:p1–p4 green

Hunt for desync (UI remaining ≠ DB), offline oversell holes, missing API_PERMISSIONS, duplicate helpers.

If anything is wrong: FIX IT, re-test cross-channel contention, re-run smokes. Do not only report.

Only after everything is verified declare Phase 4 complete.
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Capacity Management (Final hardening + production readiness).
SSOT: docs/capacity-management-complete-spec.md
Execute ONLY Phase 5 after verifying Phase 4.

================================================================================
0. PREVIOUS-PHASE VERIFICATION (MANDATORY — DO THIS FIRST)
================================================================================

Re-verify Phases 1–4 end-to-end. Carry forward and FIX any remaining gaps, partial features, security holes, or desync before hardening.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Make Capacity Management production-ready: performance/indexes, full smoke suite, regression across the rest of the app, documentation honesty, residual backlog listed, and an independent final system audit with fixes.

================================================================================
B. FEATURES / WORK INCLUDED IN PHASE 5 (ALL REQUIRED)
================================================================================

1. Performance pass — indexes, availability/daily/calendar query hygiene, hot-session concurrency
2. Full smoke:capacity:all (p1–p5) covering the entire Feature 06 + Resources/Schedules/Capacity list
3. Regression: shop, tailor, billing, venues, HQ, closed /signup, DEFAULT_ORG
4. Docs honesty — README / landing / HQ placeholders
5. Final independent system-wide audit + fix loop
6. Residual backlog explicitly listed (OTAs, full Feature 01/02/04/05/07)

================================================================================
C. TECHNICAL IMPLEMENTATION — PHASE 5
================================================================================

C1. Performance
- Ensure indexes on TicketSession (orgId, locationId, startsAt), (resourceId, startsAt, endsAt), BookingHold expiresAt, StockPeriod ranges
- Eliminate obvious N+1 on daily/calendar/availability
- Re-run last-seat concurrency under parallel load in smoke

C2. End-to-end scripted path (must pass)
entitled company → venue hours → resources (attraction, lane, party_room, …) → session series → staff preview → public availability → online hold → POS/front-desk hold contention → confirm → daily expected/actual → calendar → temporary block → availability removed → overbook permission path → party room conflict → buffer conflict → item limits → cancel unused restore → redeemed non-restore → Demo deny → storefront deny → cross-tenant deny → shop still works → /signup still closed

C3. Smoke suite
- scripts/smoke-capacity-phase5.mts (final e2e) + smoke:capacity:all running p1–p5
- package.json scripts documented

C4. Documentation
- Ensure docs/capacity-management-complete-spec.md remains SSOT
- README next-epics / module notes: Capacity Management (Feature 06) inventory layer shipped; do NOT claim full Online Booking, POS terminal, Party Command Center, Digital Waivers, Check-In scanners, or OTAs complete
- Landing anchors may remain stubs for other modules

C5. Security / tenancy final pass
- API_PERMISSIONS complete
- Demo allowlist has no capacity paths
- No client orgId trust
- Public routes cannot mutate beyond hold rules
- Overbook permission matrix correct

C6. Final audit checklist (Feature 06 + Resources/Schedules/Capacity)
[ ] Resources: attractions/jump zones, party rooms, lanes, arenas/walls mapped to types
[ ] Operating hours venue-wide + bulk updates
[ ] Product schedules linked to hours OR custom
[ ] Real-time capacity synced online / POS / front desk
[ ] Daily expected vs actual + redemptions
[ ] Calendar monthly (and day/week) bookings/occupancy
[ ] Block/reduce capacity temporarily
[ ] Overbooking permission-based
[ ] Buffer times (party packages / turnovers)
[ ] Split bookings across resources
[ ] Session punctuality / no-show tracking
[ ] Booking item limits
[ ] Prevent double-booking of party rooms
[ ] Oversell prevented unless authorized override

C7. Residual backlog (document, do not fake)
- OTA / Viator / Klook / GetYourGuide sync
- Full public booking wizard + guest Stripe product
- Full POS terminal / till / offline hardware
- Party Command Center mega-features
- Digital Waivers signing
- Check-in scanner hardware UI
- Dynamic pricing / promo engines

C8. STOP when Final System Completion Criteria are met.

================================================================================
D. COMPLETION CRITERIA
================================================================================

All Phase 5 work done; smoke:capacity:all green; regressions clean; docs honest; final audit performed with issues fixed. Capacity Management is production-ready as Feature 06 inventory layer.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT (FINAL SYSTEM AUDIT)

Copy everything inside the fence below:

```text
AUDIT PHASE 5 / FINAL SYSTEM AUDIT of Capacity Management.
SSOT: docs/capacity-management-complete-spec.md
Catalog: docs/fec-os-cursor-feature-catalog.md Feature 06

Do not trust previous phase completion reports. Independently review the final implementation.

Trace the feature through the existing application:

entitled company → venue hours → resources → sessions → availability → online/POS/front-desk holds → confirm → daily/calendar → block/reduce → overbook permission → party room conflict → buffers/limits → punctuality/no-show → cancel/redeem rules → Demo/storefront deny → shop still works → /signup still closed

Look for: missing functionality, partial functionality, incorrect functionality, broken dependencies, disconnected components, data inconsistencies, workflow inconsistencies, security loopholes, authorization problems, validation gaps, error-handling gaps, edge-case failures, regression problems, synchronization problems, performance problems, configuration problems, integration problems, production-readiness problems, unused/duplicate/conflicting implementation, placeholder buttons, second inventory paths (including shop Product.quantity), false complete claims for Online Booking/POS/Parties/Waivers/OTAs.

Verify EVERY in-scope feature from this SSOT Scope section and every Phase 1–5 checklist item. Do not skip any.

If you find an issue: FIX IT, then re-audit the fix, re-test the affected workflow, re-check synchronization and related functionality.

Re-run smoke:capacity:all (or p1–p5). Confirm /signup still 410/redirect. Confirm shop checkout still uses Order not park Booking money. Confirm tailor /tailor/* unchanged. Confirm Demo lock. Confirm README honesty.

Only after everything has been verified is Capacity Management complete.
```

---

## Final system completion criteria

Capacity Management is complete when all of the following are true:

1. Entitled non-Demo companies can configure venue operating hours (bulk updates), capacity resources (attraction, session, room, lane, party_room, other), and session/product schedules (hours-linked or custom).
2. `TicketSession.remaining` is the live SSOT; transactional; concurrent-safe; holds TTL expire correctly.
3. Online booking, POS, and front desk share that SSOT; oversell is prevented unless `bookings:overbook` authorized override is used; guests never overbook.
4. Daily expected vs actual (+ redemptions) and calendar occupancy work; actual is honest if check-in/redemption is absent.
5. Temporary block/reduce, buffer times, booking item limits, split/move across resources, party-room double-book prevention, and punctuality/no-show tracking all work.
6. Cancel restores unused capacity only; redeemed heads do not restore.
7. Data is tenant-scoped `orgId`+`locationId`; no client `orgId` trust; Demo/storefront/unpaid fail closed; capacity rides ticketing entitlement (Starter+).
8. Fashion shop `Product`/`Order`/`Wallet` are not used as park capacity; `/signup` remains closed; tailor surfaces unchanged.
9. Online Booking, POS terminal, Party Command Center, Digital Waivers, Check-In scanners, and OTAs are not fake-completed.
10. All 5 phase smokes pass (`smoke:capacity:all`); final independent audit has been performed and issues fixed.

---

## HONEST NON-GOALS (keep in every phase — do not fake)

These are out of scope for this epic. Ship contracts/stubs only where earlier phases already specified:

- Full POS terminal, F&B modifiers, kitchen display, cash till hardware sessions
- Digital waiver signing / guardian flows / QR waiver forms / staff waiver verify UI
- Check-in scanner / wristband hardware UI (redemption events may feed “actual”)
- Full public `/book/*` wizard + guest Stripe ticket product as Feature 01 complete
- Party Command Center mega-features beyond party_room conflict/buffer on the shared engine
- Membership recurring engine
- Promo codes / BOGO / dynamic pricing rule engine
- OTA / Viator / Klook / GetYourGuide / Trip.com
- Intercard / Sacoa / Amusement Connect
- Reopening `/signup`

---

## EXECUTION CONTROL

```
Paste PHASE 1 EXECUTION → implement → Paste PHASE 1 AUDIT → fix until pass
→ Paste PHASE 2 EXECUTION (verify 1 first) → Paste PHASE 2 AUDIT
→ Paste PHASE 3 EXECUTION (verify 2 first) → Paste PHASE 3 AUDIT
→ Paste PHASE 4 EXECUTION (verify 3 first) → Paste PHASE 4 AUDIT
→ Paste PHASE 5 EXECUTION (verify 4 first) → Paste PHASE 5 FINAL AUDIT
```

Never auto-skip phases. Never start coding until you paste START PHASE 1 / the Phase 1 execution prompt.

---

**End of copy-and-paste execution pack.**
