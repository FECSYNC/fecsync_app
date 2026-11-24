# Online Booking / Ticketing — Copy-and-Paste Execution Pack

**Product:** FECSYNC / VenueFlow multi-tenant venue SaaS (`roller_clone_app`)  
**Feature:** Online Booking / Ticketing + complete Bookings operations surface  
**Phases:** Exactly 5. Never skip ahead. After each phase, paste that phase’s **FOLLOW-UP AUDIT** prompt.  
**SSOT file:** This document. Paste each fenced `text` block into Cursor as-is.

**Status (Phases 1–5):** Implementation + audits complete in-repo. Prove greens with `yarn smoke:ticketing:all` against **local** Postgres (`docs/ticketing-env.md`). Remote Supabase smokes are too slow for agent loops — do not block chat on them.

**Final audit (Phase 5 follow-up):** Section C bullets verified live; public/online email enforced server-side; non-goals remain unfaked. Operator must still run `smoke:ticketing:all` locally for the green gate.

---

## How to use this file

1. Paste **PHASE 1 — EXECUTION PROMPT** into Cursor and say or include `START PHASE 1`.
2. When Cursor finishes Phase 1, paste **PHASE 1 — FOLLOW-UP AUDIT PROMPT**.
3. Only after the audit passes, paste **PHASE 2 — EXECUTION PROMPT**, and so on through Phase 5.
4. Every later phase must verify the previous phase first, fix gaps, then continue.
5. Do not ask the user for a feature list — everything required is already inside these prompts.

**Rules that apply to every phase**

- Read and obey: `.cursor/rules/saas-venue-platform.mdc`, `.cursor/rules/customer-vs-tailor-sections.mdc`, `docs/saas-module-extension.md`, `docs/enterprise-hq-controls.md`, `src/lib/subscriptionPlans.ts`, `README.md` module entitlement contract.
- Do NOT reuse fashion `Product` / `Cart` / `Order` / `Wallet` as tickets or bookings.
- Do NOT reopen `/signup` or `POST /api/auth/signup`.
- Do NOT trust client body or query `orgId` / `locationId` (validate venue belongs to actor org when used as a picker).
- DEFAULT_ORG / storefront never sells park tickets. Demo plan locks staff ticketing/bookings. Unpaid / pending / suspended orgs fail closed.
- Do NOT fake-complete POS terminal, waiver signing UI, check-in scanners, OTA/Viator/Klook, Intercard/Sacoa, membership recurring engine, promo codes, dynamic pricing engine, or manager PIN pad.
- In scope even without full POS app: `channel=pos` APIs, POS notes field, cash as booking tender, gift-card tender/refund ledger for bookings.
- UI: existing Harewa / VenueFlow gold `#D4AF37` and admin layouts. Do not copy TailorsMate bottom nav.
- Customer `/profile` may view own bookings only — never operator tools. Tailor `/tailor/*` gets no booking ops.

---

## PHASE 1 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 1 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md
Execute ONLY Phase 1. Do not implement public checkout purchase, Stripe booking capture, full booking payment UI, or polished public wizard yet.

================================================================================
A. PROJECT CONTEXT YOU MUST UNDERSTAND BEFORE CODING
================================================================================

This repo is a multi-tenant venue / event / attraction operations SaaS.
- Organization = paying company workspace (tenant HQ).
- VenueLocation = park / venue / site under the company (has timezone, slug unique per org).
- Membership = staff seat on an Organization.
- DEFAULT_ORG / isDefault = public Harewa fashion storefront — NEVER the ticketing catalog and never locked by tenant expiry.

Online Booking / Ticketing is the FIRST real venue module. Hang it off the existing control plane:
- Tenant gate: assertCompanyBillingEntitled THEN assertModuleEnabled(orgId, "ticketing").
- Every park business row: orgId required + locationId required (FK VenueLocation; assert venue.orgId === orgId).
- Public booking binds to published orgSlug + venueSlug (VenueLocation.slug is NOT globally unique — public URL MUST include both).
- Company admin lives under /admin/*. Guest views: public /book/* pages + /profile own bookings only. Tailor studio: no booking ops.

Shop commerce (Product, Cart, Order with cartId + walletId + shipping) is fashion retail. Do NOT store admission SKUs or bookings there.

Channels this epic must eventually support (Phase 1 builds catalog/foundation; booking create channels mostly Phase 2–3):
- online → /book/[orgSlug]/[venueSlug]
- phone → /admin/bookings/new?channel=phone
- walk_in → /admin/bookings/new?channel=walk_in
- pos → same booking engine APIs with channel=pos (POS terminal UI is Feature 02; APIs + POS notes ship in this epic)
- account → logged-in guest /profile?tab=bookings and party online account pages

Front desk IA to keep simple (capability underneath, progressive disclosure on detail):
CHECK IN (future) | SELL TICKETS | PARTY | MEMBERSHIP (future) | WAIVER (future) | FOOD (future) | REFUND
This epic ships SELL TICKETS, PARTY booking layer, REFUND on booking payments, and the booking engine underneath.

Reuse existing: Organization, VenueLocation, Membership, src/lib/venueLocations.ts, planLimits.ts, demoPlanLock.ts / demoPlanAssert.ts, actorLocationScope.ts, staffOrg.ts, requirePermissionFresh, permissions.ts, adminNav.ts, stripe.ts, mailer.ts / sendReceipts.ts / sendInvoice.ts, TaxSettings, activityLog.ts, Notification + notificationService, VenuesPage/orders admin patterns, companyExport.ts, smoke scripts pattern, rateLimit.ts.

Do NOT reuse as ticket store: Product, Cart, CartLine, Order (shop), Wallet, TailoringJob.

================================================================================
B. PHASE 1 OBJECTIVE
================================================================================

Entitled operators can configure the FULL ticketing catalog (all product types, sessions, resources, add-ons, stock periods, pass expiry, default booking behavior settings) and B2B companies/contacts. Permissions, nav, Demo lock, schema, and route shells exist. Public purchase must still fail (404/403). No Stripe booking capture in Phase 1. Staff availability preview API is OK.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 1 (DO NOT SKIP ANY)
================================================================================

C1. Module entitlement
- Create src/lib/moduleEntitlement.ts with assertModuleEnabled(orgId, "ticketing") that:
  1) assertOrganizationActive
  2) assertCompanyBillingEntitled (or Fresh path that already does this)
  3) Demo plan → ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE)
  4) Storefront / isDefault → Forbidden (park tickets are registered-company only)
  5) plan.moduleHints includes "ticketing" OR "all"
- Staff AND later public booking must fail if company is not entitled.
- Also create src/lib/ticketing/assertTicketingEnabled.ts as a thin ticketing-specific wrapper if useful.

C2. Plan meter ticketsPerMonth
- Move ticketsPerMonth into PlanLimits in src/lib/subscriptionPlans.ts (enforce in planLimits.ts).
- Caps: demo=0, starter=2000, growth=10000, enterprise=null (unlimited).
- Count confirmed ticket heads in venue timezone month of booking locationId. Enforce on CONFIRM (Phase 2), not draft. Phase 1: add the PlanResource + meter hook (can count 0).

C3. Complete Prisma schema + migration (create ALL tables now even if some APIs arrive in Phase 2)
All new tables: orgId required, indexed, FK Organization. Park-scoped: locationId required, FK VenueLocation.
Extend ActivityEntityType with: AdmissionProduct, TicketSession, Booking, BookingInvoice, BookingAccount, TicketCredential, BookingPayment.
Extend NotificationType with: booking.
Add Organization / VenueLocation / User relations as needed.

Enums (exact names):
- AdmissionProductType: timed_session | day_pass | group | camp_event | party_package | add_on | pass
- BookingStatus: draft | hold | reserved | pending_payment | confirmed | cancelled | expired | refunded
- BookingChannel: online | phone | walk_in | pos | account
- BookingCreateMode: hold | reserve | prompt
- CapacityResourceType: attraction | session | room | lane | party_room | other
- BookingPaymentTender: card | cash | split_component | gift_card | stored_card | invoice | other
- BookingPaymentStatus: pending | completed | failed | cancelled | refunded | partial_refund
- InvoiceStatus: draft | sent | paid | void | cancelled | overdue
- TicketCredentialStatus: unused | redeemed | void | expired
- PartyInviteStatus: pending | sent | accepted | declined | cancelled
- StockPeriodKind: available | blocked

Models and fields you MUST create:

BookingSettings (per location; locationId null = org default; unique orgId+locationId):
id, orgId, locationId?, defaultCreateMode (hold|reserve|prompt), holdTtlMinutes (default 15), reserveTtlHours (default 24), requireReviewBeforeConfirm (default false), allowOnlinePayLater, pastEditGraceMinutes (0 = lock when visit started), cancelCutoffMinutes, defaultTaxExempt, createdAt, updatedAt.

CapacityResource:
orgId, locationId, name, type, defaultCapacity (>=0), archivedAt. Timezone inherited from venue.

AdmissionProduct:
orgId, locationId, categoryId? (optional FK → org-scoped BookingCategory — Online Booking → Booking category; not shop ProductCategory), type, name, description, images[], resourceId?, published, waiverRequired (stub for future waivers), minGuests, maxGuests, defaultPassExpiryDays, taxExemptDefault, archivedAt.

AdmissionProductPrice (bands):
code (adult/child/infant/group), amount, currency, minAge, maxAge, validFrom, validTo, productId, orgId, locationId.

AdmissionAddOnLink:
parent product → add-on product, required, maxQty, stockPeriodId optional.

StockPeriod:
startsAt, endsAt, kind available|blocked, quantity optional cap, orgId, locationId, product links as needed.
Add-ons (including party package add-ons) only offered inside available periods, not blocked, with stock remaining.

TicketSession:
startsAt, endsAt, capacity, remaining (prefer stored remaining updated transactionally), resourceId, productId, priceOverride?, isClosed, orgId, locationId.

Booking (full fields for later phases — create now):
publicId (unique guest-facing), orgId, locationId, status, channel, createMode, userId?, accountId?, primaryContactName/email/phone, assignedStaffUserId?, taxExempt, taxExemptReason?, subtotal, taxAmount, total, amountPaid, amountDue, notes, posNotes, reviewedAt, reviewedById?, holdExpiresAt, reservedUntil, visitStartsAt, visitEndsAt, cancelledAt, reactivatedAt, createdById, updatedById, confirmationSentAt, viewToken or equivalent for guest confirmation.

BookingLine: product snapshot, price band, qty, unit price, resourceId, sessionId, visit date, passExpiresAt (issued), tax.

BookingGuest: name, age band, ticket credential link, party role host/guest.

BookingHold: TTL, session/resource qty claimed, token, orgId, locationId.

TicketCredential: code unique per org, qrPayload, status unused|redeemed|void|expired, customTicketId, passExpiresAt, redeemedAt.

BookingPayment: tender, amount, status, stripe ids, giftCardId?, receivedByStaffId?, splitGroupId?, receiptEmailSentAt.

BookingPaymentLink: token, amountDue snapshot, expiresAt, channel email|sms, sentTo.

BookingInvoice: number unique per org (INV-{orgSlug}-{seq}), status, dueAt, sentAt, voidedAt, optional PDF/html snapshot.

StoredPaymentMethod: Stripe customer + paymentMethod on User or BookingAccount. Never log PAN.

GiftCard (booking tender ledger only — not full gift card shop): orgId, code hash, remainingBalance, currency, issuedFromRefundBookingId?.

BookingAccount (B2B — NOT a second SaaS Organization): name, billing email, phone, taxId, notes, default tax exempt, orgId.

BookingAccountContact: name, email, phone, title/role, primary flag, accountId.

BookingActivity (or ActivityLog with typed kind): kind created|edited|status|payment|email|sms|call|note|staff_assign|ticket_ids|system, payload JSON, actorUserId, at.

Party tables:
- PartyBookingDetail 1:1 Booking (room resource, host staff, kid count, package product)
- PartyGuest (may share BookingGuest)
- PartyInvitation (token, channel email/sms, status)
- PartyRunSheetItem (time, title, notes, sort)

C4. Permissions — add ALL of these to src/lib/auth/permissions.ts (P object, PERMISSION_CATALOG, ROLE_PRESETS, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS):
- ticketing:read — view catalog, sessions, settings read
- ticketing:write — create/edit products, slots, add-ons, resources, pass expiry
- ticketing:manage — default booking behavior, TTLs, pay-later policy
- bookings:read — list/detail/search/calendar/parties/run sheets
- bookings:write — create/edit/cancel/reactivate/notes/activity/ticket IDs
- bookings:assign — assign staff
- bookings:overbook — confirm beyond capacity
- bookings:tax_exempt — mark booking tax-exempt
- bookings:refund — refund payments
- bookings:payments_read — transaction history
- bookings:payments_take — card/cash/split/gift/payment link
- bookings:charge_stored — charge card on file
- bookings:export — export booking data
- booking_invoices:read / booking_invoices:manage / booking_invoices:send
- booking_accounts:read / booking_accounts:write
- bookings:read_own / bookings:write_own — client profile

Preset grants:
- platform_admin: all (PERMISSIONS spread includes new keys automatically)
- ops_manager: ticketing read; bookings read/write/assign; payments take+read; invoices read/send; accounts read/write; bookings export; NO overbook, refund, charge_stored, tax_exempt
- catalog_editor: ticketing read/write; bookings read only
- finance: ticketing read; bookings read; payments read; refund yes; export yes; invoices all; accounts read; charge_stored yes; tax_exempt yes
- custom: via template
- client: *_own only
- tailor: none for ticketing/bookings
Do NOT build manager PIN pad.

C5. Admin routes (thin page.tsx files like venues) — register ADMIN_ROUTE_PERMISSIONS and add to ADMIN_REGISTERED_COMPANY_ONLY_PATHS. Demo must NOT allow these paths (not in isDemoAllowedAdminPath).

Pages to create in Phase 1 (working catalog UIs; bookings list can be empty shell):
- /admin/ticketing — products list (bookings: ticketing:read)
- /admin/ticketing/products/new — create product (ticketing:write)
- /admin/ticketing/products/[productId] — product editor (ticketing:read)
- /admin/ticketing/sessions — session/slot calendar (ticketing:read)
- /admin/ticketing/resources — capacity resources (ticketing:write for mutate)
- /admin/ticketing/add-ons — add-on catalog + stock periods
- /admin/ticketing/passes — pass types + default expiry
- /admin/ticketing/settings — default hold/reserve/prompt, TTLs, pay-later, past-edit, review-before-confirm, cancel cutoff, SMS enable flag
- /admin/booking-accounts — B2B companies list
- /admin/booking-accounts/[accountId] — company + contacts
- /admin/bookings — EMPTY LIST SHELL with columns/actions visible, no real booking create/pay yet
Shell-only routes may be stubbed but must exist in nav/permissions for later phases:
- /admin/bookings/new, /admin/bookings/[bookingId], /admin/bookings/[bookingId]/edit, /admin/bookings/calendar
- /admin/parties, /admin/parties/[bookingId]
- /admin/booking-invoices, /admin/booking-invoices/[invoiceId]
- /admin/booking-payments

C6. Admin sidebar (src/lib/adminNav.ts) — Bookings group:
Bookings → /admin/bookings
Calendar → /admin/bookings/calendar
Parties → /admin/parties
Ticketing → /admin/ticketing
Sessions → /admin/ticketing/sessions
Add-ons → /admin/ticketing/add-ons
Passes → /admin/ticketing/passes
Resources → /admin/ticketing/resources
Companies → /admin/booking-accounts
Invoices → /admin/booking-invoices
Payments → /admin/booking-payments
Ticketing settings → /admin/ticketing/settings
Add Dashboard quick links: Bookings, Ticketing, Parties.
Extend prefetchAdminRoute.ts stubs for these paths.
Add icon key if needed in AdminSidebar.

C7. Staff APIs for Phase 1 (register every method+path in API_PERMISSIONS; reject ?orgId= and body orgId):
GET/POST /api/admin/ticketing/products
GET/PATCH/DELETE /api/admin/ticketing/products/[id]
GET/POST /api/admin/ticketing/products/[id]/prices
GET/POST /api/admin/ticketing/products/[id]/addons
PATCH /api/admin/ticketing/products/[id]/expiry
GET/POST /api/admin/ticketing/sessions
PATCH/DELETE /api/admin/ticketing/sessions/[id]
GET/POST /api/admin/ticketing/resources
PATCH /api/admin/ticketing/resources/[id]
GET/POST /api/admin/ticketing/stock-periods
GET/PATCH /api/admin/ticketing/settings
GET/POST /api/admin/booking-accounts
GET/PATCH /api/admin/booking-accounts/[id]
GET/POST /api/admin/booking-accounts/[id]/contacts
Optional staff availability preview GET for sessions remaining (not public mutate).

Every staff create/mutate: requirePermissionFresh + requireActorOrgId + assertOrganizationActive + assertCompanyBillingEntitled + assertModuleEnabled + venue belongs to org. When actorLocationScope.locationScoped, filter lists to that locationId.

C8. Ticketing catalog product types — ALL must be creatable in admin:
- timed_session: session remaining capacity; date → slot grid later; session-based entry
- day_pass: day pool or capped; date picker; redeemable that calendar day in venue TZ
- group: timed or day + min/max guests; qty stepper with min
- camp_event: event remaining across date range
- party_package: party room resource + guest cap
- add_on: stock period and/or unlimited; attach to parent products
- pass: issued credential + defaultPassExpiryDays editable

C9. Ticketing admin UI details (Phase 1 must ship working CRUD)

Products list /admin/ticketing toolbar: Create product, type filter, published filter, venue filter.
Columns: Name, Type, Venue, Price from, Capacity/resource, Published, Archived, Updated.
Actions: View/Edit, Archive, Publish/Unpublish, Manage sessions.

Create product form fields: Type (required), Name, description, images (existing upload sign), Venue, Resource, Min/max guests, Default pass expiry days, Waiver required checkbox, Tax exempt default, Price bands repeatable (label, amount, ages), Add-on links, Published.

Product editor tabs: Details, Prices, Sessions (if timed), Add-ons, Pass expiry, Stock periods, Danger (archive).
Soft-archive only; existing bookings later keep line snapshots.

Sessions /admin/ticketing/sessions: calendar + table; create series (weekdays, start/end, capacity); close session; remaining display.
Columns: Date, Start, End, Product, Resource, Capacity, Remaining, Closed, Actions Edit/Close/View bookings.

Resources /admin/ticketing/resources: Name, Type, Venue, Default capacity, Archived, Actions Edit/Archive. Create: name, type, capacity, venue.

Add-ons /admin/ticketing/add-ons: Name, Price, Stock period, Parent products count, Actions. Create add_on + stock periods (start, end, qty, kind available|blocked).

Passes /admin/ticketing/passes: list pass-type products; edit default expiry.

Ticketing settings /admin/ticketing/settings form: defaultCreateMode hold|reserve|prompt, hold TTL minutes, reserve TTL hours, requireReviewBeforeConfirm, allowOnlinePayLater, payLaterMarksConfirmed?, pastEditGraceMinutes, cancelCutoffMinutes, SMS enable. Save via PATCH.

Capacity rules (implement at catalog/session level now; booking engine Phase 2):
- Availability must only return slots with remaining >= requestedQty (unless overbook later).
- Prefer transactional UPDATE remaining = remaining - qty WHERE remaining >= qty.
- Day passes: capacity pool per product+date or all-day resource.

C10. B2B companies & contacts (Phase 1 complete CRUD)
Company create fields: legal/trading name, billing email, phone, tax id, notes, default tax exempt.
Contact create fields: first/last, email, phone, title, primary flag.
List columns: Name, Billing email, Contacts count, Bookings count (0 for now), Actions View/Edit.
Detail: contacts table, bookings sublist placeholder, stored cards placeholder, invoices placeholder.
BookingAccount is NOT a SaaS Organization and cannot log into /admin.

C11. Bookings list shell /admin/bookings
Toolbar placeholders: Search (name/email/phone/ID/card token), filters status/channel/date/venue/staff/amount due, Create booking (may link to stub new page), Calendar link, Export (permission-gated, may 501 until Phase 4).
Columns: Visit, ID, Guest, Contact, Venue, Products, Qty, Status chip, Channel, Staff, Total/Paid, Actions.
Row actions visible in menu (may no-op or 501 until Phase 2–3): View, Edit, Take payment, Payment link, Invoice, Cancel, Reactivate, Assign staff, Download tickets, Review, Overbook confirm.
Empty state: “No bookings” + Create. Loading skeleton. Pagination.

C12. Lib files to create in Phase 1 (at least stubs that catalog uses; expand later):
src/lib/moduleEntitlement.ts
src/lib/ticketing/assertTicketingEnabled.ts
src/lib/ticketing/products.ts
src/lib/ticketing/sessions.ts
src/lib/ticketing/resources.ts
src/lib/ticketing/stockPeriods.ts
src/lib/ticketing/settings.ts
src/lib/ticketing/accounts.ts
src/lib/ticketing/pricing.ts
src/lib/ticketing/tax.ts (hook TaxSettings; full booking tax Phase 2)
Services/hooks: src/services/ticketing.ts, bookingAccounts.ts; src/hooks/useTicketing.ts
UI: src/components/Protected/admin/pages/ticketing/**, bookingAccounts/**, bookings shell

C13. Demo / pending / suspended / soft-hold / archived venue behavior
- Demo: staff catalog/bookings locked; public book 403/404
- Pending org: Fresh fail; public 404
- Suspended/expired: Fresh fail; public 404
- past_due still entitled: Allowed
- Soft-hold after unpaid paid-plan: creates denied; public 404
- Archived venue: no new products/sessions that sell; no new bookings later

C14. HQ location scope
When actorLocationScope().locationScoped, product/resource/session/account lists filter to that locationId. Creates stamp scoped venue or require validated picker when company-wide.

C15. Honest product copy
Do NOT claim ticketing complete in README or landing yet. Keep #ticketing honest.

C16. Testing Phase 1
Create scripts/smoke-ticketing-phase1.mts + package.json smoke:ticketing:p1 covering:
- same-org catalog allow
- cross-tenant deny
- Demo deny
- storefront deny
- unpaid deny
- bad locationId deny
- moduleHints without ticketing deny
- create timed_session + day_pass + group + camp_event + party_package + add_on + pass
- stock period create
- BookingSettings defaultCreateMode
- BookingAccount + contact create
Run the smoke. Fix failures. Check lints on touched files.

C17. Operator workflow Phase 1 must support end-to-end
BEFORE: Entitled org, active VenueLocation, module enabled.
START: /admin/ticketing → Create product.
DURING: Validate type-specific fields, prices > 0, capacity >= 0, venue ownership.
SUCCESS: Product saved; unpublished until published=true.
FAILURE: 400 validation / 403 Demo / 403 module.
REPEAT: PATCH edits; do not duplicate products.
REVERSAL: Soft-archive.

================================================================================
D. EXPLICITLY OUT OF PHASE 1
================================================================================

Public checkout purchase, Stripe booking payment, hold→confirm engine, refunds, invoices send, party invitations UI, profile bookings tab, payment links, overbook API, export CSV, cron expire holds (lib may stub). Do not skip those forever — they belong to Phases 2–5.

================================================================================
E. COMPLETION GATE PHASE 1
================================================================================

Staff in an entitled non-Demo company with a venue can configure timed tickets with slots/capacity, day passes, groups, camps/events, party packages with room resource, add-ons with stock periods, pass expiry, location default hold/reserve/prompt settings, and a B2B company with contacts. Permissions/nav/Demo lock work. Public cannot purchase. Shop/tailor/billing/venues/HQ still work. smoke:ticketing:p1 passes. Then STOP and wait for Phase 1 audit.
```

---

## PHASE 1 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 1 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md Phase 1 execution prompt.
Do NOT start Phase 2.

Deep-audit that EVERY Phase 1 feature was implemented completely — not partially, not stubbed where CRUD was required, not disconnected.

VERIFY EACH ITEM. If anything fails: FIX IT, re-test the fix, re-check related tenancy/billing/HQ, re-run smoke:ticketing:p1. Do not only report.

Checklist (all must be true):
1. assertModuleEnabled exists and runs AFTER billing entitlement; Demo locked; storefront forbidden; moduleHints ticketing|all enforced.
2. ticketsPerMonth is in PlanLimits with demo 0 / starter 2000 / growth 10000 / enterprise null; planLimits hook exists.
3. Full Prisma models/enums from Phase 1 prompt exist with orgId + locationId on park data; migration applies.
4. ALL permission keys listed in Phase 1 exist in P, catalog, presets, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS.
5. Admin nav Bookings group has every link listed; registered-company-only; Demo cannot open them.
6. Working CRUD (not empty fake): products all 7 types, prices, sessions, resources, add-ons, stock periods, pass expiry, ticketing settings (hold/reserve/prompt, TTLs, pay-later, past-edit, review-before-confirm, cancel cutoff).
7. B2B BookingAccount + contacts CRUD works; not a second Organization.
8. /admin/bookings shell exists with columns/actions; public purchase still impossible.
9. No fashion Product/Cart/Order used as tickets. /signup still closed.
10. Staff APIs reject client orgId; cross-tenant deny; HQ locationScoped filters lists.
11. Soft-archive products; unpublished products not for public (when public arrives).
12. smoke:ticketing:p1 green; shop/tailor/venues/billing not regressed.
13. No README false claim that ticketing is fully shipped.

Search for missing/partial/incorrect/disconnected/unused/duplicate/conflicting implementation. Fix all relevant issues. Only then declare Phase 1 complete.
```

---

## PHASE 2 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 2 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md
Execute ONLY Phase 2 after verifying Phase 1.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Re-run smoke:ticketing:p1. Inspect schema, permissions, catalog UIs, B2B, settings, Demo/storefront locks.
If anything from Phase 1 is missing, partial, insecure, or disconnected: FIX IT FIRST, re-test, then continue Phase 2.
Carry forward unfinished Phase 1 work. Do not blindly assume Phase 1 is correct.

================================================================================
B. PHASE 2 OBJECTIVE
================================================================================

Build the complete booking ENGINE and PAYMENT/TICKET/PARTY DATA APIs so the server can: create bookings (all channels via API), draft/hold/reserve/pending_payment/confirm/cancel/reactivate/expire/refund, edit products/dates/resources/costs/contacts, past-lock, review-before-confirm, notes & POS notes, activity stream including call logs, assign staff, bulk custom ticket IDs, pass expiry on credentials, resource moves, overbook (permission), tax exemption, B2B on booking, Stripe/cash/split/gift/stored/payment-link/invoice/refund/pay-later, QR credentials, party guest/invite/run-sheet/summary APIs, POS-channel APIs. UI polish is Phase 3 — APIs and engine must be complete; minimal staff create-via-API must work.

One engine: src/lib/ticketing/bookingEngine.ts used by public, phone, walk-in, POS-channel, and party bookings.

================================================================================
C. BOOKING STATE MACHINE (IMPLEMENT EXACTLY)
================================================================================

draft → hold (tentative, TTL) → pending_payment → confirmed
hold/reserved/pending_payment can → expired or cancelled
confirmed → cancelled or refunded (full/partial on payments)
draft can also → reserved (capacity held, longer TTL per settings) → pending_payment/confirmed/cancelled/expired
reactivate: cancelled → draft or hold or reserved only if capacity available OR overbook permission

Status behavior:
- draft: capacity NOT held; staff only; not guest-visible
- hold: capacity held; TTL holdTtlMinutes; optional pay link
- reserved: capacity held; TTL reserveTtlHours; guest-visible if online account
- pending_payment: capacity held; incomplete payment; guest-visible
- confirmed: capacity sold; paid OR pay-later OR invoice; guest-visible
- expired: capacity released; Stripe sessions cancelled; expired message
- cancelled: capacity released if tickets unused; refund policy
- refunded: capacity released if unused; refunded

Default booking behavior (BookingSettings.defaultCreateMode):
- hold = tentative short TTL
- reserve = longer reservation TTL
- prompt = staff UI asks Hold vs Reserve vs Confirm; ONLINE always uses hold-then-pay (never staff prompt)

Architecture rules:
1. Capacity is authoritative; overbook only with bookings:overbook.
2. Payments live on Booking via BookingPayment rows — NEVER shop Order. No Wallet required.
3. Guest checkout does NOT use /signup. Persist guest fields; link userId if email exists; magic link later (Phase 3).
4. JWT orgId is NEVER public write authority. Public APIs bind to published venue.
5. Redeemed tickets: do not restore capacity for redeemed heads on cancel/refund.

================================================================================
D. FEATURES THAT MUST BE COMPLETE IN PHASE 2 (DO NOT SKIP ANY)
================================================================================

D1. Create bookings via API for ALL channels
- online: POST /api/public/booking/holds then checkout (pay-now / pay-later)
- phone: POST /api/admin/bookings { channel: "phone" }
- walk_in: POST /api/admin/bookings { channel: "walk_in" }
- pos: POST /api/pos/bookings { channel: "pos" }
- account: public APIs with session userId
Body must NOT include orgId. locationId from scope or validated picker.
Staff create UI (domain tabs): Details (channel + Guest/Company) → Product & session (+ Availabilities rail) → Guests & add-ons → Options → Review. API must still support the same payload fields: Venue → Channel → Product(s) → Date/slot/resource → Guests/qty → Add-ons → Contact or B2B account → Notes → Mode if prompt → Review → Save.

D2. Draft, Hold, Reserve APIs
POST /api/admin/bookings/[id]/hold
POST /api/admin/bookings/[id]/reserve
Cron-ready lib expireBookingHolds() (wire cron in Phase 4; lib must work now).
Holds: atomic UPDATE remaining = remaining - qty WHERE remaining >= qty.

D3. Edit bookings
PATCH /api/admin/bookings/[id] transactional for products/qty, dates/sessions, resources, costs (line overrides), contacts (name/email/phone/company).
Re-price; restock old session; stock new session.
Reject past modifications per D6.
Guest self-edit: not in V1 except cancel + pay balance later.

D4. Cancel / reactivate
POST .../cancel { reason }: release capacity if unused; void credentials; prompt refund if amountPaid > 0 — do NOT auto-refund without bookings:refund confirmation.
POST .../reactivate: only cancelled (not refunded without finance); re-hold capacity or require overbook; restore draft/hold/reserved per body; log activity.

D5. Restrict past booking modifications
If visitEndsAt < now - pastEditGraceMinutes → PATCH products/dates/resources/costs returns 403 BOOKING_PAST_LOCKED.
Allowed when past-locked: notes, activity call log, assign staff (optional), refunds (permission), void credentials.
pastEditGraceMinutes=0 means lock when visit start has passed.

D6. Review before confirming
If requireReviewBeforeConfirm: Confirm blocked until POST .../review.
Online Stripe success may auto-set reviewedAt=system.
Staff phone/walk-in must review when setting on.
POST .../confirm after review if required. Error BOOKING_REVIEW_REQUIRED.

D7. Booking notes & POS notes
PATCH .../notes and PATCH .../pos-notes
Also PATCH /api/pos/bookings/[id]/pos-notes
POS notes on staff/POS only — NEVER on guest confirmation.

D8. Activity stream
Log: create/edit/status; payment/refund/invoice; email confirmation/receipt/invoice/invite (provider id, to, template); SMS; call logged (staff form: time, direction, summary); staff assign; ticket IDs; tax exempt; overbook.
POST /api/admin/bookings/[id]/activity for call/email/note.
GET detail includes activity reverse chronological.

D9. Assign staff
POST .../assign-staff { staffUserId } — active Membership same org. Show on list/detail.

D10. Bulk assign custom ticket IDs
POST .../ticket-ids { assignments: [{ credentialId, customTicketId }] }
Unique per org. Sequential prefix or CSV. Error TICKET_ID_TAKEN.

D11. Edit standard pass expiry
Catalog already has product expiry (Phase 1).
Issued: PATCH .../pass-expiry { credentialId, passExpiresAt } with activity log.
Credentials get passExpiresAt copied from product default at confirm.

D12. Edit resources on existing bookings
PATCH .../resources { lineId, resourceId, sessionId? }
Atomic capacity move. Conflict 409 RESOURCE_CONFLICT unless overbook.

D13. Overbook capacity (permission)
POST .../overbook or allowOverbook:true ONLY if bookings:overbook.
Remaining may go negative; UI warning later; activity overbook.
Online guests CANNOT overbook. Error OVERBOOK_FORBIDDEN.

D14. Tax exemption on bookings
PATCH .../tax-exemption { taxExempt, reason } requires bookings:tax_exempt.
Recompute tax/total using TaxSettings unless exempt. Lines keep pre-tax snapshot.

D15. Companies & contacts on booking
Booking may set accountId + primary contact from BookingAccountContact.
Picker walk-up guest vs company account.

D16. Download tickets (API payload)
GET /api/admin/bookings/[id]/tickets — QR/code payload for PDF/PNG later in Phase 3.
Issue TicketCredential only when confirmed (or walk-in staff-confirmed unpaid if you document that rule and stick to it).
Statuses: unused | redeemed | void | expired.

D17. Allow book online without paying
If allowOnlinePayLater: checkout option pay later / invoice.
Status confirmed or pending_payment per payLaterMarksConfirmed setting.
amountDue visible. Optional auto payment link.

D18. Payments — COMPLETE SET (do not skip any tender or flow)

Take payment POST /api/admin/bookings/[id]/payments
{ tenders: [{ type, amount, giftCardCode?, storedPaymentMethodId? }] }
- card: Stripe Checkout or PaymentIntent on booking; Apple/Google Pay via Stripe Checkout if enabled
- cash: staff records amount; receivedByStaffId; NO till hardware
- gift_card: redeem GiftCard balance; GIFT_CARD_INSUFFICIENT if short
- stored_card: bookings:charge_stored; Stripe customer
- split: multiple tenders; splitGroupId
- invoice: create invoice instead of capture

Payment request links:
POST .../payment-link { amount?, sendVia: ["email","sms"], to }
Public pay later via token (page Phase 3; API now).
Expires. Activity log. SMS adapter may no-op if unset.

Invoicing:
POST /api/admin/booking-invoices { bookingId }
GET/PATCH /api/admin/booking-invoices/[id]
POST .../send — email via sendInvoice.ts brand
POST .../cancel — if unpaid; INVOICE_NOT_CANCELLABLE if paid
Numbers INV-{orgSlug}-{seq}

Charge stored payment methods:
Store Stripe customer + payment_method after Checkout setup_future_usage where appropriate.
POST .../charge-stored. Failures keep pending_payment; log activity.

Manage incomplete payments:
Filter amountDue > 0. Actions: payment link, take payment, charge stored, cancel.
Stripe incomplete → failed payment row via webhook; hold TTL still applies.

Refunds:
POST .../refunds { amount, method: "original"|"gift_card", reason } requires bookings:refund
Full/partial. Card → Stripe refund. gift_card → issue/credit GiftCard.
Partial: stay confirmed with reduced amountPaid.
Full: status refunded; void unused tickets; restore capacity.

Transaction history API:
GET /api/admin/booking-payments — date, booking publicId, guest, tender, amount, status, staff, venue.
Search by booking ID, email, Stripe id (staff only; never export secrets).

Email receipts & confirmations (send path must work; polish Phase 3):
On payment: booking receipt (sendReceipts-style). On confirm: confirmation with tickets/date/venue/QR or link.
Idempotent confirmationSentAt / receiptEmailSentAt.
POST .../resend-confirmation

Stripe:
Extend src/lib/stripe.ts metadata: type=venue_booking, bookingId, orgId, locationId, paymentId.
Routes: POST /api/payment/booking, GET /api/payment/booking/confirm, POST /api/payment/booking/cancel
Success URL /payment/booking/success?session_id={CHECKOUT_SESSION_ID}
Idempotent confirm. Extend existing Stripe webhook for venue_booking — do not trust metadata orgId for auth; reload booking.
NEVER create shop Order rows for venue bookings.

D19. Public / guest APIs (implement now; UI Phase 3)
Rate-limit public hold/checkout.
GET /api/public/booking/venues/[orgSlug]/[venueSlug]
GET /api/public/booking/venues/[orgSlug]/[venueSlug]/products
GET /api/public/booking/availability ?productId&date&qty
POST /api/public/booking/holds
DELETE /api/public/booking/holds/[holdId]
POST /api/public/booking/checkout
GET /api/public/booking/confirmation/[bookingPublicId]
GET/POST /api/public/booking/pay/[paymentLinkToken]
GET /api/public/booking/magic/[token] (token validation; full portal UI Phase 3)
GET /api/public/booking/tickets/[ticketToken]
POST /api/public/booking/party/[bookingPublicId]/rsvp
Unpublished venue → PUBLIC_VENUE_NOT_PUBLISHED / 404
Sold out → SESSION_SOLD_OUT
Expired hold → HOLD_EXPIRED

Logged-in me APIs:
GET /api/me/bookings (bookings:read_own)
GET /api/me/bookings/[id]
POST /api/me/bookings/[id]/cancel (bookings:write_own if policy)
GET /api/me/bookings/[id]/tickets

POS APIs:
POST /api/pos/bookings
PATCH /api/pos/bookings/[id]
PATCH /api/pos/bookings/[id]/pos-notes

D20. Party DATA APIs (UI Phase 3)
GET/PATCH /api/admin/parties/[bookingId]/guests
POST /api/admin/parties/[bookingId]/invitations
GET /api/admin/parties/[bookingId]/run-sheet
GET /api/admin/parties/run-sheets?date=&locationId= (daily ops)
GET /api/admin/parties/[bookingId]/summary
Party add-ons respect StockPeriod.
Edit party package via admin booking PATCH and /api/pos/bookings/[id] with room capacity, guest min/max, add-ons.

D21. ticketsPerMonth enforce on confirm
assertWithinPlanLimit for ticketsPerMonth when confirming ticket heads. PLAN_LIMIT message if exceeded.

D22. Lib files to complete in Phase 2
bookingEngine.ts, capacity.ts, holds.ts, credentials.ts, payments.ts, refunds.ts, invoices.ts, paymentLinks.ts, giftCards.ts, parties.ts, search.ts (basic), confirmations.ts, sms.ts (adapter env-gated no-op), publicVenue.ts, expireHolds.ts
Services: bookings.ts, publicBooking.ts, bookingInvoices.ts

D23. Error strings (stable)
SESSION_SOLD_OUT, HOLD_EXPIRED, BOOKING_PAST_LOCKED, BOOKING_REVIEW_REQUIRED, OVERBOOK_FORBIDDEN, PAYMENT_INCOMPLETE, GIFT_CARD_INSUFFICIENT, INVOICE_NOT_CANCELLABLE, TICKET_ID_TAKEN, RESOURCE_CONFLICT, PUBLIC_VENUE_NOT_PUBLISHED, Demo/billing/module/cross-tenant messages from existing helpers.

D24. Edge cases to handle in engine
Timezone display vs UTC storage; DST; overlapping sessions; group qty below min; party kids vs package cap; Stripe webhook replay; refund after partial redeem (do not restore redeemed); reactivate without capacity; concurrent last-seat race; payment link after full pay; B2B contact deleted (keep snapshot on booking).

D25. Testing Phase 2
scripts/smoke-ticketing-phase2.mts + smoke:ticketing:p2:
- oversell race (last seat double-hold fails one)
- overbook without permission 403; with permission remaining can go negative
- hold TTL expire releases capacity
- refund restores capacity for unused
- pay-later online
- invoice create/send data path
- gift card tender
- payment link token
- tax exempt recomputes
- past lock 403
- reactivate
- party guests persist
- custom ticket IDs unique
- resource move conflict
- charge stored (mock/stub Stripe if needed)
- split cash+card
- cross-tenant deny
- ticketsPerMonth on confirm
- unpublished venue cannot hold
Run Phase 1 + Phase 2 smokes. Fix. STOP.

================================================================================
E. OUT OF PHASE 2
================================================================================

Polished public wizard UI, full admin tables polish, profile tab UI, print CSS, landing copy final, cron wiring (lib only), export CSV (may stub 501), HQ multi-venue search polish — Phase 3–4.

================================================================================
F. COMPLETION GATE PHASE 2
================================================================================

Engine prevents oversell without overbook; payments idempotent on booking not shop Order; credentials issued correctly; guest checkout does not use /signup; all booking feature APIs listed above work; party/POS/payment APIs work; smokes green. Then STOP for Phase 2 audit.
```

---

## PHASE 2 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 2 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md Phase 2 execution prompt.
Do NOT start Phase 3.

First verify Phase 1 still holds (re-run smoke:ticketing:p1). Then deep-audit Phase 2.

If anything is missing/partial/incorrect/insecure: FIX IT, re-test affected workflows (capacity, payments, refunds, party APIs), re-run smoke:ticketing:p2. Do not only report.

Must all be true:
1. State machine: draft, hold, reserved, pending_payment, confirmed, cancelled, expired, refunded — with correct capacity hold/release.
2. Channels API: online holds/checkout, phone, walk_in, pos, account linking.
3. Edit products/dates/resources/costs/contacts transactional; past lock BOOKING_PAST_LOCKED.
4. Cancel/reactivate correct; review-before-confirm enforced; notes + POS notes separate; POS notes never on guest payloads.
5. Activity logs create/edit/status/payment/email/sms/call/assign/ticket_ids/tax/overbook.
6. Assign staff; bulk custom ticket IDs unique; pass expiry on credentials; resource move atomic; overbook permissioned only; tax exemption recomputes.
7. B2B accountId on booking works.
8. Payments: card, cash, split, gift card, stored card, payment links, invoices create/send/cancel, incomplete payments, refunds full/partial to card or gift card, receipts/confirmations send path, pay-later.
9. No shop Order/Cart/Wallet for venue bookings. Stripe metadata type=venue_booking. Idempotent confirm.
10. TicketCredentials issued only per documented rule; void on refund/cancel unused.
11. Party guests/invitations/run-sheet/summary APIs exist; stock periods gate party add-ons; POS edit party validations.
12. Public APIs published-venue scoped; rate limits present; expireBookingHolds() lib works.
13. ticketsPerMonth enforced on confirm.
14. /signup still closed. Cross-tenant deny. Demo/module gates still work.
15. smoke:ticketing:p1 and p2 green.

Only then declare Phase 2 complete.
```

---

## PHASE 3 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 3 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md
Execute ONLY Phase 3 after verifying Phase 2.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Re-run smoke:ticketing:p1 and smoke:ticketing:p2. Trace hold → Stripe confirm → credentials → refund → capacity restore.
If broken: FIX, re-test, then continue. Carry forward unfinished Phase 1–2 work.

================================================================================
B. PHASE 3 OBJECTIVE
================================================================================

Ship COMPLETE staff UIs, public guest booking wizard, profile bookings, party UIs, payment/invoice pages, ticket download, email confirmations, SMS adapter, magic links, payment request pages — for every feature the engine already supports. Every table column, row action, and create form listed below must work.

================================================================================
C. PUBLIC ROUTES (create under src/app/(public)/ — NOT under /shop)
================================================================================

/book/[orgSlug]/[venueSlug] — venue booking home products
/book/[orgSlug]/[venueSlug]/[productId] — product + slot/date/add-ons
/book/[orgSlug]/[venueSlug]/checkout — guest details + pay / pay-later
/book/[orgSlug]/[venueSlug]/party/[productId] — party package booking
/booking/confirmation/[bookingPublicId] — confirmation + tickets
/booking/pay/[paymentLinkToken] — pay outstanding balance
/booking/magic/[token] — guest portal (expiring ~72h, unguessable)
/booking/tickets/[ticketToken] — single ticket / QR view
/payment/booking/success — Stripe return confirm then redirect
/payment/booking/cancel — hold still active until TTL
Query params: date, sessionId, qty, holdId, channel=online

================================================================================
D. PROFILE ROUTES (client only — NO operator tools)
================================================================================

/profile?tab=bookings — list own bookings (extend profile page)
/profile/bookings/[bookingId] — detail, tickets, pay balance, cancel if allowed, party guest list host side
Never: overbook, POS notes editor, invoice management, staff assign on profile.

================================================================================
E. ADMIN UI — EVERY PAGE, COLUMN, ACTION, CREATE FORM (ALL REQUIRED)
================================================================================

Patterns: React Query, toasts, ButtonSpinner, confirm modals, HqScopePolicyBanner on location-scoped pages, plan/module soft-gate banners.

E1. Bookings list /admin/bookings — FULLY WORKING (not shell)
Toolbar: Search name/email/phone/booking ID/card token (Stripe fingerprint/PaymentIntent staff-only), filters status/channel/date range/venue/staff/amount due, Create booking, Calendar, Export (if bookings:export — full export Phase 4 OK if button calls API).
Columns: Visit (venue TZ), ID publicId, Guest (+ company), Contact email/phone, Venue, Products summary, Qty, Status chip Draft/Hold/Reserved/Pending/Confirmed/Cancelled/Expired/Refunded + $DUE, Channel Online/Phone/Walk-in/POS/Account, Staff, Total/Paid, Actions.
Row actions: View, Edit (if not past-locked), Take payment (if amountDue>0), Payment link, Invoice, Cancel, Reactivate, Assign staff, Download tickets, Review, Overbook confirm (if permitted).
Empty state, skeleton, pagination.

E2. Create booking /admin/bookings/new?channel=&locationId=&party=1&accountId=
Domain tabs (not a 12 micro-step linear wizard): 1 Details (origin walk_in/phone/pos + Guest vs Company holder + contact/accountId) 2 Product & session (venue if unscoped, type, product, date/session; persistent Availabilities rail reuses getTicketingAvailability) 3 Guests & add-ons (qty, price band, linked add-ons) 4 Options (tax exempt if permitted, notes/POS notes, create mode if prompt, overbook if permitted) 5 Review → Submit → detail (payments/staff assign on detail).
Validation inline. Sold out blocks unless overbook.

E3. Booking detail /admin/bookings/[bookingId]
Header: publicId, status chips, amount due, assigned staff, channel, venue.
Buttons: Edit, Take payment, Payment link, Invoice, Cancel, Reactivate, Download tickets, Resend confirmation, Review & confirm.
Tabs:
- Overview: lines, dates, resources, guests, totals, tax
- Payments: tenders, refunds, incomplete, stored cards
- Invoices: list + create
- Tickets: credentials, bulk custom IDs, pass expiry, download
- Notes: booking notes / POS notes
- Activity: stream + log call form; filters All/Payments/Communications/System
- Party: if party_package embed party tabs
- Company: account/contacts
Past-locked banner when edits restricted.
Edit page /admin/bookings/[bookingId]/edit wizard.

E4. Calendar /admin/bookings/calendar
Day/week; sessions as blocks remaining/capacity; click → bookings for slot; occupancy color.

E5. Ticketing pages — ensure Phase 1 UIs remain polished and linked from booking flows (products/sessions/resources/add-ons/passes/settings already built — fix gaps).

E6. Parties list /admin/parties
Today/date picker. Columns: Time, Party name, Kids, Room, Status PAID / $BALANCE / WAIVERS MISSING (stub chip), Host, Actions Open / Run sheet / Print.
Matches FEC “Today’s Parties” behavior using booking data.

E7. Party detail /admin/parties/[bookingId]
Tabs: Overview | Guests | Invitations | Waivers (status only) | Room | Host | Add-ons | Balance | Timeline | Activity
Actions: Edit package, Take payment, Send invitations, Download summary, Print run sheet, Download tickets.
Guest list add/edit/remove names kid/adult waiver chip status string only.
Invitations email/SMS with token; RSVP public page.
Run sheet print CSS window.print — time, party name, kids, room, host, food/add-on notes, timeline.
Summary download CSV/PDF: package, payments, guests, add-ons, staff.
Party booking via online accounts: logged-in guest books party package; appears in profile; magic link without account.
Edit from VM (/admin/bookings and /admin/parties) and ensure POS API still works.
Do NOT build kitchen routing or Intercard arcade issuance; generic “arcade card” add-on SKU OK.

E8. Companies /admin/booking-accounts — polish Phase 1 CRUD; wire bookings sublist + invoices + stored cards display.

E9. Invoices /admin/booking-invoices
Columns: Number, Booking, Company/guest, Status, Total, Due, Sent, Actions View/Send/Cancel/Download.
Detail manage due date, notes, send, cancel.

E10. Payments /admin/booking-payments
Columns: When, Booking, Guest, Tender, Amount, Status, Staff, Venue, Actions Open booking.
Search booking ID, email, Stripe id.

E11. Take payment modal (card, cash, split, gift card, stored, invoice)
Payment link send email/SMS. Refund modal full/partial to card or gift card.

================================================================================
F. PUBLIC + GUEST UI DETAILS
================================================================================

Venue book home: venue name, address, timezone; grid of published products; sold out badges; party packages highlighted.
Product selection:
- timed: calendar → slots with remaining
- day pass: date + qty bands
- group: min/max
- camp/event: event dates
- add-ons step
- Continue → create hold → checkout
Hold countdown visible; expiry → restart.
Checkout: name, email, phone; Pay now (Stripe) vs Pay later if allowed; order summary; tax; NO shipping; NO shop cart mix.
Logged-in prefills profile; link userId.
Confirmation: booking ID, when/where, lines, paid/due, QR tickets, download, magic link emailed.
Profile tab Bookings: upcoming/past; detail tickets, pay due, cancel per cutoff, party guests; no POS notes.

================================================================================
G. NOTIFICATIONS
================================================================================

Booking confirmation: email REQUIRED; SMS if adapter configured + phone; in-app if userId.
Payment receipt: email if email present; SMS optional; in-app if userId.
Payment request link: per sendVia email/sms.
Invoice send: email required; SMS optional.
Party invitation: email + SMS.
Cancellation: email; SMS optional; in-app if userId.
Staff assigned: optional in-app to assignee.
SMS: src/lib/ticketing/sms.ts env BOOKING_SMS_PROVIDER; if unset skip SMS, log sms_skipped, do NOT fail booking.
Transactional only — not marketing campaigns.
Magic links expire (~72h). Confirmation tokens unguessable (publicId + viewToken).

================================================================================
H. COMPONENTS / SERVICES
================================================================================

Create/complete:
src/components/Protected/admin/pages/bookings/**
src/components/Protected/admin/pages/parties/**
src/components/Protected/admin/pages/bookingInvoices/**
src/components/Protected/admin/pages/bookingPayments/**
src/components/Public_C/booking/**
src/components/Protected/profile/bookings/**
hooks useBookings.ts usePublicBooking.ts

================================================================================
I. TESTING PHASE 3
================================================================================

scripts/smoke-ticketing-phase3.mts + browser or curl verification:
- Guest buys timed ticket + day pass + add-on
- Staff phone booking + payment link
- Walk-in cash payment
- Party booking + guest list + invitation + run sheet print + summary download + tickets download
- Profile own bookings only; magic link cannot see other bookings
- Payment link email; SMS skip if unset
- Shop checkout still works; tailor unchanged; /signup closed
Fix regressions. STOP for Phase 3 audit.

================================================================================
J. COMPLETION GATE PHASE 3
================================================================================

Every admin table/action/create form works; public wizard works for all product types; party UI works; confirmations email; tickets downloadable; profile/magic link work; channels online/phone/walk-in work. Then STOP.
```

---

## PHASE 3 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 3 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md Phase 3 execution prompt.
Do NOT start Phase 4.

Verify Phases 1–2 still hold (smokes). Then audit EVERY UI surface.

If anything is wrong: FIX IT, re-verify guest + staff + party + profile + shop regression. Do not only report.

Must all be true:
1. All public routes exist and work (book home, product, checkout, party, confirmation, pay link, magic, tickets, payment success/cancel).
2. Profile bookings list/detail without operator tools or POS notes.
3. Bookings list: every column and every row action works with correct permissions.
4. Create booking domain tabs (Details → Product & session → Guests & add-ons → Options → Review); prompt mode Hold/Reserve/Confirm; overbook checkbox permissioned; payments/staff remain on booking detail.
5. Booking detail: all primary buttons and all tabs (Overview, Payments, Invoices, Tickets, Notes, Activity, Party, Company).
6. Calendar occupancy works.
7. Parties list Today’s Parties columns/status chips; party detail all tabs; invitations; run sheet print; summary download; tickets download.
8. Invoices and payments pages complete.
9. Public wizard: timed, day pass, group, camp/event, add-ons, hold countdown, pay now/pay later.
10. Email confirmations send; SMS no-op safe; magic links expire and isolate bookings.
11. No ops tools on /profile or /tailor. Harewa UI. Shop/tailor not broken.
12. smoke:ticketing:p3 green (or documented equivalent + manual verification recorded).

Only then declare Phase 3 complete.
```

---

## PHASE 4 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 4 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md
Execute ONLY Phase 4 after verifying Phase 3.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Walk public + operator + party flows again. Re-run p1–p3 smokes. Fix broken UI/API/email BEFORE new work.

================================================================================
B. PHASE 4 OBJECTIVE
================================================================================

Synchronize Online Booking / Ticketing with the SaaS control plane: cron, HQ multi-venue search, export, company export, Stripe webhooks, rate limits, Demo/suspend/archive gates on public+staff, tax consistency, activity completeness, README/landing honesty, POS contract documentation — so the module behaves as one connected system.

================================================================================
C. FEATURES THAT MUST BE COMPLETE IN PHASE 4 (DO NOT SKIP ANY)
================================================================================

C1. Cron / reliability
Wire expireBookingHolds() (and expire unpaid pending_payment / payment links per settings) into hourly job — prefer extending existing Vercel Hobby cron budget (e.g. reconcile-company-subscriptions sibling) rather than exceeding Hobby cron limits.
Also expire reserved bookings past reservedUntil.

C2. Search (complete)
GET /api/admin/bookings?q=&status=&channel=&locationId=&from=&to=&staffUserId=&accountId=&productType=&amountDue=
q matches: guest name, email, phone, booking.publicId, TicketCredential.code, customTicketId, card token = Stripe payment method fingerprint / PaymentIntent id (staff read; NOT in export files).
Indexes: (orgId, locationId, visitStartsAt), (orgId, publicId), (orgId, primaryContactEmail), phone, credential code.

C3. Export (permission bookings:export)
GET /api/admin/bookings/export with same filters.
CSV and JSON. Columns: publicId, venue, datetime, guest, email, phone, status, channel, products, qty, total, paid, due, staff, company.
NO Stripe secrets, NO QR private tokens, NO payment-link secrets.
Audit log the export.

C4. Multi-venue booking search (HQ)
When Enterprise entitled + All locations (locationId null): search across all org venues.
When locationScoped: filter to selected locationId.
Growth multi-park still org-scoped. Never leak other orgs.
Location switcher filters booking/catalog lists when set. Rows still stamp their own locationId.

C5. Workspace company export
Extend buildCompanyWorkspaceExport / companyExport.ts with redacted:
- product counts by type
- booking counts by status
- invoice counts
- no Stripe ids, no full card numbers, no payment-link secrets (last4/brand only)

C6. Stripe webhook idempotency
Confirm venue_booking Checkout/charge/refund events handled; replay safe; booking statuses consistent.

C7. Rate limits
Public hold/checkout/payment-link consume rateLimit.ts. Export rate limited like company-export pattern if appropriate.

C8. Gates synchronized (staff AND public)
Demo locked; pending Fresh fail; suspended/expired fail; soft-hold creates denied; archived venue no new bookings (existing readable); unpaid/moduleHints fail; DEFAULT_ORG never sells park tickets.

C9. Tax
Apply org TaxSettings to booking totals unless taxExempt. Consistent online and staff.

C10. Activity completeness
Ensure all Phase 2–3 events appear in booking activity including emails/SMS/calls/exports.

C11. Future module stubs only (do not fake apps)
waiverRequired on product; waiver status chip string on party; TicketCredential unused/redeemed/void for future Check-In; document /api/pos/bookings + POS notes for Feature 02 POS epic.

C12. README + landing honesty
Update README next-epics: Online Ticketing shipped with explicit non-goals (full POS, Party Command Center mega-features beyond booking layer already shipped, waiver signing, scanners, OTAs, Intercard, dynamic pricing engine, promo codes, reopen signup).
Landing #ticketing: do not claim every park live; link real public flow only where honest.
Point docs/saas-module-extension.md at this spec.

C13. Regression
Re-run: yarn smoke:company-saas-hardening, smoke:plan-limits, smoke:venue-locations, smoke:enterprise-hq, and ticketing p1–p4.
Shop checkout + tailor + billing + venues + HQ still work. No shop Order leakage for tickets.

C14. Optional reminder emails
Hold/reserve reminder optional; if not shipped, document as residual — do not break confirmation pipeline.

C15. Testing Phase 4
scripts/smoke-ticketing-phase4.mts:
- hold expires via expireBookingHolds
- HQ location filter vs all-locations search
- export omits secrets; requires bookings:export
- company export includes redacted counts
- Demo/suspend/archive/public 404
- card token search staff-only
- webhook idempotency simulation
Fix. STOP for Phase 4 audit.

================================================================================
D. COMPLETION GATE PHASE 4
================================================================================

Control plane and ticketing agree: cron, HQ, export, Demo/suspend, webhooks, rate limits, honest docs. No fake POS/waiver/check-in apps. Smokes green. Then STOP.
```

---

## PHASE 4 — FOLLOW-UP AUDIT PROMPT

Copy everything inside the fence below:

```text
AUDIT PHASE 4 of Online Booking / Ticketing.
SSOT: docs/online-booking-ticketing-complete-spec.md Phase 4 execution prompt.
Do NOT start Phase 5 yet.

Verify Phases 1–3 still hold. Then audit integration/hardening.

If wrong: FIX, re-run affected smokes (ticketing p4, company-saas-hardening, plan-limits, venue-locations, enterprise-hq). Do not only report.

Must all be true:
1. expireBookingHolds (and related expiries) wired to cron/hourly job and actually releases capacity.
2. Search q matches name, email, phone, booking ID, credential code, custom ticket ID, card token (staff).
3. Export permissioned, redacted, audited.
4. HQ multi-venue search + locationScoped filter correct; no cross-org leak.
5. companyExport redacted ticketing/booking/invoice counts; no secrets.
6. Stripe webhook venue_booking idempotent.
7. Public rate limits present.
8. Demo/pending/suspended/soft-hold/archived/storefront gates on staff AND public.
9. TaxSettings applied unless taxExempt.
10. Activity stream complete for payments/emails/SMS/calls/exports.
11. README/landing honest; POS/waiver/check-in not falsely claimed complete; /api/pos/bookings documented.
12. Shop/tailor/billing/venues/HQ smokes still pass; no fashion Order used as tickets.

Only then declare Phase 4 complete.
```

---

## PHASE 5 — EXECUTION PROMPT

Copy everything inside the fence below:

```text
START PHASE 5 of Online Booking / Ticketing — FINAL AUDIT AND PRODUCTION READINESS.
SSOT: docs/online-booking-ticketing-complete-spec.md
Do NOT add unrelated features. Do NOT fake POS/waivers/scanners/OTAs.

================================================================================
A. PREVIOUS-PHASE VERIFICATION (MANDATORY)
================================================================================

Verify Phase 4 first. Fix any carry-forward defects before polish-only work.

================================================================================
B. PHASE 5 OBJECTIVE
================================================================================

Independently re-trace the ENTIRE feature set through the live app. Fix every gap. Make production-ready. Prove with smoke:ticketing:all.

================================================================================
C. MASTER FEATURE CHECKLIST — EVERY ITEM MUST BE TRUE (FIX IF NOT)
================================================================================

TICKETING CATALOG
- Timed tickets (session-based entry)
- Day passes
- Group bookings
- Camps/events
- Sellable add-ons attached to bookings
- Capacity-aware slot/date/resource inventory
- Price bands adult/child/etc.
- Pass expiry editable on product and issued credentials
- Stock periods for add-on (including party) availability
- Public publish/unpublish
- Tax rules + per-booking tax exemption

BOOKINGS CREATE & MANAGE
- Create bookings: phone, walk-in, online, pos API, account
- Draft, Reserve, Hold (tentative) states
- Default booking behavior: reserve vs hold vs prompt staff (online always hold-then-pay)
- Edit bookings: products, dates, resources, costs, contacts
- Cancel / reactivate bookings
- Restrict past booking modifications
- Review bookings before confirming (when setting on)
- Booking notes & POS notes
- Activity stream: full history, emails, calls logged
- Assign staff to bookings
- Bulk assign custom ticket IDs
- Edit standard pass expiry
- Edit resources on existing bookings
- Overbook capacity (permission bookings:overbook only)
- Tax exemption on bookings
- Companies & contacts (B2B/corporate)
- Download tickets
- Allow book online without paying (invoice/pay later)

PAYMENTS ON BOOKINGS
- Take payment: card, cash, split, gift card, stored card, invoice
- Payment request links SMS/email
- Invoicing: create, send, manage, cancel
- Charge stored payment methods
- Manage incomplete payments
- Refunds: full/partial, to card or gift card
- Find transaction history
- Email receipts & order confirmations
- Pay later / incomplete searchable

PARTY-SPECIFIC
- Party guest list & invitations
- Run sheets (printed daily ops)
- Party summary download
- Party package add-on availability via stock periods
- Party booking via online accounts
- Edit party package bookings from VM and POS APIs
- Download tickets for party guests/host

EXPORT & SEARCH
- Export booking data (permission bookings:export)
- Search by guest name, email, phone, booking ID, card token
- Multi-venue booking search (HQ)

CONFIRMATION PIPELINE
- Guest account/profile when linked
- Email required
- SMS when configured (safe no-op if unset)
- Magic link without reopening /signup

SECURITY / TENANCY
- orgId + locationId everywhere park-scoped
- assertModuleEnabled after billing
- Demo/storefront/unpaid/suspended/archived fail closed
- Cross-tenant deny
- No client-trusted orgId
- ticketsPerMonth enforced
- Capacity cannot oversell without overbook permission

SURFACES
- Customer / tailor / admin unmerged
- No fashion Order as tickets
- /signup still closed

================================================================================
D. ROUTES / APIs / FILES — CONFIRM EXISTENCE
================================================================================

Confirm all routes and APIs from Phases 1–4 exist (admin ticketing/bookings/parties/accounts/invoices/payments, public book/payment/magic, me bookings, pos bookings, stripe webhook, cron).
Confirm lib inventory under src/lib/ticketing/** and moduleEntitlement.ts.
Confirm package.json scripts: smoke:ticketing:p1 … p5 and smoke:ticketing:all.

================================================================================
E. TESTING MATRIX — RUN / VERIFY
================================================================================

T1 Cross-tenant deny
T2 Demo/storefront/unpaid deny
T3 Last seat double-hold
T4 Hold expires during Stripe
T5 Overbook without permission 403
T6 Overbook with permission
T7 Past booking edit 403
T8 Cancel unused restores capacity
T9 Refund to card + gift card
T10 Split cash+card
T11 Pay later online
T12 Payment link email/SMS skip if no SMS
T13 Invoice create/send/cancel
T14 Charge stored card
T15 Custom ticket IDs unique
T16 Resource move conflict
T17 Tax exempt recomputes
T18 Party invite RSVP
T19 Add-on hidden outside stock period
T20 HQ location filter vs all-locations search
T21 Export omits secrets
T22 Magic link isolation
T23 Profile cannot read other userId
T24 Shop checkout still works
T25 /signup still closed
T26 ticketsPerMonth cap on confirm
T27 Reactivate without capacity
T28 Review-before-confirm blocks staff confirm
T29 Archived venue no new book
T30 Card token search staff

Create scripts/smoke-ticketing-phase5.mts if needed. yarn smoke:ticketing:all must pass.
Re-run company-saas-hardening, plan-limits, venue-locations, enterprise-hq.

================================================================================
F. PRODUCTION READINESS
================================================================================

Document env: STRIPE_SECRET_KEY, optional BOOKING_SMS_PROVIDER + credentials.
Permission catalog complete in admin UI.
Performance: availability queries indexed; no N+1 obvious disasters on list pages.
Residual backlog listed honestly: full POS terminal, waiver signing, check-in scanners, OTA, Intercard, dynamic pricing engine, promo codes, gift card storefront merchandising, manager PIN, optional hold/reserve reminder emails.

================================================================================
G. COMPLETION GATE PHASE 5 / SYSTEM COMPLETE
================================================================================

Every item in section C is implemented (not TODO). All phase audits passed. Smokes green. README does not claim non-goals complete. Then STOP — feature is production-ready for Online Booking / Ticketing.
```

---

## PHASE 5 — FOLLOW-UP AUDIT PROMPT (FINAL)

Copy everything inside the fence below:

```text
FINAL AUDIT of Online Booking / Ticketing after Phase 5.
SSOT: docs/online-booking-ticketing-complete-spec.md entire Phase 5 checklist and all prior phase prompts.

Independently re-trace the feature through the existing application end-to-end:

entitled company → venue → catalog (all product types) → public hold → pay or pay-later → confirm → email/SMS/profile/magic link → staff phone/walk-in → payments (card/cash/split/gift/stored/link/invoice) → refund → capacity restore → party guest list/invites/run sheet/summary → B2B company booking → overbook permission → past lock → review → notes/POS notes → activity → staff assign → custom ticket IDs → pass expiry → resource edit → tax exempt → search/export/HQ → Demo deny → storefront deny → shop still works → /signup still closed.

Look for: missing, partial, incorrect, disconnected, unused, duplicate, conflicting implementation; oversell; authZ holes; entitlement lies; confirmation gaps; export/HQ/Demo issues; performance; production readiness.

If you find ANY relevant issue: FIX IT. Then re-audit the fix. Re-test the affected workflow. Re-check synchronization with billing, HQ, shop, tailor.

Feature is COMPLETE only when every Phase 5 section C bullet is true, smoke:ticketing:all is green, and honest non-goals remain unfaked.

Do not mark complete if critical booking/pay/capacity/tenant bugs remain.
```

---

## HONEST NON-GOALS (keep in every phase — do not fake)

These are out of scope for this epic. Ship contracts/stubs only where earlier phases already specified:

- Full POS terminal, F&B modifiers, kitchen display, cash till hardware sessions
- Digital waiver signing / guardian flows (waiverRequired + status chip only)
- Check-in scanner / wristband hardware UI
- Membership recurring engine
- Gift card storefront merchandising (booking gift-card tender/refund ledger IS in scope)
- Promo codes / BOGO
- Dynamic pricing rule engine
- OTA / Viator / Klook / GetYourGuide / Trip.com
- Intercard / Sacoa / Amusement Connect
- Manager PIN pad
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
