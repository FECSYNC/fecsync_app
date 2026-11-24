# Multi-park locations + franchise parks + park payouts — three Cursor prompts

Paste one step at a time. After that step finishes, paste its follow-up before you paste the next step. Do not skip a follow-up. Do not start Step 2 while the Step 1 follow-up still reports a failure. Do not start Step 3 while the Step 2 follow-up still reports a failure.

This is the only multi-park + franchise + park payouts Cursor prompt file. All three steps and all three follow-ups live in this one document. Do not split them into other markdown files.

Franchise here means Option A: each VenueLocation park can operate as a franchise unit under one Organization. Franchise park managers invite and manage staff for their own park only. Staff land in their assigned park context. Sister parks do not share staff authority or park-stamped operations. Company SaaS billing (`/admin/billing`), company profile, company plan meters, and the company subscription stay company-wide on the parent Organization. Do not invent a second Organization per park, a second SaaS Stripe Customer per park, a second `/venue/*` admin app, or a separate auth database.

What stays company-wide forever in this epic: SaaS subscription payment to FECSYNC, company profile HQ fields, company plan meters, and the company members seat meter. What becomes per franchise park in Step 3: guest money for that park’s bookable plans and packages settles to that park’s Stripe Connect payout account, not a single shared company merchant account when the park is charge-ready.

Step 1 hardens multi-park venues, Enterprise HQ, park-lock, and module sync so isolation is real. Step 2 adds franchise park management: park-local staff invites, park-local roster, forced park login context, franchise park profile fields, permissions, UI, smokes, and docs. Step 3 adds per-franchise-park Connect accounting and payouts so each franchise park receives guest booking and membership money into its own Connect account, in sync with marketplace, ticketing, memberships, webhooks, HQ, and park scope.

There are three steps. There is no Step 4.

Shared real-time sync contract for every step: after any create, archive, reactivate, park assignment change, park preference change, franchise manager grant or revoke, Connect onboard or sync, or guest checkout settlement that affects park scope or payout readiness, the UI and session must update immediately and automatically without a full page reload hack. Reuse the repo patterns already in this codebase: React Query invalidation via venueLocationKeys, parkContextKeys, hqKeys, invalidateOrgSaasQueries, invalidateTicketingQueries, invalidateMembershipsQueries, invalidateBillingUsageQueries, and admin-members or users query clears; cross-tab broadcast via hqLocationContextSync and orgSaasSessionSync keys; authStore.silentRefresh against GET /api/auth/me; server clearCachedLocationScopesForOrg or staffGateCache clears; invalidateUserSessions from memberAdmin when assignments or archive remove park access. Prefer setQueryData or invalidateQueries the way VenuesPage and useParkContext already do. router.refresh is allowed only for App Router server components that truly need it, never as the only park-scope fix. Do not invent websocket infrastructure unless this repo already has it for the same surface.

---

## Step 1 prompt

```
You are implementing Step 1 only of multi-park locations plus franchise parks for this multi-tenant venue SaaS. Build and harden the multi-park foundation end to end: VenueLocation CRUD, plan caps, Enterprise HQ, park context switchers, MembershipVenueAssignment park-lock, session park fields, and every park-stamped module filter so parks cannot leak into each other. Do not build franchise park manager invites, park-local members roster for park-locked managers, franchise profile fields, or franchise-specific permissions in this step. Those are Step 2. Do not stop halfway through Step 1. Do not ask for a shorter feature list. Everything required for Step 1 is in this prompt.

Before you change anything, scan this project and write down what already exists versus what you must add, fix, reconnect, or extend. Read the real files. Do not invent a second Organization, a second Membership model, a second billing subscription, a second login system, a second /admin app, a second ticketing engine, a second memberships engine, a second waivers engine, a second POS engine, or a second plan catalog. Parks are VenueLocation rows under one Organization. Staff seats are Membership rows. Park isolation is MembershipVenueAssignment plus resolveEffectiveParkScope. Enterprise HQ is entitlement on subscriptionPlan === "enterprise". Match the code style, permission checks, org stamping, demo lock, and module entitlement that are already here.

Product rules you must obey for this whole Step 1 run:

Multi-park means one company workspace with many parks. One subscription per Organization. VenueLocation is never billed separately. DEFAULT_ORG / isDefault is the public Harewa storefront host and must never be locked by tenant expiry. Public self-registration stays /register-company only. Do not reopen /signup. Do not merge customer, tailor, and company admin surfaces. Demo plan keeps venues at 0 and locks company apps except dashboard, company profile, and billing. Starter venues cap is 1. Growth is 5. Enterprise is unlimited. Park-lock works on Growth and Starter without Enterprise. Enterprise HQ APIs fail closed unless subscriptionPlan is enterprise. Soft-upsell UI for non-Enterprise is allowed on /admin/hq but must not leak rollup data. In Step 1, members roster and plan meters stay company-wide by design. Park preference filters venue lists, HQ venue items, and park-stamped module rows. Never trust client orgId, locationId, userId, or membershipId as authority. Stamp actor.orgId from the session. Postgres RLS stays deferred. Do not fake-implement Access Control, Guest Surveys, Loyalty, Dynamic Pricing, Reporting, check-in scanner product, or ticket-purchase kiosk. Online Ticketing, guest Memberships, Digital Waivers Phases 1 through 5, company category pages, and POS Steps 1 through 2 are already shipped. Extend them. Do not re-stub them. Do not start Step 2 franchise invite behavior yet. Keep assertNotParkLockedCompanyHq blocking park-locked seats from company-wide staff invites in Step 1 so Step 2 can open a controlled franchise invite path later. Obey the shared real-time sync contract from the top of docs/multi-park-franchise-prompts.md in this Step 1 run.

Start the scan with these files and follow every import they use:

.cursor/rules/saas-venue-platform.mdc
.cursor/rules/customer-vs-tailor-sections.mdc
docs/enterprise-hq-controls.md
docs/saas-module-extension.md
docs/postgres-rls.md
README.md sections on control plane, venues, Enterprise HQ, and module entitlement
package.json scripts smoke:venue-locations, smoke:enterprise-hq, smoke:park-admin-scope
prisma/schema.prisma models Organization, VenueLocation, Membership, MembershipVenueAssignment, RoleTemplate, CompanyProfile, AdmissionProduct, CapacityResource, Booking, BookingLine, BookingHold, BookingPayment, BookingSettings, TicketCredential, TicketSession, StockPeriod, MembershipPlan, GuestMembership, GuestProfile, MembershipPaymentAttempt, WaiverTemplate, WaiverRecord, WaiverSettings, PosDevice, PosSale, PosTill, PosTab, Product, Order, Cart, OrganizationMarketplaceAccount, BookingPackage, MarketplaceBooking
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/parkContext.ts
src/lib/hqLocationContext.ts
src/lib/enterpriseHq.ts
src/lib/hqOverview.ts
src/lib/venueLocations.ts
src/lib/memberAdmin.ts especially invalidateUserSessions
src/lib/ticketing/staffGateCache.ts
src/lib/subscriptionPlans.ts
src/lib/planLimits.ts
src/lib/demoPlanLock.ts
src/lib/demoPlanAssert.ts
src/lib/moduleEntitlement.ts
src/lib/staffOrg.ts
src/lib/assertNotParkLockedCompanyHq.ts
src/lib/companyExport.ts
src/lib/auth/permissions.ts including UsersParkAssign users:park_assign and API_PERMISSIONS entries for venue-locations, hq, park-context, members venue-assignments
src/lib/adminNav.ts
src/lib/orgSession.ts
src/lib/ticketing/common.ts
src/lib/ticketing/publicVenue.ts
src/lib/ticketing/publicBookPaths.ts
src/lib/ticketing/publicBooking.ts
src/lib/memberships/common.ts
src/lib/memberships/multiVenueStatus.ts
src/lib/waivers/common.ts
src/lib/pos/scope.ts
src/services/venueLocations.ts
src/services/hq.ts
src/services/parkContext.ts
src/services/auth.ts
src/store/authStore.ts silentRefresh
src/hooks/use-auth-handlers.ts
src/hooks/useParkContext.ts
src/hooks/useHqLocationFilter.ts
src/hooks/useBilling.ts invalidateBillingUsageQueries and useEnterpriseHqSessionCatchUp
src/utils/orgSaasSessionSync.ts
src/utils/hqLocationContextSync.ts
src/utils/invalidateOrgSaasQueries.ts
src/utils/invalidateTicketingQueries.ts
src/utils/invalidateMembershipsQueries.ts
src/app/api/auth/me/route.ts
src/app/api/auth/login/route.ts parkLocked and assignedLocationIds on session
src/app/api/admin/venue-locations/route.ts
src/app/api/admin/venue-locations/[id]/route.ts
src/app/api/admin/hq/overview/route.ts
src/app/api/admin/hq/location-context/route.ts
src/app/api/admin/park-context/route.ts
src/app/api/admin/members/route.ts
src/app/api/admin/members/[id]/route.ts
src/app/api/admin/members/[id]/venue-assignments/route.ts
src/app/api/admin/billing/usage/route.ts
src/app/api/admin/company-profile/route.ts
src/app/api/admin/company-export/route.ts
src/app/api/admin/role-templates/route.ts and [id] if present
src/app/api/admin/marketplace/account/route.ts
src/app/api/admin/marketplace/connect/onboard/route.ts
src/app/api/admin/marketplace/connect/refresh/route.ts
src/app/api/admin/marketplace/connect/sync/route.ts
src/app/api/admin/marketplace/connect/login-link/route.ts
src/app/api/public/booking/checkout/route.ts
src/app/api/public/booking/holds/route.ts
src/app/api/public/booking/pay-now/route.ts
src/app/api/public/booking/pay/[paymentLinkToken]/route.ts
src/app/api/public/booking/venues/[orgSlug]/[venueSlug]/route.ts
src/app/(admin)/admin/venues/page.tsx
src/app/(admin)/admin/hq/page.tsx
src/app/(admin)/admin/users/page.tsx
src/app/(admin)/admin/permissions/page.tsx
src/app/(admin)/admin/billing/page.tsx
src/app/(admin)/admin/company-profile/page.tsx
src/app/(admin)/admin/payouts/page.tsx
src/components/Protected/admin/pages/venues/VenuesPage.tsx including refreshMetersAndHq patterns
src/components/Protected/admin/pages/hq/HqDashboardPage.tsx
src/components/Protected/admin/pages/hq/ParkContextSwitcher.tsx
src/components/Protected/admin/pages/hq/HqVenueSwitcher.tsx
src/components/Protected/admin/layout/AdminHeader.tsx
src/components/Protected/admin/layout/AdminSidebar.tsx
src/components/Protected/admin/layout/AdminLayout.tsx
src/components/Protected/admin/layout/AdminAppSearch.tsx
src/components/Protected/admin/pages/users/UsersPermissionsPage.tsx
src/components/Protected/admin/pages/users/VenueParkAssignmentField.tsx
src/components/Protected/admin/pages/payouts/PayoutsPage.tsx
src/components/Protected/admin/pages/components/dashboard/MarketplacePayoutsNudge.tsx
src/components/Protected/admin/components/AdminHowToGuideModal.tsx
scripts/smoke-venue-locations.mts
scripts/smoke-enterprise-hq.mts
scripts/smoke-park-admin-scope.mts

Also search the whole repo for every reader and writer of VenueLocation, MembershipVenueAssignment, hqSelectedLocationId, actorLocationScope, resolveEffectiveParkScope, assignedLocationFilter, venueStampedResourceFilter, assertActorCanAccessLocation, assertEnterpriseHqEnabled, assertNotParkLockedCompanyHq, locationId, venueLocationId, parkLocked, assignedLocationIds, enterpriseHqEnabled, useHqLocationFilter, broadcastHqLocationContextChange, and users:park_assign. Update every call site that must stay in sync. If a staff list or mutate path stamps or filters by park, it must use the shared park scope helpers. Do not leave a parallel ad-hoc location filter that can bypass park-lock. Park-scoped admin consoles under /admin/bookings, /admin/ticketing, /admin/memberships, /admin/waivers, /admin/pos, /admin/booking-payments, /admin/booking-accounts, and /admin/parties must keep using useHqLocationFilter or equivalent shared scope so create, archive, assignment, and preference changes refresh their lists automatically.

What Step 1 must do when you are finished:

Company admins on a registered company can open /admin/venues and create, edit, soft-archive, and reactivate parks. Creating and reactivating burn the venues plan meter. Soft-archive frees quota without deleting history, clears MembershipVenueAssignment rows for that venue, clears hqSelectedLocationId values pointing at that venue, and soft-archives park-specific membership plans and related park eligibility or settings that this codebase already defines for archive. Park-locked seats cannot create, archive, or reactivate venues. Ops storefront platform_admin may open venues and HQ as ops consoles for counts and eligibility, but tenant create, archive, switcher, and rollup stay registered-company scoped so ops never becomes a cross-tenant data browser.

Enterprise seats with subscriptionPlan enterprise can open /admin/hq and see real VenueLocation health, company-wide plan meters, and honest module entitlement counts for ticketing, memberships, waivers, and POS where those counts are real. The header HQ venue switcher persists Membership.hqSelectedLocationId. Null means All locations for company-wide seats. When a park is selected, HQ venue items and park-stamped module counts filter to that park. Active and archived venue totals, plan meters including posTerminals, and the members roster stay company-wide in Step 1. Non-Enterprise users may see a soft-upsell page with no rollup leak. HQ APIs must call assertEnterpriseHqEnabled.

Growth, Starter, and park-locked seats use /api/admin/park-context and the park context switcher in the admin header. That API reads and writes the same hqSelectedLocationId preference field. Park-locked seats may only select an assigned active park and never All locations. A seat with exactly one assignment is forced to that park. A seat with multiple assignments may switch among assigned parks only. Platform software owner and FECSYNC storefront ops resolve company-wide through resolveEffectiveParkScope.

Company-wide or platform_admin or software-owner seats with the permission this repo already uses for park assignment, users:park_assign also known as UsersParkAssign, plus company-wide authority, can replace-set park assignments through PUT /api/admin/members/[id]/venue-assignments and the VenueParkAssignmentField on the users permissions screen. Do not weaken that to a looser permission. One or more active MembershipVenueAssignment rows park-locks the seat. platform_admin seats stay company-wide and must not receive park assignments until demoted. You must keep at least one company-wide admin who can still manage assignments and venues. Empty assignments unlock a CWV or platform_admin seat to company-wide and clear sticky park preference. Non-CWV with empty assignments stays own-records, not park-locked. Archive of a venue must invalidate sessions for users who lost that assignment when the existing session invalidation pattern already exists.

Park-locked staff must be able to manage operations only inside their assigned parks for Online Ticketing products, capacity resources, bookings, booking settings that are park-scoped, guest memberships sold or home-stamped to those parks, waiver records and kiosks for those parks, and POS devices, tills, tabs, sales, and capacity for those parks. They must not mutate company-wide null-location templates or settings when this codebase already forbids that for park-locked seats. They must not access company HQ surfaces that assertNotParkLockedCompanyHq protects, including billing, company profile, marketplace Connect, and company-wide staff invites. They must not see or mutate sister parks. Company-wide seats with a selected park preference filter lists to that park plus company-shared null rows only where venueStampedResourceFilter allows it. Park-locked seats hide company-shared null rows for Product and Order when those rows use venueLocationId.

Every module that already stamps locationId or venueLocationId must stay consistent. Online Ticketing and bookings require orgId and locationId on park-owned rows. Staff list and mutate paths must apply the shared park filters. Public booking stays per venue at /book/{venueSlug} when publicBookingEnabled. Company category pages that show booking cards for several parks must keep checkout bound to each product locationId. Guest memberships, digital waivers, and POS must keep their existing location rules and honor park scope. Shop Product and Order optional venueLocationId must use venueStampedResourceFilter.

Session and auth must expose park state to the client without trusting the client for authority. /api/auth/me, login session shaping, and org session sync must continue to surface enterpriseHqEnabled, parkLocked, assignedLocationIds, and the effective selected location so AdminHeader switchers, sidebar, and demo lock behave correctly after create, archive, assignment change, and preference change. Clear staffGateCache and related location scope caches whenever assignments, archive, or preference changes require it. Call invalidateUserSessions from memberAdmin when archive or assignment changes remove park access so the next /me or silentRefresh cannot keep stale authority.

Immediate automatic UI sync is required in Step 1. After venue create, edit, archive, or reactivate: refresh meters and HQ the way VenuesPage already does, invalidate venueLocationKeys, billing usage, park-context, hq overview, ticketing and memberships queries as needed, and broadcast HQ location context when preference-affecting. After PUT park-context or HQ location-context: useParkContext must invalidate park-context, hq, venues, ticketing, memberships and broadcastHqLocationContextChange so every open admin tab and module page updates without reload. After PUT venue-assignments: clear admin-members and user queries, silentRefresh the actor and affected user sessions, and clear location scope caches. Park-locked seats must stay denied on /admin/billing, /admin/company-profile, /admin/payouts company Connect, and role-templates. Do not use window.location.reload as the sync strategy.

Admin navigation and search must keep /admin/venues and /admin/hq discoverable for entitled seats, hide or soft-gate them correctly for Demo and park-locked company HQ denial, and keep How to set this up guides accurate. Update AdminHowToGuideModal and docs/enterprise-hq-controls.md if they still claim POS or Waivers are unshipped while this repo has them shipped. Keep docs/saas-module-extension.md location-scope policy accurate.

Company export via /api/admin/company-export, registered-companies ops views, billing usage via /api/admin/billing/usage, and plan limit asserts that mention venues or Enterprise HQ eligibility must stay in sync with VenueLocation counts and subscriptionPlan. Soft-archive and reactivate must keep assertWithinPlanLimit correct under concurrent creates.

Register every new or changed admin API permission in API_PERMISSIONS. Register every new staff page in ADMIN_PAGES and admin nav only if a new screen is truly required. Prefer extending VenuesPage, HqDashboardPage, UsersPermissionsPage, AdminHeader switchers, and existing module pages. Do not add a second venues screen. Do not add franchise manager invite APIs in Step 1.

Required staff and public paths that must work when Step 1 is finished:

/admin/venues via src/app/(admin)/admin/venues/page.tsx
/admin/hq via src/app/(admin)/admin/hq/page.tsx
/admin/users via src/app/(admin)/admin/users/page.tsx
/admin/permissions redirect alias must not become a second users app
/admin/billing for company-wide seats only
/admin/company-profile for company-wide seats only
/admin/payouts company Connect remains company-wide only in Step 1 and denied to park-locked seats
/book/[venueSlug] and legacy book paths this app already supports
public booking APIs under /api/public/booking/* that sell a venue catalog
header ParkContextSwitcher and Enterprise HqVenueSwitcher on admin chrome

Required APIs that must work when Step 1 is finished:

GET POST /api/admin/venue-locations
GET PATCH DELETE /api/admin/venue-locations/[id]
GET /api/admin/hq/overview
GET PUT /api/admin/hq/location-context
GET PUT /api/admin/park-context
GET PATCH /api/admin/members/[id]
PUT /api/admin/members/[id]/venue-assignments
GET /api/admin/billing/usage
GET /api/admin/company-export
GET /api/auth/me park and HQ fields
login session park fields on /api/auth/login

Acceptance criteria for Step 1:

A registered company on Growth or Enterprise can create two active parks from /admin/venues within plan caps.
Soft-archive of one park frees venues quota, removes that park from assignments, and clears preferences pointing at it.
Enterprise HQ shows both parks in All locations and filters venue items when one park is selected.
A company-wide admin can park-lock a staff seat to park A only.
That park-locked seat signs into the same /admin session, sees only park A in the switcher, cannot select All, cannot create venues, cannot open blocked company HQ surfaces, cannot invite company-wide staff yet, and cannot read or mutate park B ticketing, bookings, POS, or park-stamped membership and waiver operations.
Company-wide preference All versus one park filters venue lists and park-stamped module lists without changing members roster or plan meters.
Public booking for park A uses that venue slug and does not sell park B inventory.
Demo plan still cannot create venues and still cannot use HQ as an unlocked app.
Switching park context or HQ location updates open module lists and HQ overview automatically in the same session and across tabs via the shared sync helpers, without full reload.
After archive or assignment change, silentRefresh or next /me no longer shows removed parks as assigned.
yarn smoke:venue-locations, yarn smoke:enterprise-hq, and yarn smoke:park-admin-scope pass, or you update and run them so they prove the behaviors above.
docs/enterprise-hq-controls.md no longer claims POS and Digital Waivers are unshipped if the code has them.

Implementation order inside this Step 1 run:

First finish the scan and list existing versus missing.
Then fix schema only if a real shipped relation or index is missing for multi-park isolation.
Then harden parkAdminScope, actorLocationScope, venueLocations, enterprise HQ, and park-context libs.
Then harden the admin APIs listed above and every module list or mutate path that must call them.
Then harden VenuesPage, HQ dashboard, switchers, users park assignment UI, session /me fields, admin nav, and guides.
Then sync export, billing meters, registered-companies ops badges, and plan limits.
Then update smokes and docs that would otherwise lie.
Then run the relevant typecheck or targeted tests you can run in this environment and fix failures you caused.

Do not leave TODOs for park isolation. Do not claim success if park-locked seats can still see sister-park stamped rows. Do not invent separate park logins or franchise invite paths in Step 1. When you are done, summarize what existed, what you changed, which files you touched, and which smokes or checks you ran. Explicitly state that Step 2 franchise work was not started.
```

---

## Step 1 follow-up prompt

```
You just finished Step 1 of multi-park locations plus franchise parks. Do not build Step 2. Do not build franchise park manager invites, park-local roster for park-locked managers, or franchise profile fields. Audit whether Step 1 was fully implemented or whether logic was skipped.

Re-scan the real code and prove each item with file paths. For every item say PASS, FAIL, or NOT APPLICABLE with a one-line reason. If anything is FAIL, fix it now in this same run, then re-check that item until it passes or you explain a hard blocker that already matches the Step 1 product rules.

Check all of the following:

The scan notes from Step 1 match the repo and you did not invent a second Organization, Membership, billing tenant, login realm, or /venue admin app.
VenueLocation create, edit, soft-archive, and reactivate work through /admin/venues and /api/admin/venue-locations with actor.orgId stamping and venues plan caps.
Demo venues cap remains 0 and Demo cannot use HQ as an unlocked company app.
Park-locked seats cannot create, archive, or reactivate venues.
Archive clears MembershipVenueAssignment for that venue, clears hqSelectedLocationId pointing at it, and keeps history without hard delete.
/admin/hq and GET /api/admin/hq/overview require enterprise entitlement, show real venue health and company-wide meters, filter park-stamped items when a park is selected, and never leak rollup data on soft-upsell.
GET PUT /api/admin/hq/location-context and GET PUT /api/admin/park-context both use Membership.hqSelectedLocationId correctly.
Park-locked seats cannot select All locations and are forced to an assigned park.
PUT /api/admin/members/[id]/venue-assignments replace-set works with users:park_assign, blocks platform_admin park assignment, and protects the last company-wide admin.
resolveEffectiveParkScope in parkAdminScope.ts is the SSOT used by actorLocationScope and module filters.
Ticketing, bookings, capacity resources, POS, waivers, guest memberships, and optional shop Product or Order venue stamps all honor park-lock and selected park filters without a bypass path.
assertNotParkLockedCompanyHq still blocks park-locked seats from company HQ surfaces including billing, company-profile, company payouts Connect, role-templates, and the existing company-wide staff invite path.
/api/auth/me, login session, and admin session sync expose enterpriseHqEnabled, parkLocked, assignedLocationIds, and selected park fields the header switchers need.
AdminHeader shows ParkContextSwitcher or HqVenueSwitcher correctly for Growth or park-locked versus Enterprise company-wide seats.
useParkContext, hqLocationContextSync, invalidateOrgSaasQueries, invalidateTicketingQueries, invalidateMembershipsQueries, invalidateBillingUsageQueries, VenuesPage refreshMetersAndHq, silentRefresh, staffGateCache clears, and invalidateUserSessions are wired so park preference, archive, and assignment changes update UI immediately without full reload.
Public /book/[venueSlug] and /api/public/booking/checkout, pay-now, and payment-link paths stay per-venue and do not cross-sell another park’s inventory.
Company category pages still bind checkout to each product locationId when multiple parks exist.
API_PERMISSIONS, ADMIN_PAGES, and admin nav are updated only where needed and have no orphan multi-park routes.
docs/enterprise-hq-controls.md matches shipped POS and Waivers reality and still documents park assignment versus HQ preference correctly.
yarn smoke:venue-locations, yarn smoke:enterprise-hq, and yarn smoke:park-admin-scope exist, cover the Step 1 acceptance behaviors, and you ran them or recorded why the environment blocked the run.
No Step 1 acceptance criterion was deferred as a TODO.
No Step 2 franchise invite or franchise profile code was started.

End with a short verdict line that is exactly one of these:

MULTI-PARK STEP 1 AUDIT: ALL PASS
MULTI-PARK STEP 1 AUDIT: FIXED DURING FOLLOW-UP
MULTI-PARK STEP 1 AUDIT: BLOCKED

If BLOCKED, list only the remaining FAIL items and the concrete blocker for each. Do not start Step 2 until the verdict is ALL PASS or FIXED DURING FOLLOW-UP.
```

---

## Step 2 prompt

```
You are implementing Step 2 only of multi-park locations plus franchise parks. Step 1 must already be complete and its follow-up must have passed. Build the franchise layer on top of VenueLocation so each park can operate as a franchise unit under the same Organization: franchise park profile, franchise park manager capability, park-local staff invites, park-local staff roster, forced park login context for franchise staff, permissions, UI, session fields, smokes, and docs. Keep company SaaS billing, company profile, Stripe subscription, plan meters, and Enterprise HQ company meters on the parent Organization. Do not invent a second Organization per park, a second login database, a second /venue admin app, or a per-park SaaS Stripe Customer. Do not build per-park Connect guest payouts in Step 2. Those are Step 3. Obey the shared real-time sync contract from the top of docs/multi-park-franchise-prompts.md. Do not stop halfway through Step 2. Do not ask for a shorter feature list. Everything required for Step 2 is in this prompt.

Before you change anything, scan what Step 1 left in place and write down what already exists versus what you must add for franchise. Read the real files. Reuse Membership, MembershipVenueAssignment, resolveEffectiveParkScope, venueLocations, members APIs, UsersPermissionsPage, AdminHeader switchers, /api/auth/me, authRedirect defaultPathForSession, and the Step 1 query invalidation helpers. Extend them. Do not fork a parallel staff system.

Product rules you must obey for this whole Step 2 run:

Franchise park means a VenueLocation marked and configured as a franchise unit under one company. One subscription per Organization still. VenueLocation is still never billed separately. Franchise staff remain Membership rows on that Organization with MembershipVenueAssignment park-lock. Franchise park managers may invite and manage only park-locked seats assigned inside the manager’s assigned parks. Franchise park managers must never grant companyWideView, platform_admin, or empty assignments that unlock company-wide authority. Franchise park managers must never edit billing, company profile, role templates company-wide, or sister parks. Company-wide admins remain able to create parks, assign franchise managers, and see the full company roster. Park-locked non-manager staff keep operating their park modules but do not gain invite power unless they are franchise managers. Demo lock, plan venue caps, Enterprise HQ entitlement, and DEFAULT_ORG rules from Step 1 still apply. Never trust client orgId, locationId, userId, membershipId, or franchise flags as authority. Postgres RLS stays deferred. Do not fake-implement unshipped modules.

Start the scan with these files and follow every import they use, including every file Step 1 touched:

docs/enterprise-hq-controls.md
docs/saas-module-extension.md
docs/multi-park-franchise-prompts.md
.cursor/rules/saas-venue-platform.mdc
package.json smoke script section
prisma/schema.prisma models Organization, VenueLocation, Membership, MembershipVenueAssignment, RoleTemplate
src/lib/parkAdminScope.ts
src/lib/actorLocationScope.ts
src/lib/assertNotParkLockedCompanyHq.ts
src/lib/venueLocations.ts
src/lib/memberAdmin.ts
src/lib/staffOrg.ts
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/lib/orgSession.ts
src/utils/authRedirect.ts defaultPathForSession
src/app/api/auth/me/route.ts
src/app/api/auth/login/route.ts
src/app/api/admin/venue-locations/route.ts
src/app/api/admin/venue-locations/[id]/route.ts
src/app/api/admin/members/route.ts
src/app/api/admin/members/[id]/route.ts
src/app/api/admin/members/[id]/venue-assignments/route.ts
src/app/api/admin/users/route.ts
src/app/api/admin/role-templates/route.ts and [id] if present
src/app/api/admin/park-context/route.ts
src/app/api/admin/hq/location-context/route.ts
src/app/(admin)/admin/users/page.tsx
src/app/(admin)/admin/permissions/page.tsx
src/app/(admin)/admin/venues/page.tsx
src/components/Protected/admin/pages/venues/VenuesPage.tsx
src/components/Protected/admin/pages/users/UsersPermissionsPage.tsx
src/components/Protected/admin/pages/users/VenueParkAssignmentField.tsx
src/components/Protected/admin/layout/AdminHeader.tsx
src/components/Protected/admin/components/AdminHowToGuideModal.tsx
src/store/authStore.ts
src/hooks/use-auth-handlers.ts
src/utils/orgSaasSessionSync.ts
src/utils/hqLocationContextSync.ts
src/utils/invalidateOrgSaasQueries.ts
scripts/smoke-venue-locations.mts
scripts/smoke-enterprise-hq.mts
scripts/smoke-park-admin-scope.mts

Also search for every reader and writer of assertNotParkLockedCompanyHq, members invite, users:manage_roles, users:park_assign, companyWideView, parkLocked, MembershipVenueAssignment, VenueLocation create/update, defaultPathForSession, and /api/auth/me session park fields so franchise changes stay in sync. POST /api/admin/users must not bypass franchise invite rules that POST /api/admin/members enforces.

What Step 2 must do when you are finished:

Add franchise configuration on VenueLocation without breaking existing parks. At minimum support a clear franchise flag or equivalent boolean on the venue, plus franchise-facing park profile fields the park can manage when entitled: public display name override if useful, support phone, support email, and notes or franchise code if the schema style fits. Company-wide admins can mark a park as a franchise unit when creating or editing on /admin/venues. Soft-archive still clears assignments and frees quota exactly as Step 1. Existing parks without the franchise flag keep working as normal multi-park locations. Franchise UI copy on venues and users screens must say franchise park, not a second company.

Define a franchise park manager capability on the Membership seat. Prefer extending existing Membership fields or a small explicit boolean such as franchiseParkManager, or an existing role preset only if one already cleanly means park manager without colliding with platform_admin. The manager seat must be park-locked to one or more parks. Company-wide admins or software owners with users:manage_roles grant or revoke franchiseParkManager and set the park assignments. A franchise park manager must never be platform_admin. Protect invariants so the last company-wide admin cannot be removed by franchise flows.

Open a controlled invite path for franchise park managers. Today park-locked seats are blocked from POST /api/admin/members by assertNotParkLockedCompanyHq. In Step 2, keep that block for normal park-locked staff, but allow franchise park managers to invite or reactivate seats only when every one of these server checks passes: the actor is park-locked and franchiseParkManager true, the invited seat is created as park-locked with MembershipVenueAssignment rows, every assigned locationId is inside the actor’s assignedLocationIds, companyWideView is forced false, rolePreset is never platform_admin, and the invite cannot clear park lock. Ignore client orgId and ignore any client attempt to assign parks outside the manager’s set. Stamp invitedById from the actor. Members plan meter and plan seat caps still apply through the existing planLimits path. Invite email and accept flows stay the existing company membership invite system. After accept, the new user signs into the same /admin app and is forced into their assigned park context by Step 1 park-lock rules plus Step 2 session landing.

Give franchise park managers a park-local staff roster. GET /api/admin/members for a franchise park manager must return only memberships that have an active assignment intersecting the manager’s parks. They must not see company-wide seats, sister-park-only seats, or unassigned own-records seats outside their parks. Company-wide admins still see the full company roster. Franchise managers may update or revoke only seats they can see, and only in ways that keep those seats park-locked inside the manager’s parks. They must not edit role templates company-wide, must not assign companyWideView, and must not manage venue-assignments for parks they do not own. Prefer extending the existing UsersPermissionsPage with scoped queries and disabled company-wide controls rather than inventing a second users app.

Forced park login context for franchise staff and franchise managers: when parkLocked is true, after sign-in and on /api/auth/me refresh, the effective selected park must already be an assigned park, never All. If the user bookmarks /admin/hq or company HQ routes, existing Step 1 gates must still deny them. Default landing after sign-in must go through src/utils/authRedirect.ts defaultPathForSession and use-auth-handlers so park-locked franchise staff land on a park ops surface such as /admin, never /admin/billing and never /admin/hq. AdminHeader must show the park switcher with only assigned franchise parks. Session sync fields must include franchiseParkManager and franchise-capable park ids or enough data for the UI to show franchise staff controls without trusting the client for authorization. After a company-wide admin grants or revokes franchiseParkManager or changes that seat’s park assignments, invalidate admin-members queries and run silentRefresh so invite controls and roster scope appear or disappear immediately without reload.

Franchise park profile management: franchise park managers may PATCH only their assigned franchise VenueLocation profile fields that Step 2 defines as park-manageable, such as support phone, support email, and display fields you added. They must not change orgId, must not create or archive venues, must not change plan-related fields, and must not edit sister parks. Company-wide admins retain full venue create, archive, reactivate, slug, and franchise flag control. Public booking slug behavior from Step 1 stays intact.

Keep company SaaS billing and company HQ company-wide. Franchise managers remain blocked from /admin/billing, company profile writes, the company-level OrganizationMarketplaceAccount Connect onboarding on /admin/payouts when that surface is company-wide only, role template company admin, and Enterprise HQ rollup APIs unless they are separately company-wide, which a franchise manager must not be. Plan meters including members and venues stay company-wide. Enterprise HQ continues to roll up franchise parks as VenueLocation rows. Do not build per-park Connect accounts or park payout destination routing in Step 2. Those are Step 3.

Sync every related surface. Update API_PERMISSIONS if new permission keys are required. Prefer reusing users:invite or users:manage_roles with server-side franchise scope checks rather than inventing many new permission strings, but if a dedicated permission is cleaner and registered everywhere, that is allowed. Update admin nav labels or guide copy so venues explain franchise parks. Update docs/enterprise-hq-controls.md with a Franchise parks section that states: franchise is VenueLocation under one Organization, managers invite park-locked staff only, company SaaS billing stays company-wide, park-lock remains the isolation boundary, and per-park Connect guest payouts are Step 3. Update AdminHowToGuideModal accordingly. Add scripts/smoke-franchise-parks.mts and package.json script smoke:franchise-parks covering: company admin marks park A franchise and assigns a franchise manager, manager invites staff locked to park A only, invited staff cannot access park B, manager cannot invite company-wide seats, manager roster hides sister-park users, manager cannot open billing, archive still clears franchise assignments, and invite or grant changes refresh roster and session flags without reload.

Required paths and APIs that must work when Step 2 is finished:

/admin/venues franchise flag and franchise profile fields
/admin/users park-local roster for franchise managers
/admin/permissions must not become a bypass users app
sign-in to /admin with forced park context for park-locked franchise staff via defaultPathForSession
POST /api/admin/members franchise manager invite path
POST /api/admin/users must obey the same franchise invite constraints or stay company-wide only
GET /api/admin/members scoped roster for franchise managers
GET PATCH /api/admin/members/[id] scoped update or revoke for franchise managers
PUT /api/admin/members/[id]/venue-assignments still company-wide only for cross-park assignment authority, or tightly scoped if you allow managers to assign only within their parks
PATCH /api/admin/venue-locations/[id] park-manageable franchise profile fields for managers
GET /api/auth/me includes franchiseParkManager and park scope fields
existing park-context and HQ location-context APIs remain correct

Acceptance criteria for Step 2:

Company-wide admin creates park A and park B, marks both as franchise parks, and assigns user M as franchiseParkManager on park A only.
M can invite user S and S is created park-locked to park A only.
S signs into /admin, is forced into park A, can operate park A resources allowed by permissions, and cannot see park B ops or park B users.
M sees S on the park-local roster and does not see company-wide-only admins or park B-only staff.
M cannot invite a company-wide seat, cannot set companyWideView true, cannot assign park B, cannot open billing or company profile, and cannot create or archive venues.
Company-wide admin still sees all members and all parks, and billing still meters members and venues company-wide.
Enterprise HQ still rolls up park A and park B as venues under the same company.
Soft-archive of park A clears assignments and removes franchise staff access to park A.
Step 1 smokes still pass. New or extended franchise smoke passes or you record the environment blocker after implementing it.
Docs and guides describe franchise parks accurately. They may mention that per-park guest payouts are Step 3. They must not promise a separate park SaaS subscription or a separate park company tenant.

Implementation order inside this Step 2 run:

First scan Step 1 outputs and list franchise gaps.
Then add only the schema fields needed for franchise flag, franchise profile, and franchiseParkManager.
Then extend parkAdminScope or a small franchise helper for manager checks.
Then open the controlled members invite and roster scope paths.
Then allow franchise profile PATCH for managers on assigned franchise venues.
Then update UsersPermissionsPage, VenuesPage, AdminHeader, session /me, and guides.
Then sync permissions, docs, package scripts, and smokes.
Then run typecheck or targeted tests you can run and fix failures you caused.
Then verify Step 1 isolation behaviors still hold.

Do not leave TODOs for franchise staff isolation. Do not claim success if a franchise manager can invite company-wide users or assign sister parks. Do not create child Organizations. When you are done, summarize what existed, what you changed, which files you touched, and which smokes or checks you ran.
```

---

## Step 2 follow-up prompt

```
You just finished Step 2 of multi-park locations plus franchise parks. Do not build new product epics. Audit whether Step 2 was fully implemented and whether Step 1 stayed intact.

Re-scan the real code and prove each item with file paths. For every item say PASS, FAIL, or NOT APPLICABLE with a one-line reason. If anything is FAIL, fix it now in this same run, then re-check that item until it passes or you explain a hard blocker that already matches the Step 2 product rules.

Check all of the following:

No second Organization, second billing tenant, second login database, or /venue admin app was created.
VenueLocation has a franchise unit marker and franchise profile fields that company-wide admins can set from /admin/venues.
Membership has a franchise park manager capability that requires park-lock and forbids platform_admin.
Franchise park managers can invite staff only into their assigned parks with companyWideView forced false.
Normal park-locked non-manager seats still cannot use the company-wide invite path.
GET members roster for franchise managers returns only seats intersecting their parks.
Franchise managers cannot grant companyWideView, cannot assign sister parks, cannot manage billing or company profile, and cannot create or archive venues.
Invited franchise staff sign into /admin with forced park context via defaultPathForSession and cannot operate sister parks.
/api/auth/me exposes franchiseParkManager and the park scope fields the UI needs.
PATCH venue profile by franchise managers is limited to assigned franchise parks and park-manageable fields only.
Grant or revoke franchiseParkManager and park-local invite or roster changes update UsersPermissionsPage and session flags immediately through query invalidation and silentRefresh without full reload.
Company-wide admin roster, venue create or archive, billing meters, and Enterprise HQ rollups still work across all franchise parks.
Archive of a franchise park still clears assignments and frees venues quota.
Ticketing, memberships, waivers, POS, and other park-stamped modules from Step 1 still honor park-lock with no franchise bypass.
POST /api/admin/users cannot bypass franchise invite constraints.
API_PERMISSIONS, ADMIN_PAGES, admin nav, guides, and docs/enterprise-hq-controls.md describe franchise parks accurately and do not implement per-park Connect yet.
yarn smoke:venue-locations, yarn smoke:enterprise-hq, and yarn smoke:park-admin-scope still pass or were updated without weakening isolation.
yarn smoke:franchise-parks exists and covers manager invite, roster scope, sister-park deny, company SaaS billing deny, archive cleanup, and immediate session or roster sync, and you ran it or recorded the environment blocker.
No Step 2 acceptance criterion was deferred as a TODO.
No Step 3 per-park Connect payout code was started.

End with a short verdict line that is exactly one of these:

MULTI-PARK FRANCHISE STEP 2 AUDIT: ALL PASS
MULTI-PARK FRANCHISE STEP 2 AUDIT: FIXED DURING FOLLOW-UP
MULTI-PARK FRANCHISE STEP 2 AUDIT: BLOCKED

If BLOCKED, list only the remaining FAIL items and the concrete blocker for each. Do not start Step 3 until the verdict is ALL PASS or FIXED DURING FOLLOW-UP.
```

---

## Step 3 prompt

```
You are implementing Step 3 only of multi-park locations plus franchise parks. Step 1 and Step 2 must already be complete and their follow-ups must have passed. Build per-franchise-park guest money routing and accounting so each franchise VenueLocation can onboard its own Stripe Connect Express payout account and receive guest payments for that park’s booking plans, marketplace packages, membership plans, and any other guest checkout this app already charges online for that park, into that park’s Connect account instead of a single shared company merchant account. Keep company SaaS billing on /admin/billing unchanged as World A. Keep FECSYNC platform fees. Obey the shared real-time sync contract from the top of docs/multi-park-franchise-prompts.md so Connect sync, charge-ready flips, and park ledger updates appear in admin UI immediately without full reload. Do not invent a second Organization per park, a second SaaS Stripe Customer per park, a second login system, or DIY card-to-bank wiring from CompanyProfile bank fields. Do not stop halfway through Step 3. Do not ask for a shorter feature list. Everything required for Step 3 is in this prompt.

Before you change anything, scan what Step 1 and Step 2 left in place and scan the existing marketplace Connect money path. Write down what already exists versus what you must add. Read the real files. Reuse OrganizationMarketplaceAccount patterns, fee helpers, webhook branching, park scope, franchiseParkManager, and venue locationId stamps. Extend them. Do not invent a second unrelated payments stack.

Product rules you must obey for this whole Step 3 run:

World A company SaaS subscription stays on Organization stripeCustomerId / stripeSubscriptionId and metadata type company_subscription. Never route franchise guest money into SaaS columns. Never let Connect account.updated mutate subscription fields.

World B marketplace Connect already exists as OrganizationMarketplaceAccount one-to-one with Organization, BookingPackage with optional locationId, MarketplaceBooking ledger, MarketplacePaymentEvent, MarketplaceRefund, destination charges, and /admin/payouts. Step 3 adds park-level Connect accounts for franchise parks and routes guest charges for a park to that park’s connected account when the park is charge-ready.

World C venue_booking / order / tailoring comments in src/lib/stripe.ts currently settle on the platform account. For franchise parks that are park charge-ready, guest Online Ticketing public checkout and company category booking checkout that create venue_booking for a park-stamped product must settle as Connect destination charges to that park’s connected account, with platform application fee, and must stamp locationId and connectedAccountId on the payment or booking payment records this app already uses. Non-franchise parks, or franchise parks not yet park charge-ready, must keep a documented fail-closed or org-fallback policy that you implement consistently and document in docs. Prefer fail-closed for franchise parks that require park payouts once marked franchise and published for online sales. Org-level OrganizationMarketplaceAccount remains the fallback for non-franchise parks and for marketplace packages with null locationId when company Connect is charge-ready.

Never trust client orgId, locationId, connectedAccountId, fee, or amount as settlement authority. Stamp orgId and locationId from the server-side catalog row. Compute platform fee server-side with existing marketplace fee helpers or a shared helper. Idempotent webhooks only. Soft-held, suspended, unapproved, or Demo-locked companies cannot accept live guest charges. DEFAULT_ORG must never be a Connect merchant for tenant bookings. Park-locked franchise managers may onboard and manage Connect only for their assigned franchise parks. Company-wide admins may view all park payout readiness and may manage company-level OrganizationMarketplaceAccount. Franchise managers remain blocked from /admin/billing SaaS subscription management. Postgres RLS stays deferred. Do not fake-implement unshipped modules.

Start the scan with these files and follow every import they use:

docs/marketplace-payouts-implementation.md
docs/saas-module-extension.md
docs/enterprise-hq-controls.md
docs/multi-park-franchise-prompts.md
.cursor/rules/saas-venue-platform.mdc
package.json scripts smoke:marketplace-payouts, smoke:franchise-parks, and the new smoke:franchise-park-payouts you will add
prisma/schema.prisma models Organization, OrganizationMarketplaceAccount, VenueLocation, BookingPackage, MarketplaceBooking, MarketplacePaymentEvent, MarketplaceRefund, Booking, BookingPayment, AdmissionProduct, MembershipPlan, GuestMembership, MembershipPaymentAttempt, PosDevice, PosSale, PosTill, PosTab
src/lib/stripe.ts World A / B / C comments and createCheckoutSession
src/lib/marketplace/index.ts
src/lib/marketplace/account.ts
src/lib/marketplace/assertChargeReady.ts
src/lib/marketplace/fees.ts
src/lib/marketplace/bookingCheckout.ts
src/lib/marketplace/webhook.ts
src/lib/marketplace/refunds.ts
src/lib/marketplace/packages.ts
src/lib/marketplace/provider.ts
src/lib/ticketing/publicBooking.ts
src/lib/ticketing/payments.ts
src/lib/ticketing/refunds.ts
src/lib/publicCategory/companyCheckout.ts
src/lib/memberships/stripeGuest.ts
src/lib/memberships/webhookGuest.ts
src/lib/memberships/billingEngine.ts
src/lib/pos/http.ts
src/lib/pos/saleEngine.ts
src/lib/pos/tabs.ts
src/lib/pos/scope.ts
src/lib/parkAdminScope.ts
src/lib/assertNotParkLockedCompanyHq.ts
src/lib/venueLocations.ts
src/lib/hqOverview.ts
src/lib/companyExport.ts
src/lib/auth/permissions.ts
src/lib/adminNav.ts
src/app/api/webhooks/stripe/route.ts
src/app/api/admin/marketplace/account/route.ts
src/app/api/admin/marketplace/connect/onboard/route.ts
src/app/api/admin/marketplace/connect/refresh/route.ts
src/app/api/admin/marketplace/connect/sync/route.ts
src/app/api/admin/marketplace/connect/login-link/route.ts
src/app/api/admin/marketplace/bookings/route.ts
src/app/api/admin/marketplace/bookings/[id]/refund/route.ts
src/app/api/admin/company-export/route.ts
src/app/api/public/marketplace/checkout-session/[sessionId]/route.ts
src/app/api/public/booking/checkout/route.ts
src/app/api/public/booking/pay-now/route.ts
src/app/api/public/booking/pay/[paymentLinkToken]/route.ts
src/app/api/public/booking/holds/route.ts
src/app/api/public/category/[orgSlug]/[categorySlug]/checkout/route.ts
src/app/api/public/booking-packages checkout route or equivalent under src/app/api/public for BookingPackage checkout
src/app/(admin)/admin/payouts/page.tsx
src/components/Protected/admin/pages/payouts/PayoutsPage.tsx
src/components/Protected/admin/pages/components/dashboard/MarketplacePayoutsNudge.tsx
src/components/Protected/admin/pages/booking-packages/BookingPackagesPage.tsx
src/components/Protected/admin/pages/bookings/TakePaymentModal.tsx
src/components/Protected/admin/pages/venues/VenuesPage.tsx
src/components/Protected/admin/pages/hq/HqDashboardPage.tsx
src/components/Protected/admin/layout/AdminSidebar.tsx
src/components/Protected/admin/components/AdminHowToGuideModal.tsx
src/utils/invalidateOrgSaasQueries.ts
src/utils/orgSaasSessionSync.ts
src/store/authStore.ts
.env.example marketplace Connect env keys
scripts/smoke-marketplace-payouts.mts
scripts/smoke-franchise-parks.mts from Step 2

Also search the whole repo for OrganizationMarketplaceAccount, assertOrgMarketplaceChargeReady, connectedAccountId, transfer_data, marketplace_booking, venue_booking, guest_membership_subscription, pos_membership_subscription, application_fee_amount, /admin/payouts, TakePaymentModal, payment-link, and every checkout create path that charges a guest for a park-stamped catalog row. Update every path that must route to park Connect or must stay on org Connect or platform by the policy below.

What Step 3 must do when you are finished:

Add a park merchant account model for franchise parks. Name it clearly, for example VenueLocationMarketplaceAccount, with required orgId, required locationId, unique locationId, unique stripeConnectedAccountId when set, the same readiness flags and onboarding fields that OrganizationMarketplaceAccount already uses where they apply, provider stripe_connect for v1, optional platformFeeBpsOverride only if ops needs park overrides, and timestamps. FK location to VenueLocation and org to Organization. Only franchise parks may create or complete park Connect onboarding. Soft-archive of a venue must disable new park charges and clear or disable onboarding in a fail-closed way without deleting ledger history. Do not put full bank account numbers or PAN in the database. Display last4 and bank name only when Stripe provides them.

Add server helpers that mirror org charge-ready for parks, for example assertParkMarketplaceChargeReady(orgId, locationId) and resolveGuestPayoutDestination({ orgId, locationId }). Resolution order must be explicit: if locationId is a franchise park and park account is charge-ready, destination is the park connected account and settlementScope is park. Else if locationId is null or park is not franchise, use OrganizationMarketplaceAccount when org is charge-ready and settlementScope is org. Else if locationId is franchise but park is not charge-ready, fail closed for public online checkout for that park’s sellable catalog with a clear error that park payouts onboarding is required. Never let a sister park’s connected account receive another park’s charge. Never let the client pick the destination account.

Extend Connect onboarding APIs for parks without breaking company onboarding. Keep existing company routes under /api/admin/marketplace/connect/* for OrganizationMarketplaceAccount and company-wide admins. Add park-scoped routes such as:

GET /api/admin/marketplace/park-accounts
GET /api/admin/marketplace/park-accounts/[locationId]
POST /api/admin/marketplace/park-accounts/[locationId]/connect/onboard
POST /api/admin/marketplace/park-accounts/[locationId]/connect/refresh
POST /api/admin/marketplace/park-accounts/[locationId]/connect/sync
POST /api/admin/marketplace/park-accounts/[locationId]/connect/login-link

Authorize with requirePermissionFresh and park scope. Franchise park managers may call these only for assigned franchise locationIds. Company-wide admins and software owners may call them for any franchise park in actor.orgId. Park-locked non-managers remain denied. Return and refresh URLs must return to a park payouts admin surface, not /admin/billing. Reuse Stripe Connect Express account link patterns from src/lib/marketplace/account.ts. Webhook account.updated must update the matching park account row by stripeConnectedAccountId without touching SaaS subscription columns and without writing the wrong org account row.

Route guest checkout money correctly for every live guest charge path that sells park-stamped catalog. Treat these as shipped paths that must be updated or explicitly honesty-gated, not optional:

Marketplace BookingPackage checkout through src/lib/marketplace/bookingCheckout.ts and the public booking-packages checkout API when package.locationId is set must use resolveGuestPayoutDestination and destination charges to the park account when settlementScope is park. MarketplaceBooking already has locationId and connectedAccountId snapshots. Keep idempotency, fees, refunds, and disputes working for park destinations. Packages with null locationId keep using org Connect when charge-ready. BookingPackagesPage publish gates must become park-aware for location-stamped packages instead of only org chargeReady.

Online Ticketing guest paths src/app/api/public/booking/checkout/route.ts, pay-now, pay/[paymentLinkToken], holds that lead to Checkout, src/lib/ticketing/publicBooking.ts, src/lib/ticketing/payments.ts, company category src/app/api/public/category/[orgSlug]/[categorySlug]/checkout/route.ts plus src/lib/publicCategory/companyCheckout.ts, and staff TakePaymentModal plus admin booking payment-link or payments routes that create metadata type venue_booking for an AdmissionProduct or Booking bound to a franchise park must use Connect destination charges to that park account when park charge-ready, including application_fee_amount from the shared fee helper. Extend createCheckoutSession or add a marketplace-aware checkout helper so venue_booking can take an optional connectedAccountId and application fee without converting non-franchise platform flows incorrectly. BookingPayment or equivalent ledger rows must store enough to refund against the correct Connect account. Do not double-settle.

Guest membership card billing is shipped. MembershipPaymentAttempt, src/lib/memberships/stripeGuest.ts, webhookGuest.ts, billingEngine.ts, and webhook metadata guest_membership_subscription must stay in sync. When a MembershipPlan is park-stamped to a franchise park, guest membership card money must use resolveGuestPayoutDestination for that locationId when park charge-ready, or fail closed with a clear park payouts onboarding error. Do not invent a second membership engine. Do not leave guest membership subscriptions silently on the platform account for franchise park plans after Step 3.

POS Stripe PaymentIntents or Checkout in src/lib/pos/http.ts, saleEngine.ts, and tabs.ts, plus webhook metadata pos_membership_subscription, must use the same resolveGuestPayoutDestination for the sale locationId when those paths already create live Stripe charges. If a specific POS tender is cash or offline only, keep honesty in UI and still keep location stamps. Do not fake hardware payouts.

Webhook branching in src/app/api/webhooks/stripe/route.ts must keep all of these in sync and isolated: checkout.session.completed for company_subscription, marketplace_booking, venue_booking, and pos_membership_subscription; checkout.session.expired; payment_intent.succeeded, payment_failed, and canceled; account.updated for both OrganizationMarketplaceAccount and VenueLocationMarketplaceAccount by stripeConnectedAccountId; charge.refunded and charge.refund.updated; charge.dispute.created; customer.subscription.created, updated, and deleted for SaaS versus guest_membership_subscription; invoice.paid and invoice.payment_failed; setup_intent.succeeded for guest memberships. Park Connect account.updated must never write SaaS subscription columns. Guest membership and POS metadata must not be double-settled or routed to the wrong Connect account.

Build park finance visibility for franchise managers and company HQ. Extend src/components/Protected/admin/pages/payouts/PayoutsPage.tsx and /admin/payouts so company-wide admins see company Connect status plus a list of franchise park Connect statuses. Add a franchise park payouts experience such as /admin/payouts?locationId=... or /admin/venues park payouts deep link or /admin/payouts/parks/[locationId] that matches admin nav patterns. Franchise managers see only their parks’ onboarding status, bank last4, charge-ready flags, and recent park-scoped marketplace bookings or booking payments for their parks. They must not see sister-park payout details or company SaaS invoices. MarketplacePayoutsNudge on the dashboard must understand park versus org charge-ready for franchise managers. Enterprise HQ overview should show honest park payout readiness counts or badges for franchise parks without leaking Connect account ids. Company export via /api/admin/company-export may include redacted park payout readiness and must omit raw Stripe secrets.

Immediate automatic finance UI sync is required. After park or org Connect onboard, refresh, or sync: invalidate marketplace account queries, park-accounts queries, HQ overview readiness, venues payout badges, PayoutsPage local account state, and MarketplacePayoutsNudge without full reload. After webhook-driven readiness changes, the next sync or silentRefresh must show charge-ready immediately. After a successful guest checkout confirmation, existing ticketing or marketplace invalidation helpers must still run so franchise managers see the new park ledger row without reload.

Refunds and disputes for park destination charges must target the same connected account that took the charge. Staff refund APIs must assert the actor can access that locationId. Platform fee behavior on refunds must follow the existing marketplace refund rules.

Keep publish and charge gates consistent. A franchise park’s public online sell paths that require card payment must call park charge-ready before creating Checkout. Admin publish toggles should surface a clear not-ready reason when Connect onboarding is incomplete. Soft-hold and suspend still block charges company-wide. Archiving a franchise park blocks new charges immediately.

Sync permissions, nav, guides, env, and docs. Register every new API in API_PERMISSIONS. Register new admin pages in ADMIN_PAGES and admin nav. Update AdminHowToGuideModal and docs/enterprise-hq-controls.md with a Franchise park payouts section: guest money to park Connect, SaaS billing remains company-wide, org Connect remains for non-franchise or null-location catalog, park managers onboard only assigned parks. Update docs/marketplace-payouts-implementation.md with a park accounts addendum so agents do not invent a second merchant table later. Update .env.example only if new env keys are truly required. Prefer reusing existing STRIPE_CONNECT_* and MARKETPLACE_PLATFORM_FEE_* keys. Add scripts/smoke-franchise-park-payouts.mts and package.json script smoke:franchise-park-payouts. Keep yarn smoke:marketplace-payouts passing or extended. The new smoke must prove: park A and park B franchise accounts are distinct, checkout for park A catalog snapshots park A connectedAccountId, park B manager cannot onboard park A, franchise manager cannot open SaaS billing, company admin can see both park readiness, archive of park A blocks new park A charges, webhook account.updated updates the park row not SaaS columns, Connect sync refreshes payout UI without reload. Extend yarn smoke:franchise-parks if needed so it still passes.

Required paths and APIs that must work when Step 3 is finished:

/admin/payouts company plus franchise park list via PayoutsPage
/admin/payouts park detail surface for a locationId or equivalent deep link from /admin/venues
/admin/billing still company SaaS only and still blocked for franchise managers
/admin/hq park payout readiness honesty for Enterprise
/book/[venueSlug] guest checkout destination to park Connect when franchise park charge-ready
/api/public/booking/checkout, pay-now, and pay/[paymentLinkToken] destination routing
company category /api/public/category/[orgSlug]/[categorySlug]/checkout destination routing
marketplace public package checkout destination routing when package.locationId is franchise park charge-ready
staff TakePaymentModal and booking payment-link destination routing for franchise park bookings
guest membership Stripe paths for park-stamped plans
POS live Stripe charge paths for location-stamped sales or explicit honesty UI
GET /api/admin/marketplace/park-accounts
GET /api/admin/marketplace/park-accounts/[locationId]
POST /api/admin/marketplace/park-accounts/[locationId]/connect/onboard
POST /api/admin/marketplace/park-accounts/[locationId]/connect/refresh
POST /api/admin/marketplace/park-accounts/[locationId]/connect/sync
POST /api/admin/marketplace/park-accounts/[locationId]/connect/login-link
existing company /api/admin/marketplace/connect/* routes still work for OrganizationMarketplaceAccount
existing marketplace booking and refund admin APIs location-scoped for park-locked actors
GET /api/admin/company-export redacted park payout readiness
Stripe webhook route handles park Connect account.updated and park destination charge settlement without touching company_subscription fields
GET /api/auth/me exposes only safe flags the UI needs for park payouts entry, never secrets

Acceptance criteria for Step 3:

Company-wide admin has franchise park A and park B from Step 2.
Franchise manager M for park A completes park Connect onboarding for park A only.
Park A booking product or marketplace package paid by a guest creates a Checkout or PaymentIntent with transfer destination equal to park A’s connected account and a server-calculated platform fee.
The ledger row stores orgId, locationId park A, and connectedAccountId park A.
A guest purchase for park B never lands in park A’s connected account.
Public booking checkout, pay-now, payment-link, company category checkout, marketplace package checkout, staff take-payment, park-stamped guest membership card billing, and any live POS Stripe charge for park A all use park A’s destination when park A is charge-ready, or fail closed with a clear onboarding error.
M cannot onboard or view park B payouts and cannot open /admin/billing SaaS management.
Company-wide admin can see both parks’ payout readiness and can still manage company org Connect for non-franchise catalog.
Franchise park A that is not charge-ready cannot take new public card checkout for its online catalog. Error is clear.
Soft-archive of park A blocks new park A charges and does not delete historical payment rows.
Refunds for a park A charge work against park A’s Connect account and are denied to sister-park staff.
Webhooks never write Connect readiness into SaaS subscription columns and cover marketplace_booking, venue_booking, guest_membership_subscription, pos_membership_subscription, and account.updated for park rows.
Connect sync and charge-ready flips update PayoutsPage, MarketplacePayoutsNudge, HQ readiness, and venues badges immediately without full reload. Successful guest checkout makes the park ledger row visible to the franchise manager without reload.
Step 1 and Step 2 isolation and franchise staff behaviors still pass.
yarn smoke:marketplace-payouts still passes or is extended. yarn smoke:franchise-park-payouts passes or you record the environment blocker after implementing it.
Docs state clearly that SaaS billing is company-wide and guest franchise revenue is park Connect.

Implementation order inside this Step 3 run:

First scan marketplace Connect, ticketing checkout, membership checkout, POS card honesty, franchise flags, and park scope.
Then add VenueLocationMarketplaceAccount or equivalent schema and migrate.
Then add assertParkMarketplaceChargeReady and resolveGuestPayoutDestination.
Then add park Connect onboard, refresh, sync, login-link APIs and webhook account mapping.
Then route marketplace_booking, venue_booking, and any real membership or POS Stripe charge paths through the resolver.
Then build /admin/payouts park UI, venues deep links, HQ readiness, export redaction, and franchise manager access.
Then sync refunds, publish gates, archive disable, permissions, nav, docs, env notes, and smokes.
Then run typecheck or targeted tests you can run and fix failures you caused.
Then verify Step 1 and Step 2 still hold and that /admin/billing SaaS is untouched.

Do not leave TODOs for park destination routing on live guest card checkouts that already exist. Do not claim success if farm-out still always uses OrganizationMarketplaceAccount for franchise park catalog. Do not create child Organizations or per-park SaaS subscriptions. When you are done, summarize what existed, what you changed, which files you touched, which checkout paths now use park Connect, which paths intentionally remain org or platform, and which smokes or checks you ran.
```

---

## Step 3 follow-up prompt

```
You just finished Step 3 of multi-park locations plus franchise parks. Do not build a new unrelated epic. Audit whether Step 3 was fully implemented and whether Step 1 and Step 2 stayed intact.

Re-scan the real code and prove each item with file paths. For every item say PASS, FAIL, or NOT APPLICABLE with a one-line reason. If anything is FAIL, fix it now in this same run, then re-check that item until it passes or you explain a hard blocker that already matches the Step 3 product rules.

Check all of the following:

No second Organization and no per-park SaaS Stripe Customer or company_subscription routing was added.
VenueLocationMarketplaceAccount or the equivalent park merchant model exists with orgId, locationId, Connect readiness fields, and uniqueness on locationId.
resolveGuestPayoutDestination or equivalent is the SSOT for choosing park versus org Connect destination and never trusts client connectedAccountId.
assertParkMarketplaceChargeReady fails closed for incomplete franchise park onboarding.
Company OrganizationMarketplaceAccount onboarding routes still work for company-wide admins.
Park Connect onboard, refresh, sync, and login-link APIs exist and allow franchise managers only for assigned franchise parks.
Marketplace package checkout with locationId settles to the park connected account when park charge-ready and snapshots locationId plus connectedAccountId.
venue_booking paths including /api/public/booking/checkout, pay-now, payment-link, company-category checkout, and staff TakePaymentModal or payment-link for franchise park products settle to the park connected account when park charge-ready, with platform application fee, without breaking non-franchise flows.
Shipped guest membership Stripe paths MembershipPaymentAttempt, stripeGuest, webhookGuest, billingEngine, and guest_membership_subscription use the same resolver for park-stamped franchise plans or fail closed. Live POS Stripe paths in pos/http, saleEngine, tabs, and pos_membership_subscription use the same resolver or have explicit honesty UI with no fake hardware payouts.
/admin/payouts and PayoutsPage show company status for company-wide admins and park status for franchise managers scoped to their parks. MarketplacePayoutsNudge is park-aware.
Franchise managers still cannot manage /admin/billing SaaS subscription.
Enterprise HQ or payouts overview shows honest park readiness without leaking secrets.
Refunds and disputes for park destination charges target the same park connected account and honor park scope.
Archive or disable of a franchise park blocks new park charges and keeps ledger history.
Stripe webhooks update park Connect rows by stripeConnectedAccountId, cover the metadata types listed in Step 3, and never mutate SaaS subscription columns for Connect account events.
Connect onboard or sync and guest checkout settlement invalidate payout, HQ, venues, and ledger queries so UI updates immediately without full reload.
API_PERMISSIONS, ADMIN_PAGES, admin nav, guides, docs/enterprise-hq-controls.md, and docs/marketplace-payouts-implementation.md describe park payouts accurately.
yarn smoke:marketplace-payouts still passes or was extended. yarn smoke:franchise-park-payouts exists and covers distinct park destinations, sister-park deny, billing deny, archive block, webhook SaaS separation, and UI sync after Connect sync, and you ran it or recorded the environment blocker.
Step 1 park isolation and Step 2 franchise staff invite or roster behaviors still pass.
No Step 3 acceptance criterion was deferred as a TODO.

End with a short verdict line that is exactly one of these:

MULTI-PARK FRANCHISE STEP 3 AUDIT: ALL PASS
MULTI-PARK FRANCHISE STEP 3 AUDIT: FIXED DURING FOLLOW-UP
MULTI-PARK FRANCHISE STEP 3 AUDIT: BLOCKED

If BLOCKED, list only the remaining FAIL items and the concrete blocker for each.
```

---

## How to use

Copy the entire Step 1 prompt fenced block into a new Cursor chat and send it. When that agent finishes, copy the entire Step 1 follow-up prompt fenced block and send it. Only if the Step 1 follow-up verdict is ALL PASS or FIXED DURING FOLLOW-UP, copy the entire Step 2 prompt fenced block and send it. When Step 2 finishes, copy the entire Step 2 follow-up prompt fenced block and send it. Only if the Step 2 follow-up verdict is ALL PASS or FIXED DURING FOLLOW-UP, copy the entire Step 3 prompt fenced block and send it. When Step 3 finishes, copy the entire Step 3 follow-up prompt fenced block and send it. Keep all three follow-up verdicts.

If a follow-up is BLOCKED, fix the listed items first. Re-paste that same step’s follow-up after fixes. Do not jump ahead while a prior step is blocked.
