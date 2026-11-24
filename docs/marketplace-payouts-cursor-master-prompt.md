# Marketplace payouts — Cursor master prompts

Copy **Prompt A** into a fresh Cursor Agent chat first. After implementation finishes, copy **Prompt B** into a new chat (or continue) for the funds-critical audit.

Canonical design SSOT remains `docs/marketplace-payouts-implementation.md`. This file is the paste-ready execution + audit prompt pack.

---

## Prompt A — Master implementation prompt (copy everything below the line)

---

You are implementing **FECSYNC / VenueFlow marketplace payouts** for this multi-tenant venue SaaS (`roller_clone_app`). Product brand is **FECSYNC / VenueFlow** — do not reintroduce Harewa naming.

This is a **funds-critical** epic. Partial implementation, skipped routes, skipped webhooks, skipped gates, or “we’ll wire later” holes are unacceptable. Ship a complete, auditable money path end-to-end.

### PHASE ZERO — STUDY BEFORE YOU WRITE ANY CODE (MANDATORY)

Before designing or coding, read and map the live codebase. Do not invent parallel payment systems. You must understand how money already flows and where Connect must plug in without breaking existing rails.

Study all of the following (read the real files, not guesses):

**Platform rules & extension docs**
- `.cursor/rules/saas-venue-platform.mdc`
- `.cursor/rules/customer-vs-tailor-sections.mdc`
- `docs/saas-module-extension.md`
- `docs/marketplace-payouts-implementation.md` (full SSOT — every MUST section)
- `docs/postgres-rls.md` (RLS deferred; still stamp `orgId`)
- `docs/ticketing-env.md` and `.env.example` for current Stripe/billing env patterns
- README sections on Company SaaS / billing / tenancy

**Multi-company / tenancy / session**
- `src/lib/org.ts` — DEFAULT_ORG / storefront immunity, `assertOrganizationActive`, soft-hold lifecycle
- `src/lib/staffOrg.ts` — `requireActorOrgId`, `assertActorOrgMatch` (never trust client `orgId`)
- `src/lib/orgSession.ts`, `src/lib/auth/session.ts`, `src/lib/middleware/requireAuth.ts`
- `src/lib/orgRegistration.ts`, `src/app/api/auth/register-company/route.ts`
- Company lifecycle: pending → FECSYNC approve → active → entitled → soft-hold / suspend / Demo demotion
- `src/lib/companyApproval.ts` — Approve / Set plan; never merge marketplace Connect into SaaS stamps

**Subscription / SaaS billing finance flow (company pays FECSYNC)**
- `src/lib/subscriptionPlans.ts` — plan ids `demo|starter|growth|enterprise`, PlanLimits SSOT
- `src/lib/companyBilling.ts` — Checkout/portal, Customer bind, `applyStripeSubscriptionToOrg`, metadata `type: company_subscription`
- `src/lib/billingSoftHold.ts`, `src/lib/billingGrace.ts`, `src/lib/billingRenewal.ts`
- `src/lib/planLimits.ts` — `assertCompanyBillingEntitled`, `assertWithinPlanLimit`, usage meters
- `src/lib/demoPlanLock.ts`, `src/lib/demoPlanAssert.ts` — Demo fail-closed
- `src/lib/moduleEntitlement.ts`
- Admin billing APIs: `/api/admin/billing/checkout`, `portal`, `plans`, `state`, `usage`
- Auth onboarding: `/api/auth/company-onboarding-checkout`, `company-onboarding-confirm`, `company-billing-renew`
- UI: `/admin/billing`, `src/components/Protected/admin/pages/billing/*`
- Cron: `src/app/api/cron/reconcile-company-subscriptions/route.ts`, `src/lib/reconcileCompanySubscriptions.ts`
- Organization Stripe fields: `stripeCustomerId`, `stripeSubscriptionId`, plan/status/endsAt — **these are SaaS only**

**Commerce / shop payment flow (platform account)**
- `src/lib/stripe.ts` — shared Stripe client, `createCheckoutSession`, webhook verify, refunds
- `src/lib/gatewayPayment.ts`, `src/lib/orderPaymentSettle.ts`
- `/api/payment/stripe/*`, `/api/payment/purchase`, Paystack dual path under `/api/payment/paystack/*`
- Webhook branch for metadata `type: order`

**Venue booking / ticketing payment flow (platform account today)**
- `src/lib/ticketing/payments.ts` — Checkout/PI, `settleVenueBookingStripePayment`, metadata `type: venue_booking`
- `src/lib/ticketing/paymentLinks.ts`, `paymentSafety.ts`, `publicBooking.ts`, `pendingStripe.ts`, `refunds.ts`, `bookingPayable.ts`
- Public: `/api/public/booking/checkout`, `pay-now`, `pay/[paymentLinkToken]`
- Admin: `/api/admin/bookings/[id]/payments`, `payment-link`, `charge-stored`, `refunds`, `/api/admin/booking-payments`
- Success/cancel pages: `/payment/booking/success`, `/payment/booking/cancel`
- Prisma: `Booking`, `BookingPayment` — org/location scoped; cards settle to **platform** Stripe today

**Tailoring payment flow**
- `src/lib/tailoringJobPayment.ts`, `tailoringJobPaymentSettle.ts` — metadata `type: tailoring`

**Company profile bank fields (NOT live payout rails)**
- `CompanyProfile` in Prisma + `src/lib/companyProfile.ts` + `companyProfileCrypto.ts`
- `/api/admin/company-profile`, `/admin/company-profile`
- `src/lib/sendInvoice.ts`, `sendReceipts.ts`, `resolveBrandForOrg` — bank last4 for invoices/offline only

**Webhook SSOT (single router — extend, do not fork)**
- `src/app/api/webhooks/stripe/route.ts`
- Existing `checkout.session.completed` branches: `company_subscription`, `venue_booking`, `tailoring`, `order`
- Existing SaaS events: `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`
- Existing venue refund/fail events for `venue_booking`
- You will ADD Connect + `marketplace_booking` branches without mutating SaaS or venue_booking settlement logic incorrectly

**Permissions / admin routing patterns**
- `src/lib/auth/permissions.ts` — `P.*`, `API_PERMISSIONS`, `ADMIN_ROUTE_PERMISSIONS`, registered-company-only paths
- `src/lib/auth/routePolicy.ts`, `src/proxy.ts`
- Admin page shell pattern: `src/app/(admin)/admin/<route>/page.tsx` → `src/components/Protected/admin/pages/...`
- Sidebar: `src/components/Protected/admin/layout/AdminSidebar.tsx`
- How Demo path allowlists work — payouts/booking-packages must respect Demo lock (fail closed except documented allowlist)

**Mail / brand**
- `src/lib/mailer.ts`, `resolveBrandForOrg`, `publicAppBaseUrl.ts`
- Receipts must brand to **company**, not platform-only

**Smoke patterns to mirror**
- `scripts/smoke-company-subscription.mts`, `smoke-company-profile.mts`, `smoke-plan-limits.mts`, `smoke-company-saas-hardening.mts`
- `scripts/smoke-ticketing-phase*.mts` (especially offline Stripe stub patterns)
- `package.json` smoke scripts

After studying, write a short internal study note (in chat only) covering: (1) the two Stripe worlds you must keep separate, (2) every existing `metadata.type`, (3) every gate that charge-ready must compose, (4) files you will touch vs leave alone. Then implement.

Do **not** commit unless I explicitly ask.

---

### PRODUCT THESIS — WHAT “DONE” MEANS

FECSYNC / VenueFlow is a multi-tenant venue / booking gateway.

- Companies (tenants) pay FECSYNC for SaaS packages (`demo|starter|growth|enterprise`) via existing Stripe Customer/Subscription (`company_subscription`). That money stays on the **platform** Stripe account. Do not merge or replace this.
- Guests pay for a company’s booking package / later events / memberships. That money must settle to **that company** via Stripe Connect (Express + destination charges), minus a FECSYNC **application fee**.
- A company becomes **charge-ready** only after Connect onboarding completes (chargesEnabled + payoutsEnabled + details submitted + entitled SaaS + active org + not soft-held), NOT merely by typing bank fields on Company profile.
- CompanyProfile bank fields remain invoice/display/encrypted storage only. UI must state unmistakably: invoice bank ≠ live card payouts; complete `/admin/payouts` for online booking money.
- v1 ships a **minimal BookingPackage** catalog + public book + Connect payouts so funds are proven end-to-end. Do **not** fake-implement full Events/POS/Waivers/Memberships modules.
- Public storefront (`DEFAULT_ORG` / `isDefault`) must never be treated as a Connect merchant for tenant bookings.
- Prefer fixing funds loopholes over shipping extra venue UI chrome.

---

### NON-NEGOTIABLES (FUNDS = HIGHEST CARE)

1. Never invent DIY card-to-bank routing from raw account numbers / decrypted CompanyProfile ciphertext.
2. Never put full PAN / full bank account plaintext in logs, exports, client responses, or agent transcripts.
3. Never trust client `orgId`, `locationId`, `connectedAccountId`, amount, fee, or currency for settlement authority.
4. Never use platform SaaS `stripeCustomerId` / `stripeSubscriptionId` as the marketplace merchant account.
5. Never allow soft-held / suspended / pending / unapproved / Demo-locked / non-entitled orgs to accept live marketplace charges.
6. Never attach Connect merchant onboarding to DEFAULT_ORG for tenant commerce; storefront staff must not enable DEFAULT_ORG as Connect merchant for this epic.
7. Idempotent webhooks only; double-credit and double-payout are release blockers.
8. Platform fee + refunds + disputes must be modeled explicitly in the ledger — no “add later” holes.
9. Obey surfaces: company admin `/admin/*` only for payouts tools; never put payouts on `/tailor/*` or customer `/profile` editors.
10. Keep provider interface so Paystack Phase B can plug in later without rewriting ledger tables — but v1 is Stripe Connect Express.

---

### ARCHITECTURE LOCK (V1)

- PSP: **Stripe Connect Express**.
- Charge pattern: **Destination charges** on Checkout/PaymentIntent with `transfer_data.destination = connectedAccountId` and `application_fee_amount` = FECSYNC platform fee (server-computed).
- Same Stripe **platform** account as SaaS and venue_booking; separate object namespaces.
- SaaS metadata namespace remains exactly `company_subscription`.
- Marketplace metadata namespace: `type: marketplace_booking` (reserve later: `marketplace_event`, `marketplace_membership`).
- Do **not** confuse with existing `venue_booking` (platform-settled ticketing). Marketplace BookingPackage path is a **new** Connect destination-charge path with its own tables/ledger.
- Ledger SSOT: app DB tables for org-facing status; Stripe is settlement rail.
- Abstract behind `MarketplacePaymentsProvider` interface; Paystack split = Phase B only unless I explicitly switch.

Non-goals for v1:
- No FECSYNC wallet holding customer funds then manually wiring banks.
- No auto-push of encrypted CompanyProfile bank numbers into Stripe without official Connect / external-account + verification UX and consent.
- No full Events/POS/Waivers UIs — only BookingPackage + public book + payouts settings.

---

### ENV / CONFIGURATION (MUST ADD AND DOCUMENT)

Add to `.env.example` and README (and align with `docs/ticketing-env.md` where Stripe secrets are documented):

- `MARKETPLACE_PLATFORM_FEE_BPS` (default document 500 = 5.00%)
- `MARKETPLACE_PLATFORM_FEE_FLAT_MINOR` (default 0)
- `MARKETPLACE_CURRENCY_DEFAULT` (v1 primary: `usd`; multi-currency later)
- `MARKETPLACE_CONNECT_COUNTRY_DEFAULT` (optional; defaults from currency — `usd` → `US`)
- `STRIPE_CONNECT_REFRESH_URL`
- `STRIPE_CONNECT_RETURN_URL`
- `STRIPE_CONNECT_WEBHOOK_SECRET` (may share endpoint with distinct event routing; document clearly)
- Ensure platform `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, publishable key remain documented and are not mixed with Connect account keys incorrectly

Fee math (server-side only; never accept fee from client):

```
fee = floor(amountMinor * FEE_BPS / 10000) + FLAT
assert fee >= 0 && fee < amountMinor
```

Honor optional per-org `platformFeeBpsOverride` on marketplace account (ops only) when computing fee.

---

### TWO STRIPE WORLDS — HARD SEPARATION (MUST)

World A — SaaS subscription (existing, leave working):
- Org fields: `stripeCustomerId`, `stripeSubscriptionId`, plan/status/endsAt
- Metadata: `company_subscription`
- UI: `/admin/billing`
- Webhooks: subscription/invoice handlers → `applyStripeSubscriptionToOrg` only

World B — Marketplace payouts (new):
- New table: `OrganizationMarketplaceAccount` (+ ledger tables)
- Metadata: `marketplace_booking`
- UI: `/admin/payouts` (+ Company profile deep-link)
- Webhooks: Connect `account.updated` + marketplace checkout/PI/refund/dispute handlers

Rules:
- A Connect `account.updated` must **never** mutate SaaS subscription columns.
- A `customer.subscription.*` / SaaS invoice event must **never** mutate marketplace payout readiness.
- Add explicit separation comments in `src/lib/stripe.ts` and at the company billing / marketplace webhook entry points.
- Do not reuse SaaS Customer as Connect account.

Also preserve World C — existing platform commerce:
- `venue_booking`, `order`, `tailoring` continue settling on platform account as today unless/until a separate epic migrates them. Do not silently convert `venue_booking` payment links to Connect in this epic unless the SSOT explicitly requires it (it does not for v1 BookingPackage path). Focus Connect destination charges on the new `marketplace_booking` BookingPackage checkout.

---

### PRISMA DOMAIN MODEL (MUST — FOLLOW `docs/saas-module-extension.md`)

Every business table: required indexed `orgId` FK; optional `locationId` when applicable.

**OrganizationMarketplaceAccount** (1:1 Organization)
Fields: `id`, `orgId` (@unique), `provider` enum `stripe_connect|paystack|manual` (v1=`stripe_connect`), `stripeConnectedAccountId` (@unique nullable), `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`, `requirementsDue` (Json? redacted), `payoutBankLast4`, `payoutBankName`, `defaultCurrency`, `onboardingStatus` enum `not_started|pending|restricted|complete|disabled`, `disabledReason`, `platformFeeBpsOverride`, timestamps.

**Charge-ready helper** `assertOrgMarketplaceChargeReady(orgId)` MUST enforce all of:
- org.status === `active`
- `assertCompanyBillingEntitled(orgId)`
- not billing soft-hold
- not Demo-locked for this action (fail closed)
- not DEFAULT_ORG / storefront used as tenant Connect merchant
- account.onboardingStatus === `complete`
- account.chargesEnabled === true
- account.payoutsEnabled === true (or document test exception explicitly if temporarily allowed — prefer both true)
- account.stripeConnectedAccountId present

**BookingPackage** (minimal sellable catalog)
Fields: `id`, `orgId`, optional `locationId`, `slug` (unique per org), `title`, `description`, `amountMinor`, `currency`, `capacity` (null=unlimited), `active`, `published`, optional `startsAt`/`endsAt`, timestamps.
Indexes: `@@unique([orgId, slug])`, indexes on `orgId`, `(orgId, published, active)`.
Plan limit: add resource key `bookingPackages` to `subscriptionPlans` / `PlanLimits` / `planLimits.ts` / client soft-gate strings **before** create API. Do not leave uncapped.

**MarketplaceBooking** (order/reservation)
Fields: `id`, `orgId` (stamped server-side from package.orgId), optional `locationId`, `packageId`, optional `customerUserId`, required `customerEmail`, optional `customerName`, `amountMinor` + `currency` + `platformFeeMinor` locked at checkout create, `status` enum `pending_payment|paid|failed|refunded|partially_refunded|cancelled|disputed`, Stripe ids (`stripeCheckoutSessionId`, `stripePaymentIntentId`, `stripeChargeId`, `stripeTransferId`), `connectedAccountId` snapshot, `idempotencyKey` (@unique), `paidAt`, safe `metadata` Json?, timestamps.

**MarketplacePaymentEvent** (immutable webhook audit)
Fields: `id`, `orgId`, optional `bookingId`, `providerEventId` (@unique Stripe `evt_...`), `type`, `payloadRedacted` (no secrets), `processedAt`, `processingResult` (`ok|ignored|error:...`).

**MarketplaceRefund** (required for complete v1 refund path — do not skip)
Track amounts, Stripe refund ids, actor, reason; link to booking; update booking status.

CompanyProfile relationship:
- Keep encrypted bank fields for invoice/offline.
- Add UI copy + deep link `/admin/company-profile` → `/admin/payouts`.
- Do not auto-assume typed bank numbers = Connect complete.
- Pre-fill Connect onboarding hints (name, support email, country) from company profile is allowed; pushing ciphertext account numbers without verification UX is forbidden.

Migrate Prisma safely; update relations on Organization.

---

### PERMISSIONS, ROUTES, SURFACES (MUST)

Permissions (prefer new permissions; register everywhere):
- Start Connect onboard/refresh: `settings:manage` + company `platform_admin`
- View payout status: `settings:manage` or `analytics:read`
- CRUD/publish BookingPackage: new `P.BookingPackagesManage` (preferred over reusing products write)
- Refund: `settings:manage` + platform_admin **or** new `P.MarketplaceRefunds`

Register **every** new API in `API_PERMISSIONS`. Register admin pages in `ADMIN_ROUTE_PERMISSIONS` and registered-company-only path lists as appropriate. Update AdminSidebar nav. Respect Demo plan lock (fail closed for apps outside allowlist — payouts should not bypass Demo lock to take live money).

Admin surfaces (MUST ship):
- `/admin/payouts`
- `/admin/booking-packages`
- Dashboard amber nudge when packages published but not charge-ready → `/admin/payouts`
- Do not confuse SaaS renew banners with payouts banners

Public surfaces (MUST ship):
- `/book/[orgSlugOrPublicId]/[packageSlug]` — choose stable public identifier; never expose internal secrets
- Success: `/book/.../success` and cancel: `/book/.../cancel` — reconcile via session_id read-only; webhook is SSOT for paid
- v1 can email receipt + confirmation page (My bookings on customer profile can wait)

Offboard / export / soft-hold:
- Soft-hold or suspended → charge-ready fails; existing paid bookings remain readable; new Checkout blocked; onboarding refresh blocked as appropriate
- Company export must include redacted marketplace account + bookings (no ciphertext, no full account numbers)
- Wire into existing export/offboard paths (`/api/admin/company-export`, etc.)

---

### API CONTRACT (MUST IMPLEMENT EVERY ROUTE — NO PARTIALS)

**Payouts / Connect** (always `requireActorOrgId`; ignore body `orgId`):
- `GET /api/admin/marketplace/account` — status DTO for actor.orgId
- `POST /api/admin/marketplace/connect/onboard` — create Express account if missing; return Account Link URL using refresh/return env URLs
- `POST /api/admin/marketplace/connect/refresh` — new Account Link if incomplete
- `POST /api/admin/marketplace/connect/login-link` — Express Dashboard login link when complete
- `POST /api/admin/marketplace/connect/sync` — pull account flags from Stripe (also done by webhook)

**Booking packages admin**:
- `GET/POST /api/admin/booking-packages` — list/create; create asserts plan limit + billing entitled + org active + Demo/module gates
- `GET/PATCH/DELETE /api/admin/booking-packages/[id]` — `assertActorOrgMatch`
- Publishing: allow `published=true` even if not charge-ready, but checkout MUST fail closed until charge-ready. UI warning: “Publish OK; online pay blocked until payouts complete.”

**Public booking checkout**:
- `GET /api/public/booking-packages/[publicOrgKey]/[slug]` — published+active package only; no private fields
- `POST /api/public/booking-packages/[publicOrgKey]/[slug]/checkout` — body: email, name, idempotencyKey only (no price/fee/org/connectedAccount from client)

Checkout MUST:
1. Resolve org from public key → load package → assert `package.orgId === org.id`
2. `assertOrgMarketplaceChargeReady(org.id)`
3. Lock amount/currency from DB package (ignore client price)
4. Compute fee server-side (bps + flat + override)
5. Capacity race-safe hold/count (transaction / conditional)
6. Create `MarketplaceBooking` `pending_payment` with locked fee + connectedAccountId snapshot
7. Create Stripe Checkout Session as destination charge with `transfer_data.destination` + `application_fee_amount` + metadata `type=marketplace_booking`, `orgId`, `bookingId`, `packageId`
8. Idempotency: same `idempotencyKey` returns existing open session URL
9. Rate-limit public checkout
10. Return `{ url }`

**Refunds**:
- `POST /api/admin/marketplace/bookings/[id]/refund` — authorized roles only; Stripe refund with documented application-fee refund behavior; update MarketplaceRefund + booking status; concurrent refund locking; cannot exceed paid amount; cross-org denied

**Webhooks** — extend `src/app/api/webhooks/stripe/route.ts` (signature verified; reject unsigned):
- Keep all existing handlers intact (`company_subscription`, `venue_booking`, `order`, `tailoring`, subscription/invoice)
- New Connect + marketplace:
  - `account.updated` → sync OrganizationMarketplaceAccount flags / onboardingStatus / requirementsDue (redacted) / bank last4 if available
  - `checkout.session.completed` where metadata.type === `marketplace_booking` → mark booking paid (idempotent); store PI/charge/transfer ids
  - `payment_intent.payment_failed` (marketplace) → failed
  - `checkout.session.expired` (marketplace) → cancel/expire pending as designed
  - `charge.dispute.created` → disputed + in-app notification + email to company billingEmail/supportEmail + ops alert
  - `charge.refunded` / refund updated → refunded / partially_refunded + ledger
- Every marketplace event: insert/upsert `MarketplacePaymentEvent` by unique `providerEventId` first; duplicate → no-op (no double paid)

---

### LIB MODULE LAYOUT (MUST)

Create `src/lib/marketplace/` (or equivalent coherent module) including at least:
- `account.ts` — create/sync Connect Express account, Account Links, login links, DTO mapping
- `fees.ts` — fee math + override
- `assertChargeReady.ts` — composed gates
- `bookingCheckout.ts` — public checkout session creation
- `webhook.ts` — marketplace event processors
- `refunds.ts` — refund path
- `provider.ts` — `MarketplacePaymentsProvider` interface (Stripe Connect implementation v1)
- Unit tests for fee math + charge-ready gates

Add architecture comments in `src/lib/stripe.ts` pointing to SaaS vs marketplace separation. Extend Checkout helpers carefully — do not break existing `createCheckoutSession` callers for shop/venue/SaaS; add Connect-aware session creation for marketplace (destination + application_fee) without regressing platform payment sessions.

---

### ADMIN UI (MUST)

`/admin/payouts` — FECSYNC / VenueFlow gold `#D4AF37` / stone existing admin patterns:
- Status pill: Not started / Pending / Restricted / Ready / Disabled
- CTA Set up payouts → Stripe Account Link
- After return from Connect: auto-sync + success toast
- Show chargesEnabled, payoutsEnabled, bank last4/name if available
- Soft-hold banner: payouts/checkout locked; contact FECSYNC
- Link from Company profile bank section

`/admin/booking-packages`:
- CRUD list + editor: title, slug, price, currency (USD locked v1), capacity, publish/active, optional sale window, optional location
- Empty state explains complete payouts to accept online payment
- Publish warning when not charge-ready

Dashboard nudge when entitled company has published packages but marketplace not charge-ready.

---

### PUBLIC UI (MUST)

- Booking package page: title, description, price, CTA **Book & pay**
- Redirect to Stripe Checkout
- Success/cancel pages under `/book/.../success` and `.../cancel`
- Confirmation/receipt email via existing mailer + `resolveBrandForOrg(company)` — not platform-only branding

---

### SYNCHRONIZATION POINTS (MUST ALL WORK)

1. **Connect onboarding sync**: Account Link return → client calls sync API; webhook `account.updated` also syncs; UI reflects Ready only when charge-ready fields true.
2. **Checkout → booking sync**: Stripe session completed webhook marks paid; success page may read session for UX but webhook is SSOT.
3. **Fee lock sync**: fee locked on MarketplaceBooking at create; webhook must not recompute from client.
4. **SaaS entitlement sync**: if org loses entitlement / soft-hold / suspend / Demo lock, new marketplace checkout and Connect refresh fail closed; paid history remains.
5. **Export sync**: company export includes redacted marketplace account + bookings.
6. **Plan limit sync**: `bookingPackages` usage meter updates with creates/deletes; soft-gate UI stays consistent.
7. **Notification sync**: disputes and payouts-ready / payouts-restricted create in-app notification kinds `marketplace_payouts` / `marketplace_booking` and emails where specified.
8. **Idempotency sync**: providerEventId + idempotencyKey uniqueness prevent double settle / double session.
9. **Capacity sync**: concurrent checkouts cannot oversell capacity.
10. **Refund/dispute sync**: booking status + MarketplaceRefund/PaymentEvent always updated together.

---

### SECURITY CHECKLIST (MUST PASS BEFORE CLAIMING DONE)

- Client cannot set amountMinor, platformFeeMinor, connectedAccountId, orgId
- Cross-tenant package read/update/refund/export denied
- FECSYNC storefront staff cannot attach Connect to DEFAULT_ORG for tenant commerce
- Webhook signature verified
- Idempotent payment completion
- Capacity race safe
- Soft-hold / suspended / pending / !entitled → checkout 403
- No full bank account in API GET (last4 only)
- Export redacts secrets
- Logs: no ciphertext / raw secrets beyond necessity
- CSRF/cookie auth for admin; public checkout rate-limited
- Disputes alert billingEmail/supportEmail + ops
- Application fee always server-side
- Test vs live keys never mixed
- Connect restricted/deleted mid-flight: fail new checkouts; document paid booking handling
- Refunds cannot exceed paid; concurrent refund locking
- Public package enumeration does not leak drafts
- idempotencyKey uniqueness enforced

---

### IMPLEMENTATION PHASES (EXECUTE IN ORDER — DO NOT SKIP)

**Phase 0 — Spec lock & env**
- Reference this epic in README Company SaaS / Marketplace section
- `.env.example` keys + Connect URLs
- Architecture comment in `stripe.ts`
- Cross-link `docs/saas-module-extension.md`

**Phase 1 — Schema + helpers**
- Prisma models + migrate
- `src/lib/marketplace/*`
- Plan limit `bookingPackages`
- Unit tests fee + charge-ready

**Phase 2 — Connect onboarding APIs + `/admin/payouts` UI**
- Account Link create/refresh/sync/login-link
- Webhook `account.updated`
- Company profile copy + deep link
- Smoke: entitled active org can onboard URL; pending denied; DEFAULT_ORG denied

**Phase 3 — BookingPackage admin CRUD + UI**
- Limits enforced
- Publish warnings
- Sidebar + permissions

**Phase 4 — Public checkout + destination charges + booking webhook**
- End-to-end Stripe test mode path documented: publish → checkout → test card → booking paid → Connect dashboard shows funds
- Confirmation email branded to company

**Phase 5 — Refunds, disputes, export, soft-hold**
- Refund API + UI
- Dispute webhook → alerts
- Export/offboard redaction
- Soft-hold blocks checkout + onboarding refresh

**Phase 6 — Hardening**
- Rate limits, capacity races
- `yarn smoke:marketplace-payouts` script in package.json
- Security pass against checklist
- README claim only: **marketplace payouts + booking packages v1** (do not claim full Events/Memberships)

After each phase: run relevant typecheck / lint / smoke and fix failures before continuing.

---

### SMOKE TESTS (MUST — `yarn smoke:marketplace-payouts`)

Cover at least:
1. Pending org cannot onboard Connect
2. Active entitled org can create Account Link
3. DEFAULT_ORG / storefront cannot become Connect merchant for this flow
4. Create package asserts plan limit
5. Public cannot fetch unpublished package
6. Checkout without charge-ready → 403
7. Checkout with charge-ready (mocked Stripe) creates booking pending + session with destination + application_fee
8. Webhook replay does not double-mark paid
9. Cross-org refund denied
10. Soft-hold checkout denied
11. SaaS `company_subscription` webhook still works (regression)
12. Existing `venue_booking` settle path still works (regression) or at least is not broken by webhook router changes

Mirror existing smoke style (Prisma + dynamic imports + PASS/FAIL checks; stub Stripe where ticketing smokes stub).

---

### OBSERVABILITY

- Structured logs: orgId, bookingId, eventId, result — never secrets
- In-app notification kinds: `marketplace_payouts`, `marketplace_booking`
- Optional ops metrics later: charge-ready orgs, failed checkouts, open disputes

---

### FUTURE MODULES (DO NOT FAKE)

When Events / Memberships / richer Ticketing Connect migration ships later, reuse OrganizationMarketplaceAccount, fee helpers, webhook/ledger pattern, assertOrgMarketplaceChargeReady. New tables still need orgId + optional locationId. New metadata types only. Do not create a second Connect account table.

---

### ACCEPTANCE CRITERIA (ALL REQUIRED)

- Company completes `/admin/payouts` Stripe Express onboarding and sees Ready
- Company creates & publishes a BookingPackage
- Guest pays via public book page; money lands on connected account (test mode proof)
- FECSYNC application fee appears on platform account
- Company profile bank fields still print on invoices but do not alone enable card capture
- SaaS billing renew/portal still works unchanged
- Suspended / soft-hold company cannot take new booking payments
- Smokes green; security checklist checked in your final summary
- No Harewa naming in new user-facing copy

---

### DELIVERABLES WHEN FINISHED

1. Complete code for all phases above (no TODOs left in money path)
2. Short phase-by-phase summary of what shipped and file paths touched
3. Explicit list of residual risks (Paystack Phase B, multi-currency, ZIP export if still residual, full Events not claimed)
4. Do not commit unless I ask

Begin with PHASE ZERO study. Then implement phases 0→6 without skipping.

---

## Prompt B — Follow-up audit prompt (copy everything below the line after Prompt A finishes)

---

You just implemented marketplace payouts for FECSYNC / VenueFlow per `docs/marketplace-payouts-implementation.md` and the master Cursor prompt in `docs/marketplace-payouts-cursor-master-prompt.md`.

Your job now is a **funds-critical completeness audit**. Assume something was skipped. Hunt for partial implementations, missing routes, missing webhook branches, missing gates, missing UI copy, missing plan limits, missing smokes, missing permissions registrations, missing export redaction, and any place money can leak or settle wrongly.

### STEP 1 — RE-STUDY CURRENT TREE (MANDATORY)

Re-read the live code you (or the prior pass) shipped. Inventory every new file and every modified finance file. Then re-read the existing finance systems to prove non-regression:
- SaaS: `companyBilling.ts`, billing APIs, subscription webhook path
- Platform commerce: `venue_booking`, `order`, `tailoring` webhook branches
- Company profile bank crypto/redaction
- `permissions.ts` API_PERMISSIONS / ADMIN_ROUTE_PERMISSIONS / sidebar / Demo lock
- Export/offboard paths
- `.env.example` + README claims

Produce a gap matrix in chat: Expected artifact → Present? → Complete? → Evidence path.

### STEP 2 — AUDIT & FIX EVERY REAL GAP

Work these items exhaustively. For each: verify in code, fix if broken/missing, add regression coverage when High/Critical.

**A. Separation of Stripe worlds**
- Prove `company_subscription` handlers cannot mutate `OrganizationMarketplaceAccount`
- Prove marketplace/Connect handlers cannot mutate SaaS subscription columns (`stripeCustomerId`, `stripeSubscriptionId`, plan/status/endsAt)
- Prove `venue_booking` / `order` / `tailoring` still settle correctly and were not accidentally converted to Connect
- Separation comments exist in `stripe.ts` and webhook router
- Add regression tests/smokes if missing

**B. Route & API completeness (zero missing endpoints)**
Confirm all exist, authorized, and wired end-to-end:
- `GET /api/admin/marketplace/account`
- `POST /api/admin/marketplace/connect/onboard`
- `POST /api/admin/marketplace/connect/refresh`
- `POST /api/admin/marketplace/connect/login-link`
- `POST /api/admin/marketplace/connect/sync`
- `GET/POST /api/admin/booking-packages`
- `GET/PATCH/DELETE /api/admin/booking-packages/[id]`
- `GET /api/public/booking-packages/[publicOrgKey]/[slug]`
- `POST /api/public/booking-packages/[publicOrgKey]/[slug]/checkout`
- `POST /api/admin/marketplace/bookings/[id]/refund`
- Admin pages `/admin/payouts`, `/admin/booking-packages`
- Public `/book/...` + success + cancel
- Every route registered in `API_PERMISSIONS` / admin route policy / sidebar
- No dead UI buttons calling missing APIs; no APIs without UI where the spec required UI

**C. Schema & ledger completeness**
- OrganizationMarketplaceAccount, BookingPackage, MarketplaceBooking, MarketplacePaymentEvent, MarketplaceRefund all present with orgId and required indexes/uniques
- `bookingPackages` in PlanLimits + planLimits.ts + soft-gate strings + usage meter
- Migrations applied / schema consistent
- No second Connect account table fork

**D. Charge-ready gate completeness**
Enumerate **every** path that creates a marketplace Checkout Session / PaymentIntent / Account Link:
- soft-hold → deny
- suspended → deny
- pending → deny
- !assertCompanyBillingEntitled → deny
- Demo lock → deny for live money / disallowed apps
- DEFAULT_ORG → deny as Connect merchant for tenant commerce
- !chargesEnabled / !payoutsEnabled / incomplete onboarding / missing connectedAccountId → deny checkout
- Publish-without-charge-ready allowed, but checkout still denied with clear error

**E. Checkout integrity**
- Client cannot set amount, fee, currency, orgId, connectedAccountId
- Amount locked from BookingPackage row
- Fee server-computed (bps + flat + override); fee < amount
- Destination charge + application_fee_amount present on session
- Metadata type exactly `marketplace_booking` with orgId, bookingId, packageId
- idempotencyKey uniqueness; replay returns same open session
- Capacity race safe
- Public rate limit present
- Unpublished/draft not enumerable

**F. Webhook & sync completeness**
- Signature verification still mandatory
- Handlers for: account.updated, checkout.session.completed (marketplace_booking), payment_intent.payment_failed, checkout.session.expired (if specified), charge.dispute.created, charge.refunded/refund.updated
- MarketplacePaymentEvent unique providerEventId; duplicate events no-op
- Replay twice → still one `paid`
- Success page is UX-only; webhook SSOT
- Connect return URL triggers sync; webhook also syncs account flags
- Dispute emails + in-app notifications fire
- Refund path updates booking + MarketplaceRefund + events; cannot over-refund; concurrency locked

**G. Tenancy & RBAC**
- Cross-org package read/update/delete/refund/export denied
- actor.orgId stamped server-side everywhere
- Connect onboard restricted to settings:manage + company platform_admin as specified
- No payouts tools on `/tailor/*` or customer `/profile`
- Storefront staff cannot enable DEFAULT_ORG Connect for tenant bookings

**H. Secrets & bank honesty**
- Grep for bankAccountCiphertext, decryptBank, full account numbers in API responses, logs, export JSON — must be redacted
- Company profile UI states invoice-only vs `/admin/payouts` for live money
- Deep link profile → payouts exists
- Encrypted bank numbers are never auto-pushed into Stripe without official verification UX

**I. Config & docs**
- `.env.example` includes MARKETPLACE_* and STRIPE_CONNECT_* keys
- README documents marketplace payouts v1 without claiming full Events/Memberships
- `docs/saas-module-extension.md` cross-linked
- No Harewa in new copy
- Residual risks documented (Paystack Phase B, multi-currency, any unpaid ZIP export residual, etc.)

**J. Soft-hold / export / offboard**
- Soft-hold blocks checkout + onboarding refresh as appropriate
- Export includes redacted marketplace account + bookings
- Suspended org cannot take new marketplace payments
- SaaS renew/portal still works unchanged

**K. Smokes & regressions**
- `yarn smoke:marketplace-payouts` exists and covers the master prompt’s smoke list (or expand it until it does)
- Run it green
- Confirm SaaS company_subscription smoke/path still healthy
- Confirm webhook router changes did not break venue_booking settlement

**L. Partial-implementation hunt (explicit)**
Search for and eliminate:
- TODO/FIXME/coming soon in marketplace money path
- Stub functions that return fake Ready
- UI that claims payouts ready without Stripe flags
- Checkout that charges platform only (missing transfer_data.destination) while pretending Connect
- Missing application_fee_amount
- Unregistered permissions
- Pages without sidebar links or links to 404
- Webhook events mentioned in docs but not handled
- Plan limit key missing while create API exists
- Notification kinds referenced but never emitted
- Email paths never called on paid/dispute

### STEP 3 — DELIVERABLES

Return:
1. Findings list with severity (Critical / High / Medium / Low) and file paths
2. Code fixes for every Critical and High (implement them now)
3. Medium fixes if straightforward; otherwise document why deferred
4. Updated checklist: which acceptance criteria and security items are now proven
5. Residual risks only (no false “done” claims)

Rules:
- Do not weaken RBAC, billing entitlement, Demo lock, or charge-ready gates to make tests pass
- Do not merge SaaS billing with Connect
- Do not treat CompanyProfile bank fields as live payout rails
- Do not commit unless I ask

Start by building the gap matrix, then fix Critical/High gaps until the money path is complete.

---

*End of Cursor prompt pack.*
