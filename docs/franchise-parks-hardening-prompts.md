# Franchise parks hardening — one Cursor prompt + follow-up

Paste the Step 1 prompt first. When that agent finishes, paste the Step 1 follow-up. Do not skip the follow-up. There is only one step. There is no Step 2.

This file hardens the already-shipped multi-park + franchise + park payouts epic from `docs/multi-park-franchise-prompts.md` (Steps 1–3). Do not re-stub that epic. Do not invent a second Organization per park, a second SaaS Stripe Customer per park, a second `/venue/*` admin app, or a separate auth database. Franchise remains Option A: `VenueLocation.isFranchise` under one Organization, park-lock via `MembershipVenueAssignment`, managers via `Membership.franchiseParkManager`, guest park money via `VenueLocationMarketplaceAccount` + `resolveGuestPayoutDestination`.

Company SaaS billing on `/admin/billing`, company profile, company plan meters, and the company subscription stay company-wide forever. Guest franchise revenue must continue to settle to each park’s Connect account when that park is charge-ready.

Shared real-time sync contract: after franchise manager grant or revoke, park staff invite or park assignment change, park Connect onboard refresh sync or webhook readiness flip, venue archive or reactivate that disables park charges, or guest checkout settlement that affects park ledger visibility, the UI and session must update immediately without a full page reload hack. Reuse React Query invalidation via venueLocationKeys, parkContextKeys, hqKeys, marketplaceKeys including park-accounts, invalidateOrgSaasQueries, invalidateTicketingQueries, invalidateMembershipsQueries, invalidateBillingUsageQueries, and admin-members query clears; cross-tab broadcast via hqLocationContextSync, orgSaasSessionSync, and any new marketplace or payouts sync helper you add in this step; authStore.silentRefresh against GET /api/auth/me; server staffGateCache and location scope cache clears; invalidateUserSessions when archive or assignment removes park access. Prefer setQueryData or invalidateQueries the way VenuesPage, useParkContext, and PayoutsPage already do. Do not invent websocket infrastructure unless this repo already has it for the same surface.

---

## Step 1 prompt

```
You are implementing the only hardening step for multi-park franchise parks and park payouts in this multi-tenant venue SaaS. Steps 1 through 3 from docs/multi-park-franchise-prompts.md are already shipped. Your job is to scan the real codebase, list what already works versus what is broken incomplete or out of sync, then fix every gap in this prompt end to end so franchise parks can accurately manage park staff and park resources, receive guest money into their own park Connect accounts, and stay in sync with every related feature surface. Do not stop halfway. Do not ask for a shorter feature list. Everything required is in this prompt. Do not invent a second Organization, a second Membership model, a second SaaS Stripe Customer, a second login realm, a second /venue admin app, a second ticketing engine, a second memberships engine, a second waivers engine, a second POS engine, or a second plan catalog.

Before you change anything, scan and analyze this project. Read the real files. Write down what already exists versus what you must add, fix, reconnect, or extend. Prove each finding with file paths. Match the code style, permission checks, org stamping, demo lock, park scope, franchise helpers, and marketplace Connect patterns already here.

Product rules you must obey for this whole run:

Franchise park means VenueLocation.isFranchise under one Organization. Franchise park managers are Membership.franchiseParkManager seats that are park-locked via MembershipVenueAssignment. They may invite and manage staff only inside their assigned parks. They must never grant companyWideView, platform_admin, empty assignments that unlock company-wide authority, or sister-park assignments. Company-wide admins still create parks, mark franchise, grant or revoke franchiseParkManager, and see the full company roster. SaaS billing company profile company plan meters and Enterprise HQ company meters stay on the parent Organization. Guest card money for a franchise park that is charge-ready must settle to that park VenueLocationMarketplaceAccount via resolveGuestPayoutDestination, never silently to platform or to a sister park. Franchise parks that are not charge-ready must fail closed for public online card checkout with clear messaging. Non-franchise parks and null-location catalog keep using OrganizationMarketplaceAccount when org Connect is charge-ready. DEFAULT_ORG is never a Connect merchant for tenant bookings. Never trust client orgId locationId userId membershipId connectedAccountId franchise flags fee or amount as authority. Postgres RLS stays deferred. Do not fake-implement Access Control Guest Surveys Loyalty Dynamic Pricing Reporting check-in scanner product or ticket-purchase kiosk. Online Ticketing guest Memberships Digital Waivers company category pages and POS Steps 1 through 2 are shipped. Extend them. Do not re-stub them. Obey the shared real-time sync contract from the top of docs/franchise-parks-hardening-prompts.md.

Start the scan with these files and follow every import they use:

docs/multi-park-franchise-prompts.md
docs/franchise-parks-hardening-prompts.md
docs/enterprise-hq-controls.md
docs/marketplace-payouts-implementation.md
docs/saas-module-extension.md
.cursor/rules/saas-venue-platform.mdc
.cursor/rules/customer-vs-tailor-sections.mdc
package.json smoke script section especially smoke:franchise-parks smoke:franchise-park-payouts smoke:marketplace-payouts smoke:venue-locations smoke:enterprise-hq smoke:park-admin-scope
prisma/schema.prisma models Organization VenueLocation Membership MembershipVenueAssignment VenueLocationMarketplaceAccount OrganizationMarketplaceAccount Booking BookingPayment AdmissionProduct BookingPackage MarketplaceBooking MembershipPlan GuestMembership MembershipPaymentAttempt PosSale PosSalePayment PosDevice PosTill PosTab WaiverTemplate WaiverRecord
src/lib/franchisePark.ts
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/assertNotParkLockedCompanyHq.ts
src/lib/venueLocations.ts
src/lib/memberAdmin.ts
src/lib/staffOrg.ts
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/lib/orgSession.ts
src/utils/authRedirect.ts
src/utils/hqLocationContextSync.ts
src/utils/orgSaasSessionSync.ts
src/utils/invalidateOrgSaasQueries.ts
src/utils/invalidateTicketingQueries.ts
src/utils/invalidateMembershipsQueries.ts
src/lib/marketplace/guestPayoutDestination.ts
src/lib/marketplace/parkAccount.ts
src/lib/marketplace/posConnect.ts
src/lib/marketplace/bookingCheckout.ts
src/lib/marketplace/webhook.ts
src/lib/marketplace/refunds.ts
src/lib/marketplace/assertChargeReady.ts
src/lib/marketplace/account.ts
src/lib/marketplace/index.ts
src/lib/stripe.ts
src/lib/ticketing/publicBooking.ts
src/lib/ticketing/payments.ts
src/lib/ticketing/refunds.ts
src/lib/publicCategory/companyCheckout.ts
src/lib/memberships/stripeGuest.ts
src/lib/memberships/webhookGuest.ts
src/lib/memberships/billingEngine.ts
src/lib/pos/saleEngine.ts
src/lib/pos/http.ts
src/lib/pos/tabs.ts
src/lib/pos/scope.ts
src/lib/waivers/common.ts
src/lib/hqOverview.ts
src/lib/companyExport.ts
src/app/api/auth/me/route.ts
src/app/api/auth/login/route.ts
src/app/api/admin/members/route.ts
src/app/api/admin/members/[id]/route.ts
src/app/api/admin/members/[id]/venue-assignments/route.ts
src/app/api/admin/users/route.ts
src/app/api/admin/role-templates/route.ts
src/app/api/admin/role-templates/[id]/route.ts
src/app/api/admin/venue-locations/route.ts
src/app/api/admin/venue-locations/[id]/route.ts
src/app/api/admin/marketplace/park-accounts/route.ts
src/app/api/admin/marketplace/park-accounts/[locationId]/route.ts
src/app/api/admin/marketplace/park-accounts/[locationId]/connect/onboard/route.ts
src/app/api/admin/marketplace/park-accounts/[locationId]/connect/refresh/route.ts
src/app/api/admin/marketplace/park-accounts/[locationId]/connect/sync/route.ts
src/app/api/admin/marketplace/park-accounts/[locationId]/connect/login-link/route.ts
src/app/api/admin/marketplace/connect/onboard/route.ts
src/app/api/admin/marketplace/connect/refresh/route.ts
src/app/api/admin/marketplace/connect/sync/route.ts
src/app/api/admin/marketplace/connect/login-link/route.ts
src/app/api/admin/marketplace/account/route.ts
src/app/api/admin/waivers/targets/route.ts
src/app/api/admin/hq/overview/route.ts
src/app/api/admin/billing/usage/route.ts
src/app/api/webhooks/stripe/route.ts
src/app/api/public/booking/checkout/route.ts
src/app/api/public/booking/pay-now/route.ts
src/app/api/public/booking/pay/[paymentLinkToken]/route.ts
src/app/api/public/booking/holds/route.ts
src/app/api/public/category/[orgSlug]/[categorySlug]/checkout/route.ts
src/app/api/public/booking-packages under src/app/api/public for BookingPackage checkout
src/services/marketplace.ts
src/services/auth.ts
src/services/venueLocations.ts
src/services/parkContext.ts
src/hooks/useParkContext.ts
src/hooks/use-auth-handlers.ts
src/store/authStore.ts
src/components/Protected/admin/pages/users/UsersPermissionsPage.tsx
src/components/Protected/admin/pages/users/VenueParkAssignmentField.tsx
src/components/Protected/admin/pages/venues/VenuesPage.tsx
src/components/Protected/admin/pages/payouts/PayoutsPage.tsx
src/components/Protected/admin/pages/components/dashboard/MarketplacePayoutsNudge.tsx
src/components/Protected/admin/pages/booking-packages/BookingPackagesPage.tsx
src/components/Protected/admin/pages/bookings/TakePaymentModal.tsx
src/components/Protected/admin/pages/ticketing product create edit list pages under src/components/Protected/admin/pages for admission products
src/components/Protected/admin/pages/memberships MembershipPlansPage or equivalent
src/components/Protected/admin/pages/pos PosHomePage and POS sale chrome
src/components/Protected/admin/layout/AdminHeader.tsx
src/components/Protected/admin/layout/AdminSidebar.tsx
src/components/Protected/admin/components/AdminHowToGuideModal.tsx
src/lib/adminNav.ts
public booking checkout UI pages that surface ForbiddenError messages for park payouts not ready
scripts/smoke-franchise-parks.mts
scripts/smoke-franchise-park-payouts.mts
scripts/smoke-marketplace-payouts.mts
scripts/smoke-venue-locations.mts
scripts/smoke-enterprise-hq.mts
scripts/smoke-park-admin-scope.mts

Also search the whole repo for every reader and writer of franchiseParkManager, ensureFranchiseManagerPayoutPermissions, FRANCHISE_MANAGER_PAYOUT_PERMISSIONS, resolveGuestPayoutDestination, resolveVenueBookingCheckoutDestination, resolvePosConnectChargeFields, convertCardPresentIntentToBrowser, VenueLocationMarketplaceAccount, assertParkMarketplaceChargeReady, PARK_PAYOUTS_NOT_READY_MESSAGE, assignableRoleOptions, users:invite, users:park_assign, assertNotParkLockedCompanyHq, listFranchiseRosterMembershipIds, waivers/targets, invalidateMarketplacePayoutQueries, and every live Stripe PaymentIntent or Checkout create path that charges a guest for a park-stamped catalog row. Update every call site that must stay in sync. Do not leave a parallel ad-hoc money route or staff invite path that bypasses franchise rules.

What this Step 1 must do when you are finished:

First finish the scan and list existing versus missing versus broken. Then implement every item below without deferring any as a TODO.

Franchise park manager capability pack. Granting or keeping franchiseParkManager true must server-side ensure a durable permission pack so the manager can actually operate franchise staff and park payouts without relying on smoke scripts to manually inject grants. At minimum the ensure helper in src/lib/franchisePark.ts must union users:read, users:invite, payouts:read, and payouts:manage. Decide and implement whether users:park_assign and a limited users:manage_roles grant also belong in that pack so managers can reassign parks inside their set and edit park-local roles. Rename or extend ensureFranchiseManagerPayoutPermissions so the name and docs match the full pack. Apply the same ensure on members PATCH grant path, members invite or create paths that set franchiseParkManager if any, and UsersPermissionsPage when the franchise park manager checkbox is turned on. Smokes must stop manually seeding users:invite as the only way invite works. After grant, invalidate admin-members queries and silentRefresh so invite controls appear immediately without reload.

Franchise park staff invite defaults. Franchise managers must be able to invite useful park ops staff, not only empty custom seats. Implement a franchise-safe invite path that does not require the manager to personally hold the entire company ops_manager permission matrix. Prefer a server-stamped franchise park staff permission pack or capped preset list for park-locked invites, while still forcing companyWideView false, forbidding platform_admin, and forcing MembershipVenueAssignment rows inside the manager assignedLocationIds only. Update UsersPermissionsPage assignableRoleOptions and invite UI so franchise managers see workable role choices or templates for park ops. Keep AdvancedOverrides consistent between invite and edit for franchise managers. Invite-only managers without users:manage_roles may only change status or revoke. If the UI shows role or park editors for invite-only managers, that is a bug. Disable or hide non-status fields for invite-only franchise managers so the UI does not lie. Align VenueParkAssignmentField visibility with real users:park_assign or the ensure pack you chose so PUT /api/admin/members/[id]/venue-assignments does not 403 after the UI offered an edit. POST /api/admin/users must remain hard-blocked by assertNotParkLockedCompanyHq and must never become a franchise invite bypass. Role template CRUD stays company-wide only. GET role-templates may remain readable for assigning existing company templates when the franchise-safe assign path allows it.

POS park Connect destination completeness. Primary POS Stripe charge paths already use resolvePosConnectChargeFields or resolveVenueBookingCheckoutDestination. Fix convertCardPresentIntentToBrowser in src/lib/pos/saleEngine.ts so the replacement browser PaymentIntent also receives park or org Connect transfer_data application fee and metadata from the same resolver using the sale orgId and locationId. Stamp connectedAccountId and platform fee fields on PosSalePayment the same way primary sale paths do. Franchise parks that are not charge-ready must fail closed here too. Search for any other POS Terminal fallback or replacement PaymentIntent create that drops Connect fields and fix them the same way. Refunds for those payments must target the stamped connected account.

Publish and sell honesty for park Connect. BookingPackagesPage already warns when park Connect is not ready. Mirror that honesty for Online Ticketing admission product publish create edit list UI and for MembershipPlansPage or equivalent membership plan publish sell UI when the plan or product is stamped to a franchise park. Staff must see a clear not-ready reason before guests hit checkout. Do not weaken server fail-closed gates. Public and embedded guest checkout must show a guest-safe message when park payouts are not ready. Keep an admin-facing message that may mention /admin/payouts. Do not show admin URLs or ops jargon as the primary guest error. Update PARK_PAYOUTS_NOT_READY_MESSAGE usage in src/lib/marketplace/guestPayoutDestination.ts and the public booking checkout payment-link and company embedded checkout UI that surfaces ForbiddenError messages so guest copy and admin copy are separated.

Park isolation leak on waiver targets. GET /api/admin/waivers/targets currently returns all org admission products and membership plans without park scope. Filter with resolveEffectiveParkScope and the same assignedLocationFilter or waiver list location helpers other waiver routes use so park-locked and franchise manager seats cannot see sister-park catalog identifiers. Keep company-wide seats able to see company-wide targets as existing waiver rules allow.

Cross-feature payout readiness sync. After park Connect onboard refresh sync login-link success, after webhook-driven park charge-ready flips, and after venue archive that disables VenueLocationMarketplaceAccount for new charges, invalidate marketplaceKeys park-accounts, PayoutsPage state, MarketplacePayoutsNudge, VenuesPage park payout badges, and HQ park readiness counts without full reload. Add a cross-tab broadcast helper for marketplace or park payouts readiness modeled on hqLocationContextSync or orgSaasSessionSync so sister admin tabs update, not only the acting tab. PayoutsPage visibilitychange alone is not enough. Wire VenuesPage archive reactivate refresh and Connect sync mutations through the same invalidation plus broadcast. Franchise managers must see updated park ledger rows after successful guest checkout confirmation using existing ticketing marketplace memberships invalidation helpers.

POS and admin nav honesty. Add a park Connect not-ready banner on POS home or sale chrome when the current park is franchise and not charge-ready, linking to /admin/payouts?locationId= for entitled managers. Filter /admin/billing out of admin nav for park-locked seats instead of only soft-gating the page. For franchiseParkManager seats, label payouts as Park payouts or equivalent clear copy in adminNav AdminSidebar or PayoutsPage chrome. Keep franchise managers blocked from SaaS billing management. Keep company-wide admins able to see company Connect plus all franchise park readiness on /admin/payouts.

Money path regression guard. Re-verify and keep wired every live guest charge path through resolveGuestPayoutDestination or resolveVenueBookingCheckoutDestination: public booking checkout pay-now payment-link holds to Checkout, company category checkout, marketplace BookingPackage checkout when locationId is set, staff TakePaymentModal and booking payment-link routes for venue_booking, guest membership stripeGuest billingEngine webhookGuest for park-stamped plans, and POS live Stripe paths including the browser fallback you fix. Never let a sister park connected account receive another park charge. Never trust client connectedAccountId. Keep webhook account.updated updating VenueLocationMarketplaceAccount by stripeConnectedAccountId without touching SaaS subscription columns. Keep company OrganizationMarketplaceAccount routes working for company-wide admins.

Docs guides and smokes. Update docs/enterprise-hq-controls.md Smokes section to include yarn smoke:franchise-parks and yarn smoke:franchise-park-payouts alongside the Step 1 smokes. Update AdminHowToGuideModal Connect copy so venue booking and staff take-payment readiness mention park Connect for franchise parks, not only company Connect. Update docs/marketplace-payouts-implementation.md only if park destination or POS fallback behavior notes would otherwise lie. Extend scripts/smoke-franchise-parks.mts so granting franchiseParkManager through the product ensure helper is enough for invite without manually seeding users:invite as a hidden prerequisite, and so invite creates a park-locked seat that can receive a useful franchise staff pack or capped role. Extend scripts/smoke-franchise-park-payouts.mts to cover distinct park destinations, POS browser-fallback Connect stamping or an equivalent unit assertion on convertCardPresentIntentToBrowser fields, sister-park deny, billing deny for franchise managers, archive block on new charges, webhook SaaS separation, waiver targets sister-park deny for park-locked actors, and UI invalidation helper presence after Connect sync. Keep yarn smoke:marketplace-payouts yarn smoke:venue-locations yarn smoke:enterprise-hq and yarn smoke:park-admin-scope passing or update them without weakening isolation.

Required paths and APIs that must keep working or become correct when this step is finished:

/admin/users park-local roster invite and role edit for franchise managers
/admin/permissions must not become a bypass users app
/admin/venues franchise flag profile and park payouts deep links
/admin/payouts company plus park list and park detail for locationId
/admin/billing still company SaaS only and filtered from park-locked nav
/admin/hq park payout readiness honesty for Enterprise
POS admin surface with park Connect readiness honesty
Online Ticketing admission product publish UI with park Connect honesty
Membership plans UI with park Connect honesty when park-stamped
Public /book checkout and payment-link guest-safe park-not-ready copy
POST /api/admin/members franchise manager invite with useful park staff pack
GET PATCH /api/admin/members/[id] scoped update revoke and franchiseParkManager ensure pack
PUT /api/admin/members/[id]/venue-assignments aligned with UI permissions
POST /api/admin/users still company-wide only
GET /api/admin/waivers/targets park-scoped for park-locked actors
GET POST park Connect APIs under /api/admin/marketplace/park-accounts
existing company /api/admin/marketplace/connect/* routes
public booking checkout pay-now payment-link category checkout marketplace package checkout
staff TakePaymentModal and ticketing payment paths
guest membership Stripe paths
POS saleEngine convertCardPresentIntentToBrowser and primary POS Stripe paths
Stripe webhook park account.updated and guest settlement metadata types
GET /api/auth/me franchiseParkManager park scope and safe payout entry flags

Acceptance criteria for this Step 1:

Company-wide admin grants franchiseParkManager on a park-locked seat and that seat can open park payouts and invite park staff without a manual smoke-only permissionsOverride for users:invite.
That franchise manager invites staff locked to their park with a useful park ops permission pack or capped role, not an empty useless custom seat, and cannot invite company-wide or platform_admin seats or assign sister parks.
Invite-only franchise managers without manage_roles cannot appear to edit roles or parks in the UI while the server only accepts status changes.
POS card_present to browser fallback creates a PaymentIntent with the same park Connect destination and fee stamping as primary POS charges when the park is charge-ready, and fails closed when it is not.
Ticketing product publish and membership plan publish or sell UI warn when the franchise park is not charge-ready. Guests see guest-safe copy. Admins still see actionable onboarding copy.
GET /api/admin/waivers/targets does not leak sister-park products or plans to park-locked seats.
Park Connect sync archive and webhook readiness flips update PayoutsPage MarketplacePayoutsNudge Venues badges and HQ readiness in the acting tab and across admin tabs via broadcast or equivalent shared sync, without full reload.
Park-locked seats do not see Billing in admin nav. Franchise managers see clear Park payouts entry and remain blocked from SaaS billing management.
Step 1 through 3 isolation and park destination routing for the other live guest paths still hold. No second Organization and no per-park SaaS Customer were added.
yarn smoke:franchise-parks and yarn smoke:franchise-park-payouts pass or you record a concrete environment blocker after implementing them. Other listed smokes still pass or are updated without weakening isolation.
docs/enterprise-hq-controls.md Smokes section and AdminHowToGuideModal match reality.

Implementation order inside this Step 1 run:

First finish the scan and list existing versus missing versus broken with file paths.
Then fix franchisePark ensure pack and members grant invite API paths.
Then fix UsersPermissionsPage invite edit park assignment honesty and franchise-safe role defaults.
Then fix POS convertCardPresentIntentToBrowser and any sibling POS Connect gaps.
Then fix ticketing and memberships publish honesty and guest versus admin park-not-ready copy.
Then fix waivers targets park filter.
Then add marketplace or park payouts cross-tab sync and wire invalidations through VenuesPage PayoutsPage nudge HQ and Connect mutations.
Then fix admin nav Billing filter and Park payouts labeling and POS readiness banner.
Then update docs guides and smokes.
Then run the relevant typecheck or targeted tests you can run in this environment and fix failures you caused.
Then re-check that public booking marketplace memberships company category and staff take-payment still use resolveGuestPayoutDestination correctly.

Do not leave TODOs for POS destination routing franchise invite capability pack waiver targets isolation guest versus admin copy or cross-tab payouts sync. Do not claim success if franchise managers still cannot invite useful park staff after only checking the franchiseParkManager box. Do not claim success if POS browser fallback still settles franchise card money on the platform. When you are done, summarize what existed, what you changed, which files you touched, which money and staff paths you verified, and which smokes or checks you ran.
```

---

## Step 1 follow-up prompt

```
You just finished the only hardening step for multi-park franchise parks and park payouts. Do not build a new unrelated epic. Audit whether every requirement in docs/franchise-parks-hardening-prompts.md Step 1 was fully implemented and whether the original Steps 1 through 3 behaviors from docs/multi-park-franchise-prompts.md stayed intact.

Re-scan the real code and prove each item with file paths. For every item say PASS, FAIL, or NOT APPLICABLE with a one-line reason. If anything is FAIL, fix it now in this same run, then re-check that item until it passes or you explain a hard blocker that already matches the product rules in the Step 1 prompt.

Check all of the following:

No second Organization second SaaS Stripe Customer second login database or /venue admin app was created.
Granting franchiseParkManager server-side ensures users:read users:invite payouts:read payouts:manage and any additional pack keys you chose such as users:park_assign or limited users:manage_roles without requiring smoke scripts to manually seed users:invite.
Franchise managers can invite useful park-locked ops staff with a franchise-safe permission pack or capped role while companyWideView stays false and platform_admin and sister parks stay forbidden.
Invite-only franchise managers without manage_roles cannot edit roles or parks in the UI in a way that silently no-ops. Status and revoke only.
UsersPermissionsPage invite and edit AdvancedOverrides and VenueParkAssignmentField gates are consistent with server permissions.
POST /api/admin/users remains hard company-HQ denied for park-locked seats and cannot bypass franchise invite rules.
convertCardPresentIntentToBrowser and any sibling POS replacement PaymentIntent paths stamp park Connect destination and fees via the shared POS Connect resolver and fail closed for franchise parks that are not charge-ready.
PosSalePayment or equivalent ledger rows store connectedAccountId for those fallback charges so refunds target the correct account.
Ticketing admission product publish UI and membership plan publish or sell UI warn when franchise park Connect is not charge-ready without removing server fail-closed gates.
Guest-facing park-not-ready errors are guest-safe and do not primarily expose /admin/payouts. Admin-facing copy may still mention onboarding.
GET /api/admin/waivers/targets filters by park scope for park-locked and franchise manager seats and does not leak sister-park catalog ids.
Park Connect onboard sync webhook readiness and venue archive disable invalidate park-accounts payouts nudge venues badges and HQ readiness immediately, including cross-tab broadcast or equivalent shared sync, without full reload.
Admin nav hides Billing for park-locked seats. Franchise managers see clear Park payouts entry and remain blocked from /admin/billing SaaS management.
POS chrome shows a park Connect not-ready banner for franchise parks that are not charge-ready.
Public booking pay-now payment-link company category marketplace package staff TakePaymentModal guest membership and primary POS Stripe paths still use resolveGuestPayoutDestination or resolveVenueBookingCheckoutDestination correctly with no sister-park destination leak.
Stripe webhooks still update VenueLocationMarketplaceAccount by stripeConnectedAccountId and never mutate SaaS subscription columns for Connect account events.
docs/enterprise-hq-controls.md Smokes section lists smoke:franchise-parks and smoke:franchise-park-payouts. AdminHowToGuideModal park versus company Connect copy matches reality.
yarn smoke:franchise-parks no longer depends on secretly pre-seeding users:invite as the only way invite works, and covers useful franchise staff invite plus sister-park and billing denies.
yarn smoke:franchise-park-payouts covers distinct park destinations POS browser-fallback Connect stamping or equivalent assertion sister-park deny archive block webhook SaaS separation waiver targets isolation and Connect sync invalidation helper presence, and you ran it or recorded the environment blocker.
yarn smoke:marketplace-payouts yarn smoke:venue-locations yarn smoke:enterprise-hq and yarn smoke:park-admin-scope still pass or were updated without weakening isolation.
No Step 1 acceptance criterion from docs/franchise-parks-hardening-prompts.md was deferred as a TODO.

End with a short verdict line that is exactly one of these:

FRANCHISE PARKS HARDENING AUDIT: ALL PASS
FRANCHISE PARKS HARDENING AUDIT: FIXED DURING FOLLOW-UP
FRANCHISE PARKS HARDENING AUDIT: BLOCKED

If BLOCKED, list only the remaining FAIL items and the concrete blocker for each.
```

---

## How to use

Copy the entire Step 1 prompt fenced block into a new Cursor chat and send it. When that agent finishes, copy the entire Step 1 follow-up prompt fenced block and send it. Keep the follow-up verdict.

If the follow-up is BLOCKED, fix the listed items first. Re-paste the same follow-up after fixes. There is no Step 2.
