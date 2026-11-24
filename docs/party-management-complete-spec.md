# Party Management — Copy-and-Paste Execution Pack

> **Execution source of truth:** `docs/party-management-two-step-prompts.md` (two steps). This five-phase pack predates shipped Ticketing / POS / Waivers and is kept for requirement scope only. Progress is tracked in `docs/party-management-implementation-tracker.md`.

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Feature 04 — Party Management — end-to-end birthday/event party operations (base party engine)  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.  
**Catalog:** `docs/fec-os-cursor-feature-catalog.md` Feature 04 (packages, rooms, deposits, guest count, food, invitations, outstanding balances).  
**Elevates later:** Party Command Center (Section D) is **not** this epic — do not claim it complete.  
**Control plane:** `.cursor/rules/saas-venue-platform.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`.  
**Sibling specs (reuse, do not duplicate, do not fake-complete):** `docs/online-booking-ticketing-complete-spec.md`, `docs/pos-complete-spec.md`.

---

## How to use this file

1. Paste **PHASE 1 — EXECUTION PROMPT** into Cursor and say or include `START PHASE 1`.
2. When Cursor finishes Phase 1, paste **PHASE 1 — FOLLOW-UP AUDIT PROMPT**.
3. Only after the audit passes, paste **PHASE 2 — EXECUTION PROMPT**, and so on through Phase 5.
4. Every later phase must verify the previous phase first, fix gaps, then continue.
5. Do not ask the user for a feature list — everything required is already inside these prompts.

**Rules that apply to every phase**

- Read and obey: `.cursor/rules/saas-venue-platform.mdc`, `.cursor/rules/customer-vs-tailor-sections.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`, `src/lib/subscriptionPlans.ts`, `README.md` module entitlement contract.
- Do **NOT** reuse fashion `Product` / `Cart` / `CartLine` / `Order` / `Wallet` / `WalletTransaction` as party packages, party food, deposits, or party balances.
- Do **NOT** reuse staff `Membership` (org seat) as a party guest or park member. Host staff = Membership user on the org. Party guests = `PartyGuest` (+ optional `BookingGuest`).
- Do **NOT** reopen `/signup` or `POST /api/auth/signup`. Guests book/RSVP without creating `client` accounts. Link `userId` if an existing user email matches.
- Do **NOT** trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never runs park parties. Demo plan locks parties. Unpaid / pending / suspended orgs fail closed.
- Party module entitlement rides **ticketing**: `assertModuleEnabled(orgId, "ticketing")`. Starter, Growth, and Enterprise allow parties. Demo does not. Do **not** invent a separate paid `parties` SKU.
- Staff parties live under `/admin/parties*` and `/api/admin/parties*` (plus booking-engine APIs). Customer `/profile` may manage **own** party bookings only. Tailor `/tailor/*` gets no party ops.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav.
- One connected system: a party **is** a booking (`Booking` + `PartyBookingDetail`). Create/hold/confirm/cancel/capacity **must** go through `src/lib/ticketing/bookingEngine.ts` with the party’s channel (`online` | `phone` | `walk_in` | `pos` | `account`). If that engine/schema is missing, **create the shared park-booking substrate** in Phase 1 using the **same model names** as `docs/online-booking-ticketing-complete-spec.md` — then hang party tables on it. Do **not** claim Feature 01 (Online Booking / Ticketing) or Feature 02 (POS) complete.
- Do **not** fake-complete: Party Command Center HQ, Digital Waivers signing/guardian UI, Intercard/Sacoa/Amusement Connect, Kitchen Display screen, self-service kiosk, OTA, dynamic pricing engine, BOGO promo engine, membership self-service, Feature 01 public wizard for timed/day/group/camp/pass products.

---

## Honest current-repo facts (inspect before coding)

As of roadmap authoring (2026-09-13):

- Control plane **is** shipped: Organization, VenueLocation (timezone), Membership (staff), RBAC (`src/lib/auth/permissions.ts`), Demo lock, billing entitlement, HQ location scope, TaxSettings, CompanyProfile receipts, Stripe (`src/lib/stripe.ts`), mailer/`sendReceipts.ts`/`sendInvoice.ts`, activityLog, companyExport, smoke script pattern, `src/lib/adminNav.ts`.
- Fashion shop commerce **is** shipped and must keep working: Product, Cart, Order, Wallet (guest shop stored-value).
- Online Booking / Ticketing is **specified** in `docs/online-booking-ticketing-complete-spec.md` but **not present** in `prisma/schema.prisma` (no Booking / AdmissionProduct / TicketCredential / Party* tables). No `src/lib/ticketing/**`, no `/admin/parties`, no `/api/admin/parties/**`.
- POS is **specified** in `docs/pos-complete-spec.md` but **not present**. Party food must work without POS via `PartyMenuItem`. If POS models exist when you implement, reuse `PosProduct` food/beverage and emit `KitchenTicket` — still no KDS UI.
- `moduleEntitlement.ts` does **not** exist. `FuturePlanModules.ticketsPerMonth` is documented, not in `PlanLimits` yet. Move `ticketsPerMonth` into enforceable limits when the booking engine can confirm.
- `NotificationType` has no `booking` / `party`. `ActivityEntityType` has no Booking/Party types.
- Front desk IA (capability underneath): CHECK IN | SELL | PARTY | MEMBERSHIP | WAIVER | FOOD | REFUND. This epic ships the **PARTY** engine + `/admin/parties` operator surface. POS terminal “PARTY” button is Feature 02 — wire an API/hook if POS exists; do not build the POS terminal here.

---

## Boundary: this epic vs later features

| In Party Management (Feature 04) | Not in this epic |
|---|---|
| Party packages (catalog + sell/book) | Full Feature 01 wizard for timed/day/group/camp/pass |
| Party room resources + assignment + conflict | Party Command Center as a claimed product |
| Deposits, balances, collect remaining, reminders | Digital Waivers signing / guardian / QR waiver forms |
| Guest count vs package min/max | Arcade card issuance (Intercard/Sacoa/Amusement Connect) |
| Party food orders + party menu | Kitchen Display screen |
| Invitations + RSVP | Owner Dashboard KPI widgets (Feature 18) |
| Outstanding-balance list + pay | Forecasting party demand |
| Guest list, basic run sheet print, summary download | Front-desk POS terminal |
| Host staff assign (simple) | Waiver-chase Command Center tab |
| Online party book + host account manage | Public `/signup` guest shop accounts |

Base operator UI **is** required (`/admin/parties` list + detail). That list may show Time / Party / Kids / Room / PAID or $BALANCE because those are Feature 04 data. Do **not** brand it “Party Command Center”. Waiver chip may be a stub string (`—` / `n/a`) until Feature 05.

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Party Management.
SSOT: docs/party-management-complete-spec.md
Execute ONLY Phase 1. Do not implement party checkout capture, invitation send, RSVP pages, food submit-to-kitchen, balance reminder cron, or public party booking wizard yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (timezone, slug unique per org).
- Membership = STAFF seat on an Organization (do not overload this for party guests).
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER park parties. Never locked by tenant expiry.

Party Management is Feature 04 — the base party engine. Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "ticketing").
- Every park business row: orgId required + locationId required (FK VenueLocation; assert venue.orgId === orgId) except true org-default settings (locationId null = org default).
- Company admin lives under /admin/*. Guest /profile: own parties only. Tailor studio: no party ops.

Shop commerce (Product, Cart, Order with cartId + walletId + shipping) is fashion retail. Do NOT store party packages, party food, deposits, or party balances there.

Reuse: Organization, VenueLocation, Membership (staff), src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, stripe.ts, mailer.ts / sendReceipts.ts / sendInvoice.ts, TaxSettings, CompanyProfile, activityLog.ts, Notification + notificationService, companyExport.ts, smoke scripts, rateLimit.ts.

Do NOT reuse as party store: Product, Cart, CartLine, Order (shop), Wallet, TailoringJob, staff Membership-as-guest.

Ticketing dependency (mandatory, honest):
1. Inspect prisma/schema.prisma and src/lib/ticketing/.
2. IF Booking / AdmissionProduct / TicketSession / CapacityResource / BookingHold / BookingPayment already exist AND bookingEngine.ts exists: REUSE them. Add party tables + party-package catalog UI. Do not duplicate booking schemas.
3. IF they do NOT exist: CREATE the shared park-booking models required for parties using the EXACT enum/model names from docs/online-booking-ticketing-complete-spec.md Phase 1 section C3 that parties need (listed in C3 below). Create a POS/staff-usable bookingEngine skeleton (hold / confirm stubs may no-op capacity until Phase 2, but remaining field + transactional decrement helpers must exist). Do NOT build public /book/* wizard for timed/day/group/camp/pass. Do NOT claim Feature 01 complete.
4. Either way, Phase 1 must let staff create published party_package products with a party_room resource, min/max guests, duration, deposit rule snapshot fields, and add-on links — with no public purchase yet.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled Starter/Growth/Enterprise operators can: enable party ops for a venue (via ticketing entitlement), configure party settings (deposit/balance/duration/invitation/food cutoff defaults), manage party rooms (CapacityResource type party_room), manage party packages (AdmissionProduct type party_package + PartyPackageConfig), manage a location party food menu (PartyMenuItem), see Parties admin nav and route shells, and fail closed on Demo/storefront/unpaid/pending/suspended. Public cannot book a party yet. No invitation send, no deposit capture, no food fulfillment in Phase 1.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create or extend src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, module):
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden (park parties are registered-company only)
  5) plan.moduleHints includes the module OR "all"
- assertTicketingEnabled(orgId) and assertPartiesEnabled(orgId) as thin wrappers around module "ticketing" (parties ride ticketing; do not add a separate moduleHints id).
- Staff party APIs fail if not entitled.
- Starter (ticketing hint) MUST allow parties. Demo MUST 403. Growth + Enterprise allow.

C2. Plan meter ticketsPerMonth
- If confirming will happen in Phase 2, move ticketsPerMonth into PlanLimits now:
  demo=0, starter=2000, growth=10000, enterprise=null.
- Count confirmed ticket heads (party kids+adults + issued credentials) in venue timezone month of locationId. Enforce on CONFIRM in Phase 2; Phase 1 adds PlanResource + meter hook (may count 0).
- Update FuturePlanModules comments so ticketsPerMonth is no longer “future only” once added.
- VenueLocation remains the only park create gate. Do not bill rooms separately.

C3. Complete Prisma schema + migration (create ALL party tables now even if some APIs arrive later)
All new tables: orgId required, indexed, FK Organization. Park-scoped: locationId required, FK VenueLocation, unless noted (settings may have locationId null = org default).
Extend ActivityEntityType with: Booking (if not present), PartyBooking, PartyInvitation, PartyFoodOrder, AdmissionProduct (if creating substrate).
Extend NotificationType with: booking (if missing) and party.

Party enums (exact names — do not invent parallels):
PartyOpsStatus: inquiry | held | confirmed | checked_in | in_progress | completed | cancelled | no_show
PartyInviteStatus: pending | sent | accepted | declined | cancelled | bounced
PartyGuestKind: honoree | kid | adult | chaperone | other
PartyFoodOrderStatus: draft | submitted | sent_to_kitchen | fulfilled | cancelled
PartyDepositDueMode: at_booking | days_before_event | on_arrival
PartyBalanceDueMode: at_booking | days_before_event | on_arrival
PartyInvitationChannel: email | sms | link
PartyMenuItemKind: food | beverage | cake | other

IF ticketing models are missing, ALSO create these ticketing enums/models from docs/online-booking-ticketing-complete-spec.md (same names):
AdmissionProductType (must include party_package | add_on; include the rest of the enum so Feature 01 can attach later without a rename),
BookingStatus, BookingChannel (must include online | phone | walk_in | pos | account),
BookingCreateMode, CapacityResourceType (must include party_room),
BookingPaymentTender, BookingPaymentStatus, InvoiceStatus, TicketCredentialStatus,
StockPeriodKind.
Models (minimum for parties — use ticketing field lists; do not invent a second booking schema):
BookingSettings, CapacityResource, AdmissionProduct, AdmissionProductPrice, AdmissionAddOnLink,
StockPeriod, TicketSession, Booking, BookingLine, BookingGuest, BookingHold, TicketCredential,
BookingPayment, BookingPaymentLink, BookingInvoice, BookingActivity.
You MAY omit BookingAccount / BookingAccountContact in this epic IF unused; if omitted, party contact lives on Booking primaryContact* only. Do not create a parallel “PartyOrder” instead of Booking.

Party-native models you MUST create:

PartySettings (per location; locationId null = org default; unique orgId+locationId):
id, orgId, locationId?, defaultDepositPercent Decimal?, defaultDepositFixedCents Int?,
depositDueMode (default at_booking), depositDaysBefore Int default 0,
requireDepositToConfirm Boolean default true,
balanceDueMode (default on_arrival), balanceDaysBefore Int default 0,
defaultPartyDurationMinutes Int default 120,
defaultMinKids Int default 1, defaultMaxKids Int default 15, defaultIncludedAdults Int default 2,
invitationExpiresHours Int default 168,
allowOnlinePartyBooking Boolean default true,
allowHostEditGuestList Boolean default true,
allowHostEditFood Boolean default false,
foodOrderCutoffMinutes Int default 60,
sendBalanceReminder Boolean default true,
balanceReminderDaysBefore Json (e.g. [7,3,1]),
createdAt, updatedAt.

PartyPackageConfig (1:1 AdmissionProduct where type=party_package; unique productId):
id, orgId, locationId, productId,
durationMinutes, includedKids, includedAdults, extraKidPriceCents?, extraAdultPriceCents?,
roomResourceId? (CapacityResource party_room),
depositPercentOverride?, depositFixedCentsOverride?,
includesFood Boolean default false, defaultMenuItemIds Json?,
createdAt, updatedAt.

PartyBookingDetail (1:1 Booking):
id, orgId, locationId, bookingId unique,
partyName, honoreeName?, honoreeAge?, honoreeBirthDate?,
kidCount Int, adultCount Int,
roomResourceId?, roomNameSnapshot?,
hostStaffUserId?, hostNotes?,
opsStatus PartyOpsStatus,
depositRequiredCents Int, depositPaidCents Int default 0, depositDueAt DateTime?,
balanceDueAt DateTime?,
foodNotes?,
waiverMissingCount Int default 0,
createdAt, updatedAt.
Indexes: orgId+locationId+opsStatus, orgId+locationId+createdAt, bookingId unique.

PartyGuest:
id, orgId, locationId, partyDetailId, bookingGuestId?,
name, kind PartyGuestKind, age?, email?, phone?,
invitationId?, rsvpStatus PartyInviteStatus default pending,
waiverStatus String default "n/a",
createdAt, updatedAt.

PartyInvitation:
id, orgId, locationId, partyDetailId, guestId?,
publicToken String unique, channel PartyInvitationChannel,
toEmail?, toPhone?, status PartyInviteStatus,
sentAt?, respondedAt?, expiresAt?,
createdAt, updatedAt.

PartyMenuItem:
id, orgId, locationId, name, description?, kind PartyMenuItemKind,
priceCents Int, currency String default "usd",
available Boolean default true, archivedAt?, posProductId? String?,
sortOrder Int default 0, createdAt, updatedAt.

PartyFoodOrder:
id, orgId, locationId, partyDetailId, status PartyFoodOrderStatus default draft,
promisedAt?, kitchenTicketId?, notes?, submittedAt?, fulfilledAt?,
createdAt, updatedAt.

PartyFoodLine:
id, orgId, locationId, foodOrderId, menuItemId?, posProductId?,
nameSnapshot, qty Int, modifiers Json?, unitPriceCents Int, notes?,
createdAt, updatedAt.

PartyRunSheetItem:
id, orgId, locationId, partyDetailId, startsAt DateTime?, title, notes?, sortOrder Int,
createdAt, updatedAt.

PartyBalanceReminder:
id, orgId, locationId, partyDetailId, kind String (deposit|balance),
scheduledFor DateTime, sentAt?, createdAt.

C4. Permissions — add ALL of these to src/lib/auth/permissions.ts (P object, PERMISSION_CATALOG, ROLE_PRESETS, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS):
Party-specific:
- parties:read — list/detail parties, run sheets, summaries, rooms/packages/menu read
- parties:write — create/edit/cancel party bookings, assign room/host, guest list, ops status
- parties:manage — party settings, package config, rooms mutate, menu mutate
- parties:invitations — create/send/cancel invitations
- parties:food — create/edit/submit party food orders
- parties:read_own / parties:write_own — guest host on /profile (guest list + pay balance + RSVP view)

IF creating booking substrate, ALSO add the ticketing/booking bits from the ticketing spec that parties need:
ticketing:read, ticketing:write, ticketing:manage,
bookings:read, bookings:write, bookings:assign, bookings:overbook,
bookings:payments_read, bookings:payments_take, bookings:refund, bookings:charge_stored,
bookings:tax_exempt, bookings:export,
booking_invoices:read, booking_invoices:manage, booking_invoices:send.
If those keys already exist, reuse them — do not create parties:payments duplicates.

Preset grants:
- platform_admin: all
- ops_manager: parties read/write/invitations/food; ticketing read; bookings read/write/assign/payments_take/payments_read; NO parties:manage, NO overbook, NO refund, NO export, NO charge_stored
- catalog_editor: ticketing read/write; parties read; parties:manage NO (packages via ticketing:write is OK for party_package CRUD)
- finance: parties read; bookings payments read; refund yes; invoices all; tax_exempt yes
- custom: via template
- client: parties *_own and bookings *_own only
- tailor: none for parties/ticketing/bookings

C5. Admin routes — register ADMIN_ROUTE_PERMISSIONS and add to ADMIN_REGISTERED_COMPANY_ONLY_PATHS. Demo must NOT allow these paths (not in isDemoAllowedAdminPath).

Working catalog UIs in Phase 1:
- /admin/parties — list SHELL with columns visible (Time, Party, Kids, Room, Status PAID/$BALANCE, Host, Actions). Empty is OK (no bookings yet).
- /admin/parties/packages — party package list + create/edit (AdmissionProduct party_package + PartyPackageConfig)
- /admin/parties/packages/new
- /admin/parties/packages/[productId]
- /admin/parties/rooms — CapacityResource type party_room CRUD
- /admin/parties/menu — PartyMenuItem CRUD
- /admin/parties/settings — PartySettings form (org default + per-venue override)

Shell-only (must exist in nav/permissions; may be empty/placeholder until Phase 2–3):
- /admin/parties/new
- /admin/parties/[bookingId]
- /admin/parties/balances (outstanding balances)

C6. Admin sidebar (src/lib/adminNav.ts) — Parties group (registered-company):
Parties → /admin/parties
New party → /admin/parties/new
Packages → /admin/parties/packages
Rooms → /admin/parties/rooms
Menu → /admin/parties/menu
Balances → /admin/parties/balances
Party settings → /admin/parties/settings
Add Dashboard quick link: Parties.
Extend prefetchAdminRoute.ts stubs for these paths.
Add icon key if needed (reuse "operations" if you do not want a new icon).

C7. Staff APIs for Phase 1 (register every method+path in API_PERMISSIONS; reject ?orgId= and body orgId):
GET/PATCH /api/admin/parties/settings
GET/POST /api/admin/parties/packages
GET/PATCH/DELETE /api/admin/parties/packages/[id]  (soft-archive)
GET/POST /api/admin/parties/rooms
PATCH /api/admin/parties/rooms/[id]
GET/POST /api/admin/parties/menu
PATCH /api/admin/parties/menu/[id]
GET /api/admin/parties  (empty list OK; must filter by org + location scope + date)
GET /api/admin/ticketing/sessions  (or /api/admin/parties/packages/[id]/sessions) — create/list slots for a party package
POST /api/admin/ticketing/sessions for party products (weekday series OK)

Every staff create/mutate: requirePermissionFresh + requireActorOrgId + assertOrganizationActive + assertCompanyBillingEntitled + assertPartiesEnabled + venue belongs to org. When actorLocationScope.locationScoped, filter lists to that locationId.

C8. Party package catalog rules
- Type party_package required. Published + not archived to sell later.
- Must attach or select a party_room CapacityResource (can be unset as draft; publish requires a room resource OR explicit “room assigned at booking” flag documented on the product).
- minGuests/maxGuests on AdmissionProduct; PartyPackageConfig.includedKids/includedAdults/durationMinutes required to publish.
- Price bands: at least one (e.g. package / extra_kid / extra_adult). Amounts integer cents.
- Add-on links to AdmissionProduct type add_on (create add_on from party package editor or a simple add-ons section on the same page). StockPeriod optional.
- Soft-archive only.

C9. Party rooms
- CapacityResource type=party_room, defaultCapacity >= 0 (headcount cap for that room).
- Archived rooms cannot be newly assigned.
- Name unique per location (case-insensitive).

C10. Party menu
- Location-scoped items. Price cents. Kind food|beverage|cake|other.
- Soft-archive. available=false hides from Phase 2/3 pickers.
- posProductId optional FK-less string until POS exists; if PosProduct model exists, validate same org+location.

C11. Party settings UI
Form fields matching PartySettings. Save via PATCH. Show which values are org-default vs venue override. HqScopePolicyBanner when location-scoped.

C12. Lib files to create in Phase 1:
src/lib/moduleEntitlement.ts (if missing)
src/lib/ticketing/assertTicketingEnabled.ts
src/lib/parties/assertPartiesEnabled.ts
src/lib/parties/settings.ts
src/lib/parties/packages.ts
src/lib/parties/rooms.ts
src/lib/parties/menu.ts
src/lib/parties/serialize.ts
If substrate created: src/lib/ticketing/products.ts, sessions.ts, resources.ts, settings.ts, capacity.ts (helpers)
Services/hooks: src/services/parties.ts, src/hooks/useParties.ts
UI: src/components/Protected/admin/pages/parties/**

C13. Demo / pending / suspended / soft-hold / archived venue
- Demo: party admin locked; public later 403/404
- Pending/suspended: Fresh fail
- past_due still entitled: Allowed
- Soft-hold unpaid paid-plan: creates denied
- Archived venue: no new packages/rooms/sessions/parties
- Storefront: no party admin (registered-company paths)

C14. HQ location scope
When actorLocationScope().locationScoped, package/room/menu/party lists filter to that locationId. Creates stamp scoped venue or require validated picker when company-wide.

C15. Honest product copy
Do NOT claim Party Management or Party Command Center complete in README or landing yet.

C16. Testing Phase 1
Create scripts/smoke-parties-phase1.mts + package.json smoke:parties:p1 covering:
- same-org package/room/menu/settings allow
- cross-tenant deny
- Demo deny
- storefront deny
- Starter allow (ticketing entitled)
- unpublished/archived not listed as sellable
- location scope filter
- invalid publish (no duration / no max guests) 400
Run it. Fix. STOP. Do not start Phase 2.

================================================================================
D. COMPLETION CRITERIA
================================================================================

Staff in an entitled non-Demo company with a venue can configure party settings, party rooms, party packages with guest caps and deposit rule fields, party menu items, and see Parties nav/list shell. Permissions/Demo lock work. Public cannot book. Shop/tailor/billing/venues/HQ still work. smoke:parties:p1 passes. Then STOP and wait for Phase 1 audit.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 1 of Party Management.
SSOT: docs/party-management-complete-spec.md

Perform a deep audit of the completed Phase 1. Do not implement Phase 2.

Verify every Phase 1 requirement: entitlement (ticketing module, Demo/storefront/unpaid fail closed, Starter allowed), ticketsPerMonth PlanResource if substrate can confirm later, Prisma party tables + booking substrate (reuse or created with ticketing names — no PartyOrder duplicate), permissions, ADMIN_ROUTE_PERMISSIONS, ADMIN_REGISTERED_COMPANY_ONLY_PATHS, admin nav, APIs, package/room/menu/settings UIs, location scope, activity/notification enums, no client orgId trust, no shop Product reuse, no /signup.

If anything is missing/partial/incorrect/insecure/disconnected/duplicate/conflicting: FIX IT, re-test the affected workflow, re-run smoke:parties:p1. Do not only report.

Search for unused/placeholder hacks. Remove or complete them.

Re-check: fashion shop, tailor, billing, venues, HQ, Demo dashboard still work.

Only after everything is verified declare Phase 1 complete.
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Party Management.
SSOT: docs/party-management-complete-spec.md
Execute ONLY Phase 2 after verifying Phase 1.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Re-run smoke:parties:p1. Inspect schema, permissions, package/room/menu/settings UIs, Demo/storefront locks.
If anything from Phase 1 is missing, partial, insecure, or disconnected: FIX IT FIRST, re-test, then continue Phase 2.
Carry forward unfinished Phase 1 work. Do not blindly assume Phase 1 is correct.

================================================================================
B. PHASE 2 OBJECTIVE
================================================================================

Build the complete PARTY ENGINE + DATA APIs so the server can: create party bookings (phone/walk-in/online-account/POS-channel via API), hold room+session capacity, enforce guest count vs package min/max, snapshot deposit/balance due rules, take/record deposits and remaining balances (card/cash/split/payment-link/invoice — reuse BookingPayment, never shop Order), manage guest lists, create invitation tokens, manage party food orders against PartyMenuItem (and PosProduct if present), assign/move rooms with conflict detection, edit/cancel/reactivate, compute outstanding balances. UI polish is Phase 3 — APIs and engine must be complete; staff create-via-API must work.

One engine: src/lib/ticketing/bookingEngine.ts used by party bookings. Party-specific orchestration: src/lib/parties/partyEngine.ts (creates Booking + PartyBookingDetail together, never one without the other for party_package).

================================================================================
C. PARTY + BOOKING STATE (IMPLEMENT EXACTLY)
================================================================================

Booking status machine: follow docs/online-booking-ticketing-complete-spec.md Phase 2 section C if you created/own the engine. Do not invent a second machine.

Party opsStatus mapping (store on PartyBookingDetail; keep Booking.status authoritative for money/capacity):
- inquiry → Booking draft
- held → Booking hold | reserved | pending_payment
- confirmed → Booking confirmed
- cancelled / no_show → Booking cancelled (no_show is ops overlay after visitStartsAt without check-in)
- checked_in / in_progress / completed → Booking remains confirmed; ops overlay only (no Check-In epic UI required; APIs allowed)

Rules:
1. Room capacity AND session remaining are authoritative. Overbook only with bookings:overbook.
2. Payments live on Booking via BookingPayment — NEVER shop Order. Never Wallet.
3. Guest checkout does NOT use /signup.
4. JWT orgId is NEVER public write authority.
5. Deposit: if PartySettings.requireDepositToConfirm, confirm is blocked until amountPaid >= depositRequiredCents (error PARTY_DEPOSIT_REQUIRED) unless bookings:overbook/manager-style override is NOT used for deposits — use a documented staff override parties:write + reason logged, only when settings allow a future flag allowConfirmWithoutDeposit default false. Keep fail-closed.
6. Guest counts: kidCount+adultCount must be within product min/max; kidCount >= 1 for birthday-style packages unless minGuests=0. Extra heads reprice extraKid/extraAdult bands.
7. Food submit after foodOrderCutoffMinutes before visitStartsAt → PARTY_FOOD_CUTOFF unless parties:food + documented override with activity log.
8. Redeemed tickets: do not restore capacity for redeemed heads on cancel/refund.

================================================================================
D. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

D1. Create party bookings via API
POST /api/admin/parties
{ channel: "phone"|"walk_in"|"pos"|"account", locationId?, productId, sessionId?, startsAt?, roomResourceId?, kidCount, adultCount, partyName, honoreeName?, contact, addOnProductIds?, foodLines?, notes?, createMode? }
- Creates Booking + PartyBookingDetail + BookingLine snapshots + optional draft PartyFoodOrder in one transaction.
- Assigns room; 409 PARTY_ROOM_CONFLICT if overlapping confirmed/held party on same room (unless overbook).
- Computes depositRequiredCents from package override or PartySettings; sets depositDueAt / balanceDueAt.
- Body must NOT include orgId. locationId from scope or validated picker.
- POS-channel: POST /api/pos/parties or POST /api/pos/bookings with party_package that calls partyEngine — if /api/pos does not exist, implement POST /api/admin/parties with channel pos AND a thin src/lib/parties/posAdapter.ts so Feature 02 can call it later. Do not build POS terminal UI.

D2. Hold / reserve / confirm / expire
Reuse bookingEngine hold/reserve/confirm. Party confirm also: issue TicketCredential for host + guest heads per policy (at least host + kidCount credentials or document 1 package credential + guest list without tickets — pick one and stick to it: issue unused credentials for kidCount+adultCount on confirm).
Cron-ready expirePartyHolds() wrapping expireBookingHolds(); wire cron in Phase 4; lib must work now.
Holds: atomic remaining decrement on TicketSession AND room occupancy check.

D3. Edit party
PATCH /api/admin/parties/[bookingId]
Transactional: counts, room, session/time, contact, partyName/honoree, add-ons, hostStaffUserId, food notes.
Re-price extras; restock old session/room; stock new. Reject past modifications per BookingSettings.pastEditGraceMinutes (PARTY_PAST_LOCKED / BOOKING_PAST_LOCKED).
opsStatus PATCH allowed for checked_in/in_progress/completed/no_show when booking confirmed.

D4. Cancel / reactivate
POST /api/admin/parties/[bookingId]/cancel { reason }
Release room+session if unused; void credentials; do NOT auto-refund — require bookings:refund confirmation to refund deposit.
POST .../reactivate: only cancelled; re-hold room+session or overbook; restore held/confirmed per body.

D5. Guest list APIs
GET/POST /api/admin/parties/[bookingId]/guests
PATCH/DELETE /api/admin/parties/[bookingId]/guests/[guestId]
Kinds honoree|kid|adult|chaperone|other. Named guests may exceed headcount? NO — named kids cannot exceed kidCount; named adults cannot exceed adultCount (error PARTY_GUEST_CAP). Staff may PATCH kidCount first.

D6. Invitation token APIs (send in Phase 3; tokens in Phase 2)
POST /api/admin/parties/[bookingId]/invitations { guestId?, channel, toEmail?, toPhone? }
Creates PartyInvitation with unguessable publicToken, expiresAt from settings.invitationExpiresHours, status pending.
POST .../invitations/[id]/cancel
GET list on party detail.
Public RSVP API may be stubbed 501 until Phase 3 BUT token row must persist. Prefer implementing POST /api/public/parties/invite/[token]/rsvp now (accept|decline, name) so Phase 3 is UI-only.

D7. Food order APIs
GET/PUT /api/admin/parties/[bookingId]/food
POST .../food/submit  (draft → submitted; cutoff enforced)
POST .../food/cancel
Lines snapshot name+price; qty>=1; menu item must be available and same location.
If KitchenTicket model exists, submit emits queued ticket and stores kitchenTicketId. No KDS UI.
If PosProduct exists and menuItem.posProductId set, snapshot from POS price unless overridden.

D8. Room assignment
POST /api/admin/parties/[bookingId]/room { resourceId }
Conflict 409 PARTY_ROOM_CONFLICT. GET /api/admin/parties/rooms/availability?locationId&startsAt&endsAt&excludeBookingId

D9. Deposits, balances, payments
Reuse BookingPayment APIs if they exist (POST /api/admin/bookings/[id]/payments). If not, implement party-scoped:
POST /api/admin/parties/[bookingId]/payments { tenders: [{ type, amount }] }
- card: Stripe Checkout or PaymentIntent metadata type=venue_booking or venue_party, bookingId, orgId, locationId, paymentId. NEVER shop Order.
- cash: staff record; receivedByStaffId
- split: multiple tenders
- payment_link: create BookingPaymentLink token
- invoice: BookingInvoice INV-{orgSlug}-{seq} via sendInvoice.ts when sent (send may be Phase 3)
Update depositPaidCents = min(amountPaid, depositRequiredCents); amountDue = total - amountPaid.
GET /api/admin/parties/balances?status=due  list amountDue>0 parties.
Refunds: POST .../refunds requires bookings:refund.

D10. Run sheet + summary data APIs
GET/PUT /api/admin/parties/[bookingId]/run-sheet  (items time/title/notes/sort)
GET /api/admin/parties/[bookingId]/summary  JSON: package, room, guests, food, payments, deposit, due, host
GET /api/admin/parties/run-sheets?date=&locationId=

D11. Activity
Log create/edit/status/payment/room/guest/invite/food/host on BookingActivity or ActivityLog with PartyBooking entity. GET detail includes reverse chronological stream.

D12. Public APIs (data; UI Phase 3)
Rate-limit.
GET /api/public/parties/packages?orgSlug&venueSlug  (published party_package only)
GET /api/public/parties/availability?productId&date&qtyKids
POST /api/public/parties/holds
POST /api/public/parties/checkout  (pay deposit / pay-later if BookingSettings.allowOnlinePayLater AND PartySettings.allowOnlinePartyBooking)
GET /api/public/parties/confirmation/[bookingPublicId]
GET/POST /api/public/parties/pay/[paymentLinkToken]
POST /api/public/parties/invite/[token]/rsvp
Unpublished venue → 404. Sold out → SESSION_SOLD_OUT or PARTY_ROOM_CONFLICT. Deposit missing on confirm → PARTY_DEPOSIT_REQUIRED.

Logged-in me:
GET /api/me/parties
GET /api/me/parties/[id]
PATCH /api/me/parties/[id]/guests  if allowHostEditGuestList and parties:write_own
POST /api/me/parties/[id]/cancel  if policy/cutoff

D13. ticketsPerMonth enforce on confirm (party heads).

D14. Lib files to complete:
src/lib/ticketing/bookingEngine.ts (complete for party flows)
src/lib/parties/partyEngine.ts, deposits.ts, rooms.ts (conflicts), guests.ts, invitations.ts, food.ts, balances.ts, reminders.ts (schedule rows; send Phase 4)
src/lib/parties/pricing.ts (package + extras + add-ons + food; tax via TaxSettings)
Services: parties.ts, publicParties.ts

D15. Stable error strings
PARTY_DEPOSIT_REQUIRED, PARTY_ROOM_CONFLICT, PARTY_GUEST_CAP, PARTY_FOOD_CUTOFF, PARTY_PAST_LOCKED, PARTY_NOT_FOUND, PARTY_ONLINE_DISABLED, SESSION_SOLD_OUT, HOLD_EXPIRED, OVERBOOK_FORBIDDEN, PAYMENT_INCOMPLETE, plus existing Demo/billing/module/cross-tenant helpers.

D16. Edge cases
Timezone vs UTC (VenueLocation.timezone); DST; overlapping rooms; kids vs package cap; extra heads pricing; confirm without deposit; concurrent last-room race; refund deposit after start (do not restore room if visit in progress unless unused); invitation after cancel; food submit after cutoff; hold expire releases room; double RSVP; named guest email duplicate on same party.

D17. Testing Phase 2
scripts/smoke-parties-phase2.mts + smoke:parties:p2:
- create party phone channel
- last-room double-book fails one
- overbook without permission 403
- guest cap reject
- deposit required blocks confirm
- payment reduces amountDue / depositPaid
- hold expire releases room
- cancel releases capacity unused
- food cutoff
- cross-tenant deny
- ticketsPerMonth on confirm
- invitation token persists / rsvp accept creates/updates PartyGuest
- public unpublished 404
Run Phase 1 + Phase 2 smokes. Fix. STOP.

================================================================================
E. COMPLETION CRITERIA
================================================================================

Engine prevents room/session oversell without overbook; deposits/balances persist on Booking not shop Order; party guests/food/invites persist; staff API create/pay/cancel works; public hold/checkout APIs exist; smokes green. Then STOP for Phase 2 audit. No claim that Command Center or Feature 01 is complete.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 2 of Party Management.
SSOT: docs/party-management-complete-spec.md

Deep-audit Phase 2. Do not implement Phase 3 UI unless required to fix a Phase 2 API gap.

Verify previous Phase 1 still passes (re-run smoke:parties:p1). Then verify every Phase 2 requirement: partyEngine+bookingEngine, state mapping, create all channels via API, holds/confirm/expire, edit/cancel/reactivate, guest cap, invitation tokens, food orders, room conflicts, deposits/payments/invoices/payment links, balances list API, run sheet/summary JSON, activity, public APIs, me APIs, ticketsPerMonth, error strings, edge cases, no shop Order, no /signup, no client orgId trust.

If anything is missing/partial/incorrect/insecure: FIX IT, re-test affected workflows (capacity, payments, refunds, guests, food, invites), re-run smoke:parties:p2. Do not only report.

Confirm POS adapter exists or /api/pos/parties is ready for Feature 02 without a terminal UI. Confirm KitchenTicket emit only if model exists.

Only then declare Phase 2 complete.
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Party Management.
SSOT: docs/party-management-complete-spec.md
Execute ONLY Phase 3 after verifying Phase 2.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Re-run smoke:parties:p1 and smoke:parties:p2. Trace create → hold → deposit pay → confirm → room assigned → guest add → invite token → food draft.
If broken: FIX, re-test, then continue. Carry forward unfinished Phase 1–2 work.

================================================================================
B. PHASE 3 OBJECTIVE
================================================================================

Ship COMPLETE staff UIs and guest UIs for every party engine capability: create party wizard, today’s/date parties list, party detail tabs, outstanding balances, public party package booking (party products only), invitation RSVP page, payment-link pay page, confirmation, host /profile party management, emails for confirmation/invitation (send path), printable run sheet, summary download. Do not build Feature 01 non-party catalog wizards. Do not brand Party Command Center.

================================================================================
C. ADMIN UI (ALL REQUIRED)
================================================================================

Patterns: React Query, toasts, ButtonSpinner, confirm modals, HqScopePolicyBanner on location-scoped pages, plan/module soft-gate banners. Gold #D4AF37.

C1. Parties list /admin/parties
Toolbar: date picker (default today in venue TZ), venue filter, search name/email/phone/publicId, filters opsStatus / amountDue>0 / room / host, Create party, Balances link.
Columns: Time (venue TZ), Party name, Honoree, Kids, Room, Status chip PAID or $BALANCE (and booking status), Host, Actions Open / Run sheet / Print.
Empty state, skeleton, pagination.
This is the base operator list — do NOT title it “Party Command Center”.

C2. Create party /admin/parties/new?channel=&locationId=
Steps: 1 Channel phone/walk_in 2 Venue (hidden if scoped) 3 Package 4 Date & session/room with availability + conflict warning 5 Kid/adult counts vs included/extras price preview 6 Add-ons 7 Party name / honoree 8 Contact 9 Deposit due preview 10 Food optional draft 11 Notes 12 Create mode if BookingSettings prompt 13 Review 14 Submit → detail.
Sold out / room conflict blocks unless overbook permission shown.

C3. Party detail /admin/parties/[bookingId]
Header: partyName, time, room, publicId, booking status, opsStatus, amount due, host.
Buttons: Edit, Take payment, Payment link, Cancel, Reactivate, Send invitations, Print run sheet, Download summary, Resend confirmation.
Tabs (base engine — required):
- Overview: package, counts, room, honoree, totals, deposit vs paid vs due
- Guests: add/edit/remove; cap enforcement
- Invitations: create/send/cancel; copy link; status chips
- Food: menu picker, qty, notes, submit, cutoff warning
- Room: assigned room, day timeline of that room, change room
- Balance: tenders, deposit required/paid, amountDue, take payment, payment link, invoice create
Supporting tabs (simple, not Command Center):
- Host: assign staff Membership same org; host notes
- Add-ons: attached add-on lines
- Run sheet: editable items + print
- Activity: stream
Do NOT add Arcade Cards tab. Waivers tab optional stub “Waivers are not enabled” — no signing UI.

C4. Outstanding balances /admin/parties/balances
Columns: Visit, Party, Contact, Deposit required, Paid, Due, Due-at, Actions Take payment / Payment link / Open.

C5. Take payment modal
Card (Stripe), cash, split, payment link send email (SMS skip if no provider). Refund modal if bookings:refund.

C6. Packages / rooms / menu / settings
Polish Phase 1 CRUD so create-party picker is populated. Fix any Phase 1 UX gaps.

C7. Run sheet print
window.print CSS: time, party name, kids, room, host, food, add-ons, timeline items.

C8. Summary download
CSV or simple PDF/HTML: package, payments, guests, food, staff. No PAN/Stripe secrets.

================================================================================
D. PUBLIC + GUEST UI
================================================================================

/book/[orgSlug]/[venueSlug]/party/[productId] — party package booking (calendar/slots, kids/adults, add-ons, deposit preview, contact, pay deposit / pay later if allowed)
/book/[orgSlug]/[venueSlug]/parties — optional index of published party packages (or reuse a small card on a venue parties landing)
/booking/confirmation/[bookingPublicId] — may be shared with ticketing; must work for parties
/booking/pay/[paymentLinkToken] — pay outstanding
/party/invite/[token] — RSVP accept/decline + guest name
/payment/booking/success and cancel — Stripe return
Do NOT require /signup. Magic/view tokens unguessable.

Profile (client only):
/profile?tab=parties or extend bookings tab with party rows
/profile/parties/[bookingId] — detail, guests if host, pay due, cancel if allowed, invitations view. Never POS notes, overbook, invoice manage, staff assign.

================================================================================
E. NOTIFICATIONS (send path must work)
================================================================================

Party confirmation email REQUIRED on confirm (brand via resolveBrandForOrg / sendReceipts-style). Idempotent confirmationSentAt.
Invitation email on send; SMS if BOOKING_SMS_PROVIDER or PARTY_SMS_PROVIDER set, else log sms_skipped and still succeed.
Payment receipt on deposit/balance capture.
Do not fail booking if SMS unset.
In-app Notification type party for host userId if linked.
Transactional only — not marketing campaigns.

================================================================================
F. COMPONENTS / SERVICES
================================================================================

src/components/Protected/admin/pages/parties/**
src/components/Public_C/parties/** or booking/party/**
src/components/Protected/profile/parties/**
hooks useParties.ts usePublicParties.ts

================================================================================
G. TESTING PHASE 3
================================================================================

scripts/smoke-parties-phase3.mts + smoke:parties:p3 (API-level for UI routes existence + critical POST paths):
- staff create page route registered
- public party product 404 unpublished
- invite RSVP page token invalid 404
- profile own vs other party 403
Also manually verify UI against running app if browser tools exist; if not, say what could not be browser-verified.
Run p1–p3. Fix. STOP.

================================================================================
H. COMPLETION CRITERIA
================================================================================

Every admin table/action/create form listed works; public party book + RSVP + pay balance work; confirmation email path works; profile host manage works; shop/tailor not regressed. Then STOP for Phase 3 audit.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 3 of Party Management.
SSOT: docs/party-management-complete-spec.md

Deep-audit Phase 3 UIs and guest flows. Do not start Phase 4 cron/export work except to fix Phase 3 gaps.

Re-run smoke:parties:p1 p2 p3. Verify every list column, create wizard step, detail tab, balances page, print/summary, public party book, RSVP, pay link, profile host, emails, permissions on buttons, Demo lock, location scope, no Command Center claim, no waiver/arcade/KDS fake UI, no /signup, shop regression.

If anything is wrong: FIX IT, re-verify guest + staff + profile + shop. Do not only report.

Browser-verify if tools exist: create party, take deposit, add guests, send invite, RSVP, add food, pay balance. If tools are unavailable, API-verify and state that limitation.

Only then declare Phase 3 complete.
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Party Management.
SSOT: docs/party-management-complete-spec.md
VERIFY PHASE 3 FIRST. If Phase 3 is missing, partial, or broken: FIX, test, then continue.

Execute ONLY Phase 4. Integration, security, reliability, cross-feature sync, automation. Do not start the Phase 5 production audit-only pass until this phase’s smokes are green.

================================================================================
A. PHASE 4 OBJECTIVE
================================================================================

Make parties a connected production subsystem: Stripe webhooks idempotent, hold/reminder crons, company export, HQ/location consistency, POS/ticketing/F&B hooks without faking those modules, rate limits, search, notifications of balance reminders, access hardening, no split-brain with bookings.

================================================================================
B. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

B1. Previous-phase verification
Re-run smoke:parties:p1 p2 p3. Fix failures before new work.

B2. Stripe webhook + payment confirm
Extend existing Stripe webhook: metadata type venue_booking / venue_party. Reload booking by id; do not trust metadata orgId for auth. Idempotent payment rows. Success URL confirm does not double-apply. Failed/expired Checkout does not confirm.

B3. Cron / jobs
- expire holds (parties + bookings) — wire to existing cron style (CRON_SECRET). Prefer attaching to an existing hourly cron helper if Vercel Hobby 2-cron limit applies; do not add a third Vercel cron unless one can be reused. Lib must be invocable via yarn script.
- send scheduled PartyBalanceReminder (deposit|balance) email; mark sentAt; skip if amountDue=0 or cancelled.
- expire pending invitations past expiresAt → status cancelled.
Do not send marketing.

B4. companyExport
Include party packages (ids/names), party bookings summary (no card numbers), guest counts, amountDue, rooms — redacted JSON. Never Stripe ids in plaintext if other exports redact them; match companyExport redaction style.

B5. Cross-feature synchronization
- Booking list: if /admin/bookings exists, party bookings appear with type/package; opening a party_package prefers /admin/parties/[id]. If Feature 01 UI is absent, do not fake a full bookings module — optional deep link only.
- POS: if saleEngine exists, party_package_proxy MUST call partyEngine (channel=pos). If POS absent, keep posAdapter exported and documented.
- Food: submitted orders remain visible if POS/KDS later reads KitchenTicket.
- TaxSettings applied consistently with booking tax helper.
- Notifications + ActivityLog stay in sync with payments/invites.
- Profile parties tab does not show staff-only POS notes.

B6. Search / filter reliability
List search by party name, honoree, contact email/phone, publicId. Indexes used (orgId+locationId+visitStartsAt). Pagination stable.

B7. Security hardening
- Invitation tokens unguessable (crypto random, unique).
- Public RSVP cannot edit other guests or prices.
- Rate-limit public holds/checkout/rsvp/pay.
- parties:write_own cannot assign host staff or overbook.
- Cross-tenant IDOR tests on every /api/admin/parties/[bookingId]*.
- No secrets in summary CSV.

B8. Front desk hook
Export a small helper getTodayParties(orgId, locationId, date) for Feature 02 POS “PARTY” action. If POS terminal exists, add PARTY button routing to /admin/parties?date=today or embed a compact list — only if POS UI already exists; otherwise helper + API GET /api/admin/parties?date=today is enough.

B9. SMS adapter
src/lib/parties/sms.ts or reuse ticketing sms.ts. Env-gated no-op.

B10. Honest copy
README: Party Management engine shipped for entitled companies; Party Command Center not claimed. Landing # ticketing honesty unchanged unless a parties sentence is already a stub — do not advertise Command Center.

B11. Testing Phase 4
scripts/smoke-parties-phase4.mts + smoke:parties:p4:
- webhook replay does not double-pay
- hold expire cron lib releases room
- reminder skipped when paid
- export contains parties for same org only
- IDOR cross-tenant 404/403
- public rate-limit or equivalent deny flood (if rateLimit helper returns 429)
- posAdapter/partyEngine importable
Run p1–p4. Fix. STOP.

================================================================================
C. COMPLETION CRITERIA
================================================================================

Payments idempotent; crons/libs work; export/HQ/scope consistent; POS/ticketing hooks connected without fake modules; security checks pass; smokes green. Then STOP for Phase 4 audit.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 4 of Party Management.
SSOT: docs/party-management-complete-spec.md

Deep-audit integration/security/reliability. Do not start Phase 5 until this audit’s fixes are re-tested.

Re-run smoke:parties:p1–p4. Verify webhooks, crons, export, IDOR, rate limits, POS/ticketing sync, reminder skip-if-paid, invitation expiry, no shop Order, no Command Center claim, Vercel cron limit not broken.

If anything is incomplete or incorrect: FIX IT, re-check the fix, re-test the affected workflow, re-check synchronization. Do not only report.

Only then declare Phase 4 complete.
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Party Management.
SSOT: docs/party-management-complete-spec.md
VERIFY PHASE 4 FIRST. Fix gaps, then continue. Execute ONLY Phase 5 — testing, optimization, final audit, production readiness.

================================================================================
A. PHASE 5 OBJECTIVE
================================================================================

Independent system-wide audit of Party Management as one connected subsystem. Fix remaining gaps. Performance indexes. Smoke p5. Production-ready for entitled companies. Do not expand into Command Center, Waivers, Arcade, KDS, or Feature 01 full wizard.

================================================================================
B. WORK TO COMPLETE
================================================================================

B1. Re-run smoke:parties:p1 p2 p3 p4. Fix anything red.

B2. End-to-end traces (implement/fix until true):
entitled company → venue → party room → party package published → staff phone create → hold room → take deposit → confirm → email → guest list → invitation RSVP → food submit → outstanding balance payment link → pay remaining → PAID → cancel unused restores room → Demo deny → storefront deny → cross-tenant deny → shop still works → /signup still closed.

Public: published package → availability → hold → checkout deposit → confirmation.

Host profile: see party, edit guests if allowed, cannot take staff refund.

B3. Performance
Indexes on PartyBookingDetail (orgId, locationId, opsStatus), (orgId, locationId, bookingId), PartyInvitation.publicToken unique, Booking visitStartsAt if missing, balances query (amountDue>0). Avoid N+1 on parties list (include room, counts, amountDue).

B4. scripts/smoke-parties-phase5.mts + smoke:parties:p5 + smoke:parties:all chaining p1–p5.
Cover: deposit then balance to zero; RSVP after cancel rejected; food after cutoff; room conflict; extra kid pricing; location scope; finance refund permission; client own vs other.

B5. Final independent audit (you must actually inspect code, not trust earlier phase reports):
Missing/partial/incorrect; disconnected components; data inconsistency (Booking.amountDue vs PartyBookingDetail.depositPaid); workflow inconsistency; security loopholes; validation gaps; regression shop/tailor/billing/venues/HQ; README honesty.

B6. If you find an issue: FIX, re-audit the fix, re-run affected smokes.

================================================================================
C. COMPLETION CRITERIA
================================================================================

All five phases’ completion gates pass. Feature 04 scope (packages, rooms, deposits, guest count, food, invitations, outstanding balances) works as one system. Command Center not falsely claimed. Relevant security/data relationships consistent. Testing complete. Then STOP.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 5 / FINAL SYSTEM AUDIT of Party Management.
SSOT: docs/party-management-complete-spec.md

Do not trust previous phase completion reports. Independently review the final implementation.

Trace the feature through the existing application. Look for missing/partial/incorrect functionality, broken dependencies, disconnected components, data inconsistencies (booking totals vs party deposit/balance), workflow inconsistencies, security loopholes, authorization problems, validation/error-handling gaps, edge-case failures, regressions, synchronization problems, performance problems, configuration problems, integration problems, production-readiness problems, unused/duplicate/conflicting implementation.

If you find an issue: FIX IT, then re-audit the fix, re-test the affected workflow, re-check synchronization and related functionality.

Re-run smoke:parties:all (or p1–p5). Confirm /signup still 410/redirect. Confirm shop checkout still uses Order not Booking. Confirm tailor /tailor/* unchanged. Confirm Demo lock. Confirm no Party Command Center false claim in README.

Only after everything has been verified is Party Management complete.
```

---

## Final system completion criteria

Party Management is complete when all of the following are true:

1. Entitled non-Demo companies can configure party packages, rooms, menu, and settings.
2. Staff can create/edit/cancel party bookings (phone/walk-in; POS-channel API), assign rooms without silent oversell, enforce guest caps, take deposits and remaining balances, manage guests, send invitations, take RSVPs, and capture party food orders.
3. Guests can book a published party package online (if enabled), RSVP via token, and hosts can manage their party from `/profile` without operator tools.
4. Outstanding balances are visible and collectable (staff + payment link).
5. Data lives on `Booking` + `PartyBookingDetail` (not shop `Order`), tenant-scoped `orgId`+`locationId`, no client `orgId` trust.
6. Ticketing/POS are reused or honestly stub-adapted — never duplicated as a second booking/POS.
7. Party Command Center, Digital Waivers, Arcade, and KDS are not fake-completed.
8. All 5 phase smokes pass; shop, tailor, billing, venues, HQ, and closed `/signup` still work.
9. Final independent audit has been performed and issues fixed.
