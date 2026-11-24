# Harewa — Company SaaS Backend Implementation Prompt (Cursor)

> **HISTORICAL — do not treat as live SSOT.** Steps 1–4 control plane are complete.
> Live SSOT: `README.md` (“Company SaaS hardening complete”), `.cursor/rules/saas-venue-platform.mdc`,
> `src/lib/subscriptionPlans.ts`, [`docs/saas-module-extension.md`](./docs/saas-module-extension.md),
> [`docs/postgres-rls.md`](./docs/postgres-rls.md). Prefer those + live code over any fashion/catalog-only
> package wording below. Do **not** re-run Step 1–4 prompts; start new work from the Next epics list in README.
> Security rules in this file that still match live code remain valid; do not contradict them.

> **How to use this file**  
> Copy everything from the section **「CURSOR AGENT PROMPT — START」** through **「CURSOR AGENT PROMPT — END」** into a new Cursor Agent chat and instruct the agent to begin at **Step 1**.  
> When all four steps are complete, copy the **「FOLLOW-UP AUDIT PROMPT」** section into a fresh (or continued) Agent chat and require every checklist item to PASS with fixes applied in-session.  
> Do **not** commit unless the user explicitly asks.

---

## CURSOR AGENT PROMPT — START

# Role & mission

You are a senior full-stack engineer implementing a **world-class multi-tenant Company SaaS layer** on the existing Harewa Next.js (App Router) + Prisma/Postgres codebase at the workspace root.

**Product thesis:** Registered companies subscribe to Harewa packages and use Harewa as **their company backend** (catalog, orders, members, tax, shipping, invoices, receipts, emails, quotations/branding). Harewa remains the platform operator; the public Harewa storefront catalog is **never** locked by a tenant company’s status.

**Your job:** Extend what is already built (org pending → approve → suspend + subscription foundation columns). Do **not** rebuild Phase 4 registration from scratch. Close every gap: **Company Profile**, **subscription packages + Stripe Billing**, **plan limits**, **dashboards**, **permission metrics/catalog**, **expiry automation**, **document/email branding**, **smokes**, **README**, and **security hardening**.

Work in **exactly four steps**. At the start of Steps 2–4, write a short **Previous step audit** (PASS/FAIL checklist) and **fix any FAIL before** starting new work. After each step, leave the tree buildable and summarize files created/changed + how to test.

---

# Absolute non-negotiables (fail the task if violated)

1. **Customer vs Tailor separation** (workspace rule `.cursor/rules/customer-vs-tailor-sections.mdc`):
   - Customer surfaces: shop, cart, checkout, `/profile`, `/tailors` discovery, `/join/[slug]`.
   - Tailor studio: `/tailor/*` only.
   - Company SaaS admin (profile, billing, catalog ops): `/admin/*` for that company’s staff.
   - Never put company billing/profile editors on `/tailor/*` or customer `/profile` as primary workspace tools.
2. **No org switcher** — one live company Membership seat per user (`orgRegistration.ts` / `memberAdmin.ts` patterns).
3. **Public Harewa storefront** uses `DEFAULT_ORG_ID` / `getStorefrontOrgId()` / `storefrontOrgFilter()` — never JWT `orgId` of a registered company for public catalog.
4. **Only Harewa storefront `platform_admin`** may approve/suspend companies (`assertStorefrontPlatformAdmin` in `src/lib/companyApproval.ts`).
5. **Never trust client-supplied `orgId`** — stamp from JWT via `requireActorOrgId` / `staffOrg`.
6. **Org status gates** (keep & extend):
   - `assertOrganizationNotSuspended` — session OK for `pending`; fail on `suspended`.
   - `assertOrganizationActive` — staff PermissionFresh require `active`.
7. **Separate Stripe metadata namespaces** from customer commerce:
   - Existing: `type: "order" | "tailoring" | "wallet"`.
   - New: `type: "company_subscription"` (+ `orgId`, `plan`, `actorSub`).
8. **Do not** settle company subscriptions inside order/tailoring settle helpers.
9. **Do not** weaken `PAYMENT_POLICY` (Stripe UI on / Paystack UI off / wallet API-only for customer commerce).
10. **Permissions + nav + routePolicy + API catalog + dashboards + README + smokes** must update in the **same step** that adds routes — no orphan APIs.
11. UI language: existing Harewa gold `#D4AF37`, stone/gray layouts. No purple AI-slop themes. Match TaxSettings / ShippingSettings admin patterns.
12. Prefer performance: parallel `Promise.all` counts, thin DTOs, CDN logo URLs (never base64 in JWT), no N+1, React Query keys scoped by `orgId`, reuse `prefetchAdminRoute` where appropriate.
13. Do **not** create git commits unless the user explicitly asks.

---

# What already exists (READ BEFORE CODING — do not regress)

## Org approval + subscription foundation

| Concern | Path |
|---|---|
| `OrgStatus` enum `pending\|active\|suspended` | `prisma/schema.prisma` |
| Org fields `subscriptionPlan`, `subscriptionStatus`, `subscriptionEndsAt`, `approvedAt`, `approvedById` | `prisma/schema.prisma` → `Organization` |
| Migration | `prisma/migrations/20260908120000_org_pending_subscription_foundation/` |
| Plan/status constants | `src/lib/org.ts` — `ORG_SUBSCRIPTION_PLANS`, `ORG_SUBSCRIPTION_STATUSES` |
| Gates | `src/lib/org.ts` — `assertOrganizationNotSuspended`, `assertOrganizationActive` |
| Register helper (creates `pending`) | `src/lib/orgRegistration.ts` — `createOrganizationWithPlatformAdmin` |
| Finders | `findRegisteredCompanyAdminOrgId` (active), `findPendingRegisteredCompanyAdminOrgId`, `findSuspendedRegisteredCompanyAdminOrgId` |
| Approve/suspend | `src/lib/companyApproval.ts` |
| Register API | `src/app/api/auth/register-company/route.ts` → redirect `/company-pending` |
| Register UI | `src/app/(auth-user)/register-company/page.tsx` |
| Waiting room | `src/app/(auth-user)/company-pending/page.tsx` |
| Admin API | `src/app/api/admin/registered-companies/route.ts` (`GET`, `PATCH`) |
| Admin UI | `src/app/(admin)/admin/registered-companies/page.tsx` |
| Pending redirect in shell | `src/components/Protected/admin/layout/AdminLayout.tsx` |
| Fresh middleware | `src/lib/middleware/requireAuth.ts` |
| Nav “Companies” | `src/lib/adminNav.ts` |
| Route perms + storefront-only | `src/lib/auth/permissions.ts` — `ADMIN_ROUTE_PERMISSIONS`, `ADMIN_STOREFRONT_ONLY_PATHS`, `API_PERMISSIONS` |
| Page inventory | `src/lib/auth/routePolicy.ts` — `ADMIN_PAGES` |
| `/me` org payload | `src/app/api/auth/me/route.ts` — `organization`, `orgStatus` |
| Session types | `src/services/auth.ts` — `orgStatus`, `organizationName` |
| Smokes | `scripts/smoke-phase4-register-company.mts`, matrix **L** in `scripts/verify-rbac-matrix.mjs` |
| Docs | `README.md` — Multi-company registration / approval tables |

## Patterns to clone

| Pattern | Path |
|---|---|
| Tax 1:1 org settings | `TaxSettings` model; `src/lib/taxSettings.ts`; `src/app/api/admin/tax-settings/route.ts`; `src/components/Protected/admin/pages/tax-settings/TaxSettingsPage.tsx`; page route under `src/app/(admin)/admin/tax-settings/` |
| Shipping 1:1 org | `ShippingSettings`; `src/lib/shipping/settings.ts`; admin shipping-settings routes/UI |
| Staff tenancy | `src/lib/staffOrg.ts` — `requireActorOrgId`, `actorOrgFilter`, `assertStorefrontStaffOrg`, CWV |
| ActivityLog | `src/lib/audit/activityLog.ts` — `logStaffActivityEntry` |
| Uploads | `src/lib/cloudinary.ts`, `src/lib/upload.ts`, `src/app/api/upload/route.ts` (+ sign/bulk) |
| Email | `src/lib/mailer.ts` (nodemailer SMTP; currently hardcoded Harewa brand) |
| Invoice/receipt email | `src/lib/sendInvoice.ts`, `src/lib/sendReceipts.ts` |
| Order print | `src/components/Protected/admin/pages/orders/print/OrderPrint*.tsx` |
| Stripe commerce | `src/lib/stripe.ts`; `src/app/api/webhooks/stripe/route.ts`; payment confirm routes |
| Analytics | `src/app/api/analytics/route.ts`; `src/services/analytics.ts` |
| Dashboard cards | `src/components/Protected/admin/pages/components/dashboard/*` |
| Admin permission UI gate | `src/hooks/useAdminPermission.ts`; `AdminSidebar.tsx` filters via `can()` + storefront-only |
| Prefetch | `src/lib/prefetchAdminRoute.ts` |
| Env loading for scripts | `scripts/prisma-env.mjs` — `loadDatabaseUrl()` |

## Explicit gaps this prompt closes

> **Status (2026-09-09):** These gaps are closed in-tree. Prefer README + smokes
> (`smoke:company-profile`, `smoke:company-subscription`, `smoke:plan-limits`,
> `reconcile:subscriptions`) over this historical list.

- ~~No `CompanyProfile`~~ → `CompanyProfile` + `/admin/company-profile` + branding
- ~~No SaaS subscription Checkout~~ → Stripe company billing + webhooks + `subscriptionEndsAt`
- ~~No plan-limit enforcement~~ → `planLimits.ts` + usage API + UI meters
- ~~No per-tenant branding~~ → mailer/invoice/receipt/print + Reply-To
- ~~No dashboard metrics~~ → CompaniesOverviewCards + CompanyPlanUsageCards
- ~~No expiry reconcile job~~ → `yarn reconcile:subscriptions`
- VenueFlow marketing Starter/Growth/Enterprise copy is **not** org billing — do not wire billing to VenueFlow pages.

---

# Domain model for packages (Harewa-native — NOT venues)

Create SSOT: `src/lib/subscriptionPlans.ts` (re-export plan ids from `org.ts` to avoid drift).

| Plan id | Positioning | Default monthly Price | Suggested limits (constants; tune in one file) |
|---|---|---|---|
| `starter` | Small studio | env `STRIPE_PRICE_STARTER_MONTHLY` | members ≤ 3; products ≤ 50; fabrics ≤ 50; categories ≤ 20; tailor seats ≤ 1; campaigns ≤ 2; TailorClients ≤ 25 |
| `growth` | Growing brand | env `STRIPE_PRICE_GROWTH_MONTHLY` | members ≤ 15; products ≤ 500; fabrics ≤ 500; categories ≤ 100; tailor seats ≤ 5; campaigns ≤ 20; TailorClients ≤ 100 |
| `enterprise` | Custom | env optional / Contact sales | unlimited or very high caps; may be ops-stamped without Stripe |

Also define feature bullets for UI (Harewa modules that actually exist: catalog, orders, shipping, tax, members/RBAC, tailor jobs, campaigns, AI chats if storefront-only note carefully).

`subscriptionStatus` values (already in `org.ts`): `none | trialing | active | past_due | canceled | expired`.

---

# Permission / nav / dashboard sync rule (EVERY STEP)

Whenever you add or change a surface, update **all** of the following in the same step:

1. `src/lib/auth/permissions.ts`
   - `P.*` constant if new permission needed (prefer reuse `settings:manage` / `users:manage_roles` / `analytics:read` unless a clean `billing:manage` is justified)
   - `ROLE_PRESETS` / preset metadata if new permission
   - `ADMIN_ROUTE_PERMISSIONS`
   - `ADMIN_ROUTE_MUTATION_PERMISSIONS`
   - `ADMIN_STOREFRONT_ONLY_PATHS` (if Harewa-ops-only)
   - `API_PERMISSIONS` catalog entries with accurate notes
   - Header/inventory comments that still claim “immediate /admin after register”
2. `src/lib/adminNav.ts` — sidebar entries
3. `ADMIN_DASHBOARD_QUICK_LINKS` in `adminNav.ts` — quick links where relevant
4. `src/lib/auth/routePolicy.ts` — `ADMIN_PAGES`
5. Dashboard components under `src/components/Protected/admin/pages/components/dashboard/`
6. Frontend pages under `src/app/(admin)/admin/...`
7. `README.md` slice for the feature
8. Smoke scripts + `package.json` yarn scripts
9. `scripts/verify-rbac-matrix.mjs` when HTTP behavior changes

---

# STEP 1 — Tenant Company Profile (identity for documents, emails, invoices, receipts)

## 1.0 Pre-flight audit (foundation)

Before any Step 1 code, verify and fix:

- [ ] `POST /api/auth/register-company` creates `Organization.status = pending`, `subscriptionStatus = none`, redirects `/company-pending`
- [ ] Harewa storefront `platform_admin` can `PATCH /api/admin/registered-companies` approve/suspend
- [ ] Pending JWT: `requireAuthFresh` OK; `requirePermissionFresh` denied with pending message
- [ ] Suspended JWT: Fresh denied
- [ ] Public `GET /api/product` still storefront-scoped when a company is suspended
- [ ] `AdminLayout` redirects `orgStatus === "pending"` → `/company-pending`
- [ ] `ADMIN_STOREFRONT_ONLY_PATHS` includes `/admin/registered-companies`
- [ ] `yarn smoke:phase4-register` still conceptually correct (pending start)

If anything fails, fix foundation first.

## 1.1 Prisma schema — `CompanyProfile`

Add model (preferred 1:1 like `TaxSettings`), relation on `Organization`:

```prisma
model CompanyProfile {
  id        String   @id @default(cuid())
  orgId     String   @unique
  org       Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  legalName     String?
  tradingName   String?
  logoUrl       String?
  logoPublicId  String?

  supportEmail  String?
  billingEmail  String?
  replyToEmail  String?
  phone         String?
  website       String?

  addressLine1  String?
  addressLine2  String?
  city          String?
  state         String?
  country       String?
  postalCode    String?

  taxId         String?  // VAT / TIN

  // Bank — store secrets carefully (see 1.2)
  bankName              String?
  bankAccountName       String?
  bankAccountLast4      String?
  bankAccountCiphertext String?  // encrypted full number if product requires display-on-invoice
  bankRoutingOrIban     String?
  bankCurrency          String?  // e.g. NGN, USD, GBP

  invoiceFooterNote     String?
  receiptFooterNote     String?
  letterheadColor       String?  // optional accent; default brand gold if null

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("company_profiles")
}
```

- Create migration: `prisma/migrations/YYYYMMDDHHMMSS_company_profile/migration.sql`
- Apply via project’s env pattern (`scripts/prisma-env.mjs` + `prisma migrate deploy` / `yarn db:migrate` as appropriate)
- `npx prisma generate`
- Update `src/lib/models/` if the repo mirrors models there

## 1.2 Encryption & redaction for bank details

- Add `src/lib/companyProfileCrypto.ts` (or extend an existing secrets helper if present):
  - Encrypt `bankAccountCiphertext` with server secret from env `COMPANY_PROFILE_ENCRYPTION_KEY` (required in production; document in README)
  - Never return ciphertext to clients
  - List/GET responses: return `bankAccountLast4`, `bankName`, `bankAccountName`, `bankCurrency`, `hasBankAccount: boolean` — full number only to actors with `settings:manage` **and** only on explicit `?revealBank=1` **or** never reveal (prefer never reveal; invoices use last4 + account name)
- ActivityLog metadata: never include full account numbers

## 1.3 Library — `src/lib/companyProfile.ts`

Implement:

| Function | Behavior |
|---|---|
| `getCompanyProfile(orgId)` | Prisma findUnique; throw/not-found as appropriate |
| `getOrEmptyCompanyProfile(orgId)` | For forms |
| `upsertCompanyProfile(actor, input)` | `requireActorOrgId`; org must be `active` via `assertOrganizationActive`; validate emails/URLs/phone; encrypt bank if provided; clear bank if `clearBank: true` |
| `getCompanyBrandForDocuments(orgId)` | Safe DTO: legal/trading name, logoUrl, supportEmail, replyToEmail, address lines, taxId, bank last4 + bank name/account name, footers — **no ciphertext** |
| `getPlatformBrandFallback()` | Harewa/Skyline defaults (`/logoNobg.webp`, platform support email from env) |
| `resolveBrandForOrg(orgId \| null)` | Company brand if profile sufficiently complete, else platform fallback |
| `computeProfileCompleteness(profile)` | 0–100 score for dashboard (legalName, logo, supportEmail, address, bank optional weight) |

Validation rules (Zod or manual, match repo style):

- Emails: max length, basic format
- `website`: http(s) only
- Country/postal: length caps
- Logo URL: must be Cloudinary host allowlist if you already allowlist elsewhere
- Reject HTML in footer notes (strip tags) to prevent email HTML injection

## 1.4 Upload — company logo

- Prefer extending upload pipeline with folder `company-profiles/{orgId}`
- Options:
  - A) `POST /api/admin/company-profile/logo` — multipart or signed Cloudinary upload then PATCH profile
  - B) Reuse `POST /api/upload` with server-side folder override only when Fresh + settings:manage + active org
- Constraints: image MIME only (`image/jpeg`, `image/png`, `image/webp`); max size aligned with existing upload limits; delete previous `logoPublicId` on replace when safe
- On logo change: update `logoUrl` + `logoPublicId` in same transaction as profile upsert when possible

## 1.5 API routes

### `src/app/api/admin/company-profile/route.ts`

| Method | Auth | Behavior |
|---|---|---|
| `GET` | `requirePermissionFresh(P.SettingsManage)` **or** `requireAnyPermissionFresh` including read if you split read/write — default: settings:manage for both, or `settings:manage` write + allow `analytics:read`? Prefer: GET allowed for any staff with `settings:manage` OR platform_admin; if catalog_editor needs to see logo on print, print path loads server-side brand by order.orgId without exposing bank | Return redacted profile + completeness |
| `PUT` | `requirePermissionFresh(P.SettingsManage)` | Upsert; ActivityLog `Company Profile Updated`; return redacted profile |

Rules:

- Org must be `active`
- `assertOrganizationActive(actor.orgId)`
- Never accept `body.orgId` as authority
- Cross-tenant impossible by construction

### Optional `src/app/api/admin/company-profile/logo/route.ts`

`POST` — Fresh + settings:manage + active org → upload → update profile → ActivityLog `Company Logo Updated`

### Permissions catalog entries (mandatory)

In `API_PERMISSIONS`:

- `"GET /api/admin/company-profile"`
- `"PUT /api/admin/company-profile"`
- `"POST /api/admin/company-profile/logo"` (if created)

Notes must mention actor.orgId isolation and bank redaction.

## 1.6 Admin frontend

### Routes / files to create

| File | Purpose |
|---|---|
| `src/app/(admin)/admin/company-profile/page.tsx` | Page entry (server or client wrapper matching tax-settings pattern) |
| `src/components/Protected/admin/pages/company-profile/CompanyProfilePage.tsx` | Form UI |
| Optional field components under same folder | Logo uploader, address block, bank block, email identity block, footer notes |

### UX requirements

- Mirror `TaxSettingsPage.tsx` layout density and save patterns
- Sections: Identity (legal/trading/logo), Contact (support/billing/replyTo/phone/website), Address, Tax ID, Bank (masked), Document footers
- Show completeness meter
- Save button with loading/error/toast (`useToast`)
- Disable entire form with clear banner if somehow reached while pending (AdminLayout should prevent)
- Harewa gold accents; no card spam in hero — this is a settings form, cards OK for section containers if existing settings pages use them

### Nav / permissions / routePolicy / quick links

Update:

- `ADMIN_ROUTE_PERMISSIONS["/admin/company-profile"] = P.SettingsManage`
- `ADMIN_ROUTE_MUTATION_PERMISSIONS["/admin/company-profile"] = P.SettingsManage`
- `adminNav.ts` Store settings children: `{ name: "Company profile", href: "/admin/company-profile" }`
- `ADMIN_DASHBOARD_QUICK_LINKS.store` — add “Company profile” with `settings:manage`
- `routePolicy.ts` `ADMIN_PAGES` include `/admin/company-profile`
- `AdminSidebar` already filters via permissions + storefront-only — ensure company-profile is **NOT** storefront-only (every active company needs it)

## 1.7 Wire branding into document/email pipelines

### Must update

| Consumer | Path | Rule |
|---|---|---|
| Email HTML wrapper | `src/lib/mailer.ts` — `wrapEmailHtml` / send helpers | When email is **org-scoped** (order paid, order status, membership invite from company, tailoring quote/status for org job), use `resolveBrandForOrg(orgId)` for logo, company name, support/reply-to |
| Invoice email | `src/lib/sendInvoice.ts` | Org brand + bank last4/name on invoice HTML |
| Receipt email | `src/lib/sendReceipts.ts` | Org brand |
| Order print | `OrderPrintHeader.tsx`, `OrderPrintFooter.tsx` | Company logo, legal name, address, taxId, bank summary |
| Tailoring notification emails | Find send sites in `mailer.ts` / tailoring libs | Prefer job’s org brand |

### Must NOT change branding for

- Password reset, email verification OTP, Google link emails
- Platform-level Harewa marketing
- Storefront-only AI settings emails if any remain platform-owned

Implement a clear helper:

```ts
function isPlatformAuthEmail(kind: string): boolean
```

so branding selection cannot accidentally white-label OTP emails.

## 1.8 `/api/auth/me` + session frontend

Extend organization payload (no bank secrets):

```ts
organization: {
  id, name, status,
  subscriptionPlan, subscriptionStatus, subscriptionEndsAt,
  profileCompleteness?: number,
  hasLogo?: boolean,
  legalName?: string | null,
}
```

Update:

- `src/app/api/auth/me/route.ts`
- `src/services/auth.ts` — `UserProfile` / `normalizeSessionUser` / `toUserProfile` as needed
- Any admin header that should show company legal name

## 1.9 Dashboard updates (Step 1)

### Company-tenant dashboard (`StoreOverviewCards` or new `CompanyProfileOverviewCard.tsx`)

When `!isStorefrontOrgSession(user)`:

- Card: “Company profile” → completeness % → CTA `/admin/company-profile`
- Warn if completeness < threshold (e.g. 60%)

### Storefront Harewa dashboard

- No need for per-tenant profile completeness of all companies here (that’s Step 3 metrics)
- Optionally leave unchanged in Step 1

### Analytics

- Do not bloating `GET /api/analytics` yet; completeness can come from `/me` or company-profile GET

## 1.10 Smoke — `scripts/smoke-company-profile.mts`

Using `loadDatabaseUrl()` + Prisma:

1. Create user + `createOrganizationWithPlatformAdmin` → pending
2. Assert upsert while pending fails at lib/API level (or activate org first)
3. Set org `active`, upsert profile with bank number → assert DB has ciphertext, API DTO has last4 only
4. Second org cannot read/write first org profile
5. `getCompanyBrandForDocuments` returns safe fields
6. Cleanup rows

Add `package.json`: `"smoke:company-profile": "npx tsx scripts/smoke-company-profile.mts"`

## 1.11 README (Step 1)

Document Company Profile purpose, fields, encryption env key, branding fallback rules, routes.

## 1.12 Step 1 exit criteria

- [ ] Migration applied; client generated
- [ ] Active company can CRUD profile; pending/suspended cannot
- [ ] Cross-tenant 403
- [ ] Bank redaction + no plaintext in ActivityLog
- [ ] Logo upload org-scoped
- [ ] Org-scoped emails/print use company brand; platform auth emails unchanged
- [ ] permissions + nav + routePolicy + quick links + README + smoke done
- [ ] Admin dashboard shows completeness for company tenants
- [ ] `yarn smoke:phase4-register` still passes
- [ ] `yarn smoke:company-profile` passes

**Stop and report** before Step 2.

---

# STEP 2 — Subscription packages, Checkout, Portal, Webhooks, `subscriptionEndsAt`

## 2.0 Previous step audit (mandatory)

Re-verify every Step 1 exit criterion. Grep for:

- orphan `/api/admin/company-profile` without catalog entry
- hardcoded Harewa logo still used on org-scoped invoice paths
- bank ciphertext leaked in `/me`

Fix FAILs before billing work.

## 2.1 Plan SSOT module

Create `src/lib/subscriptionPlans.ts`:

- `SUBSCRIPTION_PLANS` detailed objects: `id`, `name`, `tagline`, `features[]`, `limits`, `stripePriceEnvKey`, `highlighted`, `cta: "checkout" | "contact"`
- `getSubscriptionPlan(id)`, `listSubscriptionPlansForUi()`, `getPlanLimits(id)`, `resolveStripePriceId(id)`
- Re-export / dual-source with `ORG_SUBSCRIPTION_PLANS` in `org.ts` (single source of truth — avoid divergent arrays)

Env (document in README + `.env.example` if present):

```
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_GROWTH_MONTHLY=price_...
STRIPE_PRICE_ENTERPRISE_MONTHLY=price_...  # optional
STRIPE_COMPANY_BILLING_SUCCESS_URL=...     # or derive from NEXT_PUBLIC_APP_URL
STRIPE_COMPANY_BILLING_CANCEL_URL=...
```

Demo pricing amounts may live in plan SSOT for UI display; charge via Stripe Price IDs only.

## 2.2 Schema — billing identifiers on Organization

Add to `Organization` (or 1:1 `CompanyBilling`):

```prisma
stripeCustomerId              String?   @unique
stripeSubscriptionId          String?   @unique
subscriptionInterval          String?   // "month"
subscriptionCancelAtPeriodEnd Boolean   @default(false)
```

Migration + generate.

Also ensure approve/suspend/webhook paths **write** `subscriptionEndsAt` (today it is read-only in app code).

## 2.3 Billing library — `src/lib/companyBilling.ts`

| Function | Behavior |
|---|---|
| `getCompanyBillingState(orgId)` | plan, status, endsAt, cancelAtPeriodEnd, hasCustomer, hasSubscription (no secrets) |
| `ensureStripeCustomerForOrg(org, actorEmail)` | create Stripe customer with metadata `{ orgId }`; save `stripeCustomerId` |
| `createCompanySubscriptionCheckout({ orgId, plan, actor, successUrl, cancelUrl })` | org `active`; plan not enterprise-contact unless price configured; Checkout `mode: "subscription"`; metadata `type: "company_subscription"`; `client_reference_id = orgId`; idempotency key recommended |
| `createCompanyBillingPortal({ orgId, actor, returnUrl })` | customer must belong to org |
| `applyStripeSubscriptionToOrg(orgId, stripeSub, eventId)` | map status → `subscriptionStatus`; set plan from price id mapping; set `subscriptionEndsAt` from `current_period_end`; set `stripeSubscriptionId` |
| `markOrganizationSubscriptionExpired(orgId, reason)` | `status: suspended`, `subscriptionStatus: expired`; ActivityLog; **do not** touch storefront default org |
| `mapStripePriceIdToPlan(priceId)` | env reverse map |

Enterprise “Contact sales”: checkout disabled; CTA mailto or link to support; Harewa ops can still stamp plan on approve.

## 2.4 Extend `companyApproval.ts`

On **approve**:

- If `subscriptionPlan` provided: set `subscriptionStatus` to `active` (ops grant) or `trialing` if you introduce trial days
- Optionally set `subscriptionEndsAt = now + trialDays` when ops grant without Stripe
- Do not invent Stripe ids on manual approve

On **suspend** (ops hold from registered-companies):

- Set `status: suspended` + `subscriptionStatus: ops_hold` via `organizationOpsHoldData()` (not billing `expired`)
- Self-serve renew stays locked until **Approve** or emergency **Set plan**
- Optionally schedule Stripe cancel via API if `stripeSubscriptionId` present (best-effort; don’t fail suspend if Stripe down — queue/log)
- Never delete org / venues / catalog / orders / memberships / history
- Per-user soft lock is separate: `User.accountSuspended` via `/api/admin/platform-accounts`

## 2.5 API routes

Create namespace (pick one and stay consistent):

### Recommended: `/api/admin/billing/*`

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/admin/billing/plans` | GET | `requireAuthFresh` + staff + org **active** (PermissionFresh with `P.SettingsManage` or platform_admin) | Returns plan catalog + current org billing state |
| `/api/admin/billing/checkout` | POST | `requirePermissionFresh(P.SettingsManage)` + active org + preferably `platform_admin` only for paying | Body `{ plan }` → `{ url }` Checkout |
| `/api/admin/billing/portal` | POST | same | → `{ url }` Customer Portal |
| `/api/admin/billing/state` | GET | settings:manage | Thin billing state for dashboard widgets |

Rate-limit checkout POSTs (reuse `authRateLimited` patterns or dedicated bucket per orgId+IP).

### Harewa ops (existing)

- Keep `/api/admin/registered-companies` — enrich response with stripeCustomerId presence boolean, endsAt, plan (already partially there)

### Catalog

Add full `API_PERMISSIONS` entries for every billing route.  
`ADMIN_ROUTE_PERMISSIONS["/admin/billing"] = P.SettingsManage`  
Mutation map for billing page.  
**Not** storefront-only (company admins need billing).  
Registered-companies remains storefront-only.

## 2.6 Stripe webhook — `src/app/api/webhooks/stripe/route.ts`

### Keep unchanged

- `checkout.session.completed` for `type: order|tailoring` settlement paths
- Signature verification
- Idempotency patterns already used

### Add handlers

1. `checkout.session.completed` when `metadata.type === "company_subscription"` OR session.mode === `subscription` with metadata orgId:
   - Verify orgId ↔ customer binding
   - Retrieve subscription; `applyStripeSubscriptionToOrg`
2. `customer.subscription.updated` / `customer.subscription.deleted`
3. `invoice.payment_failed` → `subscriptionStatus = past_due` (config: grace; do not suspend immediately unless product says so)
4. `invoice.paid` → ensure `active`/`trialing` and refresh `subscriptionEndsAt`

### Safety

- Ignore events for unknown customers
- Never activate a **pending** org solely via payment unless product explicitly wants pay-to-unlock (default: **require prior Harewa approve**; if pending, log + skip or mark billing ready but keep status pending)
- Default policy: **Checkout allowed only if `Organization.status === active`**
- System ActivityLog entries with `domain: "company-billing"`

## 2.7 Admin frontend — Billing

| File | Purpose |
|---|---|
| `src/app/(admin)/admin/billing/page.tsx` | Route |
| `src/components/Protected/admin/pages/billing/BillingPage.tsx` | Plan cards UI |
| `BillingPlanCard.tsx` | Starter/Growth/Enterprise |
| `BillingStatusBanner.tsx` | current plan/status/endsAt/past_due warnings |

### UX

- Title + short subtitle (one job per section)
- Three plans; highlight Growth as most popular if desired (subtle border, not tacky stickers overload)
- Current subscription summary at top
- Buttons: Choose plan → redirect to Stripe; Manage billing → portal; Contact sales for enterprise
- Success/cancel query params show toast
- Disabled states for pending (shouldn’t reach page) and suspended (optional reactivate messaging)

### Nav

- Store settings: `{ name: "Billing", href: "/admin/billing" }`
- Quick link for company tenants
- `routePolicy` `ADMIN_PAGES`
- Prefetch billing route from dashboard if pattern exists

### Update registered-companies UI

- Show `subscriptionEndsAt`, plan, status, `hasStripeCustomer`
- Approve dropdown still stamps plan (ops path)

### Update company-pending copy

- Clarify: after Harewa approval you can open Billing to choose a package; expiry suspends company admin access

## 2.8 `/me` + session

Expose safe billing fields already on organization (plan/status/endsAt). Ensure frontend `UserProfile` keeps them updated after portal return (`getMe({ force: true })`).

## 2.9 Dashboard updates (Step 2)

### Company tenant

- New card or banner on `/admin`: plan name, status badge, days until renewal, CTA Billing
- If `past_due`: strong warning

### Storefront Harewa

- Defer heavy metrics to Step 3; optional light “Billing ops” link already via Companies page

## 2.10 Smokes

`scripts/smoke-company-subscription.mts`:

- Pending org: checkout helper throws
- Active org: `applyStripeSubscriptionToOrg` with fake stripe-like payload updates DB fields
- `markOrganizationSubscriptionExpired` sets suspended + expired
- Public storefront org remains active
- Price→plan mapping unit checks

Optional: webhook handler unit with mocked Stripe event object (no network).

`package.json`: `"smoke:company-subscription": "npx tsx scripts/smoke-company-subscription.mts"`

Extend `verify-rbac-matrix.mjs` section **L** or new **M**:

- After register (pending): `GET /api/admin/billing/plans` → 403 pending
- After storefront approve: company token billing GET → 200
- Company B cannot portal for company A

## 2.11 README (Step 2)

Document billing flow, env Price IDs, webhook events, approve-vs-Stripe relationship, past_due policy, expiry→suspend.

## 2.12 Step 2 exit criteria

- [ ] Schema + migration for Stripe ids
- [ ] Checkout + portal APIs secured
- [ ] Webhook subscription branch; order/tailoring unbroken
- [ ] `subscriptionEndsAt` written on activate
- [ ] Expiry helper suspends tenant only
- [ ] UI `/admin/billing` + nav + permissions + catalog
- [ ] Smokes + matrix updates
- [ ] Dashboards show plan status for company tenants
- [ ] Phase 4 smoke still green

**Stop and report** before Step 3.

---

# STEP 3 — Plan limits enforcement + usage meters + full dashboard/permission sync

## 3.0 Previous step audit (mandatory)

Verify Step 2 exit criteria. Especially:

- [ ] Order Stripe webhook still settles orders
- [ ] Company webhook cannot suspend `isDefault` / storefront org
- [ ] Billing routes in `API_PERMISSIONS`
- [ ] No VenueFlow pages wired as billing

## 3.1 `src/lib/planLimits.ts`

```ts
export type PlanResource =
  | "members"
  | "products"
  | "fabrics"
  | "categories"
  | "tailorSeats"
  | "campaigns"
  | "tailorClients";

export async function countPlanResource(orgId: string, resource: PlanResource): Promise<number>
export async function assertWithinPlanLimit(orgId: string, resource: PlanResource, adding?: number): Promise<void>
export async function getPlanUsageSnapshot(orgId: string): Promise<UsageSnapshot>
```

Rules:

- Resolve plan from Organization.subscriptionPlan; **policy (picked):** block plan-capped creates until subscription is entitled (`active` | `trialing` | `past_due`) via Checkout or Harewa ops plan stamp. Approve-without-plan leaves `subscriptionStatus: none` → `assertWithinPlanLimit` throws `BILLING_REQUIRED_MESSAGE`. Once entitled, null/empty `subscriptionPlan` uses **starter floors**.
- Enterprise unlimited = `Number.MAX_SAFE_INTEGER` or null means unlimited
- Throw `ForbiddenError` with stable message: `Plan limit reached for {resource} on the {plan} plan` (or billing-required when unpaid)
- **Replace** hardcoded `25` in `src/lib/measurementCampaigns.ts` / tailor client UI with `getPlanLimits(plan).tailorClients`

## 3.2 Call sites (server enforcement — mandatory)

| Resource | Wire into |
|---|---|
| members | `POST /api/admin/members` (invite/assign); block when active+invited seats ≥ cap |
| products | `POST /api/product` (+ bulk create if applicable) |
| fabrics | `POST /api/fabric` |
| categories | `POST /api/product-category` |
| tailor seats | membership assign `rolePreset: tailor` + admin tailor create paths |
| campaigns | campaign create API in measurement campaign routes |
| tailorClients | `POST /api/tailor/clients` (and related) |

UI mirrors:

- Members invite modal — remaining seats
- Product create — disable/submit error
- `TailorHomePage` / `AddClientModal` — plan-driven limit text
- Campaign create UI

## 3.3 Usage API

`GET /api/admin/billing/usage`

- `requirePermissionFresh(P.SettingsManage)` or `P.AnalyticsRead` (document choice; analytics:read is good for dashboard widgets)
- `assertOrganizationActive`
- `Promise.all` counts + limits + plan + endsAt
- Thin JSON for widgets

Catalog entry required.

## 3.4 Dashboard — comprehensive update

### A) Storefront Harewa admin (`isStorefrontOrgSession`)

Extend analytics **or** add `GET /api/admin/registered-companies/metrics`:

- `pendingCount`, `activeCompanyCount`, `suspendedCount`
- `expiringWithin7Days`
- `subscribedCount` (subscriptionStatus in active|trialing)

Wire UI:

- New `CompaniesOverviewCards.tsx` **or** extend `StoreOverviewCards.tsx`
- Quick link already to `/admin/registered-companies`
- Cards must be permission-gated (`users:manage_roles`) and storefront-only

Performance: single SQL groupBy/count query preferred over loading all companies.

### B) Company tenant admin

- `CompanyPlanUsageCards.tsx` — meters for each resource (used/limit/progress)
- Profile completeness card (Step 1)
- Billing status card (Step 2)
- Place on main `/admin` dashboard beside existing KeyMetrics (orders/revenue/customers) — do not remove existing commerce metrics

### C) KeyMetrics / analytics

- Keep commerce metrics org-scoped as today (`GET /api/analytics`)
- Do not mix Harewa platform company counts into tenant analytics responses
- Branch dashboard composition in the admin dashboard page component based on `isStorefrontOrgSession(user)`

Find dashboard page entry (e.g. under `src/app/(admin)/admin/page.tsx` or components composition) and update.

### D) OperationsOverviewCards / TailorsOverviewCards

- Ensure quick links remain accurate
- Add billing/profile links only for company tenants when permissions allow
- No broken hrefs

## 3.5 Frontend permission metrics sync

Audit and update:

- `useAdminPermission.ts` / `isAdminPageAllowed` — storefront-only paths still hide Companies for non-storefront; company-profile & billing visible to company staff with settings:manage
- `AdminSidebar.tsx` — verify new items appear/hide correctly
- Permissions admin UI page (`/admin/permissions`) if it renders catalog — ensure new API notes visible if that page reads `API_PERMISSIONS`
- Preset grants: if you added `billing:manage`, grant to `platform_admin` (and maybe `ops_manager` read-only via separate perm); update `ROLE_PRESETS`

## 3.6 Smokes — `scripts/smoke-plan-limits.mts`

- Active org on starter: create products up to limit; next create throws
- Growth limits higher after plan field update
- TailorClients uses SSOT not hardcoded mismatch
- Usage snapshot counts match

`package.json`: `"smoke:plan-limits": "npx tsx scripts/smoke-plan-limits.mts"`

## 3.7 README (Step 3)

Document limits table, enforcement points, usage endpoint, dashboard differences storefront vs company.

## 3.8 Step 3 exit criteria

- [ ] All create/invite paths listed above enforce limits server-side
- [ ] UI mirrors caps
- [ ] Usage API fast + accurate
- [ ] Storefront dashboard company metrics live
- [ ] Company dashboard usage/plan/profile cards live
- [ ] permissions/nav/quicklinks/catalog fully synced
- [ ] Smokes pass; phase4 still green

**Stop and report** before Step 4.

---

# STEP 4 — Expiry automation, security hardening, E2E verification, polish

> **DONE / SUPERSEDED.** Control plane Step 4 is implemented in-repo (export/offboard, isolation smokes,
> `docs/saas-module-extension.md`, `docs/postgres-rls.md`, `yarn smoke:company-saas-hardening`).
> Do not re-implement from this section — follow README “Company SaaS hardening complete” and Next epics.

## 4.0 Previous step audit (mandatory)

Grep & fix:

- [ ] Remaining hardcoded `25` client limits inconsistent with SSOT
- [ ] Org-scoped invoice/email still forcing Harewa logo
- [ ] Billing/profile routes missing from `ADMIN_PAGES` or catalog
- [ ] Dashboard widgets fetching full bank ciphertext
- [ ] Customer `/checkout` and `/tailor/*` polluted with company billing CTAs

## 4.1 Reconcile job

Create `scripts/reconcile-company-subscriptions.mts`:

1. `loadDatabaseUrl()`
2. Find orgs where:
   - `isDefault === false`
   - `status === active`
   - `subscriptionEndsAt != null && subscriptionEndsAt < now`
   - `subscriptionStatus` in `active|trialing|past_due`
3. Optionally retrieve Stripe subscription if `stripeSubscriptionId` set; if Stripe says still active, refresh endsAt instead of suspending (avoid false suspends)
4. Else `markOrganizationSubscriptionExpired`
5. Print summary counts
6. Exit nonzero on unexpected errors

`package.json`: `"reconcile:subscriptions": "npx tsx scripts/reconcile-company-subscriptions.mts"`

Document cron recommendation in README (e.g. hourly). Safe locally.

## 4.2 Reactivation path (define & implement)

Product rule (implement explicitly):

- After expiry suspend, company admin session fails Fresh.
- Allow **Harewa storefront admin** to approve/reactivate via existing approve path (sets active + optional plan).
- Optional: `POST /api/admin/billing/checkout` rejected while suspended OR allowed only for portal/checkout with a **narrow** `requireAuthFresh` + NotSuspended exception — **prefer**: suspended users see `/company-pending`-like **suspended** page with “Contact Harewa” / wait for ops, and Harewa reactivates after payment arranged.
- Update `company-pending/page.tsx` suspended messaging (already partial) + optional `/company-suspended` if cleaner.

Do not silently unlock catalog writes for suspended orgs.

## 4.3 Security hardening checklist (implement fixes)

- [ ] IDOR matrix: profile, billing state, checkout, portal, usage — all actor.orgId
- [ ] Storefront metrics/companies APIs — `assertStorefrontPlatformAdmin`
- [ ] Webhook signature required; reject body without sig
- [ ] Metadata orgId must match Stripe customer’s stored org
- [ ] Rate-limit billing checkout
- [ ] Logo upload authz + MIME + size
- [ ] Bank encryption key missing → fail closed in production
- [ ] No XSS via footer notes in emails (escape HTML)
- [ ] CSRF: same-site cookies already used — do not introduce bearer tokens in localStorage for billing
- [ ] Do not log Stripe secrets or raw bank numbers
- [ ] Pending cannot hit PermissionFresh APIs
- [ ] Suspended cannot hit PermissionFresh APIs
- [ ] Cannot set `isDefault: true` via profile/billing
- [ ] Cannot register second company / org switcher
- [ ] Public product endpoints ignore tenant suspension of other orgs

## 4.4 Performance polish

- Dashboard: one usage fetch; parallel counts inside API
- Prefetch `/admin/billing` and `/admin/company-profile` from dashboard hover if `prefetchAdminRoute` supports
- Avoid including `CompanyProfile` in every `/me` if heavy — only completeness flags + legalName + hasLogo
- Indexes: ensure `Organization.subscriptionEndsAt`, `status`, `isDefault` filters are indexed if missing (`@@index` on `[status, subscriptionEndsAt]`, `[isDefault, status]`)

Add indexes in a small migration if not present.

## 4.5 Full docs sync

Update `README.md`:

- Architecture diagram in prose: Register → Pending → Approve → Profile → Billing → Limits → Expiry
- Env vars list
- Cron
- Branding rules
- Permission table for new routes
- Smoke commands

Update any stale comments in `permissions.ts` inventory.

## 4.6 Verification commands (run; fix until green)

```bash
npx prisma validate
npx prisma generate
yarn smoke:phase4-register
yarn smoke:company-profile
yarn smoke:company-subscription
yarn smoke:plan-limits
yarn smoke:org-registration-failures
npx tsx scripts/smoke-org-registration-helper.mts
# terminal A: yarn dev
# terminal B:
#   $env:DISABLE_AUTH_RATE_LIMIT="1"   # Windows PowerShell; ignored in production
yarn verify-rbac
npx tsx scripts/reconcile-company-subscriptions.mts
```

Also manually spot-check:

1. Register company → pending UI
2. Harewa approve + starter plan
3. Company profile save + logo
4. Place test order email/print shows company brand (in that tenant)
5. Billing page loads plans
6. Hit product limit
7. Suspend → staff API 403; public Harewa shop OK

## 4.7 Step 4 exit criteria

- [ ] Reconcile job idempotent
- [ ] Security checklist all addressed or explicitly deferred with reason
- [ ] Indexes added if needed
- [ ] README + permissions inventory accurate
- [ ] All smokes + verify-rbac green
- [ ] Dashboards, nav, frontend, permission metrics fully aligned
- [ ] No critical TODOs in new code paths

## Final Step 4 deliverable to user

Write a completion report:

1. Files created
2. Files modified
3. Migrations
4. Env vars required
5. How to test
6. Residual risks / intentional deferrals

---

# Coding standards reminder

- Match existing patterns; small focused diffs per concern
- `logStaffActivityEntry` on staff mutations
- `ForbiddenError` / `UnauthorizedError` + `authErrorToResponse` / `routeErrorResponse`
- Use `connectDB` / prisma patterns used by sibling admin routes
- `export const dynamic = "force-dynamic"` and `runtime = "nodejs"` on admin APIs as siblings do
- Prefer `ok` / `created` / `badRequest` helpers from `src/lib/response.ts`
- Do not skip catalog/nav/dashboard updates “for later”

---

# Execution order

1. Step 1 complete + report  
2. Step 2 (after previous audit)  
3. Step 3 (after previous audit)  
4. Step 4 (after previous audit)  

Begin now with **§1.0 Pre-flight audit**, then implement Step 1.

## CURSOR AGENT PROMPT — END

---

## FOLLOW-UP AUDIT PROMPT

> Paste this into Cursor **after** the four implementation steps finish.

### FOLLOW-UP AUDIT — START

# Mission

You are auditing the Company SaaS Backend implementation (Company Profile + Subscription Billing + Plan Limits + Expiry).  
Do **not** start net-new features. Be adversarial. For every FAIL: **fix in this session**, then re-run the relevant smoke.  
Produce a final PASS/FAIL report with files remediated.

# Method

1. Open `COMPANY_SAAS_SUBSCRIPTION_IMPLEMENTATION_PROMPT.md` and diff the repo against Steps 1–4 exit criteria.
2. Grep and open real files — do not trust comments alone.
3. Confirm runtime wiring: schema → lib → API → permissions catalog → adminNav → routePolicy → page → dashboard → smoke.
4. Fix gaps; re-verify.

---

## A. Foundation regression

- [x] Register → `pending` → `/company-pending`
- [x] Approve/suspend storefront `platform_admin` only
- [x] Pending: AuthFresh OK; PermissionFresh denied
- [x] Suspended: Fresh denied
- [x] Public catalog still storefront org when tenant suspended
- [x] No org switcher / dual membership path introduced
- [x] Customer vs tailor surfaces not polluted with company billing/profile primary nav

## B. Company profile

- [x] `CompanyProfile` model + migration + Organization relation
- [x] `src/lib/companyProfile.ts` + crypto helper
- [x] `GET|PUT /api/admin/company-profile` (+ logo route if promised)
- [x] Cross-tenant 403; pending/suspended blocked
- [x] Bank redaction; no ciphertext in `/me` or ActivityLog
- [x] `/admin/company-profile` in `ADMIN_ROUTE_PERMISSIONS`, mutation map, `adminNav`, `ADMIN_PAGES`, `API_PERMISSIONS`, quick links
- [x] `mailer` / `sendInvoice` / `sendReceipts` / `OrderPrintHeader|Footer` use org brand for org-scoped docs
- [x] Platform auth emails still Harewa
- [x] Dashboard completeness card for company tenants
- [x] `yarn smoke:company-profile` exists & passes

## C. Subscription billing

- [x] `src/lib/subscriptionPlans.ts` SSOT (+ limits)
- [x] Stripe customer/subscription fields on Organization (or CompanyBilling)
- [x] `src/lib/companyBilling.ts` checkout/portal/apply/expire helpers
- [x] `POST /api/admin/billing/checkout` metadata `type: "company_subscription"`
- [x] Portal bound to org’s customer only
- [x] Webhook handles subscription events **and** still settles order/tailoring
- [x] `subscriptionEndsAt` written on activation
- [x] Expire/delete → tenant `suspended` + `subscriptionStatus` expired/canceled as designed
- [x] Pending cannot checkout
- [x] `/admin/billing` UI + nav + permissions + catalog
- [x] `yarn smoke:company-subscription` passes
- [x] verify-rbac covers billing gates (L extended or M)

## D. Plan limits + dashboards

- [x] `src/lib/planLimits.ts` used on members/products/fabrics/categories/tailors/campaigns/tailorClients
- [x] Hardcoded TailorClient 25 reconciled with SSOT
- [x] `GET /api/admin/billing/usage` (or equivalent) fast parallel counts
- [x] Storefront dashboard: pending/active/suspended/expiring metrics
- [x] Company dashboard: plan + usage meters + profile + billing CTA
- [x] UI disable/CTA at caps matches API messages
- [x] `yarn smoke:plan-limits` passes
- [x] `ADMIN_DASHBOARD_QUICK_LINKS` updated; no dead links

## E. Automation + security

- [x] `scripts/reconcile-company-subscriptions.mts` + yarn script; idempotent
- [x] Indexes for status/endsAt if required
- [x] Webhook signature required
- [x] Checkout rate-limited
- [x] Encryption key fail-closed in production for bank fields
- [x] Footer notes escaped
- [x] Reactivation path explicit (no silent unlock)
- [x] Cannot flip `isDefault` via new APIs
- [x] PAYMENT_POLICY customer checkout unchanged

## F. Sync matrix (permissions ↔ frontend ↔ dashboard)

For **each** new route below, confirm **all** columns exist:

| Route | API file | Page | adminNav | ADMIN_ROUTE_PERMISSIONS | MUTATION map | STOREFRONT_ONLY? | API_PERMISSIONS | Dashboard/quick link |
|---|---|---|---|---|---|---|---|---|
| `/admin/company-profile` | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ |
| `/admin/billing` | ✓ | ✓ | ✓ | ✓ | ✓ | no | ✓ | ✓ |
| `/admin/registered-companies` | ✓ | ✓ | ✓ | ✓ | ✓ | **yes** | ✓ | ✓ metrics |
| `/api/admin/billing/plans` | ✓ | — | — | — | — | — | ✓ | — |
| `/api/admin/billing/checkout` | ✓ | — | — | — | — | — | ✓ | — |
| `/api/admin/billing/portal` | ✓ | — | — | — | — | — | ✓ | — |
| `/api/admin/billing/usage` | ✓ | — | — | — | — | — | ✓ | ✓ |
| `/api/admin/company-profile` | ✓ | — | — | — | — | — | ✓ | — |

Fail any row with a missing cell.

## G. Commands to run

```bash
npx prisma validate
yarn smoke:phase4-register
yarn smoke:company-profile
yarn smoke:company-subscription
yarn smoke:plan-limits
yarn smoke:org-registration-failures
# with dev server + DISABLE_AUTH_RATE_LIMIT=1:
yarn verify-rbac
yarn reconcile:subscriptions
```

## Deliverable format

1. Checklist with PASS/FAIL  
2. Remediation file list  
3. Command results  
4. Explicit deferrals only if unavoidable (must not include security IDOR or public-shop lock bugs)

### FOLLOW-UP AUDIT — END

---

## Quick reference — key existing paths

```
prisma/schema.prisma
prisma/migrations/20260908120000_org_pending_subscription_foundation/
src/lib/org.ts
src/lib/orgRegistration.ts
src/lib/companyApproval.ts
src/lib/middleware/requireAuth.ts
src/lib/staffOrg.ts
src/lib/auth/permissions.ts
src/lib/auth/routePolicy.ts
src/lib/adminNav.ts
src/lib/mailer.ts
src/lib/sendInvoice.ts
src/lib/sendReceipts.ts
src/lib/stripe.ts
src/lib/measurementCampaigns.ts
src/app/api/webhooks/stripe/route.ts
src/app/api/auth/register-company/route.ts
src/app/api/auth/me/route.ts
src/app/api/admin/registered-companies/route.ts
src/app/api/analytics/route.ts
src/app/(auth-user)/register-company/page.tsx
src/app/(auth-user)/company-pending/page.tsx
src/app/(admin)/admin/registered-companies/page.tsx
src/components/Protected/admin/layout/AdminLayout.tsx
src/components/Protected/admin/pages/tax-settings/TaxSettingsPage.tsx
src/components/Protected/admin/pages/orders/print/OrderPrintHeader.tsx
src/components/Protected/admin/pages/components/dashboard/*
scripts/verify-rbac-matrix.mjs
scripts/smoke-phase4-register-company.mts
scripts/prisma-env.mjs
README.md
.cursor/rules/customer-vs-tailor-sections.mdc
```

## Suggested new paths (create during execution)

```
prisma/migrations/<ts>_company_profile/
prisma/migrations/<ts>_company_billing_stripe_ids/
prisma/migrations/<ts>_organization_subscription_indexes/   # if needed
src/lib/companyProfile.ts
src/lib/companyProfileCrypto.ts
src/lib/companyBilling.ts
src/lib/subscriptionPlans.ts
src/lib/planLimits.ts
src/app/api/admin/company-profile/route.ts
src/app/api/admin/company-profile/logo/route.ts
src/app/api/admin/billing/plans/route.ts
src/app/api/admin/billing/checkout/route.ts
src/app/api/admin/billing/portal/route.ts
src/app/api/admin/billing/state/route.ts
src/app/api/admin/billing/usage/route.ts
src/app/api/admin/registered-companies/metrics/route.ts     # optional
src/app/(admin)/admin/company-profile/page.tsx
src/app/(admin)/admin/billing/page.tsx
src/components/Protected/admin/pages/company-profile/*
src/components/Protected/admin/pages/billing/*
src/components/Protected/admin/pages/components/dashboard/CompaniesOverviewCards.tsx
src/components/Protected/admin/pages/components/dashboard/CompanyPlanUsageCards.tsx
scripts/smoke-company-profile.mts
scripts/smoke-company-subscription.mts
scripts/smoke-plan-limits.mts
scripts/reconcile-company-subscriptions.mts
```

---

*End of file.*
