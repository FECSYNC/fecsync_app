# Party Management (Feature 04): two Cursor prompts

Paste one step at a time into Cursor chat. When a step finishes, paste its follow-up prompt before moving on, and never skip a follow-up. Do not start Step 2 while the Step 1 follow-up still reports a failure, a partial item, or a missing item.

This file is the execution source of truth for Party Management. `docs/party-management-complete-spec.md` is the older five-phase pack. It was written before Online Ticketing, POS, guest Memberships, and Digital Waivers shipped, so it assumes tables are missing that now exist. Keep its requirements, but follow the two-step split below. Do not recreate any model, route, or helper that already exists.

Step 1 covers the foundation: gates, schema, permissions, the party engine, every staff/public/me/POS API, payments money-sync, party catalog admin screens (packages, rooms, menu, settings), and the Step 1 smoke. Step 2 covers everything else: operator screens (list, create wizard, detail tabs, balances), guest screens (party booking, RSVP, pay link, confirmation, profile host), emails/SMS/in-app notices, crons, export, cross-feature sync, security hardening, performance, the Step 2 smoke, and the final independent audit.

There are only two steps. There is no Step 3.

---

## Step 1 prompt

```
You are implementing STEP 1 of 2 of Party Management (Feature 04) for this multi-tenant venue / event / attraction SaaS (skyline360degree / VenueFlow, repo roller_clone_app). Step 1 builds the party foundation, the full party engine, every API, the payment money-sync, and the party catalog admin screens. Do not build the operator party list redesign, the create-party wizard UI, the party detail tabs UI, the balances page UI, the public party booking UI, the RSVP UI, the pay-link UI, or the profile party UI in this step. Those are Step 2. Do not stop halfway. Do not ask me for a feature list. Everything required is written below.

=====================================================================
PART 0. SCAN THE PROJECT FIRST (MANDATORY, BEFORE ANY CODE)
=====================================================================

Before you change anything, scan this project and write down what already exists, what is partial, what is missing, and what has to be connected. Read the real files and follow every import they use. Do not trust this prompt's "known facts" blindly; confirm each one in code.

Read these rules and docs fully:
.cursor/rules/saas-venue-platform.mdc
.cursor/rules/customer-vs-tailor-sections.mdc
docs/party-management-complete-spec.md (older five-phase requirements; still binding for scope)
docs/fec-os-cursor-feature-catalog.md (Feature 04 section)
docs/online-booking-ticketing-complete-spec.md
docs/pos-complete-spec.md and docs/pos-two-step-prompts.md
docs/digital-waivers-complete-spec.md
docs/saas-module-extension.md
docs/enterprise-hq-controls.md
docs/ticketing-env.md and docs/pos-env.md
README.md (module entitlement contract section)

Read these schema areas in prisma/schema.prisma:
Organization, VenueLocation, Membership, MembershipVenueAssignment, User, GuestProfile, BookingSettings, CapacityResource, AdmissionProduct, AdmissionProductPrice, AdmissionAddOnLink, StockPeriod, TicketSession, Booking, BookingLine, BookingGuest, BookingHold, TicketCredential, BookingPayment, BookingPaymentLink, BookingInvoice, BookingActivity, PartyBookingDetail, PartyGuest, PartyInvitation, PartyRunSheetItem, WaiverRecord (and its PartyGuest relation), PosProduct, KitchenTicket, TaxSettings, CompanyProfile, Notification, ActivityLog, and enums NotificationType, ActivityEntityType, AdmissionProductType, BookingStatus, BookingChannel, BookingCreateMode, CapacityResourceType, BookingPaymentTender, BookingPaymentStatus, InvoiceStatus, TicketCredentialStatus, PartyInviteStatus, PartyGuestRole, PaymentLinkChannel, StockPeriodKind, BookingActivityKind. Also read the shop models Product, Cart, CartLine, Order, Wallet, WalletTransaction only so you know what you must NOT reuse.

Read these libs and follow their imports:
src/lib/moduleEntitlement.ts
src/lib/subscriptionPlans.ts
src/lib/planLimits.ts
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/lib/prefetchAdminRoute.ts
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/staffOrg.ts
src/lib/venueLocations.ts
src/lib/companyExport.ts
src/lib/activityLog.ts
src/lib/stripe.ts
src/lib/mailer.ts
src/lib/sendReceipts.ts
src/lib/sendInvoice.ts
src/lib/rateLimit.ts
every file in src/lib/ticketing/ (especially bookingEngine.ts, parties.ts, holds.ts, expireHolds.ts, capacity.ts, resources.ts, sessions.ts, sessionLimits.ts, products.ts, settings.ts, pricing.ts, tax.ts, payments.ts, paymentLinks.ts, paymentSafety.ts, pendingStripe.ts, refunds.ts, invoices.ts, credentials.ts, confirmations.ts, activity.ts, errors.ts, publicBooking.ts, loadPublicBook.ts, publicBookPaths.ts, publicVenue.ts, bookingRoute.ts, bookingPayable.ts, bookingExport.ts, staffBookingContact.ts, staffGateCache.ts, visitDayBounds.ts, sms.ts, assertTicketingEnabled.ts)
every file in src/lib/pos/ (especially saleEngine.ts, catalog.ts, fulfillSale.ts, webhook.ts, scope.ts, assertPosEnabled.ts)
every file in src/lib/waivers/ that references PartyGuest or party (capture.ts, bookingHooks.ts, desk.ts, signToken.ts)

Read these existing routes and pages (party-related ones already exist; extend them, do not duplicate them):
src/app/(admin)/admin/parties/page.tsx, loading.tsx, [bookingId]/page.tsx
src/components/Protected/admin/pages/bookings/PartyDetailPage.tsx
src/app/(admin)/admin/bookings/** and src/app/(admin)/admin/ticketing/**
src/app/api/admin/parties/[bookingId]/guests/route.ts, host/route.ts, invitations/route.ts, run-sheet/route.ts, summary/route.ts
src/app/api/admin/parties/run-sheets/route.ts
src/app/api/admin/bookings/** (route.ts, [id]/confirm, hold, reserve, cancel, reactivate, payments, payment-link, refunds, resources, overbook, assign-staff, activity, resend-confirmation, tickets, waivers, tax-exemption, charge-stored, notes, pos-notes)
src/app/api/admin/ticketing/** (products, products/[id], prices, addons, resources, resources/[id], sessions, sessions/[id], stock-periods, availability, settings, categories)
src/app/api/admin/waivers/party-chase/route.ts
src/app/api/public/booking/** (availability, holds, holds/[holdId], checkout, pay-now, confirmation/[bookingPublicId], pay/[paymentLinkToken], magic/[token], magic/[token]/guests, party/[bookingPublicId]/rsvp, venues/[orgSlug]/[venueSlug], venues/[orgSlug]/[venueSlug]/products)
src/app/api/me/bookings/** (route.ts, [id], [id]/cancel, [id]/party-guests, [id]/tickets)
src/app/api/pos/bookings/** and src/app/api/pos/[...path]
src/app/api/webhooks/stripe/route.ts and src/app/api/payment/booking/confirm/route.ts
src/app/api/cron/reconcile-company-subscriptions/route.ts and scripts/reconcile-company-subscriptions.mts
src/app/(public)/book/[venueSlug]/party/[productId]/page.tsx, src/app/(public)/book/[venueSlug]/[legacyVenue]/party/[productId]/page.tsx, src/app/(company-site)/[orgSlug]/[categorySlug]/party/[productId]/page.tsx
src/app/(public)/booking/party/[bookingPublicId]/rsvp/page.tsx and src/components/Public_C/booking/PartyRsvpPage.tsx
src/app/(public)/booking/confirmation/[bookingPublicId], booking/pay/[paymentLinkToken], booking/magic/[token]
src/components/Protected/profile/profile-tabs.ts, profile-layout.tsx, bookings/ProfileBookingsSection.tsx, bookings/ProfileBookingDetail.tsx
src/services/adminParties.ts, adminBookings.ts, adminBookingPayments.ts, adminBookingInvoices.ts, meBookings.ts, publicBooking.ts, ticketing.ts
src/hooks/useBookings.ts, usePublicBooking.ts, useTicketing.ts
vercel.json (only 2 Vercel crons are allowed; both slots are used)
package.json scripts (smoke:ticketing:*, smoke:pos:*, smoke:waivers:*, smoke:memberships:*, smoke:plan-limits, smoke:enterprise-hq, smoke:park-admin-scope, smoke:phase4-register, smoke:shipping)
scripts/smoke-ticketing-phase*.mts (copy their DB setup / teardown pattern for party smokes)

Known facts at the time this prompt was written (verify each in code; if one is wrong, follow the code and note it in the tracker):
1. The shared booking substrate already exists: Booking, BookingLine, BookingGuest, BookingHold, BookingPayment, BookingPaymentLink, BookingInvoice, TicketCredential, BookingActivity, BookingSettings, CapacityResource (type party_room exists), AdmissionProduct (type party_package and add_on exist), AdmissionProductPrice, AdmissionAddOnLink, StockPeriod, TicketSession. src/lib/ticketing/bookingEngine.ts exists. REUSE all of it. Never create a second booking schema, a PartyOrder model, or a second hold/payment engine.
2. src/lib/moduleEntitlement.ts with assertModuleEnabled exists. src/lib/ticketing/assertTicketingEnabled.ts exists. ticketsPerMonth already lives in PlanLimits (demo 0, starter 2000, growth 10000, enterprise null) and planLimits.ts has a ticketsPerMonth meter.
3. Thin party tables already exist and must be EXTENDED, not replaced:
   PartyBookingDetail has only id, bookingId (unique), orgId, roomResourceId, hostStaffUserId, kidCount, packageProductId, timestamps. It is missing locationId, partyName, honoreeName, honoreeAge, honoreeBirthDate, adultCount, roomNameSnapshot, hostNotes, opsStatus, depositRequiredCents, depositPaidCents, depositDueAt, balanceDueAt, foodNotes, waiverMissingCount and the required indexes.
   PartyGuest has only id, partyDetailId, bookingGuestId (unique), name, age, createdAt, plus a waiverRecords relation that Digital Waivers depends on. It is missing orgId, locationId, kind, email, phone, invitationId, rsvpStatus, waiverStatus, updatedAt.
   PartyInvitation has id, partyDetailId, token (unique), channel (PaymentLinkChannel), sentTo, status, sentAt, respondedAt, timestamps. It is missing orgId, locationId, guestId, toEmail, toPhone, expiresAt, and its channel must become PartyInvitationChannel (email | sms | link).
   PartyRunSheetItem is missing orgId and locationId.
4. Missing party models: PartySettings, PartyPackageConfig, PartyMenuItem, PartyFoodOrder, PartyFoodLine, PartyBalanceReminder.
5. Missing enums: PartyOpsStatus, PartyGuestKind, PartyFoodOrderStatus, PartyDepositDueMode, PartyBalanceDueMode, PartyInvitationChannel, PartyMenuItemKind. PartyInviteStatus exists but lacks bounced. PartyGuestRole (host | guest) exists; find every usage before touching it.
6. ActivityEntityType has Booking and AdmissionProduct but lacks PartyBooking, PartyInvitation, PartyFoodOrder. NotificationType has booking but lacks party.
7. permissions.ts has only parties:read and parties:write. It lacks parties:manage, parties:invitations, parties:food, parties:read_own, parties:write_own.
8. Existing party business logic lives in src/lib/ticketing/parties.ts (getPartyGuests, patchPartyGuests, patchPartyGuestsForOwner, createPartyInvitation, getPartyRunSheet, patchPartyRunSheet, assignPartyHost, listDailyPartyRunSheets, getPartySummary, publicPartyRsvp). There is no src/lib/parties/ folder yet. There is no GET/POST /api/admin/parties (collection) route; the /admin/parties page currently reads bookings with partyOnly.
9. POS is shipped. src/lib/pos/saleEngine.ts already handles product kind party_package_proxy, /api/pos/bookings exists, and PosProduct and KitchenTicket models exist. So party food submit MUST emit a KitchenTicket, and PartyMenuItem.posProductId MUST be validated against PosProduct in the same org and location. Do not build a Kitchen Display screen.
10. Digital Waivers is shipped, and PartyGuest.waiverRecords plus /api/admin/waivers/party-chase already exist. Party screens show the real waiver status read-only from the waivers lib and link to the existing party chase. Do not build waiver signing, guardian, or kiosk UI here.
11. vercel.json already has 2 crons: reconcile-company-subscriptions (hourly) and remind-company-subscriptions (daily). The hourly reconcile already calls booking hold expiry. Never add a third Vercel cron.

Create the tracker file docs/party-management-implementation-tracker.md now. Do not use tables in it. Write a checklist with one line per requirement in this prompt, each line in the form "- [ ] ITEM-ID short description | evidence: file paths | status: missing/partial/done". Use IDs S1-A1, S1-A2, ... matching the parts below. Put your scan findings at the top under the heading "Scan findings": what exists, what is partial, what is missing, and what needs connecting. Update this file as you complete each item. The follow-up prompts will audit against it.

=====================================================================
PART 1. NON-NEGOTIABLE RULES (APPLY TO EVERY LINE OF CODE)
=====================================================================

R1. A party IS a booking. Every party is Booking + PartyBookingDetail created together in one transaction. Never one without the other for a party_package product. Booking.status stays authoritative for money and capacity. PartyBookingDetail.opsStatus is the operations overlay.
R2. Never store party packages, party food, deposits, party balances, or party payments in shop Product, Cart, CartLine, Order, Wallet, or WalletTransaction. Never reuse TailoringJob. Never reuse staff Membership as a party guest. Host staff = a User with an active Membership on the same org. Party guests = PartyGuest (optionally linked to BookingGuest).
R3. Never reopen /signup or POST /api/auth/signup. Guests book and RSVP without accounts. If a guest email matches an existing User, link userId; never create a client user.
R4. Never trust orgId or locationId from the request body or query. orgId always comes from the actor (requireActorOrgId) for staff, or from the resolved published org/venue for public. A locationId picker value must be validated as belonging to the actor org, active (not archived), and inside the actor's location scope. Reject any body or query orgId with 400.
R5. DEFAULT_ORG / isDefault storefront never runs parties. Demo plan is locked out. Pending, suspended, and soft-hold unpaid orgs fail closed on creates and mutations. past_due that is still entitled is allowed. Archived venues get no new packages, rooms, sessions, menu items, or parties.
R6. Party entitlement rides the ticketing module: assertModuleEnabled(orgId, "ticketing"). Starter, Growth, Enterprise allowed; Demo denied. Do not add a parties module id to moduleHints, a parties SKU, or a parties plan meter beyond ticketsPerMonth.
R7. Staff party ops live only under /admin/parties* and /api/admin/parties* (plus the existing /api/admin/bookings/* and /api/admin/ticketing/* engine routes). Customer /profile shows only the signed-in user's own parties. Tailor /tailor/* gets nothing party-related.
R8. UI uses existing Harewa / VenueFlow admin layouts and gold #D4AF37. Do not copy TailorsMate bottom nav. Do not brand anything "Party Command Center".
R9. Every capacity, hold, confirm, cancel, reactivate, and payment path goes through the existing src/lib/ticketing/bookingEngine.ts and its sibling libs. Party orchestration goes in src/lib/parties/partyEngine.ts, which calls the booking engine. No second state machine.
R10. Do not fake-complete or claim: Party Command Center, waiver signing/guardian UI, Intercard/Sacoa/Amusement Connect, Kitchen Display screen, self-service kiosk, OTA, dynamic pricing, BOGO promos, the Feature 01 wizard for timed/day/group/camp/pass products, or the POS terminal PARTY button UI unless the POS terminal UI already exists.
R11. Every new table has orgId (required, indexed, FK Organization). Every park business row has locationId (required, FK VenueLocation) except PartySettings, where locationId null means org default. Every write asserts the venue's orgId equals the actor org.
R12. Money is integer cents. Times are stored UTC and computed against VenueLocation.timezone (DST safe; reuse visitDayBounds.ts).
R13. Write code that matches the surrounding code style. Only comment constraints the code itself cannot show.

=====================================================================
PART 2. STEP 1 WORK ITEMS (DO EVERY ONE)
=====================================================================

S1-A. Entitlement and gates
S1-A1. Create src/lib/parties/assertPartiesEnabled.ts exporting assertPartiesEnabled(orgId) as a thin wrapper around assertTicketingEnabled / assertModuleEnabled(orgId, "ticketing"). Confirm assertModuleEnabled runs, in order: assertOrganizationActive, assertCompanyBillingEntitled, Demo deny (DEMO_FEATURE_LOCKED_MESSAGE), storefront/isDefault deny, plan moduleHints includes the module or "all". If any step is missing in moduleEntitlement.ts, fix it there (one implementation).
S1-A2. Create src/lib/parties/gate.ts with one staff gate helper used by every party staff route: requirePermissionFresh(permission) then requireActorOrgId then assertOrganizationActive then assertCompanyBillingEntitled then assertPartiesEnabled then soft-hold/create deny for mutations then resolve actorLocationScope. Reuse staffGateCache.ts / bookingRoute.ts patterns if they already do this for bookings; do not duplicate them, wrap them.
S1-A3. Register every /admin/parties* path in ADMIN_ROUTE_PERMISSIONS and ADMIN_REGISTERED_COMPANY_ONLY_PATHS. Confirm isDemoAllowedAdminPath does not allow them.
S1-A4. Archived venue guard: a helper assertVenueWritable(orgId, locationId) in src/lib/parties/scope.ts (reuse venueLocations.ts) used by package, room, menu, session, and party creates.

S1-B. Plan meter ticketsPerMonth
S1-B1. Confirm planLimits.ts ticketsPerMonth counts confirmed ticket heads in the venue-timezone month. Make sure confirmed party heads (kidCount + adultCount) are counted exactly once, and not double-counted with the TicketCredentials issued for those same heads. Document the counting rule in a short comment if the code does not make it obvious.
S1-B2. Party confirm must call the same ticketsPerMonth enforcement the booking engine uses on confirm. If the booking engine does not enforce it on confirm, add it to the engine (one place), not only to parties.
S1-B3. FuturePlanModules comments in subscriptionPlans.ts must not describe ticketsPerMonth as future-only.

S1-C. Prisma schema and migration (additive, data-preserving)
Follow the repo's existing migration workflow (inspect prisma/migrations and package.json). Write one migration named like party_management_foundation. Never drop a column or table that has data; rename only with data copy. Backfill every new required column in SQL before setting NOT NULL.
S1-C1. Add enums with exactly these names and values:
PartyOpsStatus: inquiry, held, confirmed, checked_in, in_progress, completed, cancelled, no_show
PartyGuestKind: honoree, kid, adult, chaperone, other
PartyFoodOrderStatus: draft, submitted, sent_to_kitchen, fulfilled, cancelled
PartyDepositDueMode: at_booking, days_before_event, on_arrival
PartyBalanceDueMode: at_booking, days_before_event, on_arrival
PartyInvitationChannel: email, sms, link
PartyMenuItemKind: food, beverage, cake, other
Add bounced to PartyInviteStatus. Keep PartyGuestRole if anything uses it; if PartyGuest is its only consumer, migrate PartyGuest to kind PartyGuestKind (map host to honoree only if that is how it was used; otherwise map host to adult and guest to kid, and write the mapping into the tracker) and keep the old enum until nothing references it.
S1-C2. Extend ActivityEntityType with PartyBooking, PartyInvitation, PartyFoodOrder. Extend NotificationType with party. Update every TypeScript switch/union/label map that enumerates these enums (activity log UI labels, notification icons, filters) so nothing falls through.
S1-C3. Extend PartyBookingDetail to: id, orgId, locationId (FK VenueLocation), bookingId unique, packageProductId (keep), partyName String, honoreeName?, honoreeAge Int?, honoreeBirthDate DateTime?, kidCount Int (make required, backfill from existing or 0), adultCount Int default 0, roomResourceId?, roomNameSnapshot?, hostStaffUserId?, hostNotes?, opsStatus PartyOpsStatus, depositRequiredCents Int default 0, depositPaidCents Int default 0, depositDueAt?, balanceDueAt?, foodNotes?, waiverMissingCount Int default 0, confirmationSentAt DateTime? (only if Booking does not already track this; reuse the booking's field if it exists), timestamps. Relations: Organization, VenueLocation, foodOrders, balanceReminders. Indexes: (orgId, locationId, opsStatus), (orgId, locationId, createdAt), (orgId, locationId, bookingId), bookingId unique. Backfill locationId from Booking.locationId, partyName from the booking's primary contact name or product name, opsStatus from Booking.status using the S1-F1 mapping.
S1-C4. Extend PartyGuest: add orgId, locationId, kind PartyGuestKind default kid, email?, phone?, invitationId?, rsvpStatus PartyInviteStatus default pending, waiverStatus String default "n/a", updatedAt. Keep bookingGuestId unique and the waiverRecords relation untouched. Indexes (orgId, locationId), (partyDetailId, kind). Backfill orgId and locationId from the parent PartyBookingDetail.
S1-C5. Extend PartyInvitation: add orgId, locationId, guestId? (FK PartyGuest, SetNull), toEmail?, toPhone?, expiresAt?. Keep the existing unique token column as the public token (the spec's publicToken IS this token; do not add a second token column). Generate new tokens with crypto.randomBytes (at least 24 bytes, base64url), not cuid. Migrate channel from PaymentLinkChannel to PartyInvitationChannel with a SQL cast, and copy sentTo into toEmail or toPhone based on channel. Index (orgId, locationId, status), (partyDetailId, status), expiresAt.
S1-C6. Extend PartyRunSheetItem with orgId and locationId (backfill from parent) and index (orgId, locationId).
S1-C7. Create PartySettings: id, orgId, locationId? (null = org default), defaultDepositPercent Decimal?, defaultDepositFixedCents Int?, depositDueMode PartyDepositDueMode default at_booking, depositDaysBefore Int default 0, requireDepositToConfirm Boolean default true, allowConfirmWithoutDeposit Boolean default false, balanceDueMode PartyBalanceDueMode default on_arrival, balanceDaysBefore Int default 0, defaultPartyDurationMinutes Int default 120, defaultMinKids Int default 1, defaultMaxKids Int default 15, defaultIncludedAdults Int default 2, invitationExpiresHours Int default 168, allowOnlinePartyBooking Boolean default true, allowHostEditGuestList Boolean default true, allowHostEditFood Boolean default false, foodOrderCutoffMinutes Int default 60, sendBalanceReminder Boolean default true, balanceReminderDaysBefore Json default [7,3,1], hostCancelCutoffHours Int default 48, timestamps. Unique (orgId, locationId). Note that Postgres treats NULLs as distinct in unique constraints, so enforce "only one org-default row per org" in code inside a transaction, or with a partial unique index added in raw SQL in the migration.
S1-C8. Create PartyPackageConfig: id, orgId, locationId, productId unique (FK AdmissionProduct), durationMinutes Int, includedKids Int, includedAdults Int, extraKidPriceCents Int?, extraAdultPriceCents Int?, roomResourceId? (FK CapacityResource), roomAssignedAtBooking Boolean default false, depositPercentOverride Decimal?, depositFixedCentsOverride Int?, includesFood Boolean default false, defaultMenuItemIds Json?, timestamps. Index (orgId, locationId).
S1-C9. Create PartyMenuItem: id, orgId, locationId, name, description?, kind PartyMenuItemKind, priceCents Int, currency String default "usd", available Boolean default true, archivedAt?, posProductId String?, sortOrder Int default 0, timestamps. Index (orgId, locationId, available, archivedAt). Unique name per location is enforced case-insensitively in code.
S1-C10. Create PartyFoodOrder: id, orgId, locationId, partyDetailId, status PartyFoodOrderStatus default draft, promisedAt?, kitchenTicketId? (FK KitchenTicket if the model's shape allows, otherwise a plain string with a code-level check), notes?, submittedAt?, fulfilledAt?, cutoffOverrideReason?, timestamps. Index (orgId, locationId, status), (partyDetailId).
S1-C11. Create PartyFoodLine: id, orgId, locationId, foodOrderId, menuItemId?, posProductId?, nameSnapshot, qty Int, modifiers Json?, unitPriceCents Int, notes?, timestamps. Index (foodOrderId).
S1-C12. Create PartyBalanceReminder: id, orgId, locationId, partyDetailId, kind String (deposit or balance), scheduledFor DateTime, sentAt?, skippedReason String?, createdAt. Unique (partyDetailId, kind, scheduledFor) so rescheduling is idempotent. Index (scheduledFor, sentAt).
S1-C13. Run prisma generate, apply the migration locally, and confirm existing rows were backfilled (write a short verification query into the tracker).

S1-D. Permissions (src/lib/auth/permissions.ts: P object, PERMISSION_CATALOG, ROLE_PRESETS, ADMIN_ROUTE_PERMISSIONS, API_PERMISSIONS)
S1-D1. Add parties:manage, parties:invitations, parties:food, parties:read_own, parties:write_own with clear catalog descriptions. Keep parties:read and parties:write. Reuse existing ticketing:* bookings:* booking_invoices:* keys; never add parties:payments or parties:refund duplicates.
S1-D2. Presets: platform_admin gets all. ops_manager gets parties read, write, invitations, food plus ticketing read plus bookings read, write, assign, payments_read, payments_take, and NOT parties:manage, overbook, refund, export, or charge_stored. catalog_editor gets ticketing read and write plus parties read (party_package CRUD is allowed through ticketing:write) and NOT parties:manage. finance gets parties read plus bookings payments_read, refund, tax_exempt plus booking_invoices read, manage, send. client gets only parties:read_own, parties:write_own and the existing bookings *_own keys. tailor gets nothing party, ticketing, or bookings related. Custom role templates can pick any of them.
S1-D3. Register every route from S1-G, S1-I, and S1-J in API_PERMISSIONS with method + path + the permission + a one-line description, including the existing party routes whose descriptions are currently terse.

S1-E. Party lib layer (src/lib/parties/)
S1-E1. Create the folder and move the existing logic out of src/lib/ticketing/parties.ts into these files. Then either delete ticketing/parties.ts and update every import, or keep it only as a re-export shim. No logic may live in both places.
src/lib/parties/assertPartiesEnabled.ts
src/lib/parties/gate.ts
src/lib/parties/scope.ts (location scope + venue writable + body orgId rejection)
src/lib/parties/errors.ts (stable error codes, extend ticketing/errors.ts, do not fork it)
src/lib/parties/settings.ts (resolve effective settings = venue override over org default over schema defaults, and report which fields come from where)
src/lib/parties/packages.ts (party_package CRUD on AdmissionProduct + PartyPackageConfig, publish validation, add-on links, price bands, soft-archive)
src/lib/parties/rooms.ts (party_room CRUD on CapacityResource, case-insensitive unique name per location, archive, overlap/conflict detection, availability)
src/lib/parties/menu.ts (PartyMenuItem CRUD, soft-archive, PosProduct validation)
src/lib/parties/pricing.ts (package price + extra kids + extra adults + add-ons + food, tax via ticketing/tax.ts and TaxSettings, deposit computation)
src/lib/parties/deposits.ts (deposit required, due-at and balance due-at computation in venue timezone, deposit gate on confirm, the syncPartyMoney helper)
src/lib/parties/partyEngine.ts (create, edit, hold, reserve, confirm, cancel, reactivate, ops status, room move; always via bookingEngine)
src/lib/parties/guests.ts (named guest CRUD, caps, duplicate email check, BookingGuest link)
src/lib/parties/invitations.ts (token create, cancel, expire, list, RSVP apply)
src/lib/parties/food.ts (draft upsert, submit with cutoff, cancel, KitchenTicket emit)
src/lib/parties/balances.ts (outstanding list query, amountDue)
src/lib/parties/reminders.ts (schedule PartyBalanceReminder rows on create/edit/confirm/payment; sending is wired in Step 2)
src/lib/parties/runSheet.ts (get/put items, daily run sheets)
src/lib/parties/summary.ts (summary JSON, no PAN, no Stripe secrets, no raw Stripe ids)
src/lib/parties/activity.ts (log to BookingActivity + ActivityLog with entity PartyBooking / PartyInvitation / PartyFoodOrder)
src/lib/parties/posAdapter.ts (createPartyFromPos for saleEngine party_package_proxy)
src/lib/parties/frontDesk.ts (getTodayParties(orgId, locationId, date) for the POS PARTY action)
src/lib/parties/serialize.ts (staff DTO, public DTO, owner/host DTO; the owner DTO never includes POS notes, staff notes, overbook flags, invoice manage data, or other guests' contact details unless host)
src/lib/parties/publicParties.ts (public package list, availability, hold, checkout, confirmation, pay-link, RSVP; delegates to ticketing/publicBooking.ts)
S1-E2. Every lib function takes an actor or a resolved org context, never a raw client orgId.

S1-F. Party engine behavior (implement exactly)
S1-F1. State mapping. inquiry maps to Booking draft. held maps to Booking hold, reserved, or pending_payment. confirmed maps to Booking confirmed. cancelled maps to Booking cancelled. no_show is an ops overlay set after visitStartsAt without check-in and does not change capacity unless staff cancels. checked_in, in_progress, and completed are ops overlays on a confirmed booking. opsStatus changes to checked_in, in_progress, completed, or no_show are allowed only when the Booking is confirmed. Keep opsStatus in sync automatically whenever the booking engine changes Booking.status (hold expiry, webhook confirm, cancel, refund), so call a syncPartyOpsFromBooking(tx, bookingId) hook from the engine, not from routes.
S1-F2. Create (createParty) in one transaction: validate product is party_package, published, not archived, same org and location; validate venue writable; validate counts; resolve session (sessionId or startsAt + package duration); resolve room (body, package default, or assign-at-booking); check room conflict; hold or reserve session remaining and room occupancy atomically through bookingEngine; create Booking with the requested channel (online, phone, walk_in, pos, account) and createMode respecting BookingSettings; create BookingLine snapshots for package, extra kids, extra adults, add-ons; create PartyBookingDetail with roomNameSnapshot, deposit fields, due dates; optionally create a draft PartyFoodOrder with lines; schedule reminders; log activity. Link userId when the contact email matches an existing User.
S1-F3. Guest counts. kidCount + adultCount must be within AdmissionProduct min/max guests. kidCount must be at least 1 unless minGuests is 0. Heads above includedKids/includedAdults are priced with extraKidPriceCents/extraAdultPriceCents (or the extra_kid/extra_adult price bands). Room defaultCapacity is a headcount cap.
S1-F4. Room conflicts. Two parties overlap on the same room when their [startsAt, startsAt + duration) windows intersect and the other booking is held, reserved, pending_payment, or confirmed. Return 409 PARTY_ROOM_CONFLICT unless the actor has bookings:overbook and passes overbook true with a reason (logged). Without permission return 403 OVERBOOK_FORBIDDEN. Make the last-room race safe: take a row lock or serializable retry on the room resource inside the transaction so two concurrent creates cannot both win.
S1-F5. Deposits. depositRequiredCents comes from the PartyPackageConfig override, otherwise PartySettings (percent of total or fixed), clamped to the total. depositDueAt and balanceDueAt come from the due modes and days-before values in venue timezone. depositPaidCents = min(Booking.amountPaid, depositRequiredCents). If requireDepositToConfirm is true, confirm fails with PARTY_DEPOSIT_REQUIRED until amountPaid >= depositRequiredCents. The only bypass: allowConfirmWithoutDeposit is true in settings AND the actor has parties:write AND gives a reason, which is logged. Fail closed otherwise.
S1-F6. Confirm. Goes through bookingEngine confirm, enforces ticketsPerMonth, then issues unused TicketCredentials for kidCount + adultCount (this is the chosen credential policy; write it into the tracker and stick to it). Resize credentials on count edits (void extras, issue missing) without touching redeemed ones.
S1-F7. Holds and expiry. Holds decrement TicketSession remaining and occupy the room atomically. Create expirePartyHolds() that wraps the existing expireBookingHolds() and also moves expired party details to the right opsStatus and releases the room. It must work now and be callable from a script; Step 2 wires it into the hourly cron.
S1-F8. Edit (PATCH). Transactional: counts, room, session/time, contact, partyName/honoree fields, add-ons, hostStaffUserId, hostNotes, foodNotes, opsStatus. Re-price extras, release old session and room, take the new ones, recompute deposit and due dates, reschedule reminders. Reject edits after the visit start plus BookingSettings.pastEditGraceMinutes with PARTY_PAST_LOCKED (if pastEditGraceMinutes does not exist, use the booking engine's existing past-lock rule and note it).
S1-F9. Cancel and reactivate. Cancel requires a reason, releases room and session for unredeemed heads only, voids unused credentials, cancels pending invitations and draft or submitted food orders (KitchenTicket cancel if supported), cancels unsent reminders, and does NOT auto-refund. Refunds are a separate call that requires bookings:refund. Reactivate works only on cancelled bookings: re-hold room and session (or overbook with permission) and restore held or confirmed per body, re-checking the deposit gate when restoring confirmed.
S1-F10. Guests. Named kids cannot exceed kidCount and named adults (adult + chaperone) cannot exceed adultCount; otherwise return PARTY_GUEST_CAP. There is at most one honoree. Duplicate guest email on the same party is rejected. Keep BookingGuest in sync when a guest is linked. Recompute waiverMissingCount from the waivers lib after guest changes.
S1-F11. Invitations. Create PartyInvitation with a crypto-random token, expiresAt = now + invitationExpiresHours, status pending, optional guestId. Cancel sets cancelled. Invitations cannot be created or answered on cancelled parties or after expiry (return 410 or a stable error). RSVP accept creates or updates a PartyGuest (kind kid by default), respects guest caps, sets rsvpStatus and respondedAt, and is idempotent so a double RSVP does not create two guests. RSVP decline sets declined. A token can only touch its own invitation and guest. It can never edit prices, other guests, or the booking.
S1-F12. Food. Draft upsert (PUT) replaces lines. Each line snapshots name and price from PartyMenuItem; if posProductId is set and PosProduct exists, snapshot the POS price unless the line overrides it. Menu item must be available, not archived, and in the same location. qty >= 1. Submit moves draft to submitted, emits a KitchenTicket (queued) using the POS kitchen lib, stores kitchenTicketId, and moves to sent_to_kitchen when the ticket is queued. Submitting within foodOrderCutoffMinutes of visitStartsAt fails with PARTY_FOOD_CUTOFF unless the actor has parties:food and gives an override reason, which is logged. Food totals flow into the booking total as BookingLines (or the engine's existing adjust-items mechanism) so amountDue stays correct; never a shop Order.
S1-F13. Payments and money sync. Reuse the existing booking payment libs and routes (payments.ts, paymentLinks.ts, refunds.ts, invoices.ts, pendingStripe.ts, paymentSafety.ts) for card (Stripe Checkout or PaymentIntent), cash (receivedByStaffId), split, payment link, invoice, stored card, gift card. Stripe metadata must include type venue_party (or venue_booking, whichever the existing handler keys on; add venue_party as an alias routed to the same handler), bookingId, orgId, locationId, paymentId. Add syncPartyMoney(tx, bookingId) that recomputes depositPaidCents and marks reminders skippable, and call it from inside the payment, refund, webhook, payment-link, invoice-paid, and POS fulfillSale code paths so every way of paying updates the party. Booking.amountDue = total - amountPaid is the single source of truth for balance; PartyBookingDetail never stores a second balance.
S1-F14. Run sheet and summary. Get/put run sheet items (time, title, notes, sort). Daily run sheets per date and location in venue timezone. Summary JSON contains package, room, counts, guests, food, payments (tender type, amount, status only), deposit, amountDue, host, add-ons, activity count. No card numbers, no Stripe secrets, no raw Stripe ids.
S1-F15. Activity. Log create, edit, status, opsStatus, payment, refund, room, host, guest, invite, RSVP, food submit/cancel, override reasons, and cancel/reactivate to BookingActivity (kind) and ActivityLog (entity PartyBooking/PartyInvitation/PartyFoodOrder). Party detail GET returns the stream newest first.
S1-F16. Stable error codes (in src/lib/parties/errors.ts, extending ticketing/errors.ts): PARTY_DEPOSIT_REQUIRED, PARTY_ROOM_CONFLICT, PARTY_GUEST_CAP, PARTY_FOOD_CUTOFF, PARTY_PAST_LOCKED, PARTY_NOT_FOUND, PARTY_ONLINE_DISABLED, PARTY_INVITE_EXPIRED, PARTY_INVITE_INVALID, PARTY_PACKAGE_INVALID, PARTY_ROOM_ARCHIVED, SESSION_SOLD_OUT, HOLD_EXPIRED, OVERBOOK_FORBIDDEN, PAYMENT_INCOMPLETE, plus the existing Demo, billing, module, and cross-tenant errors. Cross-tenant ids return 404 (not 403) so ids are not confirmed to exist.
S1-F17. Edge cases that must be handled and covered by the smoke: venue timezone vs UTC and DST boundaries; overlapping rooms; counts above package cap; extra-head pricing; confirm without deposit; concurrent last-room race; refund of deposit after the visit started (do not restore room capacity if in progress or redeemed); invitation after cancel; food submit after cutoff; hold expiry releases room; double RSVP; duplicate guest email; archived room or package; unpublished package; storefront org; Demo org.

S1-G. Staff APIs (create or extend; every one uses the S1-A2 gate, rejects body/query orgId, filters by actor location scope, returns stable errors)
GET /api/admin/parties (list: date in venue TZ, locationId, q over partyName/honoree/contact email/phone/publicId, opsStatus, amountDueOnly, roomResourceId, hostStaffUserId, cursor or page pagination; include room, counts, amountDue, host, booking status, waiver missing count in one query with no N+1)
POST /api/admin/parties (create; body channel phone/walk_in/pos/account, locationId?, productId, sessionId?, startsAt?, roomResourceId?, kidCount, adultCount, partyName, honoreeName?, honoreeAge?, honoreeBirthDate?, contact, addOnProductIds?, foodLines?, notes?, createMode?, overbook?, overbookReason?)
GET /api/admin/parties/[bookingId] (detail incl. activity stream)
PATCH /api/admin/parties/[bookingId] (edit + opsStatus)
POST /api/admin/parties/[bookingId]/confirm (deposit gate, optional override reason)
POST /api/admin/parties/[bookingId]/cancel
POST /api/admin/parties/[bookingId]/reactivate
GET, POST /api/admin/parties/[bookingId]/guests (keep the existing PATCH replace for compatibility, implemented on the new lib)
PATCH, DELETE /api/admin/parties/[bookingId]/guests/[guestId]
GET, POST /api/admin/parties/[bookingId]/invitations (POST creates the token; actual email/SMS send is Step 2 but the route must accept send true and be ready)
POST /api/admin/parties/[bookingId]/invitations/[id]/cancel
GET, PUT /api/admin/parties/[bookingId]/food
POST /api/admin/parties/[bookingId]/food/submit
POST /api/admin/parties/[bookingId]/food/cancel
POST /api/admin/parties/[bookingId]/room
PATCH /api/admin/parties/[bookingId]/host (existing; move onto new lib)
GET, PUT /api/admin/parties/[bookingId]/run-sheet (keep existing PATCH working)
GET /api/admin/parties/[bookingId]/summary (JSON; add ?format=csv in Step 2)
GET /api/admin/parties/run-sheets?date=&locationId=
GET /api/admin/parties/balances?status=due (amountDue > 0, not cancelled, sorted by balanceDueAt)
GET /api/admin/parties/rooms/availability?locationId&startsAt&endsAt&excludeBookingId
GET, PATCH /api/admin/parties/settings (org default + per-venue override; response states which fields are default vs override)
GET, POST /api/admin/parties/packages
GET, PATCH, DELETE /api/admin/parties/packages/[id] (DELETE = soft-archive)
GET, POST /api/admin/parties/packages/[id]/sessions (create/list sessions for that package, weekday series allowed; delegates to ticketing/sessions.ts)
GET, POST /api/admin/parties/rooms
PATCH /api/admin/parties/rooms/[id] (includes archive)
GET, POST /api/admin/parties/menu
PATCH /api/admin/parties/menu/[id] (includes archive and available toggle)
Payments, payment links, refunds, invoices, tax exemption, and resend confirmation: reuse POST /api/admin/bookings/[id]/payments, payment-link, refunds, tax-exemption, resend-confirmation, and the booking invoice routes. Confirm each one runs syncPartyMoney and party activity logging when the booking is a party. Do not create parallel party payment routes. If a thin /api/admin/parties/[bookingId]/payments wrapper helps the UI, it must call the exact same lib and be registered in API_PERMISSIONS.
Ensure GET /api/admin/bookings with partyOnly and the booking detail route still work, and that opening a party_package booking from bookings links to /admin/parties/[bookingId].

S1-H. POS and kitchen connection (no terminal UI)
S1-H1. In src/lib/pos/saleEngine.ts, the party_package_proxy branch must call createPartyFromPos in src/lib/parties/posAdapter.ts, which calls partyEngine with channel pos. No second party create path.
S1-H2. /api/pos/bookings creating or editing a party_package booking must go through partyEngine as well.
S1-H3. Party food submit uses the existing KitchenTicket creation helper from the POS lib; read its required fields and stations. No KDS screen.
S1-H4. POS fulfillSale and POS refunds touching a party booking call syncPartyMoney.
S1-H5. Export getTodayParties from src/lib/parties/frontDesk.ts and make GET /api/admin/parties?date=today return the same data for the POS PARTY action.

S1-I. Public and guest APIs (rate limited with src/lib/rateLimit.ts; resolve org and venue from published slugs only; unpublished, archived, Demo, storefront, or non-entitled venue returns 404)
GET /api/public/parties/packages?orgSlug&venueSlug (published party_package only, with config, price bands, add-ons, deposit preview)
GET /api/public/parties/availability?productId&date&kids&adults (sessions with remaining and room availability)
POST /api/public/parties/holds
POST /api/public/parties/checkout (pay deposit online, or pay later only when BookingSettings.allowOnlinePayLater AND PartySettings.allowOnlinePartyBooking; else PARTY_ONLINE_DISABLED)
GET /api/public/parties/confirmation/[bookingPublicId] (requires the booking view or magic token the existing confirmation flow uses; never exposes guest list to strangers)
GET, POST /api/public/parties/pay/[paymentLinkToken]
GET /api/public/parties/invite/[token] (party name, honoree, date/time in venue TZ, venue name, RSVP status; nothing else)
POST /api/public/parties/invite/[token]/rsvp (accept or decline, guest name, optional age; idempotent)
These must be thin wrappers that delegate to ticketing/publicBooking.ts, holds, checkout, payment links, and parties/invitations.ts. One hold engine, one checkout engine. Keep the existing /api/public/booking/party/[bookingPublicId]/rsvp working by delegating to the same RSVP lib (it still requires the invitation token).
Logged-in host (client) APIs, scoped to the signed-in user's own bookings, 404 for others:
GET /api/me/parties
GET /api/me/parties/[id]
PATCH /api/me/parties/[id]/guests (only if allowHostEditGuestList and parties:write_own; keep the existing PATCH /api/me/bookings/[id]/party-guests working on the same lib)
PUT /api/me/parties/[id]/food (only if allowHostEditFood, before cutoff)
POST /api/me/parties/[id]/cancel (only before hostCancelCutoffHours; never refunds automatically)
POST /api/me/parties/[id]/invitations (host creates invites for own party within caps)
A host can never assign host staff, overbook, take staff payments, refund, manage invoices, or see POS or staff notes.

S1-J. Waivers connection (read-only)
S1-J1. PartyGuest.waiverStatus and PartyBookingDetail.waiverMissingCount are computed from the existing waivers lib (bookingHooks.ts, desk.ts). Recompute on guest change and when a waiver is signed or voided for that booking (add the hook in the waivers lib so it calls back into parties). If waivers are not enabled for the org, waiverStatus stays "n/a".
S1-J2. Confirm the waiver party-chase route still works after the PartyGuest migration.

S1-K. Data layer for the UI (services and hooks)
S1-K1. Extend src/services/adminParties.ts with every staff endpoint above. Create src/services/publicParties.ts and src/services/meParties.ts.
S1-K2. Create src/hooks/useParties.ts (admin queries and mutations with React Query keys and invalidation of party list, party detail, balances, run sheets, bookings list, booking detail, and ticketing availability after mutations) and src/hooks/usePublicParties.ts.

S1-L. Party catalog admin screens (these ARE in Step 1)
Folder: src/components/Protected/admin/pages/parties/**. Use existing admin layouts, React Query, toasts, ButtonSpinner, confirm modals, HqScopePolicyBanner when location-scoped, plan/module soft-gate banners, gold #D4AF37.
S1-L1. /admin/parties/packages: list (venue filter, published/draft/archived filter) plus create and edit at /admin/parties/packages/new and /admin/parties/packages/[productId]. Fields: name, description, venue, min/max guests, duration, included kids/adults, extra kid/adult prices, package price band, room (select party_room) or "room assigned at booking", deposit percent/fixed override, includes food, default menu items, add-ons (link existing add_on products or create a new add_on inline), sessions (create single or weekday series through the package sessions API), publish toggle. Publishing without a duration, max guests, included kids/adults, at least one price band, and a room or roomAssignedAtBooking returns 400 PARTY_PACKAGE_INVALID with field errors shown in the form.
S1-L2. /admin/parties/rooms: party_room CRUD (name unique per venue case-insensitive, capacity >= 0, archive). Archived rooms cannot be newly assigned.
S1-L3. /admin/parties/menu: PartyMenuItem CRUD (kind, price, available toggle, sort, optional POS product picker limited to same org and location, archive).
S1-L4. /admin/parties/settings: PartySettings form for the org default and a venue override selector. Show "org default" vs "venue override" per field, with a reset-to-default action per venue.
S1-L5. Route shells registered and reachable (real content arrives in Step 2): /admin/parties (the existing list keeps working), /admin/parties/new, /admin/parties/[bookingId] (the existing PartyDetailPage keeps working), /admin/parties/balances.
S1-L6. src/lib/adminNav.ts: a Parties group for registered companies with Parties (/admin/parties), New party (/admin/parties/new), Packages, Rooms, Menu, Balances, Party settings, each gated by its permission. Remove or redirect the old single "Parties" entry under Bookings so there is one nav home. Keep the Dashboard quick link to Parties. Add prefetch entries in src/lib/prefetchAdminRoute.ts for every new path. Reuse the "operations" icon unless a parties icon key already exists.
S1-L7. The existing ticketing product editor must not be a second way to configure party config with different rules: if a party_package is opened in /admin/ticketing/products, either redirect to /admin/parties/packages/[productId] or show the same PartyPackageConfig form component.

S1-M. Step 1 smoke test
Create scripts/smoke-parties-step1.mts and the package.json script smoke:parties:step1, using the same DB setup and teardown pattern as scripts/smoke-ticketing-phase*.mts. It must assert:
same-org package, room, menu, settings CRUD allowed; cross-tenant ids 404 on every /api/admin/parties/[bookingId]* and catalog id route; Demo denied; storefront denied; pending and suspended denied; soft-hold create denied; past_due entitled allowed; Starter allowed; archived venue cannot create; unpublished and archived packages not listed by the public packages API; location-scoped actor sees only its venue; invalid publish (no duration, no max guests) returns 400; body orgId rejected; phone-channel create creates Booking + PartyBookingDetail together; last-room double-book (two concurrent creates) lets exactly one win; overbook without permission 403; overbook with permission succeeds and logs reason; guest cap rejected; duplicate guest email rejected; deposit required blocks confirm; deposit override only with setting + reason; cash payment reduces amountDue and sets depositPaidCents; payment through payment link and webhook path also syncs depositPaidCents; hold expiry releases the room and session; cancel releases capacity for unused heads only; refund requires bookings:refund; food submit after cutoff rejected and override logged; food submit creates a KitchenTicket; menu item from another location rejected; ticketsPerMonth blocks confirm when exhausted; credentials issued for kidCount + adultCount on confirm; invitation token persists, RSVP accept creates or updates a PartyGuest, double RSVP is idempotent, RSVP after cancel or expiry rejected; public unpublished venue 404; POS party_package_proxy goes through partyEngine; host me APIs see own party only and cannot assign host or overbook; /api/auth/signup still returns 410.
Run it and fix until green.

S1-N. Regression
Run and keep green: smoke:ticketing:all, smoke:pos:all, smoke:waivers:all, smoke:memberships:all, smoke:plan-limits, smoke:enterprise-hq, smoke:park-admin-scope, smoke:franchise-parks, smoke:phase4-register, smoke:company-subscription, smoke:shipping, and the TypeScript build / lint commands from package.json. If a regression smoke fails because of your change, fix your change, not the test. If it was already failing before your change, prove it with git stash and note it in the tracker.

S1-O. Honesty
Do not claim Party Management complete in README.md or the landing page yet. Add a short note at the top of docs/party-management-complete-spec.md that docs/party-management-two-step-prompts.md is the execution source of truth.

When everything above is done, update docs/party-management-implementation-tracker.md with each S1 item marked done with evidence, list any item you could not finish and why, paste the smoke output summary, and STOP. Do not start Step 2.
```

---

## Step 1 follow-up prompt

```
AUDIT STEP 1 of Party Management. Do not start Step 2. Do not trust the previous report or the tracker; verify everything yourself in code and by running it.

1. Open docs/party-management-two-step-prompts.md (Step 1 prompt) and docs/party-management-implementation-tracker.md. For every S1 item ID (S1-A1 through S1-O), open the actual files and confirm the implementation exists, is complete, is connected to its callers, and behaves as written. Mark each line in the tracker done, partial, or missing with file-path evidence. Do not use tables in the tracker.

2. Re-scan for duplication and disconnection:
- Search for any second booking schema, PartyOrder, second hold engine, second checkout engine, second payment path, or party logic still living in both src/lib/ticketing/parties.ts and src/lib/parties/*.
- Search for any party data written into Product, Cart, CartLine, Order, Wallet, WalletTransaction, TailoringJob, or staff Membership.
- Search every /api/admin/parties*, /api/public/parties*, /api/me/parties*, /api/pos/* party path for body or query orgId trust, missing requirePermissionFresh, missing assertPartiesEnabled, missing location-scope filtering, and missing API_PERMISSIONS registration.
- Confirm every payment, refund, webhook, payment-link, invoice-paid, and POS fulfill path calls syncPartyMoney, and that Booking.amountDue is the only balance. Pick three real parties in the smoke DB and compare Booking.amountPaid, Booking.amountDue, and PartyBookingDetail.depositPaidCents by query.
- Confirm syncPartyOpsFromBooking runs inside the booking engine for hold expiry, confirm, cancel, and webhook confirm.
- Confirm saleEngine party_package_proxy and /api/pos/bookings call partyEngine through posAdapter.
- Confirm food submit emits a real KitchenTicket and stores kitchenTicketId, and that no KDS UI was added.
- Confirm the waivers hooks recompute waiverMissingCount and that /api/admin/waivers/party-chase still works.
- Confirm ADMIN_ROUTE_PERMISSIONS, ADMIN_REGISTERED_COMPANY_ONLY_PATHS, adminNav Parties group, prefetchAdminRoute, and that Demo cannot open any /admin/parties* path.
- Confirm the migration was additive and backfilled: query PartyBookingDetail, PartyGuest, PartyInvitation, PartyRunSheetItem rows for null orgId/locationId, and confirm PartyInvitation.channel cast and sentTo copy.
- Confirm permission presets exactly match S1-D2 (ops_manager has no parties:manage, overbook, refund, export, charge_stored; tailor has nothing; client has only *_own).
- Confirm every enum switch for ActivityEntityType and NotificationType handles the new values.
- Search for TODO, FIXME, "not implemented", 501 responses, placeholder returns, enabled: false on core paths, and hard-coded test ids in party code. Complete or remove them.

3. Exercise the catalog screens: open /admin/parties/packages, /admin/parties/packages/new, /admin/parties/packages/[productId], /admin/parties/rooms, /admin/parties/menu, /admin/parties/settings in the running app (use browser tools if available) as a platform_admin, an ops_manager, a catalog_editor, and a Demo company. Confirm create, edit, archive, publish validation errors, venue override display, and HqScopePolicyBanner when location-scoped. If browser tools are unavailable, verify through the APIs and say plainly what could not be browser-verified.

4. For anything missing, partial, incorrect, insecure, duplicated, or disconnected: FIX IT, re-test the affected workflow, and update the tracker. Do not only report.

5. Re-run smoke:parties:step1 and every regression smoke from S1-N. All must pass. Confirm /signup still redirects and POST /api/auth/signup still returns 410. Confirm shop checkout still creates Order (not Booking), the tailor /tailor/* pages are untouched, billing, venues, HQ, and the Demo dashboard still work.

6. Write a final section in the tracker called "Step 1 audit result" listing: items verified, items fixed in this audit (with files), smoke results, anything that could not be verified and why. Declare Step 1 complete only if every S1 item is done and every smoke is green. Then STOP.
```

---

## Step 2 prompt

```
You are implementing STEP 2 of 2 of Party Management (Feature 04) for this multi-tenant venue SaaS. Step 2 builds every operator screen, every guest and host screen, notifications, crons, export, cross-feature sync, security hardening, performance, the final smoke suite, and the final independent audit. Do not stop halfway. Do not ask me for a feature list. Everything required is written below.

=====================================================================
PART 0. VERIFY STEP 1 FIRST (MANDATORY)
=====================================================================

Read docs/party-management-two-step-prompts.md (both steps), docs/party-management-implementation-tracker.md, and docs/party-management-complete-spec.md. Re-read .cursor/rules/saas-venue-platform.mdc and .cursor/rules/customer-vs-tailor-sections.mdc. Every rule R1 to R13 from the Step 1 prompt still applies to every line of code in this step.

Re-scan the project: prisma/schema.prisma party and booking models, src/lib/parties/**, src/lib/ticketing/**, src/lib/pos/**, src/lib/waivers/** party hooks, every party API route, src/services/adminParties.ts, publicParties.ts, meParties.ts, src/hooks/useParties.ts, usePublicParties.ts, adminNav, permissions. Re-run smoke:parties:step1. Trace by API: create party (phone) then hold then take deposit then confirm then assign room then add guest then create invitation then RSVP then food draft then food submit then payment link then pay remaining then cancel. If anything from Step 1 is missing, partial, insecure, or disconnected, FIX IT FIRST, re-test, update the tracker, then continue. Add Step 2 item lines S2-A1 and onward to the tracker as you go (checklist lines, no tables).

=====================================================================
PART 1. OPERATOR SCREENS (src/components/Protected/admin/pages/parties/**)
=====================================================================

Patterns for every screen: React Query via src/hooks/useParties.ts, toasts, ButtonSpinner, confirm modals, skeleton loaders, empty states, HqScopePolicyBanner on location-scoped pages, plan/module soft-gate banners, Demo lock screen, gold #D4AF37, permission-aware buttons (hide or disable actions the actor's permissions do not allow, and still enforce on the server). Never title anything "Party Command Center".

S2-A1. Parties list at /admin/parties (src/app/(admin)/admin/parties/page.tsx). Replace the bookings-partyOnly read with GET /api/admin/parties. Toolbar: date picker defaulting to today in the venue timezone, previous/next day, venue filter (hidden when location-scoped), search (party name, honoree, contact email, phone, publicId), filters (opsStatus, balance due only, room, host), Create party button (parties:write), Balances link. Columns: Time (venue TZ), Party name, Honoree, Kids (and adults), Room, Status chip showing PAID when amountDue is 0 or $BALANCE otherwise plus booking status and opsStatus, Host, Waiver chip (real missing count from waivers, or "n/a" when waivers are not enabled), Actions (Open, Run sheet, Print). Stable pagination, URL-synced filters, skeleton, empty state.
S2-A2. Create party wizard at /admin/parties/new?channel=&locationId= (src/app/(admin)/admin/parties/new/page.tsx). Steps in order: 1 channel (phone or walk_in; pos and account are API-only unless the POS terminal exists), 2 venue (hidden if scoped), 3 package (published party packages only), 4 date and session plus room with live availability from /api/admin/parties/rooms/availability and a conflict warning, 5 kid and adult counts versus included with extras price preview, 6 add-ons, 7 party name and honoree name/age/birth date, 8 contact (search existing guest by email/phone, link existing user if email matches, never create a user), 9 deposit preview with due dates in venue TZ, 10 optional food draft from the venue menu, 11 notes, 12 create mode when BookingSettings says prompt, 13 review with full price breakdown and tax, 14 submit then redirect to the detail page. Sold out or room conflict blocks submit unless the actor has bookings:overbook, in which case show an overbook checkbox with a required reason. Map every stable error code to a clear message.
S2-A3. Party detail at /admin/parties/[bookingId]. Move or refactor the existing src/components/Protected/admin/pages/bookings/PartyDetailPage.tsx into src/components/Protected/admin/pages/parties/ (update imports; one component). Header: party name, date/time in venue TZ, room, publicId, booking status, opsStatus selector (allowed transitions only), amount due, host. Header buttons: Edit, Confirm (deposit gate message and override flow if allowed), Take payment, Payment link, Cancel (reason), Reactivate, Send invitations, Print run sheet, Download summary, Resend confirmation, Refund (bookings:refund only). Required tabs: Overview (package, counts, room, honoree, totals, deposit required vs paid vs due, due dates); Guests (add, edit, remove, kind, age, email, phone, RSVP status, waiver status, cap enforcement with clear messages); Invitations (create for a guest or blank, send by email or SMS, copy link, cancel, status chips including bounced and expired); Food (menu picker of available items, qty, modifiers, notes, submit to kitchen, cutoff warning and override reason, status, kitchen ticket reference); Room (assigned room, a day timeline for that room showing other parties, change room with conflict check); Balance (tenders list, deposit required/paid, amountDue, take payment, payment link, invoice create and send, refund). Supporting tabs: Host (assign staff user from same-org memberships only, host notes); Add-ons (attached add-on lines, add/remove with repricing); Run sheet (editable items, reorder, print); Activity (stream newest first). Waivers tab is read-only: show guest waiver status and a link to the existing waiver party chase; do not build signing UI. No Arcade Cards tab.
S2-A4. Edit party at /admin/parties/[bookingId]/edit (or an edit drawer on the detail page; pick one and use it everywhere) using PATCH with the same validation as create, including the past-lock message.
S2-A5. Outstanding balances at /admin/parties/balances. Columns: Visit date/time, Party, Contact, Deposit required, Paid, Due, Due at, Actions (Take payment, Payment link, Open). Filters: venue, due before date, deposit unpaid only. Sorted by due date. Totals row of outstanding amount.
S2-A6. Take payment modal (shared component): card through the existing Stripe flow, cash with staff recorded, split across tenders, gift card and stored card if the booking payment lib supports them, payment link sent by email (SMS only when a provider env is set, otherwise show that SMS is unavailable). Refund modal shown only with bookings:refund, with amount and reason. After success, invalidate party, balances, booking, and list queries.
S2-A7. Packages, rooms, menu, settings: polish the Step 1 screens so the create wizard pickers are populated, archived items are hidden from pickers, and every validation error shows inline.
S2-A8. Run sheet print: a print view (window.print with print CSS) per party and per day (/admin/parties/run-sheets?date= or a print button on the list) showing time, party name, honoree, kids/adults, room, host, food lines, add-ons, timeline items, and notes for staff.
S2-A9. Summary download: GET /api/admin/parties/[bookingId]/summary?format=csv (and an HTML printable view) with package, payments (tender, amount, status), guests, food, staff host. No card numbers, no Stripe secrets, no raw Stripe ids. Register the format in API_PERMISSIONS.
S2-A10. Bookings module sync: in /admin/bookings list, calendar, and detail, party bookings show a Party badge with package name, and opening one routes to /admin/parties/[bookingId]. The bookings calendar shows party room blocks. The existing booking detail must not offer edits that bypass partyEngine for party bookings (route edits through the party edit flow).
S2-A11. Dashboard quick link and nav: confirm the Parties group and dashboard link, and that the old Bookings > Parties link is not a duplicate.

=====================================================================
PART 2. GUEST AND HOST SCREENS
=====================================================================

S2-B1. Public party booking. Reuse the existing public booking route structure from src/lib/ticketing/publicBookPaths.ts and the existing pages src/app/(public)/book/[venueSlug]/party/[productId]/page.tsx, src/app/(public)/book/[venueSlug]/[legacyVenue]/party/[productId]/page.tsx, and src/app/(company-site)/[orgSlug]/[categorySlug]/party/[productId]/page.tsx (the spec's /book/[orgSlug]/[venueSlug]/party/[productId] maps onto these existing segments; do not create a parallel route tree). The page uses the /api/public/parties/* APIs: calendar and slots in venue TZ, kids and adults with included and extras pricing, room availability handled server-side, add-ons, party name and honoree, contact, deposit preview, pay deposit, or pay later only when allowed, then redirect to confirmation. Add a party packages index for a venue (for example src/app/(public)/book/[venueSlug]/parties/page.tsx following the same segment pattern) listing published party packages. Company category pages and ?embed=1 framing must keep working for party products. Components go in src/components/Public_C/booking/party/**.
S2-B2. Confirmation at /booking/confirmation/[bookingPublicId] (existing page) must render party details (party name, honoree, date/time, room name, counts, deposit paid, amount due, pay balance link, host manage link) only with the existing view or magic token rules.
S2-B3. Pay balance at /booking/pay/[paymentLinkToken] (existing page) must work for party balances, show the party name and amount due, and handle already paid, expired, and cancelled states.
S2-B4. Invitation RSVP: create src/app/(public)/party/invite/[token]/page.tsx as the canonical invitation landing using GET /api/public/parties/invite/[token] and POST .../rsvp (accept with guest name and optional age, or decline). Show party name, honoree, date/time in venue TZ, venue name, and current RSVP state. Invalid token shows 404, expired or cancelled shows a clear closed state, and repeat RSVP shows the saved answer. Keep /booking/party/[bookingPublicId]/rsvp working by sharing the same component or redirecting when a token is present. No account needed, never link to /signup.
S2-B5. Stripe return: card checkouts for parties use the existing /payment/success, /payment/cancel, and /api/payment/booking/confirm flow (add /payment/booking/success and /payment/booking/cancel only if the existing flow has no booking-specific return; never two). Return confirm must not double-apply a payment that the webhook already applied.
S2-B6. Host profile. In src/components/Protected/profile/profile-tabs.ts add a Parties tab (or party rows inside the existing bookings tab with a Party badge; choose one and document it), plus a host party detail route /profile/parties/[bookingId] (src/app/(...)/profile/parties/[bookingId]/page.tsx following the existing profile route group) with components in src/components/Protected/profile/parties/**. Show date/time, room, counts, amount due with a pay button (payment link flow), guest list editing only when allowHostEditGuestList is true, food editing only when allowHostEditFood is true and before cutoff, invitations (create, copy link, see RSVP status), and cancel only before hostCancelCutoffHours. Never show POS notes, staff notes, overbook, invoice manage, refund, or host staff assignment. Other users' parties return 404.

=====================================================================
PART 3. NOTIFICATIONS (TRANSACTIONAL ONLY)
=====================================================================

S2-C1. Party confirmation email on confirm, reusing src/lib/ticketing/confirmations.ts and resolveBrandForOrg / sendReceipts.ts branding, with party details and manage/pay links. Idempotent via the existing confirmation-sent field (or confirmationSentAt). Resend confirmation button works.
S2-C2. Invitation send: email via mailer.ts with an invitation template (party name, honoree, date/time, venue, RSVP link to /party/invite/[token]); SMS via src/lib/ticketing/sms.ts when BOOKING_SMS_PROVIDER or PARTY_SMS_PROVIDER is set, otherwise log sms_skipped and still succeed. Set sentAt and status sent. Mark bounced when the mail provider reports a bounce if a bounce hook exists; otherwise document that bounced is set manually.
S2-C3. Payment receipt email on deposit and balance capture through the existing booking receipt path.
S2-C4. In-app Notification of type party to the linked host userId for confirmation, RSVP received, balance due, and cancellation. Staff notification for new online party bookings if the booking module already notifies staff.
S2-C5. A failed email or missing SMS provider never fails the booking, payment, or RSVP; log it to BookingActivity.
S2-C6. Document the env keys in docs/ticketing-env.md (or a parties section in it): PARTY_SMS_PROVIDER and anything new.

=====================================================================
PART 4. CRONS, WEBHOOKS, EXPORT
=====================================================================

S2-D1. Create src/lib/parties/maintenance.ts with runPartyMaintenance(now) that runs: expirePartyHolds (releases rooms and sessions), expire pending/sent invitations past expiresAt to cancelled, send due PartyBalanceReminder rows (deposit or balance email; skip and set skippedReason when amountDue is 0, the booking is cancelled, or sendBalanceReminder is off; set sentAt; never send twice), and set no_show overlay for confirmed parties whose visit ended without check-in if the check-in data exists. Each part is idempotent and safe to re-run.
S2-D2. Wire runPartyMaintenance into the existing hourly src/app/api/cron/reconcile-company-subscriptions/route.ts (CRON_SECRET protected) and scripts/reconcile-company-subscriptions.mts. Also add src/app/api/cron/parties-maintenance/route.ts (CRON_SECRET) for external schedulers and a package.json script parties:maintenance that runs it from the CLI. Do not add a third entry to vercel.json.
S2-D3. Stripe webhook (src/app/api/webhooks/stripe/route.ts): handle metadata type venue_party (and venue_booking for party bookings) by reloading the booking by id and checking it belongs to the metadata org only as a consistency check (never as authorization), creating payment rows idempotently by Stripe event or PaymentIntent id, calling syncPartyMoney and the confirm path when the deposit gate is satisfied. Failed or expired Checkout sessions never confirm and release the hold per booking rules. Success-URL confirm and webhook racing must not double-apply.
S2-D4. companyExport (src/lib/companyExport.ts): add a parties section with party packages (ids, names, venue), party bookings summary (publicId, visit date, venue, room name, kid/adult counts, opsStatus, booking status, depositRequired, depositPaid, amountDue), rooms, menu items, and counts of guests, invitations, food orders. Same-org only. Follow the existing redaction style: no card numbers, no Stripe ids in plaintext, no guest contact details if other exports redact them.

=====================================================================
PART 5. CROSS-FEATURE SYNC, SECURITY, PERFORMANCE
=====================================================================

S2-E1. HQ and park scope: Enterprise HQ location switcher and park-locked memberships (MembershipVenueAssignment) filter every party list, balances, run sheets, catalog, and detail. A franchise park manager sees only assigned parks. Franchise park guest card payments for parties use resolveGuestPayoutDestination the same way bookings do. Plan meters stay company-wide. Add party counts or upcoming parties to the HQ overview only if hqOverview already rolls up bookings; never as a Command Center.
S2-E2. POS: if the POS terminal UI already has a front-desk action bar, add a PARTY button that routes to /admin/parties?date=today (or a compact list from getTodayParties). If it does not, leave the helper and API ready and say so in the tracker.
S2-E3. Tax: every party price preview, create, edit, food line, and add-on uses the same booking tax helper and TaxSettings, including tax exemption.
S2-E4. Activity and notifications stay consistent with payments, invites, RSVPs, and food actions (spot-check by querying after the smoke).
S2-E5. Security hardening: invitation, payment link, and magic tokens are crypto-random and unique; public RSVP cannot edit other guests, prices, or the booking; rate limits on public holds, checkout, RSVP, pay, and invite GET return 429 on flood; parties:write_own cannot assign host staff, overbook, refund, or take staff payments; every /api/admin/parties/[bookingId]* and /api/me/parties/[id]* route returns 404 for another tenant's or another user's party; summary CSV contains no secrets; no route accepts body or query orgId; public endpoints never expose staff notes, POS notes, or other guests' contact details.
S2-E6. Search and filters: list search over party name, honoree, contact email, phone, publicId uses indexes; pagination is stable with ties broken by id.
S2-E7. Performance: confirm indexes PartyBookingDetail (orgId, locationId, opsStatus), (orgId, locationId, bookingId), (orgId, locationId, createdAt); PartyInvitation token unique and (orgId, locationId, status); Booking (orgId, locationId, visitStartsAt) and an index that supports amountDue > 0 balance queries; PartyBalanceReminder (scheduledFor, sentAt); PartyFoodOrder (orgId, locationId, status). Add any missing ones in a migration. Remove N+1 queries from the parties list, balances list, run sheets, and HQ views (include room, counts, amountDue, host in one query).

=====================================================================
PART 6. HONEST COPY
=====================================================================

S2-F1. README.md: add a short Party Management section stating the party engine (packages, rooms, deposits, guest count, food, invitations, outstanding balances, online party booking, host profile) is shipped for entitled Starter, Growth, and Enterprise companies, and that Party Command Center, Kitchen Display, arcade card integrations, and kiosk are not part of it. Update the shipped-modules list in .cursor/rules/saas-venue-platform.mdc to mention Party Management Steps 1–2 shipped, so future work extends it instead of re-stubbing it. Do not advertise a Command Center on the landing page.

=====================================================================
PART 7. TESTING AND FINAL AUDIT
=====================================================================

S2-G1. Create scripts/smoke-parties-step2.mts and package.json smoke:parties:step2, plus smoke:parties:all that runs step1 then step2. Step 2 smoke asserts: every new admin page route is registered in ADMIN_ROUTE_PERMISSIONS and in the registered-company paths; Demo cannot open them; public party package of an unpublished venue 404; public hold then checkout deposit then confirmation works; invalid invite token 404; RSVP after cancel rejected; expired invitation moved to cancelled by maintenance; profile own party allowed and other user's party 404; host cannot assign host staff or overbook; webhook replay does not double-pay; success-URL confirm after webhook does not double-apply; failed checkout does not confirm; maintenance releases expired hold room; balance reminder skipped when paid and sent once when due; export contains only same-org parties and no Stripe ids; IDOR cross-tenant 404 on every party id route; public flood returns 429; posAdapter and partyEngine importable and the POS party proxy creates a party; deposit then balance to zero shows PAID; extra kid pricing correct; room conflict 409; finance can refund and ops_manager cannot; location-scoped actor sees only its venue; summary CSV has no secrets; /api/auth/signup still 410.
S2-G2. Run smoke:parties:all plus every regression smoke from Step 1 S1-N plus build and lint. Fix until green.
S2-G3. Browser-verify with browser tools if available, as staff: create a party with the wizard, take a deposit, confirm, add guests, send an invite, open the invite link in a fresh session and RSVP, add food and submit, open balances, send a payment link, pay the remaining balance on the pay page, print the run sheet, download the summary. As a guest: book a published party package online and reach confirmation. As a host: open /profile parties, edit guests if allowed, and confirm no staff tools appear. If browser tools are unavailable, verify each through the APIs and state plainly which steps could not be browser-verified.
S2-G4. Final independent audit (inspect code, do not trust earlier reports): missing or partial items; disconnected components; data inconsistency between Booking.total/amountPaid/amountDue and PartyBookingDetail.depositRequiredCents/depositPaidCents; opsStatus vs Booking.status drift; workflow inconsistency between staff, public, host, and POS create paths; authorization gaps; validation and error-handling gaps; timezone bugs; regressions in shop, tailor, billing, venues, HQ, ticketing, POS, waivers, memberships, category pages, and embeds; README honesty. Fix every issue, re-audit the fix, and re-run the affected smokes.

When everything is done, update docs/party-management-implementation-tracker.md with every S2 item marked done with evidence, the smoke output summary, the browser verification results (or what could not be browser-verified), and the final audit findings and fixes. Then STOP.
```

---

## Step 2 follow-up prompt

```
FINAL AUDIT of Party Management (after Step 2). Do not trust any previous report, the tracker, or the smoke names. Independently verify the whole feature in code and by running it.

1. Open docs/party-management-two-step-prompts.md and docs/party-management-implementation-tracker.md. For every item S1-A1 through S1-O and S2-A1 through S2-G4, open the actual files, confirm the implementation exists, is complete, and is wired to its callers, and mark the tracker line done, partial, or missing with file-path evidence. Do not use tables.

2. Trace the full system end to end and fix anything that breaks:
entitled Starter company, venue, party room, party menu, party settings, party package published with sessions, staff phone create with the wizard, room held, deposit taken by cash and by card, confirm, confirmation email sent once, guest list edited within caps, invitation created and sent, RSVP accepted from the public page, food draft and submit creating a KitchenTicket, outstanding balance visible on /admin/parties/balances, payment link sent and paid, status PAID, run sheet printed, summary downloaded, then a second party cancelled with unused capacity restored and a refund that needed bookings:refund.
Public: published package, availability, hold, checkout deposit, Stripe webhook, confirmation page, pay-later when allowed.
Host: /profile parties, edit guests if allowed, cannot refund, assign host, overbook, or see staff notes; another user's party returns 404.
POS: saleEngine party_package_proxy creates the party through partyEngine; getTodayParties returns it.
Denials: Demo company, storefront org, pending, suspended, soft-hold, archived venue, cross-tenant ids, park-locked seat outside its park.

3. Check data consistency by querying the database after the trace: for every party, Booking.amountDue equals total minus amountPaid, PartyBookingDetail.depositPaidCents equals min(amountPaid, depositRequiredCents), opsStatus agrees with Booking.status per the mapping, TicketCredentials count equals kidCount plus adultCount for confirmed parties with no redeemed credential voided, PartyGuest named kids and adults are within counts, every party row has orgId and locationId matching its booking, and no party data exists in Order, Cart, Wallet, or WalletTransaction.

4. Check for problems of every kind: missing or partial functionality, broken dependencies, disconnected components, duplicate or conflicting implementations (two RSVP libs, two payment paths, two party detail components, two nav entries), workflow inconsistencies between staff, public, host, and POS paths, security loopholes, authorization problems (API_PERMISSIONS coverage, preset grants, body orgId), validation and error-handling gaps (stable error codes reach the UI as readable messages), timezone and DST edge cases, rate limits, webhook idempotency, cron idempotency, the Vercel cron count still 2, performance (N+1, missing indexes), configuration (env docs), export redaction, leftover TODOs, 501 stubs, placeholders, and unused files.

5. For every issue: FIX IT, re-audit the fix, re-test the affected workflow, and re-check the features that depend on it. Do not only report.

6. Re-run smoke:parties:all, smoke:ticketing:all, smoke:pos:all, smoke:waivers:all, smoke:memberships:all, smoke:plan-limits, smoke:enterprise-hq, smoke:park-admin-scope, smoke:franchise-parks, smoke:phase4-register, smoke:company-subscription, smoke:company-category:all, smoke:shipping, and the build and lint commands. All must pass. Confirm /signup still redirects and POST /api/auth/signup still returns 410, shop checkout still creates an Order and never a Booking, /tailor/* is unchanged, the Demo lock still holds, and README does not claim Party Command Center.

7. Write a final section in the tracker called "Final audit result" with: every item's final status, every issue found and the fix (file paths), smoke results, browser verification results or the exact steps that could not be browser-verified, and any remaining known limitation. Declare Party Management complete only if every S1 and S2 item is done, every smoke is green, and the data consistency checks pass. Otherwise list exactly what is still open and keep fixing.
```
