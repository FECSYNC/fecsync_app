This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Product thesis

**Primary product:** multi-tenant **venue / event / attraction operations SaaS** (VenueFlow-style control plane) — companies run one or many parks/venues. **Online Booking / Ticketing (Phases 1–5)** and **guest Memberships (Phases 1–5)** are production-ready for entitled packages. **Digital Waivers Phases 1–5** (templates, guest signing, desk verify, import/export, expiry reminders, booking confirmation links, party waiver list, production smokes) are live on Growth+. **POS terminal Steps 1–2** are live on Growth+. Further modules (check-in scanner product, ticket-purchase kiosk, Access Control, Guest Surveys, Loyalty, Dynamic Pricing, Reporting) attach as their remaining epics ship. Postgres RLS is still deferred. Legal wording is the operator’s, not a compliance certificate. SMS needs Twilio.

**Secondary surface:** the public Harewa shop (`DEFAULT_ORG` / `isDefault`) and inherited tailor/customer flows. Shop is never locked when a tenant expires. Do not merge customer (`/profile`), tailor (`/tailor/*`), and company admin (`/admin/*`) surfaces.

## Tenant model

| Concept | Meaning |
|---|---|
| **Organization** | Paying / registered **company workspace** (tenant HQ). One SaaS subscription per org (`starter` \| `growth` \| `enterprise`). |
| **VenueLocation** | Park / venue / site under a company (multi-park). Plan resource `venues`. **Not** auto-created on register/approve — operators add locations in `/admin/venues` after Billing entitlement. |
| **Membership** | Staff seat on an Organization. |
| **DEFAULT_ORG** | Public storefront catalog host — uncapped; never suspended by company billing. |

**Registration duality**

| Path | Creates |
|---|---|
| `/signup` + Google | End-user / guest (`client`). **No** Organization, approval, or SaaS plan. |
| `/register-company` (+ optional `?plan=starter\|growth\|enterprise` hint) | Pending Organization + `platform_admin` → `/company-pending` → Harewa approve → Profile → Billing → Limits → Expiry. Plan query is a **hint only** (no charge until Billing). |

Landing “Choose Starter/Growth” must link to `/register-company?plan=…`, never `/signup`.

**Plan SSOT:** `src/lib/subscriptionPlans.ts`. Stripe Price env keys: `STRIPE_PRICE_*_MONTHLY` (1 month) and optional `STRIPE_PRICE_*_{N}M` for multi-month. Display amounts ($199 / $449 / custom) are UI SSOT; Checkout term total = monthly × duration (1|2|3|6|12|24|60 months) via Price ID or inline `price_data`.

### Sync contract (Steps 2–4)

- **Step 2:** billing/approve/expire use plan ids `starter` \| `growth` \| `enterprise` only; clear/set Organization subscription fields; VenueLocation is never billed separately; do not change Stripe webhook namespace `company_subscription`. Shared reconcile: `src/lib/reconcileCompanySubscriptions.ts` (`runReconcileCompanySubscriptions`) for CLI + Step 3 cron.
- **Step 3:** notices/cron use `Organization.subscriptionEndsAt` + notice watermarks; do not email `/signup` users as tenants; cron calls `runReconcileCompanySubscriptions()` / `runCompanySubscriptionReminders()` / `expireOverdueMembershipInvites()` (no parallel expire logic). Step 4 must not break notice watermarks; export includes venues; future modules use the same entitled gate.
- **Step 4:** isolation/export/`VenueLocation`; Postgres RLS deferred (`docs/postgres-rls.md`); future modules follow [`docs/saas-module-extension.md`](./docs/saas-module-extension.md) (`orgId` + optional `locationId`). **Control plane complete** — see “Company SaaS hardening complete” below.

### Module entitlement contract (future venue features)

Future product modules (Access Control, Guest Surveys, Loyalty, Dynamic Pricing, Reporting, check-in scanner product, ticket-purchase kiosk) **must** hang off this same company SaaS control plane. Online Ticketing, guest Memberships, Digital Waivers Phases 1–5, and POS terminal Steps 1–2 already do:

1. **Tenant gate:** creates/mutations call `assertCompanyBillingEntitled(orgId)` and/or `assertWithinPlanLimit(orgId, resource)` and, for shipped venue modules, `assertModuleEnabled(orgId, moduleId)` (entitlement first — see `src/lib/moduleEntitlement.ts`).
2. **Multi-park:** location-scoped data uses `orgId` + optional `locationId` pointing at `VenueLocation`. The existing `venues` plan resource is the multi-park create gate.
3. **No second billing system** — do not invent parallel Stripe products or plan catalogs; extend `src/lib/subscriptionPlans.ts` only.
4. **`moduleHints`** on each plan (`starter: ["ticketing"]`, `growth: ["ticketing","pos","waivers","memberships","marketing",…]`, `enterprise: ["all"]`) are marketing until a module ships; **ticketing**, **memberships**, **waivers**, **pos**, and **guest marketing automation** now enforce them via `assertModuleEnabled`. Do **not** enforce unshipped modules in `planLimits`. Do **not** reuse fashion `Product` / `Cart` / `Order` as tickets, guest memberships, waivers, or POS SKUs.
5. Until a module exists, leave schema/plan/docs hooks only. **Online Booking / Ticketing Phases 1–5 complete**. **Memberships (guest) Phases 1–5 complete**. **Digital Waivers Phases 1–5** are live for Growth+. **POS terminal Steps 1–2** are live for Growth+. **Guest Marketing Automation** is live for Growth+ (newsletter, welcome/birthday/re-engagement, post-visit surveys; Campaign Monitor / Salesforce / ROLLER Connect sync **not** live). The separate **check-in scanner product**, **ticket-purchase kiosk**, and Party Command Center are not shipped. SMS without Twilio stays honest. Postgres RLS is deferred. Legal wording is not a compliance certificate. Guest membership billing stays the Memberships module. Full contract: [`docs/saas-module-extension.md`](./docs/saas-module-extension.md). Env: [`docs/ticketing-env.md`](./docs/ticketing-env.md), [`docs/pos-env.md`](./docs/pos-env.md). Smoke: `yarn smoke:marketing`.
6. **Newsletter campaigns** (Growth+, `/admin/marketing?tab=campaigns`): block composer (heading, text with `**bold**`/`[link](url)`, image, button, offer/promo code, auto-filled upcoming ticket sessions, divider), merge tags (`{{guestFirstName}}`, `{{orgName}}`, `{{bookUrl}}`, `{{websiteUrl}}`, `{{monthName}}`), live branded preview, test send to self, audience (park, newsletter-only, visited within N days, active members) on top of the opt-in consent gate. Schedules: one-off or **monthly** (day 1–28, hour, IANA timezone). `MarketingCampaignRecipient` unique `(campaignId, guestProfileId, windowKey)` guarantees one email per guest per issue; sends go through `sendPromotionalMarketingEmail` (send log, consent re-check, unsubscribe + RFC 8058 `List-Unsubscribe`). Delivery: `GET /api/cron/marketing-campaigns` (Bearer `CRON_SECRET`, resumable batches, run every 15 min). On the Windows test host: `yarn marketing:crons:register` installs scheduled tasks (newsletters every 15 min, lifecycle automations daily); `yarn marketing:crons` runs both once. Transport is the existing SMTP pair (`NOTIFICATION_EMAIL_USER` / `TEAM_EMAIL_USER`) — fine for small lists; no ESP bounce handling yet. Smoke: `yarn smoke:marketing:campaigns`.

## Company SaaS hardening complete (Steps 1–4)

**Thesis:** Harewa hosts many companies; each company hosts many parks (`VenueLocation`); venue modules attach with `orgId` + optional `locationId` under one billing entitlement gate (**ticketing**, **memberships**, **waivers**, and **POS terminal** are live on entitled packages; the separate check-in scanner product and the ticket-purchase kiosk are still later epics). Public Harewa shop (`DEFAULT_ORG`) stays independent and never locks on tenant expiry.

| Layer | Meaning |
|---|---|
| Organization | Tenant HQ + one SaaS subscription |
| VenueLocation | Multi-park sites under plan `venues` |
| Membership | Staff seats + RoleTemplates (capped) |
| Future modules | Same tenant + entitled creates — see extension contract |

**Lifecycle:** Register (`/register-company`) → Pending → Harewa Approve → Profile → Billing Checkout → Plan limits → Notices / expire → soft Offboard request + workspace Export (no hard-delete of orders/payments/users).

**Crons (Vercel Hobby ≤2):** hourly `reconcile-company-subscriptions`; daily remind (+ invite TTL expire). Env: `CRON_SECRET`, `STRIPE_PRICE_*_MONTHLY`, `COMPANY_OPS_GRANT_DAYS`, `COMPANY_OPS_ALERT_EMAIL`, `COMPANY_BILLING_NOTICE_ENABLED`, `MEMBERSHIP_INVITE_DAYS`.

**Isolation:** app-layer `staffOrg` + Fresh; platform ops audit via `logPlatformActionOnCompany`; Postgres RLS **deferred** — [`docs/postgres-rls.md`](./docs/postgres-rls.md).

**Export / offboard:** `GET /api/admin/company-export`, `POST /api/admin/company-offboard-request` (`settings:manage` + company `platform_admin`, actor org only; soft billing hold allowed via workspace-lifecycle Fresh). UI: `/admin/company-profile` when admin is reachable; soft-hold waiting room `/company-pending` also exposes export/offboard. Harewa `/admin/registered-companies` shows an Offboard req badge (cleared on Approve). Export format is **redacted JSON** (ZIP not shipped — residual). `offboardedAt` is reserved for a future ops completion job (not self-serve).

**GDPR stance (current):**

| Request | Behavior |
|---|---|
| End-user erase | Existing account-delete / blacklist paths (user-scoped); not a full org wipe |
| Workspace export | Redacted JSON package for the company admin (no passwords, Stripe ids, bank ciphertext) |
| Hard org purge | **Not shipped** — future ops-only job; never cascade-delete payments/orders from self-serve offboard |

**Smokes:**

```bash
yarn smoke:company-saas-hardening
yarn smoke:company-subscription
yarn smoke:company-subscription-notices
yarn smoke:company-subscription-remind
yarn smoke:plan-limits
yarn smoke:venue-locations
yarn smoke:enterprise-hq
yarn smoke:phase2-tenancy
```

**Extension contract:** [`docs/saas-module-extension.md`](./docs/saas-module-extension.md) — required reading for every future module Cursor prompt.  
**Enterprise HQ SSOT:** [`docs/enterprise-hq-controls.md`](./docs/enterprise-hq-controls.md) — routes, gates, APIs, non-goals.

### Next epics (landing navbar order)

Each depends on this control plane (Steps 1–4). Do not mark a module **fully** complete until its epic phases ship.

**Shipped (Enterprise HQ Steps 2–4 + park-admin):** entitled `enterprise` companies get `/admin/hq` (cross-park dashboard + HQ venue switcher). Growth/Starter get `MembershipVenueAssignment` park-lock + `/api/admin/park-context` park filter (no HQ rollup claim). Venues lifecycle, soft upsell on `/admin/hq` for non-Enterprise, `actorLocationScope` (venues + park-stamped modules; members roster + meters company-wide), and landing/Billing/ops honesty. Ops `/admin/registered-companies` shows venue count + HQ eligibility. See [`docs/enterprise-hq-controls.md`](./docs/enterprise-hq-controls.md). Smoke: `yarn smoke:enterprise-hq` · `yarn smoke:park-admin-scope`.

1. **Online Ticketing** — **Phases 1–5 complete** (catalog → engine/APIs → public + admin UI → control-plane sync → final audit / production readiness). Admission products optionally classify under org-scoped **BookingCategory** (Online Booking → Booking category — separate from Food sales Catalog ProductCategory). **Explicit non-goals (not faked):** Party Command Center mega-features beyond the booking layer already shipped, check-in scanner product, ticket-purchase kiosk, Digital Waivers is the separate Growth+ module (booking confirmation can include its link), OTAs, Intercard/Sacoa, dynamic pricing engine, promo codes, gift card storefront merchandising, reopen `/signup`. Staff POS terminal is the separate Growth+ POS module. Thin POS adapter remains `/api/pos/bookings*` + POS notes for Feature 02. Spec: [`docs/online-booking-ticketing-complete-spec.md`](./docs/online-booking-ticketing-complete-spec.md). Env: [`docs/ticketing-env.md`](./docs/ticketing-env.md). Smoke: `yarn smoke:ticketing:p1` … `p5` / `:fast` / `yarn smoke:ticketing:all` (sequential; prefer local Postgres — remote Supabase smokes take many minutes).
2. **POS** — **Steps 1–2 complete** (sale engine + staff terminal/check-in/tills/tabs/capacity on Growth+). Smoke: `yarn smoke:pos:step1`, `yarn smoke:pos:step2`, `yarn smoke:pos:all`. Env: [`docs/pos-env.md`](./docs/pos-env.md). Non-goals: check-in scanner product, ticket-purchase kiosk, Intercard, kitchen display UI, OTAs, BOGO.
3. **Accounting** — **Steps 1–2 complete** (chart, journals, posting queue, AR/AP, banking, inventory, reports; auto-post hooks from bookings/POS/shop/memberships/tailoring; admin hub `/admin/accounting`). Spec: [`docs/accounting-complete-spec.md`](./docs/accounting-complete-spec.md). Env: [`docs/accounting-env.md`](./docs/accounting-env.md).
4. **Memberships (guest)** — **Phases 1–5 complete** (foundation + billing/lifecycle + `entitlementEngine` redeem/verify, multi-venue CURRENT/VISITING/INELIGIBLE, family beta, card/wallet honesty, POS/online adapters, guest self-serve, click-to-cancel + alternatives (beta), agreements, CRM polish, reports, advanced dunning, production smokes/security/docs). Spec: [`docs/memberships-complete-spec.md`](./docs/memberships-complete-spec.md). Smoke: `yarn smoke:memberships:p1` … `p5` / `yarn smoke:memberships:all` (prefer local Postgres).
5. **Digital Waivers** — **Phases 1–5 complete** (templates, guest signing, kiosk, desk search/verify/void/import/export, expiry reminders, compliance guides, booking confirmation links, party waiver list, production smoke pack). Enforced for **Growth and Enterprise** only. **Not shipped with this module:** check-in scanner product, ticket-purchase kiosk, Party Command Center, SMS without Twilio, legal certification, Postgres RLS. Guest Memberships billing and the Growth+ POS terminal are separate shipped modules. Spec: [`docs/digital-waivers-complete-spec.md`](./docs/digital-waivers-complete-spec.md). Env: [`docs/waivers-env.md`](./docs/waivers-env.md). Smoke: `yarn smoke:waivers:p1` … `p5`, or `yarn smoke:waivers:all`.
6. **Access Control** — gates/scanners bound to venue
7. **Guest Surveys** — post-visit; org + optional location
8. **Loyalty** — tenant program; entitled gate
9. **Dynamic Pricing** — rules per org/location
10. **Reporting & Analytics deep dive** — org-scoped facts only
11. **Industry templates** — starter configs; still org-scoped

**Party Management (Feature 04, Steps 1–2):** the party engine rides the Online Ticketing module (`assertModuleEnabled(orgId, "ticketing")`) for entitled **Starter, Growth, and Enterprise** companies — no separate SKU or meter beyond `ticketsPerMonth`. Every party is a Booking + `PartyBookingDetail` created through the booking engine: party packages (`party_package` + `PartyPackageConfig`), party rooms with conflict checks, deposits and balance due dates in venue time, kid/adult counts with extra-head pricing, named guests, invitations with RSVP (`/party/invite/[token]`), party food that emits a POS `KitchenTicket`, outstanding balances (`Booking.amountDue` is the only balance), online party booking on the existing `/book/…/party/…` routes and company category pages, and a host view under **Profile → My Parties**. Staff screens live under `/admin/parties*`; maintenance runs inside the hourly reconcile cron (no extra Vercel cron). **Not part of it:** Party Command Center, Kitchen Display screen, arcade card integrations (Intercard / Sacoa / Amusement Connect), and self-service kiosk. Prompts / tracker: [`docs/party-management-two-step-prompts.md`](./docs/party-management-two-step-prompts.md), [`docs/party-management-implementation-tracker.md`](./docs/party-management-implementation-tracker.md). Smoke: `yarn smoke:parties:all` (sequential; prefer local Postgres).

**Company category pages (Steps 1–4 complete):** every booking, membership, and menu category owns one `PublicCategoryPage` (stable slug per org, layout `auto|grid|stack`, `embedEnabled`, archive → inactive). Guests open white-label `/{orgSlug}/{categorySlug}` pages (company header and contact fields switched on in Company profile; no FECSYNC chrome). Booking checkout uses Stripe embedded Checkout and returns to the company path; menu and membership pages are display-only. `?embed=1` plus `public/embed/category.js` frames a page on the company's saved https embed origins (+ https Website) via CSP `frame-ancestors`; every other route keeps `X-Frame-Options: SAMEORIGIN`. Default storefront, Demo, pending, and suspended companies 404, and booking/membership pages follow the ticketing/memberships module gates (membership pages need Growth+). Company slugs and category slugs reject reserved first segments (`src/lib/publicCategory/slug.ts`); renaming the company slug moves every shared link. Code: `src/lib/publicCategory/`, `src/app/(company-site)/`, `src/proxy.ts`. Spec: [`docs/company-category-pages-four-step-prompts.md`](./docs/company-category-pages-four-step-prompts.md). Smoke: `yarn smoke:company-category:all` (sequential; the pages smoke needs `yarn dev` and local Chrome/Edge).

### Residual backlog (control plane)

- Seat-quantity Stripe line items
- Full Postgres RLS (see deferral doc)
- Hard org purge / ops data retention job
- Workspace export ZIP package (JSON download ships today)
- Ops job to stamp `Organization.offboardedAt` after soft offboard request
- Optional hold/reserve reminder emails (confirmation pipeline stays intact without them)
- Venue module epics listed above

### Residual backlog (Memberships guest — honest, not faked)

- Live Apple/Google Wallet pass **signing** (`.pkpass` / Google JWT not implemented — API always returns honest `not_configured` + digital QR; env cert keys alone never report ready)
- SMS dunning (email-only unless a Twilio/SMS provider is already configured)
- Feature 19 self-service ticket **kiosk** hardware UI
- Digital Waivers `membership_contract` kind exists; Membership agreements still use the minimal accept/store until a later waivers phase links `waiverRecordId` from the sell flow
- Separate check-in scanner product / ticket-purchase kiosk (POS station check-in at `/admin/pos/check-in` is shipped; Memberships still owns guest billing)
- Online booking checkout does not auto-apply membership discount; staff/online verify hook is `POST /api/memberships/verify` + `applyMembershipDiscount`
- Upgrading/downgrading a live Stripe subscription **price item** mid-cycle remains staff/Stripe Dashboard ops when amount must change on the next invoice (DB plan + proration ledger are authoritative in-app)
- Beta UI labels: family, pause, cancel alternatives

## Getting Started

First, run the development server:

```bash
yarn install
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Shipping (Nigeria logistics)

Server-only env and provider research (Shipbubble primary, Fez fallback, Kwik Lagos supplement):

- [`docs/shipping/providers.md`](./docs/shipping/providers.md) — VERIFIED vs ASSUMPTION provider notes (F10)
- [`docs/shipping-env.md`](./docs/shipping-env.md) — env var cheat sheet

Do **not** commit `.env.local` secrets (`SHIPBUBBLE_API_KEY`, webhook secrets, Fez keys).

## Admin bootstrap

Public signup and Google OAuth always create `role: "client"` (ignore any client-supplied role). To create or promote the first admin:

```bash
yarn create-admin you@email.com YourPassword123
```

Then sign in at `/signin` and open `/admin`. Requires `DATABASE_URL` (Postgres / Prisma) in `.env.local`.

## Account → Organization (SSOT)

Architecture-doc **Account** maps to Harewa **Organization**. Do not rebuild Django ERP Company Profile.

| Architecture concept | Harewa |
|---|---|
| Tenant / Account | `Organization` (`status`: active \| suspended; unique `slug`; one `isDefault` storefront org) |
| Company Admin | Active `Membership` with `rolePreset: platform_admin` (no `ownerUserId` FK) |
| Team member | `Membership` on a normal `User` (single login) |
| Role | `rolePreset` + optional `RoleTemplate` + `permissionsOverride` |
| Permission | `P.*` in `src/lib/auth/permissions.ts` |
| Company-wide visibility | `Membership.companyWideView` (`platform_admin` always true) |

**Primary membership (JWT, no org switcher):** preferOrgId (registration / sticky access JWT org on refresh+`/me`) → active **staff** Membership (over client/tailor) → storefront/default org active Membership → else oldest active Membership. Stuck empty `custom` rows are skipped when another active Membership exists. Members admin is always scoped to `actor.orgId`. Inviting or reactivating a user who already has a **live** membership (`active`/`invited`) on another org is refused; **revoked/suspended** seats elsewhere still allow an ops move. Company registration still refuses **any** Membership row (self-serve, no switcher).

**ActivityLog org context:** `ActivityLog.orgId` column (mirrored in `metadata.orgId`). Staff mutation audits use `logStaffActivityEntry(actor, …)` so `actor.orgId` is stamped; denials and registration helper also stamp org. Customer order / shipment webhooks stamp `Order.orgId` when present.

## White-label company dashboard

Registered companies (any non-`isDefault` org) see **their own** identity in `/admin`; the FECSYNC lockup stays only on the platform storefront org.

| Surface | Source |
|---|---|
| Sidebar logo + name | `CompanyProfile.logoUrl` + trading name → legal name → `Organization.name` (`src/components/brand/CompanyBrandLogo.tsx`) |
| Browser tab title + icon | `generateMetadata` in `src/app/(admin)/layout.tsx` (letter tile until a logo is uploaded) |
| Dashboard address | `https://{Organization.slug}.{NEXT_PUBLIC_TENANT_ROOT_DOMAIN}` (`src/lib/tenantDomain.ts`, `src/proxy.ts`) |
| Staff sign-in page | `https://{slug}.{root}/signin`, or `/signin/{slug}` when subdomains are off (`src/app/(auth-user)/signin/[orgSlug]`, `src/lib/companyLogin.ts`) |

**Company sign-in link.** Each registered company has its own sign-in page showing only its name, logo, brand color (`letterheadColor`), and the contact fields it switched public. Password and Google sign-in through it admit only users with an **active** Membership in that company (checked after the password, so membership is never revealed) and issue the session for that company. The link is shown on the dashboard and Company Profile, used in staff invite emails, and is where company staff land after logout. Renaming the slug changes the link.

The platform `/signin` (FECSYNC-branded) is for the super admin, platform staff, tailors, and customers — anyone with an active seat on the storefront org, or no company seat. An account whose non-revoked seats are only in registered companies is refused there after the password check (`code: USE_COMPANY_SIGNIN`, `companyOnlySignIn` in `src/lib/companyLogin.ts`) and sent to its company's page with the email pre-filled. The super admin's dashboard keeps the FECSYNC identity.

Billing, approval, and suspension notices still name FECSYNC — the company's subscription is with the platform.

**Subdomains** are off until `NEXT_PUBLIC_TENANT_ROOT_DOMAIN` is set. When on:

- `{slug}.{root}` serves `/admin/*`, `/403`, and that company's `/signin`; `/` opens `/admin`; every other page (marketing, storefront, booking, waivers) redirects to the root host. Root-host `/signin/{slug}` redirects to `{slug}.{root}/signin`.
- Root-host `/admin` redirects a company admin to their subdomain; a mismatched subdomain redirects to the session's own company. The storefront org stays on the root host. Data isolation still comes from `actor.orgId` — the host is routing only.
- Auth cookies are issued with `Domain={root}` (via `src/lib/auth/sessionCookies.ts`) on the root host and its subdomains; other hosts (localhost, preview URLs) keep host-only cookies.
- Org slugs cannot be infra labels (`www`, `api`, `app`, …). Slugs that are not valid DNS labels keep that company on the root host.
- Deploy: wildcard DNS `*.{root}` and a wildcard domain on the host (Vercel requires its nameservers for wildcard certs). Local test: `NEXT_PUBLIC_TENANT_ROOT_DOMAIN=lvh.me:3000` and `DEV_ALLOWED_ORIGINS=lvh.me,*.lvh.me`, then open `http://lvh.me:3000`.

## Multi-company registration (Phase 4)

| Path | Purpose |
|---|---|
| **Customer** `/signup` + Google OAuth | Always `User.role=client`. **Never** creates an Organization. Ignores `body.role`. |
| **Company** `/register-company` → `POST /api/auth/register-company` | Creates User (**`isVerified: true` at birth**; prefer signed-in/session path when email was already proven) + Profile + Wallet + `Organization` (`isDefault: false`, **`status: pending`**, `subscriptionStatus: none`) + `platform_admin` Membership (`companyWideView: true`) in **one transaction** via `createOrganizationWithPlatformAdmin`, issues JWT with `preferOrgId` → redirect **`/company-pending`**. Existing-email refusals use one generic message (no admin/password oracle). |
| **Harewa approval** `/admin/registered-companies` | Storefront `platform_admin` only. **Approve** (optional plan demo\|starter\|growth\|enterprise) → `active` + `/admin` unlock. **Set plan** (emergency) stamps any plan on pending/active/suspended without altering venues/catalog/orders/memberships. **Suspend company** → `status: suspended` + `subscriptionStatus: ops_hold` (staff/tailor Fresh fail-closed; self-serve renew blocked; records kept). **Suspend user** (same page) → `User.accountSuspended` soft lock across the platform (records kept). Public Harewa catalog is never locked by company billing. |
| **Ops bootstrap** `yarn create-admin` / `yarn ensure-default-org` | Storefront / default Harewa org only — scripts, not the product onboarding path. |

Signed-in clients without a staff Membership may register a company with `{ companyName, slug }` only (session `sub` is bound server-side). Existing staff cannot use this as an org switcher.

Public catalog continues to use **`DEFAULT_ORG_ID` / default org** — not the newly registered company’s JWT `orgId`.

### Company SaaS lifecycle (architecture)

**Register → Pending → Approve → Profile → Billing → Limits → Expiry**

1. **Register** — `/register-company` creates a non-default org (`status: pending`) + `platform_admin` membership.
2. **Pending** — company admin lands on `/company-pending`; staff Fresh APIs stay locked.
3. **Approve / Set plan** — Harewa storefront `platform_admin` on `/admin/registered-companies` sets `active` (optional Approve plan stamp / ops grant, or emergency **Set plan** for demo\|starter\|growth\|enterprise — subscription fields only).
4. **Profile** — `/admin/company-profile` (logo, legal name, bank last4, footers) for invoices/receipts/print.
5. **Billing** — `/admin/billing` Stripe Checkout/Portal (company `platform_admin` + `settings:manage`).
6. **Limits** — `assertWithinPlanLimit` on venues/roleTemplates/catalog/members/seats/campaigns/clients; meters via `GET /api/admin/billing/usage`.
7. **Expiry** — paid soft-hold → grace → Demo demotion; Demo trial end → suspend. **Reactivate** via Harewa **Approve** or emergency **Set plan** (not self-serve Billing while Demo-expired / ops-suspended).

### Company approval + subscription control

| Org `status` | Session (`requireAuthFresh`) | Staff APIs (`requirePermissionFresh`) | UI |
|---|---|---|---|
| `pending` | Allowed (waiting room) | Denied — pending Harewa approval | `/company-pending` |
| `active` | Allowed | Allowed (normal RBAC) | `/admin` |
| `suspended` | Denied (except `/me` + waiting room) | Denied — catalog writes stay locked | `/company-pending` — ops_hold → contact developers/IT dialog; billing `expired` may renew; Demo-expired needs Approve |

Subscription columns (`subscriptionPlan`, `subscriptionStatus`, `subscriptionEndsAt`) plus Stripe ids (`stripeCustomerId`, `stripeSubscriptionId`) power Company SaaS billing. **Ops Suspend** sets `status: suspended` + `subscriptionStatus: ops_hold` (Approve / Set plan to unlock; records kept). **Billing Demo end** uses `suspended` + `expired`. Paid unpaid path soft-holds then demotes to Demo. Public Harewa catalog stays open. **User suspend** is `User.accountSuspended` via `GET/PATCH /api/admin/platform-accounts` (never deletes rows).

### Company Billing (Stripe subscriptions)

| Path | Purpose |
|---|---|
| **Admin UI** `/admin/billing` | Plan cards (Starter / Growth / Enterprise), current status banner, Checkout + Customer Portal. Permission: `settings:manage`. Checkout/portal require company `platform_admin`. |
| **API** `GET /api/admin/billing/plans` | Plan catalog + actor.orgId billing state |
| **API** `GET /api/admin/billing/state` | Thin state for dashboard widgets |
| **API** `POST /api/admin/billing/checkout` | Body `{ plan, durationMonths? }` → Stripe Checkout `mode: subscription`, metadata `type: company_subscription` + `durationMonths` |
| **API** `POST /api/admin/billing/portal` | Stripe Customer Portal (customer must belong to actor.orgId) |
| **Webhook** `/api/webhooks/stripe` | Handles `company_subscription` checkout + `customer.subscription.*` + `invoice.paid` / `invoice.payment_failed` without touching order/tailoring settle |
| **Approve vs Stripe** | Harewa approve unlocks `/admin` (optionally stamps plan + `subscriptionEndsAt` ops grant via `COMPANY_OPS_GRANT_DAYS`, default 30). Stripe Checkout does **not** activate a `pending` org. |
| **past_due** | `invoice.payment_failed` → `subscriptionStatus: past_due` (grace; no immediate suspend) |
| **Expiry** | `markOrganizationSubscriptionExpired` → tenant `suspended` + `expired`; never the storefront default org |
| **Reconcile** | `yarn reconcile:subscriptions` → `runReconcileCompanySubscriptions()` in `src/lib/reconcileCompanySubscriptions.ts` (CLI wrapper: `scripts/reconcile-company-subscriptions.mts`). Finds `active` non-default orgs with overdue `subscriptionEndsAt` (or `past_due` + null endsAt); if Stripe still live, refreshes `endsAt`; else expires. Soft-skips when Stripe unreachable for bound subs. Ops-grant (no `stripeSubscriptionId`) expires when `endsAt` past. Idempotent; used by Step 3 hourly cron (`/api/cron/reconcile-company-subscriptions`) and CLI. |
| **Reactivate** | Stripe webhooks **do not** set `status: active` on a suspended org. Harewa **Approve** or emergency **Set plan** on `/admin/registered-companies` unlocks admin again after suspend/expiry **or soft-hold** (DB still `active` but overdue / `past_due`+null — list projects suspended). Set plan never deletes company records. Suspended admins see `/company-pending`; ops_hold cannot self-serve renew or export — contact FECSYNC. Billing Checkout stays locked via Fresh until entitled again. |

After pull: run `npx prisma migrate deploy` (includes `User.accountSuspended`) and `npx prisma generate` if the Prisma client is stale.

Env (Stripe Price IDs — charge only via Prices, not demo UI amounts):

```
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_GROWTH_MONTHLY=price_...
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_...   # optional; else Contact sales
STRIPE_COMPANY_BILLING_SUCCESS_URL=...      # or derive from NEXT_PUBLIC_APP_URL
STRIPE_COMPANY_BILLING_CANCEL_URL=...
COMPANY_OPS_GRANT_DAYS=30
COMPANY_PROFILE_ENCRYPTION_KEY=...          # preferred for bank ciphertext (else JWT_SECRET)

# Marketplace Connect payouts (World B — not SaaS billing)
MARKETPLACE_PLATFORM_FEE_BPS=500
MARKETPLACE_PLATFORM_FEE_FLAT_MINOR=0
MARKETPLACE_CURRENCY_DEFAULT=usd
# MARKETPLACE_CONNECT_COUNTRY_DEFAULT=US
# STRIPE_CONNECT_RETURN_URL=.../admin/payouts?connect=return
# STRIPE_CONNECT_REFRESH_URL=.../admin/payouts?connect=refresh
```

**Marketplace payouts (v1):** Stripe Connect Express destination charges for `BookingPackage` checkouts (`metadata.type=marketplace_booking`). UI: `/admin/payouts`, `/admin/booking-packages`, public `/book/{orgSlug}/{packageSlug}`. Company profile bank fields remain invoice-only. SSOT: [`docs/marketplace-payouts-implementation.md`](./docs/marketplace-payouts-implementation.md). Smoke: `yarn smoke:marketplace-payouts`.

**Franchise park Connect (Step 3):** Guest card money for a franchise `VenueLocation` settles to `VenueLocationMarketplaceAccount` when park charge-ready (`resolveGuestPayoutDestination`); null-location / non-franchise catalog stays on org `OrganizationMarketplaceAccount`. SaaS software billing remains company-wide on `/admin/billing` (never a per-park Stripe Customer). Smoke: `yarn smoke:franchise-park-payouts`.

**Stripe test-mode proof path:** entitled company completes Connect on `/admin/payouts` → Ready → create/publish package → guest opens `/book/{orgSlug}/{packageSlug}` → Checkout → test card → webhook marks booking `paid` → funds appear on the connected Express account (minus `MARKETPLACE_PLATFORM_FEE_*` application fee on the platform). For a franchise park, onboard park Connect at `/admin/payouts?locationId=…` first. Do **not** claim full Events/Memberships modules from this epic.

```

**Cron (recommended hourly):**

```bash
# Linux/macOS crontab example
0 * * * * cd /path/to/roller_clone_app && yarn reconcile:subscriptions >> /var/log/harewa-reconcile.log 2>&1
```

Safe to run locally (`yarn reconcile:subscriptions`). Behavior:
- **No** `stripeSubscriptionId` (ops grant / unbound) → expire when `subscriptionEndsAt` is past.
- **Bound** sub + Stripe env OK → refresh if Stripe is still live with a future period end; else expire (including `resource_missing`).
- **Bound** sub + Stripe **not** configured, or retrieve is transient → **skip** (fail-closed; never mass-suspend without verification).

Smoke: `yarn smoke:company-subscription`.

### Plan limits & usage

| Plan | venues | members | role templates | products | fabrics | categories | tailor seats | campaigns | tailor clients | booking packages | display $/mo |
|---|---|---|---|---|---|---|---|---|---|---|
| **starter** | 1 | 3 | 5 | 50 | 50 | 20 | 1 | 2 | 25 | 5 | 199 |
| **growth** | 5 | 15 | 25 | 500 | 500 | 100 | 5 | 20 | 100 | 25 | 449 |
| **enterprise** | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited | unlimited | custom |

Policy: registered companies need an **entitled** subscription (`active` | `trialing` | `past_due`) before plan-capped creates (including **venues**). Harewa approve alone (`subscriptionStatus: none`) unlocks `/admin` for Billing + profile + venue UI shell, but **not** creates. Once entitled, **null** `subscriptionPlan` uses **starter floors**. Harewa storefront / `isDefault` org is **not** plan-capped.

| Path | Purpose |
|---|---|
| **Lib** `src/lib/subscriptionPlans.ts` | Plan SSOT (venue-first packages + caps) |
| **Lib** `src/lib/planLimits.ts` | `assertCompanyBillingEntitled`, `countPlanResource`, `assertWithinPlanLimit`, `assertNewTailorSeat`, `getPlanUsageSnapshot` |
| **Lib** `src/lib/venueLocations.ts` | `listVenueLocations` / `createVenueLocation` / update / archive / reactivate (asserts `venues` on create/reactivate) |
| **Admin** `/admin/venues` + `GET\|POST\|PATCH\|DELETE /api/admin/venue-locations` | Multi-park foundation UI/API (`settings:manage`, actor.orgId) |
| **Admin** `/admin/hq` + `/api/admin/hq/*` | Enterprise HQ control plane (entitled `enterprise` for data; soft-upsell others; venue switcher; overview rollup — see `docs/enterprise-hq-controls.md`) |
| **Enforcement** | Server create/invite: venues, roleTemplates, members, products (+bulk), fabrics, categories, tailor seats, campaigns, tailor clients. **tailorSeats** = non-suspended `TailorProfile` studios, plus live `rolePreset=tailor` Memberships that do not yet have a profile (reserved invites). Suspending a studio frees the seat. Archived venues free `venues` quota. |
| **API** `GET /api/admin/billing/usage` | Meters for company tenants (`settings:manage` **or** `analytics:read` **or** invite/catalog write/`tailors:manage` for UI mirrors). Includes `tailorSeatOccupantUserIds`. |
| **API** `GET /api/admin/registered-companies/metrics` | Storefront Harewa company counts (pending/active/suspended/subscribed/expiring) |
| **Dashboard** | Storefront: `CompaniesOverviewCards`. Company tenant: `CompanyPlanUsageCards` (+ profile/billing). Commerce `KeyMetrics` unchanged and org-scoped. |

Smoke: `yarn smoke:plan-limits` · `yarn smoke:venue-locations` · `yarn smoke:enterprise-hq`.

### Step 2 verification (subscription + approval + entitlement + expiry)

```bash
npx prisma validate
npx prisma generate
yarn smoke:phase4-register
yarn smoke:company-subscription   # approve±plan, past_due, expire, Stripe skip pending
yarn smoke:plan-limits            # unpaid blocks products + venues; entitled caps
yarn smoke:venue-locations        # venues create under cap / storefront deny
yarn smoke:enterprise-hq          # Enterprise HQ gate + archive + location context
yarn reconcile:subscriptions      # shared runReconcileCompanySubscriptions()
```

Checklist:
- Soft-hold (active + overdue / `past_due`+null) → Reactivate via Approve or Set plan; healthy active re-approve blocked
- Emergency Set plan (`action: set_plan`) → demo\|starter\|growth\|enterprise stamp; venues/catalog/orders/memberships untouched
- Approve without plan → `/admin` unlock, creates blocked (`subscriptionStatus: none`)
- Approve with plan stamp → ops grant entitle (`COMPANY_OPS_GRANT_DAYS`) including venues
- Stripe Checkout never activates `pending` orgs
- `past_due` with a future `subscriptionEndsAt` remains entitled (grace); `past_due` + null / overdue endsAt soft-denies Fresh + creates; expire → tenant `suspended` only (storefront open)
- Billing cards = Step 1 `SUBSCRIPTION_PLANS` (venue-first); usage meters include `venues`
- `/register-company?plan=` stores a Billing highlight hint only (localStorage; never entitles)
- Module entitlement contract + `moduleHints`; **ticketing**, **memberships**, **waivers**, and **pos** enforce hints via `assertModuleEnabled` (loyalty still story-only)

### Company Profile (tenant identity)

| Path | Purpose |
|---|---|
| **Admin UI** `/admin/company-profile` | Per-company legal name, logo, contact, address, tax ID, bank (masked), invoice/receipt footers. Permission: `settings:manage`. Not storefront-only — every active company uses it. Dashboard completeness meter is shown for **non-storefront** tenant orgs (Harewa storefront already has platform brand). |
| **API** `GET\|PUT /api/admin/company-profile` | Actor `orgId` only (never `body.orgId`). Org must be `active`. Returns redacted DTO (`bankAccountLast4` / `hasBankAccount` / `hasBankRoutingOrIban`; **never** account number or routing/IBAN plaintext). |
| **Logo** `POST /api/admin/company-profile/logo` | JPEG/PNG/WebP → Cloudinary `company-profiles/{orgId}`. |
| **Sign-in background** `POST\|DELETE /api/admin/company-profile/signin-background` | JPEG/PNG/WebP (browser-optimised to ≤4MB, server cap 8MB) → Cloudinary `company-profiles/{orgId}/signin-background`. Shown behind the logo on the company staff sign-in page (`/signin/{slug}` / `{slug}.{root}/signin`) with a brand-colour tint; `company_profile:write`, Demo allowed, park-locked denied. |
| **Branding** | Org-scoped order/tailoring/membership emails, receipt/invoice **helpers**, and order print use `resolveBrandForOrg(orgId)`. Platform auth emails (OTP, verify, password reset, welcome) stay Harewa via `isPlatformAuthEmail`. Under `PAYMENT_POLICY` (Stripe UI on / Paystack UI off), live checkout uses branded **order status** emails + print; `sendInvoiceMail` remains wired for the Paystack API path only. |
| **Encryption** | `COMPANY_PROFILE_ENCRYPTION_KEY` (preferred) or `JWT_SECRET` encrypts `bankAccountCiphertext`. Required in production for bank writes. |

Smoke: `yarn smoke:company-profile`.

### Step 3 verification (notices + cron + invite TTL + over-limit)

**Thesis:** many companies get notified, reminded, expired on schedule, and cannot silently burn seats — so ticketing, memberships, and waivers Phases 1–5 already sit on a real multi-tenant control plane.

```bash
yarn smoke:company-subscription-notices
yarn smoke:company-subscription-remind
yarn smoke:plan-limits            # overLimitResources + roleTemplates/venues meters
yarn remind:subscriptions
yarn reconcile:subscriptions
yarn expire:membership-invites
```

| Piece | Detail |
|---|---|
| **Notices SSOT** | `src/lib/companySubscriptionNotices.ts` — register/approve/suspend/past_due/expire/remind; email via `mailer.ts`; in-app `alert` + `{ kind: "company_billing", event, orgId, href }`. Never from `/signup`. |
| **Watermarks** | `Organization.subscriptionNotice*` + `opsGrantNotice*` — clear on Stripe apply / ops grant with future `endsAt`. |
| **Env** | `COMPANY_BILLING_NOTICE_ENABLED` (default on), `COMPANY_OPS_ALERT_EMAIL`, `CRON_SECRET`, `MEMBERSHIP_INVITE_DAYS` (default 14). |
| **Cron** | `GET /api/cron/reconcile-company-subscriptions` (hourly), `…/remind-company-subscriptions` (daily; also expires overdue invites for Vercel Hobby’s 2-cron limit). Dedicated `…/expire-membership-invites` for CLI/GH. Bearer `CRON_SECRET`. `vercel.json` (2 jobs) + `.github/workflows/company-saas-crons.yml`. `yarn remind:subscriptions` matches HTTP remind (remind + invite expire). |
| **Invite TTL** | `Membership.inviteExpiresAt` on invite; overdue → `revoked` (frees seats); activate rejects expired. |
| **roleTemplates** | `assertWithinPlanLimit` on POST; usage meters + soft-gates. |
| **Over-limit UX** | `usage.overLimitResources` + banners on `CompanyPlanUsageCards` / `BillingStatusBanner` (keep data, block creates). |

Notice matrix (company workspace copy — not “your shop”):

| Event | Email | In-app | Watermark |
|---|---|---|---|
| Registered | company admins | yes | — |
| Ops pending | `COMPANY_OPS_ALERT_EMAIL` + storefront admins | yes | — |
| Approved | company admins (Billing + profile CTAs) | yes | clear on grant |
| Suspended | company admins | yes | — |
| Past due | company admins | yes | `subscriptionNoticePastDueAt` |
| Expiring 7/3/1d | company admins | yes | `subscriptionNoticeRemind*At` |
| Ops grant 7/3/1d | company admins | yes | `opsGrantNoticeRemind*At` |
| Expired | company admins | yes | `subscriptionNoticeExpiredAt` |
| Offboard requested (Step 4) | company admins + ops | yes | soft `offboardRequestedAt` (no hard-delete) |

**Backlog (not in Step 3/4 control plane):** seat-quantity Stripe pricing; full Postgres RLS; hard org purge.

### Step 4 verification (isolation + export + hardening)

```bash
npx prisma validate
npx prisma generate
yarn smoke:company-saas-hardening
yarn smoke:phase4-register
yarn smoke:company-profile
yarn smoke:company-subscription
yarn smoke:company-subscription-notices
yarn smoke:company-subscription-remind
yarn smoke:plan-limits
yarn smoke:venue-locations
yarn smoke:phase2-tenancy
yarn smoke:org-registration-failures
npx tsx scripts/smoke-org-registration-helper.mts
yarn reconcile:subscriptions
# With yarn dev running (PowerShell): $env:DISABLE_AUTH_RATE_LIMIT="1"; yarn verify-rbac
```

Docs: [`docs/saas-module-extension.md`](./docs/saas-module-extension.md), [`docs/postgres-rls.md`](./docs/postgres-rls.md).

### Phase 4 completion checklist

- [x] Customer `/signup` + Google always `client`; never create Organization
- [x] `/register-company` → pending org + JWT → `/company-pending` until Harewa approves
- [x] Harewa storefront approve/suspend/set_plan (`/admin/registered-companies`) + optional Approve plan stamp / emergency Set plan
- [x] Bootstrap scripts (`create-admin` / `ensure-default-org` / `ensure-memberships` / `repair-admin-memberships`) are Prisma/Postgres
- [x] Revoked/suspended/invited Membership does not elevate via `User.role=admin` (`isStaffActor` honors preset)
- [x] Stale JWT: `authzVersion` / JTI → Fresh “Session outdated; sign in again”
- [x] Proxy gates: client `/admin` → `/403`; staff `/profile` → `/admin`; tailor → `/tailor/home`; approved company admin → `/admin` (pending → `/company-pending`)
- [x] Sole `platform_admin` cannot `DELETE /api/auth/me` or hard-delete self
- [x] Blacklist org-scoped; company register rate-limited; no client `orgId` trust
- [x] `PAYMENT_POLICY` / cart `user===sub` / storefront default org unchanged; no org switcher
- [x] Docs: `DATABASE_URL` SSOT; register-company vs customer signup documented
- [x] Helper smoke: `yarn smoke:phase4-register` (+ failures: `yarn smoke:org-registration-failures`; HTTP matrix **L/H/I** via `yarn verify-rbac`)

## Multi-company registration helper (Phase 1)

Server helper: `createOrganizationWithPlatformAdmin` in `src/lib/orgRegistration.ts`:

1. Create `Organization` with unique slug, **`status: pending`**, **`isDefault: false`** (never steals Harewa storefront). Ops unlock requires Harewa approve → `active`.
2. Create `Membership`: `platform_admin`, `companyWideView: true`, `status: active`.
3. Set `User.role` to `admin` in the **same transaction**. `ensureAdminMembership` will **not** attach a default-org membership when another org Membership already exists.
4. Always bump `authzVersion` on success and set `isVerified: true` (clears OTP). When `invalidateSessions` (default), set refresh JTI to `revoked:…`. Phase 4 register-company passes `invalidateSessions: false`, which rotates refresh JTI to a fresh UUID (not `revoked:`), then issues cookies with `preferOrgId`.
5. Primary JWT: `resolveAuthzForUser(user, { preferOrgId: newOrgId })`. Helper refuses users who already have any Membership (no org switcher / dual-company seat), serializing the check with a per-user row lock inside the write transaction.

`yarn ensure-memberships` / `repair-admin-memberships` / `create-admin` skip attaching or repairing the default-org seat when the user already has **any** Membership on a non-default org (any status — matches runtime `ensureAdminMembership`). Runtime `ensureAdminMembership` (on `/me` / login) still skips any other-org row so soft-revoke cannot re-elevate via storefront.

### Phase 1 completion checklist

- [x] Account→Organization map in README (no `Organization.ownerUserId`; Company Admin = `platform_admin`)
- [x] `ActivityLog.orgId` column (+ metadata mirror) on new writes (`logStaffActivityEntry` / denials / registration; order & webhook stamp `Order.orgId`)
- [x] Primary membership: preferOrgId → staff-over-client → storefront → oldest active (`resolvePrimaryMembership`)
- [x] `createOrganizationWithPlatformAdmin` — `isDefault: false` + `platform_admin` + CWV true (tested via `yarn smoke:phase1-org`)
- [x] No org switcher; storefront stays `DEFAULT_ORG_ID` (Company Profile is 1:1 org branding, not an ERP company switcher)
- [x] Pending org: session OK, staff PermissionFresh denied; suspended org: Fresh fail-closed (`assertOrganizationNotSuspended` / `assertOrganizationActive`)
- [x] Customer `/signup` creates no Organization / Membership
- [x] FOLLOW-UP AUDIT Phase 1: staff ActivityLog routes synchronized to `logStaffActivityEntry`

## Staff tenancy & companyWideView isolation (Phase 2)

Helpers live in `src/lib/staffOrg.ts`. Layer 1 = `actor.orgId`. Layer 2 = when `companyWideView === false`, own-row filters on ownership-capable models.

| Resource | Tenant | CWV own-scope | Notes |
|---|---|---|---|
| Product list/detail/mutate (`?scope=staff`) | `actor.orgId` | `sellerId = sub` **or** `createdById = sub` | Public GET (no scope) = storefront |
| Fabric / category list/detail/mutate | `actor.orgId` | `createdById = sub` | Null `createdById` hidden when CWV false |
| Order staff list / analytics | `actor.orgId` | `userId = sub` | Customer `order/me` stays `user===sub` |
| Order `[id]` staff path | org match + permission | CWV via `assertOwnedDocument` | Staff GET always Fresh; owner customer path unchanged |
| Shipments (deliveries) | `actor.orgId` | order.`userId = sub` when CWV false | Aligns with staff order visibility |
| Members | `actor.orgId` | self-only when CWV false | GET/PATCH/POST invite & create-user require CWV for others |
| Fashion chats admin | `actor.orgId` | assignee / CWV helper | List + stats counts use same own-scope |
| Reviews moderate | product.`orgId` | CWV=false → product own-scope (seller/createdBy) | Owner edit stays `user===sub` |
| Tax / shipping / homepage / ads / company profile | `actor.orgId` | **none (org-wide settings)** | One row per org; CWV false still may open |
| AI assistant settings | **storefront org only** | **none** | Non-storefront company admins get 403 (chatbot is Harewa storefront) |
| Admin tailors / tailoring-jobs | `actor.orgId` | **none** | Do not invent createdBy |
| Analytics job totals | `actor.orgId` | **none** (org-ops metrics) | Orders/products scoped; activity feed requires `ActivityLog.orgId` / metadata.orgId (no bare member `userId` OR) |
| Role templates | `actor.orgId` | **none (org-wide)** | Shared team roles; no CWV own-scope |
| Cart / wallet / customization staff | **storefront staff only** | n/a | Models have no `orgId`; `assertStorefrontStaffOrg` — registered companies get 403 |
| Tailor `/api/tailor/*` | profile ownership | **not staff CWV** | |
| Public catalog | storefront org | n/a | Unchanged |

Cross-tenant: Company A staff requesting Company B resource ids → **403** `Cross-tenant access denied` (not silent 404 on staff catalog mutate paths that assert org match).

### Phase 2 completion checklist

- [x] Written matrix: org-only vs org+own vs org-blind (above)
- [x] Fabric / category / product / order / analytics / members use `actor.orgId` + CWV helpers
- [x] Analytics ActivityLog feed tenant-scoped (no cross-org leak via member `userId` OR)
- [x] Exceptions intentional: org-wide settings; AI storefront-only; cart/wallet/customization **storefront-staff-only** (no orgId column); admin jobs/tailors org-only
- [x] Storefront public catalog + cart/wishlist/wallet unchanged
- [x] Tailor `/api/tailor/*` ownership-based (not staff CWV)
- [x] Cross-tenant catalog asserts → 403; `platform_admin` CWV always true
- [x] Tested via `npx tsx scripts/smoke-phase2-tenancy.mts` (+ matrix G/L in `yarn verify-rbac`)

## Security model (Step 7.1)

| Layer | What decides access |
|---|---|
| **User.role** | Live: `admin` \| `client`. Archived: `seller` → treated as `client` (enum kept for legacy; `yarn ensure-memberships` migrates). |
| **Membership** | Staff/provider link to an **Organization** via `rolePreset` ∪ `permissionsOverride` (or template ∪ override). **Membership presets:** `platform_admin`, `ops_manager`, `catalog_editor`, `finance`, `custom`, `tailor`. JWT-only preset `client` (no Membership row — from `User.role`). No `seller` Membership preset. |
| **Permissions** | Catalog in `src/lib/auth/permissions.ts`. JWT may embed them; `sessionCan` / store `can()` for UI; API uses `requirePermission` / `requirePermissionFresh`. |
| **Org tenancy** | Catalog + orders carry `orgId`. Storefront reads `DEFAULT_ORG_ID`; staff APIs require membership and filter/stamp `actor.orgId`. Never trust body/`?orgId=`. |
| **Staff visibility (CWV)** | See Staff tenancy matrix above. `platform_admin` always company-wide. |
| **User isolation** | Cart, wishlist, wallet, profile, notifications: `document.user === JWT sub`. |
| **Proxy** | `src/proxy.ts` + `src/lib/auth/routePolicy.ts` (edge JWT). APIs are not in the matcher — handlers must guard. |
| **Payments** | `PAYMENT_POLICY`: Stripe UI on / Paystack UI off / wallet API-only. |

**Bootstrap admin:** `yarn ensure-default-org` → `yarn create-admin <email> <password>` (creates `platform_admin` membership) → optional `yarn ensure-memberships` for legacy admins + seller archive.

**ACCEPTED unauthenticated mutators:** identity auth routes; Stripe webhook (signature verify); Stripe/Paystack confirm callbacks (provider proof); guest fashion-chat. All other resource mutators use `requireAuth` / `requirePermission*`.

**Payment return paths:** Stripe → `/payment/success` → `GET /api/payment/stripe/confirm`. Paystack (API-only; UI off) → `/payment/callback` → `GET /api/payment/paystack/callback`. Do not use removed `/api/payment/verify`.

## Organization (tenant) — Step 5.1

The tenant root is **Organization** (= architecture Account), not Shop (`/api/shop` stays 410 Gone). Company Admin = `platform_admin` Membership.

Bootstrap exactly one default org ("Harewa") and backfill `orgId` on Product, Fabric, ProductCategory, TaxSettings, AiSettings, and Order:

```bash
yarn ensure-default-org
```

Set `DEFAULT_ORG_ID` in `.env.local` to that org's id (the script appends it if missing). Storefront catalog lists use this env var when present; otherwise they use the default org. It is server-only — not a JWT claim yet for clients without membership. Cart and Wishlist stay user-scoped.

Suspended orgs: staff/tailor `requireAuthFresh` / Fresh APIs fail closed with `Organization is suspended` (ops Suspend uses `subscriptionStatus: ops_hold`). Public storefront shopping is not locked behind company approval/ops hold (customer `*_own` stays available). Soft **user** suspend (`User.accountSuspended`) blocks sign-in and customer own-scope APIs until Unsuspend.

## Membership (Step 5.2)

Staff users link to an Organization via **Membership** (`userId`, `orgId`, `rolePreset`, optional `permissionsOverride`).

**Effective permissions = preset ∪ override** (union). Overrides only add grants; use `rolePreset: custom` (empty preset) when the override should be the full set.

```bash
yarn ensure-memberships
```

Migrates existing `User.role === "admin"` → `platform_admin` membership on the default org. Also archives `User.role === "seller"` → `client` (Step 7.1; not a Membership preset). `yarn create-admin` also creates that membership. Clients get no staff membership (JWT falls back to legacy role expansion). Suspended/revoked/invited memberships are not bypassed by `User.role`. `GET /api/auth/me` returns primary authz plus a `memberships[]` list. Invite/edit UI lives at `/admin/users` (Step 6.2).

## Tenant-scoped staff queries (Step 5.3)

Staff catalog and order APIs filter/stamp **`actor.orgId`** (JWT Membership). Public storefront reads stay on **`DEFAULT_ORG_ID`** / default org. Cross-tenant access returns **403** (`Cross-tenant access denied`), including platform_admin of another org.

Admin list UIs call catalog GETs with `?scope=staff`. Never trust `body.orgId` or `?orgId=`.
When `companyWideView` is false: products narrow by `sellerId` **or** `createdById`; fabrics/categories by `createdById`; staff orders/analytics by `userId`. Org-wide settings and admin tailor/jobs stay org-only (documented exceptions).

**Still in force:** Cart / Wishlist / Wallet / checkout stay `user === JWT sub`. Stripe UI on; Paystack UI off; wallet API-only. Public tax/checkout uses storefront TaxSettings; admin tax uses actor.orgId.

```bash
yarn ensure-second-org
```

Creates an `other-org` fixture and prints a regression checklist (admin of org A cannot read org B).

### Regression checklist

Covered by `yarn verify-rbac` block **G** (and related A/B/C) when green; keep for manual spot-checks:

- [x] Admin of org A: `GET /api/product/<id-from-B>?scope=staff` → 403 (matrix G)
- [x] Admin of org A: `PUT/DELETE` that product → 403 (matrix G / cross-tenant asserts)
- [x] Admin of org A: `GET /api/order/<id-from-B>` → 403 (matrix G)
- [ ] Admin of org A: `GET /api/order` / `GET /api/analytics` only include org A (customers = distinct order users; activity = org order logs)
- [x] Public `GET /api/product` (no scope) lists `DEFAULT_ORG_ID` only (matrix A/L)
- [x] Client `GET /api/order/me` still returns only own orders (matrix B)
- [ ] Staff who also owns an order: PUT/DELETE stays user-scoped (Steps 3.x), not forced through another Membership org
- [x] `POST /api/order` still stamps `Order.orgId` (order create path)
- [ ] Staff `reviews:moderate` on a review whose product is org B → 403

`yarn ensure-second-org` remains valid alongside self-serve `/register-company` (matrix **L**); the fixture `other-org` is for G, not a second product onboarding path.

## Members admin & RoleTemplates (Phase 3)

`/admin/users` + `/api/admin/members*` + `/api/admin/role-templates*` are one control plane per **actor.orgId** (each registered company manages only its own team/roles):

- **Grant ⊆ actor** — invite/create/edit cannot assign preset, template, or override permissions the actor does not hold.
- **CWV ⊆ actor** — cannot grant `companyWideView: true` without holding CWV; invite-only (`users:invite`) cannot set CWV (requires `users:manage_roles`).
- **Last `platform_admin`** — cannot demote/revoke/hard-delete the sole active Admin in the org (Serializable).
- **RoleTemplates** — org-scoped; unique name per org; permissions ⊆ actor; delete blocked while assigned to active/invited/suspended members; permission PATCH invalidates assignee sessions.
- **UI is not security** — chips/checkboxes preview effective grants (preset/template ∪ override); APIs enforce.
- **Tailor** remains a Membership provider preset (not staff). `client` is JWT-only (not a Membership preset). There is no tenant UI to invent new `P.*` codes.



Org-scoped membership management:

| Method | Path | Permission |
|---|---|---|
| GET | `/api/admin/members` | `users:read` |
| POST | `/api/admin/members` | `users:invite` or `users:manage_roles` |
| PATCH | `/api/admin/members/[id]` | `users:manage_roles` |
| DELETE | `/api/admin/members/[id]` | `users:manage_roles` (soft revoke) |

- Scoped to **actor.orgId** (never trust body/`?orgId=`).
- Effective grants = Step 1.1 `ROLE_PRESETS` ∪ `permissionsOverride`; cannot grant beyond the actor’s own permissions.
- Cannot demote/revoke the last active `platform_admin` in the org (POST update, PATCH, and DELETE).
- On role/status change: bumps `User.authzVersion`, clears `refreshTokenJTI`. Access tokens with mismatched `av` get **401** on `requirePermissionFresh` / `requireAuthFresh` (“Session outdated; sign in again”). Refresh also fails until re-login.
- Writes `ActivityLog` (`entityType: Membership` on member mutations; `User` on create-user when applicable).
- Does **not** change checkout: Cart/Wishlist/Wallet stay `user === sub`; Stripe UI on; Paystack UI off; wallet API-only; public tax stays storefront org.
- `DELETE /api/auth/me` refuses if the user is the sole active `platform_admin` of an org.

### Phase 3 completion checklist

- [x] Grant ⊆ actor; template perms ⊆ actor; CWV grant ⊆ actor
- [x] Last `platform_admin` protected on demote / revoke / hard-delete
- [x] RoleTemplate unique name; delete blocked while assigned to active/invited/suspended
- [x] authzVersion bump + refresh kill on role/status change (Fresh → 401)
- [x] Users UI chips = effective perms; advanced checkboxes ⊆ actor-held catalog
- [x] Nav Users gated by `users:read`; no tenant “invent P.*” UI
- [x] README Membership presets match schema; `client` JWT-only; `tailor` non-staff
- [x] Helper smoke: `yarn smoke:phase3-members` (HTTP matrix K/H via `yarn verify-rbac`)

### Members regression checklist

- [x] `GET /api/admin/members` as client → 403; as admin → only actor.orgId rows (`verify-rbac` B8 / org scope)
- [x] `POST` invite with role whose perms exceed actor → 403 (helper + matrix K1)
- [x] Demote/revoke last `platform_admin` → 403 (helper + matrix K3)
- [x] After role change, target refresh → fail; next Fresh staff call with old access token → 401 (matrix H)
- [x] `GET /api/auth/me` after re-login shows new preset/permissions

## Users & permissions UI (Step 6.2)

Admin page **`/admin/users`** (alias **`/admin/permissions`** → redirect; sidebar **Users**, gated by `users:read` via store `can()` / `permissionForAdminPath`):

- Lists org members with role preset, status, and **effective permissions** (preview chips + full list in View)
- **View** details; **Edit** role/status/overrides (`users:manage_roles`)
- **Invite** by email (`users:invite` or `users:manage_roles`) — creates pending membership and sends invite email (sign-in link) when status is `invited`
- **Create user** (`users:manage_roles`) — new account + org membership in one step (`POST /api/admin/users`); user is email-verified; optional role template
- **Role templates** tab — CRUD reusable permission bundles per org (`/api/admin/role-templates`); assign on invite/edit/create with role preset **Custom**
- Advanced override checkboxes only offer permissions the actor already holds
- `catalog_editor` (and any role without `users:read`) does **not** see the Users nav item or dashboard Team card
- Edge still gates **staff vs client** only (JWT permissions may be omitted); page `can()` + `/api/admin/members` are the real denials for missing `users:*`

### Users UI regression checklist

- [ ] `platform_admin` sees Users nav and can open `/admin/users`
- [ ] `catalog_editor` does **not** see Users nav; opening `/admin/users` → `/403?denied=permission`; `GET /api/admin/members` → 403
- [ ] Invite existing user by email creates membership; invited status triggers email
- [ ] Create user with password assigns membership; duplicate email → 400
- [ ] Role template CRUD; assign template on member; effective perms = template ∪ override
- [ ] Edit role/overrides; target must re-login for JWT to pick up new grants
- [ ] Editing **your own** membership forces logout + sign-in (authzVersion / stale `can()`)
- [ ] Dashboard “Team members” card appears only with `users:read`

## Admin UI permission gates (Step 6.3)

Fine-grained UI gating across admin (API remains source of truth if UI is bypassed):

- **Sidebar** — link shown only when `can(adminPagePermissionForPath)`; Dashboard `/admin` is soft-gated (always shown to staff)
- **Pages** — `AdminLayout` redirects to `/403?denied=permission` when the route’s read/manage permission is missing (unknown `/admin/*` fail closed)
- **Actions** — Edit/Delete/Save/status buttons hide or disable without write/delete/manage; handlers also no-op without the grant
- **Dashboard** — analytics queries need `analytics:read`; list widgets only call products/orders APIs when the actor has those reads (actor.orgId scoped); Tax / AI / Team cards keep their own gates
- **Orphans** — `/admin/deliveries` and `/admin/reviews` live under **Operations** in the sidebar; deliveries uses mock data until backend wiring ships
- **API** — remains source of truth if the UI is bypassed
- **Unchanged by 6.3** — multi-tenant `actor.orgId` filters, user-scoped cart/wishlist/wallet, `PAYMENT_POLICY` (Stripe UI on / Paystack UI off / wallet API-only)

### Admin gate regression checklist

- [ ] Staff without `products:read` cannot open `/admin/products` (403) and do not see Products in the Catalog nav
- [ ] Staff with `products:read` but not `products:write` see View, not Edit/Add
- [ ] Staff with `products:write` but not `products:delete` see Edit, not Delete
- [ ] Staff without `analytics:read` can open `/admin` but not metrics widgets
- [ ] Deep link `/admin/reviews` without `reviews:read` → permission 403
- [ ] Bypassing UI still fails on API (e.g. DELETE product without `products:delete`)

## Cleanup (Step 7.1)

- User.role `seller` **archived** → client preset (not a Membership role); migrate via `yarn ensure-memberships`
- JWT + API responses normalize live roles (`seller` → `client`) via `toDbUserRole` / `authz.role` / `stampLiveRoleOnProfile`
- Staff list GETs (`cart` / `wallet` / `customization`) use `requirePermissionFresh` + `assertStorefrontStaffOrg` (no orgId on those models — Harewa storefront staff only)
- Dead helpers `requireAdmin` / `requireClient` removed — use `requirePermission` / `requirePermissionFresh`
- Proxy uses live `routePolicy` (no legacy rbac module)
- Signup / Google still force `client` only; UI does not send a role
- Paystack return page uses `GET /api/payment/paystack/callback` (removed `/api/payment/verify`)
- Step 0.1 OPENs: resource mutators CLOSED; identity / Stripe webhook / Stripe·Paystack confirm / guest fashion-chat ACCEPTED in `UNUSED_OR_IDENTITY_APIS`

## Verification matrix (Step 7.2)

End-to-end RBAC / isolation / tenancy checks (API + proxy UI gates). Run with the dev server up:

```bash
yarn verify-rbac
```

Requires `.env.local`: `DATABASE_URL`, `JWT_SECRET`. Optional: `BASE_URL` (default `http://localhost:3000`), `DEFAULT_ORG_ID`.

The script bootstraps matrix fixtures (`rbac-matrix-*@test.local` users, org A/B products/orders), runs `scripts/fix-wallet-reference-index.mjs` (idempotent), then asserts:

| Block | Coverage |
|---|---|
| **A** Anonymous | Public catalog 200; admin + order/cart/wallet IDOR → 401 |
| **B** Client | Own cart/order/wallet 200; others' IDs 403; catalog POST + admin API 403; `/admin` → `/403` |
| **C** `platform_admin` | Staff products/fabrics/categories, members, analytics, tax; `/admin` allowed |
| **D** `catalog_editor` | Catalog reads OK; tax/users/orders manage 403 |
| **E** `ops_manager` | Orders + customizations OK; catalog write + tax 403; **CWV=false** order list own-scope |
| **F** `finance` | Tax + analytics OK; catalog write + orders list 403 |
| **G** Cross-tenant | Org A admin denied on org B product + order (403 `Cross-tenant access denied`) — fixture `other-org` / `yarn ensure-second-org` |
| **H** Role change | Stale JWT → 401 after `authzVersion` bump; fresh token + `/api/auth/me` reflect new preset |
| **I** Signup | `role: "admin"` in body ignored → DB `client` (never creates Organization) |
| **J** Resource policies | `orders:manage` cannot change amount; finance cannot delete product |
| **K** Members (Phase 3) | Over-grant invite 403; catalog_editor members denied; last-admin demote 403; template delete-while-assigned; invite allowed after **revoked** other-org seat; invite refused for **active** other-org seat |
| **L** Multi-company (Phase 4/5) | HTTP `POST /api/auth/register-company` ×2 → **pending** + `/company-pending`; pending staff catalog denied; pending billing plans **403**; Harewa approve → ops unlock; B→A staff product **403**; public list/detail excludes company product; company B denied storefront-only `/api/customization`; approved billing plans **200**; portal ignores foreign `orgId` |

**Customer vs tailor:** Clients stay on storefront + `/profile`; tailor preset is not staff (`isStaffPreset`); studio under `/tailor/*`. Storefront catalog continues to use the **default / `DEFAULT_ORG_ID` org**, not a registered company’s JWT `orgId`.

**No org switcher / no Part B ERP** in this matrix — primary membership is single-org JWT only.

**Note:** `scripts/fix-wallet-reference-index.mjs` is a legacy Mongo index helper kept for migration-era DBs. Prisma/Postgres deployments skip it (no-op without `MONGO_URI`). Wallet uniqueness is `Wallet.userId @unique` in `prisma/schema.prisma`.

## Production readiness (Phase 5)

Org-membership RBAC + multi-company onboarding is verification-ready when:

1. `yarn ensure-default-org` has run (storefront org exists).
2. `.env.local` has `DATABASE_URL` + `JWT_SECRET` (optional `DEFAULT_ORG_ID`, `BASE_URL`).
3. `yarn dev` is up and `yarn verify-rbac` is green (blocks A–L). For frequent local re-runs, set `DISABLE_AUTH_RATE_LIMIT=1` in `.env.local` (dev only).
4. Company admins use `/register-company`; storefront admins use `yarn create-admin` (not customer `/signup`).
5. `verify-rbac` is a **manual** gate (not wired into CI in this repo).

### Phase 5 completion checklist

- [x] Matrix A–L covers CWV own-scope, members over-grant, last admin, cross-tenant G, signup I, stale H, two-company L
- [x] `ensure-second-org` still valid alongside self-serve registration
- [x] README: presets, `DATABASE_URL` SSOT, CWV honesty, Account→Organization, register-company vs signup
- [x] Customer vs tailor surfaces stay separate; no Part B ERP / org switcher
- [x] `yarn verify-rbac` green on this environment (last recorded: 103/103 A–L). Re-run after analytics ActivityLog tenant fix before ship.

## Resource policies & audit (Step 7.3)

Optional stretch after 7.2 passes:

| Feature | Location |
|---|---|
| **Permission denial audit** | `authErrorToResponse(err, authAudit(req, route, …))` → ActivityLog (`Permission Denied` / `Auth Required`, `entityType: System`) |
| **Membership audit** | Successful mutates: `logMembershipActivity` (Step 6.1); denials audited via `authAudit` on `/api/admin/members*` |
| **Resource policies** | `src/lib/auth/resourcePolicy.ts` — `orders:manage` cannot mutate financial fields; `products:delete` required for catalog delete (tax:manage alone insufficient) |
| **Rate limiting** | In-memory auth buckets (e.g. `register-company` 6/hour per IP **and** email or session user id via `authRateLimited` on **new** registrations / failed attempts). Password-verified or session **AFTER** re-issue (already company admin) does **not** consume the bucket. For local `yarn verify-rbac` re-runs, set `DISABLE_AUTH_RATE_LIMIT=1` in `.env.local` (**ignored when `NODE_ENV=production`**). Redis/edge limiting still not used. |

Sensitive routes wired for denial audit: `/api/admin/members*`, `/api/admin/tax-settings`, `PUT /api/order/[id]`, `DELETE /api/product/[id]`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
