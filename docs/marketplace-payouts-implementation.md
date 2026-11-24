# Marketplace payouts & company money routing — Cursor execution brief

**Purpose:** Paste this entire document (or “Phase N” sections) into Cursor as the single source of truth to implement **customer → company** money flow for bookings / events / memberships, while FECSYNC / VenueFlow remains the multi-tenant gateway.

**Audience:** Cursor Agent (implementer) + product owner review.

**Status of today (do not regress):**
- Company **SaaS billing** (company pays FECSYNC for Starter/Growth/Enterprise) already lives under `/admin/billing`, Stripe Customer/Subscription, metadata `type: company_subscription`. **Do not merge or replace that.**
- `CompanyProfile` bank fields are **document/invoice display + encrypted storage only**. They do **not** move card money.
- Venue modules (full Online Ticketing / Events / Memberships) may still be thin — this epic must ship a **complete, auditable money path** with a **minimal booking package** so funds can be proven end-to-end before richer modules expand.

**Non-negotiables (funds = highest care):**
1. Never invent DIY card-to-bank routing from raw account numbers.
2. Never put full PAN / full bank account plaintext in logs, exports, client responses, or agent transcripts.
3. Never trust client `orgId` / `locationId` / `connectedAccountId` / amount from the browser for settlement authority.
4. Never use platform SaaS `stripeCustomerId` / `stripeSubscriptionId` as the marketplace merchant account.
5. Never allow soft-held / suspended / unapproved orgs to accept live marketplace charges.
6. Public FECSYNC storefront (`DEFAULT_ORG`) must never be treated as a Connect merchant for tenant bookings.
7. Idempotent webhooks only; double-credit and double-payout are release blockers.
8. Platform fee + tax + refunds + disputes must be modeled explicitly — no “we’ll add later” holes in the ledger.

---

## How to run this in Cursor (operator instructions)

### Primary prompt (paste first)

```
Read and execute docs/marketplace-payouts-implementation.md end-to-end.

Rules:
- Follow every phase in order. Do not skip sections marked MUST.
- Preserve company SaaS billing (company_subscription) untouched except for clear separation comments.
- Obey .cursor/rules/saas-venue-platform.mdc and docs/saas-module-extension.md (orgId on every table; no fake full venue modules beyond the minimal BookingPackage required here).
- Prefer Stripe Connect Express (destination charges or separate charges & transfers) as v1; keep a provider interface so Paystack/Flutterwave can be added later without rewriting ledger tables.
- Ship schema + APIs + admin UI + public checkout + webhooks + smokes + docs updates.
- After each phase, run relevant typecheck/smoke and fix failures before continuing.
- Do not commit unless I ask.
```

### Follow-up prompt (paste after primary implementation)

See **§16 Follow-up audit prompt** at the bottom of this file. Use it for security / ledger / loophole closure before any production keys.

---

## 0. Product thesis (what “done” means)

FECSYNC / VenueFlow is a **multi-tenant venue / booking gateway**:

| Actor | Pays for | Money goes to |
|---|---|---|
| Company (tenant) | SaaS package (Starter/Growth/Enterprise) | **FECSYNC** (existing Stripe subscription) |
| Customer / guest | Booking package / event / membership on a company | **That company** (Connect / sub-merchant payout bank), minus optional **platform application fee** to FECSYNC |

When a company’s `platform_admin` completes **payouts onboarding** (not merely typing bank fields on Company profile), that company becomes **charge-ready**. Any guest checkout for that company’s booking package settles to **their** connected account / verified payout destination.

**Display bank details** on invoices remain useful for offline/manual transfer modes. **Live card/online checkout** requires PSP-connected merchant onboarding + KYC.

---

## 1. Architecture decision (MUST lock before coding)

### 1.1 Chosen v1 stack

| Concern | Decision |
|---|---|
| PSP | **Stripe Connect Express** (v1) |
| Charge pattern | Prefer **Destination charges** on Checkout/PaymentIntent with `transfer_data.destination = connectedAccountId` and `application_fee_amount` = FECSYNC platform fee |
| SaaS billing Stripe account | Same Stripe **platform** account; separate Customer/Subscription objects; metadata namespace **must stay** `company_subscription` |
| Marketplace metadata namespace | `type: marketplace_booking` (and later `marketplace_event`, `marketplace_membership`) |
| Alt PSP | Abstract behind `MarketplacePaymentsProvider` interface; Paystack split payments = Phase B, not v1 unless product owner explicitly switches |
| Ledger SSOT | App DB tables (below) are source of truth for org-facing status; Stripe is settlement rail |

### 1.2 Explicit non-goals for v1

- Do not become a licensed money transmitter by holding customer funds in a FECSYNC wallet then manually wiring banks.
- Do not decrypt and submit CompanyProfile bank ciphertext to Stripe without Connect onboarding / Financial Connections / external account APIs and verification.
- Do not build full Events/POS/Waivers UIs — only **BookingPackage** + public book + payouts settings needed to prove money.

### 1.3 Fee model (configurable, MUST implement)

Env / config (document in `.env.example` + README):

```
MARKETPLACE_PLATFORM_FEE_BPS=500          # 5.00% application fee (basis points)
MARKETPLACE_PLATFORM_FEE_FLAT_MINOR=0    # optional flat minor units per charge
MARKETPLACE_CURRENCY_DEFAULT=usd         # v1 primary; multi-currency = later
STRIPE_CONNECT_REFRESH_URL=...
STRIPE_CONNECT_RETURN_URL=...
STRIPE_CONNECT_WEBHOOK_SECRET=...        # may share endpoint with distinct event routing
```

Fee calculation MUST be server-side only:

```
fee = floor(amountMinor * FEE_BPS / 10000) + FLAT
assert fee >= 0 && fee < amountMinor
```

Never accept fee from client.

---

## 2. Separate the two Stripe worlds (MUST)

| Flow | Org fields (existing) | New fields / tables | Metadata `type` | UI |
|---|---|---|---|---|
| SaaS subscription | `stripeCustomerId`, `stripeSubscriptionId`, plan/status/endsAt | unchanged | `company_subscription` | `/admin/billing` |
| Marketplace payouts | **none today** | `OrganizationMarketplaceAccount` (+ ledger) | `marketplace_booking` | `/admin/payouts` (new) + Company profile deep-link |

**MUST:** Webhook handlers branch on `metadata.type` / Connect event types. A Connect `account.updated` must never mutate SaaS subscription columns. A `customer.subscription.*` must never mutate marketplace payout readiness.

Add code comments at `src/lib/stripe.ts` and company billing webhook entry pointing to this separation.

---

## 3. Domain model (Prisma) — MUST

Follow `docs/saas-module-extension.md`: every business table has `orgId` (required, indexed, FK). Location-scoped when applicable.

### 3.1 `OrganizationMarketplaceAccount` (1:1 Organization)

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `orgId` | String @unique | FK Organization |
| `provider` | enum `stripe_connect` \| `paystack` \| `manual` | v1 = `stripe_connect` |
| `stripeConnectedAccountId` | String? @unique | `acct_...` |
| `chargesEnabled` | Boolean | from Stripe account |
| `payoutsEnabled` | Boolean | from Stripe account |
| `detailsSubmitted` | Boolean | onboarding complete flag |
| `requirementsDue` | Json? | redacted snapshot of currently_due |
| `payoutBankLast4` | String? | display only |
| `payoutBankName` | String? | display only |
| `defaultCurrency` | String | |
| `onboardingStatus` | enum `not_started` \| `pending` \| `restricted` \| `complete` \| `disabled` | |
| `disabledReason` | String? | |
| `platformFeeBpsOverride` | Int? | optional per-org override (ops only) |
| `createdAt` / `updatedAt` | DateTime | |

**Charge-ready definition (server helper):**

```
function assertOrgMarketplaceChargeReady(orgId):
  org.status === 'active'
  assertCompanyBillingEntitled(orgId)   // SaaS package still required
  !billingSoftHold
  account.onboardingStatus === 'complete'
  account.chargesEnabled === true
  account.payoutsEnabled === true       // or document if charges without payouts allowed in test
  account.stripeConnectedAccountId present
```

### 3.2 Minimal catalog: `BookingPackage`

Enough to sell something without shipping full Events module.

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `orgId` | String | required |
| `locationId` | String? | optional VenueLocation |
| `slug` | String | unique per org |
| `title` | String | |
| `description` | String? | |
| `amountMinor` | Int | price in minor units |
| `currency` | String | |
| `capacity` | Int? | null = unlimited |
| `active` | Boolean | |
| `published` | Boolean | public bookable only if published && active && org charge-ready (checked at checkout) |
| `startsAt` / `endsAt` | DateTime? | optional |
| timestamps | | |

Index: `@@unique([orgId, slug])`, indexes on `orgId`, `(orgId, published, active)`.

Plan limit: add resource key `bookingPackages` to `subscriptionPlans` / `PlanLimits` / `planLimits.ts` **before** create API (even if generous caps). Do not leave uncapped forever.

### 3.3 `MarketplaceBooking` (order / reservation)

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `orgId` | String | stamped server-side from package.orgId |
| `locationId` | String? | copy from package |
| `packageId` | String | FK |
| `customerUserId` | String? | if logged-in guest |
| `customerEmail` | String | required |
| `customerName` | String? | |
| `amountMinor` | Int | locked at checkout create |
| `currency` | String | |
| `platformFeeMinor` | Int | locked at checkout create |
| `status` | enum `pending_payment` \| `paid` \| `failed` \| `refunded` \| `partially_refunded` \| `cancelled` \| `disputed` | |
| `stripeCheckoutSessionId` | String? @unique | |
| `stripePaymentIntentId` | String? @unique | |
| `stripeChargeId` | String? | |
| `stripeTransferId` | String? | if applicable |
| `connectedAccountId` | String | snapshot |
| `idempotencyKey` | String @unique | client or server generated |
| `paidAt` | DateTime? | |
| `metadata` | Json? | safe fields only |
| timestamps | | |

### 3.4 `MarketplacePaymentEvent` (immutable ledger / webhook audit)

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `orgId` | String | |
| `bookingId` | String? | |
| `providerEventId` | String @unique | Stripe `evt_...` idempotency |
| `type` | String | e.g. `checkout.session.completed` |
| `payloadRedacted` | Json | **no** secrets; strip sensitive payment_method details |
| `processedAt` | DateTime | |
| `processingResult` | String | `ok` \| `ignored` \| `error:...` |

### 3.5 Optional `MarketplaceRefund`

Track refunds with amounts, Stripe refund ids, who initiated, reason. Link to booking. Update booking status accordingly.

### 3.6 CompanyProfile relationship

- Keep existing encrypted bank fields for **invoice print / offline**.
- Add UI copy on Company profile: “Bank details on invoices ≠ live card payouts. Complete **Payouts** onboarding to receive online booking payments.”
- Deep link: `/admin/company-profile` → `/admin/payouts`.
- Do **not** auto-assume typed bank numbers = Connect complete.

---

## 4. Permissions & surfaces (MUST)

| Action | Permission | Who |
|---|---|---|
| Start Connect onboarding / refresh link | `settings:manage` + company `platform_admin` | tenant admin |
| View payout status | `settings:manage` or `analytics:read` | staff |
| CRUD BookingPackage | new `P.BookingPackagesManage` (or reuse products write — prefer **new** permission) | entitled staff |
| Publish package | same | |
| Public list/detail/checkout | public / guest auth as designed | no staff JWT org spoof |
| Refund | `settings:manage` + platform_admin **or** new `P.MarketplaceRefunds` | |

Register all routes in `API_PERMISSIONS`.

Surfaces:

- Company admin: `/admin/payouts`, `/admin/booking-packages`
- Public: `/book/[orgSlugOrPublicId]/[packageSlug]` (choose stable public identifier — **never** expose internal-only secrets)
- Customer profile: show “My bookings” later; v1 can email receipt + confirmation page
- Do **not** put payouts tools on `/tailor/*` or customer `/profile` editors

Offboard / soft-hold:

- Soft-hold or suspended → `assertOrgMarketplaceChargeReady` fails; existing paid bookings remain readable; new Checkout blocked.
- Export includes redacted marketplace account + bookings (no ciphertext, no full account numbers).

---

## 5. API contract (MUST implement)

### 5.1 Payouts / Connect

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/admin/marketplace/account` | Status DTO for actor.orgId |
| `POST` | `/api/admin/marketplace/connect/onboard` | Create Express account if missing; return Account Link URL |
| `POST` | `/api/admin/marketplace/connect/refresh` | New Account Link if incomplete |
| `POST` | `/api/admin/marketplace/connect/login-link` | Express Dashboard login link when complete |
| `POST` | `/api/admin/marketplace/connect/sync` | Pull account flags from Stripe (also done by webhook) |

Ignore body `orgId`. Always `requireActorOrgId`.

### 5.2 Booking packages (admin)

| Method | Path | Behavior |
|---|---|---|
| `GET/POST` | `/api/admin/booking-packages` | list/create; create asserts plan limit + billing entitled + org active |
| `GET/PATCH/DELETE` | `/api/admin/booking-packages/[id]` | assertActorOrgMatch |

Publishing: allow `published=true` even if not charge-ready, but checkout MUST fail closed with clear error until charge-ready. Prefer UI warning: “Publish OK; online pay blocked until payouts complete.”

### 5.3 Public booking checkout

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/api/public/booking-packages/[publicOrgKey]/[slug]` | published package only; no private fields |
| `POST` | `/api/public/booking-packages/[publicOrgKey]/[slug]/checkout` | body: email, name, idempotencyKey; creates `MarketplaceBooking` pending + Stripe Checkout Session on **connected account** (destination charge); returns `{ url }` |

Checkout MUST:

1. Resolve org from public key → load package → assert `package.orgId === org.id`
2. `assertOrgMarketplaceChargeReady(org.id)`
3. Lock amount from DB package (ignore client price)
4. Compute fee server-side
5. Create Stripe session with metadata: `type=marketplace_booking`, `orgId`, `bookingId`, `packageId`
6. Idempotency: same `idempotencyKey` returns existing session URL if still open

### 5.4 Webhooks

Extend Stripe webhook router:

- Existing: `company_subscription*` handling unchanged
- New Connect + Checkout events for marketplace:
  - `account.updated` → sync OrganizationMarketplaceAccount flags
  - `checkout.session.completed` (metadata type marketplace_booking) → mark booking paid (idempotent)
  - `payment_intent.payment_failed` → failed
  - `charge.dispute.created` → disputed + alert
  - `charge.refunded` → refunded / partial

Every event: insert `MarketplacePaymentEvent` with unique `providerEventId` first (or upsert); if duplicate, no-op.

### 5.5 Refunds

`POST /api/admin/marketplace/bookings/[id]/refund` — platform_admin; creates Stripe refund with fee behavior documented (Stripe application fee refund flags); updates ledger.

---

## 6. Admin UI (MUST)

### 6.1 `/admin/payouts`

FECSYNC / VenueFlow gold/stone existing admin patterns:

- Status pill: Not started / Pending / Restricted / Ready / Disabled
- CTA: **Set up payouts** → Stripe Account Link
- After return: auto-sync + success toast
- Show: chargesEnabled, payoutsEnabled, bank last4/name if available
- Link from Company profile bank section
- Soft-hold banner: payouts/checkout locked; contact FECSYNC

### 6.2 `/admin/booking-packages`

CRUD list + editor: title, slug, price, currency (USD locked v1), capacity, publish/active, optional sale window (`startsAt`/`endsAt`), location optional.

Empty state explains: complete payouts to accept online payment.

### 6.3 Dashboard nudge

If entitled company has packages published but marketplace not charge-ready → amber banner → `/admin/payouts`.

If charge-ready and within renew window for SaaS — keep existing renew banners (do not confuse SaaS renew with payouts).

---

## 7. Public UI (MUST)

- Booking package page: title, description, price, CTA **Book & pay**
- Checkout redirect to Stripe
- Success / cancel pages under `/book/.../success` and `.../cancel` that reconcile via session_id (read-only) + webhook as SSOT
- Receipt email via existing `mailer` / brand resolver with **company** brand (`resolveBrandForOrg`), not FECSYNC-only

---

## 8. Security & loophole closure checklist (MUST pass)

- [ ] Client cannot set `amountMinor`, `platformFeeMinor`, `connectedAccountId`, `orgId`
- [ ] Cross-tenant: Company A cannot read/refund Company B bookings
- [ ] FECSYNC storefront staff cannot attach Connect to DEFAULT_ORG for tenant commerce
- [ ] Webhook signature verified; reject unsigned
- [ ] Idempotent payment completion (replay evt_ twice → one `paid`)
- [ ] Capacity race: use transaction / conditional decrement or count paid+pending holds
- [ ] Soft-hold / suspended / pending org: checkout 403
- [ ] SaaS not entitled: checkout 403 (gateway still requires subscription)
- [ ] No full bank account in API GET responses (last4 only)
- [ ] Export redacts secrets
- [ ] Logs: no raw Account Link secrets beyond what’s needed; no ciphertext
- [ ] CSRF / cookie auth for admin routes; public checkout rate-limited
- [ ] Disputes create in-app + email alert to company `billingEmail`/`supportEmail` + ops
- [ ] Application fee always computed server-side
- [ ] Test mode vs live keys clearly separated; never mix
- [ ] Connect account deleted/restricted mid-flight: fail new checkouts; document paid booking handling
- [ ] Refunds cannot exceed paid amount; concurrent refund locking
- [ ] Public package enumeration does not leak drafts
- [ ] `idempotencyKey` uniqueness per org (or global) enforced

---

## 9. Company profile bank details — correct role

| Use | Allowed? |
|---|---|
| Invoice / order print “pay to” lines | Yes (existing) |
| Completeness score | Yes |
| Offline / manual payment mode flag on package (`paymentMode: online \| manual_bank`) | Optional v1.1 |
| Pretend card Checkout pays that IBAN without Connect | **Forbidden** |
| Pre-fill Connect onboarding hints (name, support email, country) | Yes |
| Auto-push encrypted account number into Stripe without verification UX | **Forbidden** unless using official Stripe external-account + verification flows with user consent |

UI copy MUST make this distinction unmistakable.

---

## 10. Implementation phases (execute in order)

### Phase 0 — Spec lock & env
- Add this doc reference to README “Company SaaS / Marketplace” section
- `.env.example` keys listed in §1.3 + Connect URLs
- Architecture comment in `stripe.ts`

### Phase 1 — Schema + helpers
- Prisma models + migrate
- `src/lib/marketplace/` : `account.ts`, `fees.ts`, `assertChargeReady.ts`, `bookingCheckout.ts`, `webhook.ts`
- Plan limit `bookingPackages`
- Unit tests for fee math + charge-ready gates

### Phase 2 — Connect onboarding APIs + `/admin/payouts` UI
- Account Link create/refresh/sync
- Webhook `account.updated`
- Smoke: onboard URL returns for approved entitled org; pending org denied

### Phase 3 — BookingPackage admin CRUD + UI
- Limits enforced
- Publish warnings

### Phase 4 — Public checkout + destination charges + booking webhook
- End-to-end in Stripe test mode: publish package → checkout → pay test card → booking `paid` → Connect dashboard shows funds (test)
- Confirmation email branded to company

### Phase 5 — Refunds, disputes, export, soft-hold
- Refund API + UI
- Dispute webhook → alerts
- Export/offboard redaction
- Soft-hold blocks checkout + onboarding refresh as appropriate

### Phase 6 — Hardening
- Rate limits, capacity races, smokes (`yarn smoke:marketplace-payouts`)
- Security pass against §8
- README + `docs/saas-module-extension.md` cross-link
- Do **not** claim full Events/Memberships modules complete — claim **marketplace payouts + booking packages v1**

---

## 11. Smoke tests (MUST)

`yarn smoke:marketplace-payouts` covering:

1. Pending org cannot onboard Connect
2. Active entitled org can create Account Link
3. Create package asserts plan limit
4. Public cannot fetch unpublished package
5. Checkout without charge-ready → 403
6. Checkout with charge-ready (mocked Stripe) creates booking pending + session
7. Webhook replay does not double-mark paid
8. Cross-org refund denied
9. Soft-hold checkout denied
10. SaaS `company_subscription` webhook still works (regression)

---

## 12. Observability & ops

- Structured logs: `orgId`, `bookingId`, `eventId`, `result` — never secrets
- In-app notifications kind: `marketplace_payouts` / `marketplace_booking`
- Ops metric ideas: charge-ready orgs count, failed checkouts, open disputes (admin metrics optional)

---

## 13. Future modules (do not fake-implement)

When Events / Memberships / Ticketing ship, **reuse**:

- `OrganizationMarketplaceAccount`
- fee helpers
- webhook router + ledger pattern
- `assertOrgMarketplaceChargeReady`

New tables still need `orgId` + optional `locationId`. New metadata types: `marketplace_event`, etc. Do not create a second Connect account table.

---

## 14. Acceptance criteria (product owner)

- [ ] Company completes `/admin/payouts` Stripe Express onboarding and sees **Ready**
- [ ] Company creates & publishes a BookingPackage
- [ ] Guest pays via public book page; money lands on connected account (test mode proof)
- [ ] FECSYNC application fee appears on platform account
- [ ] Company profile bank fields still print on invoices but do not alone enable card capture
- [ ] SaaS billing renew/portal still works unchanged
- [ ] Suspended / soft-hold company cannot take new booking payments
- [ ] Smokes green; §8 checklist checked in PR description

---

## 15. Risks & explicit mitigations

| Risk | Mitigation |
|---|---|
| Confusing SaaS Stripe Customer with Connect account | Separate table + metadata namespaces + tests |
| Nigeria/local banks vs Stripe availability | Document market constraint; provider interface for Paystack Phase B |
| Platforms holding funds | Destination charges / Connect — avoid custom wallet |
| Double spend webhooks | Unique providerEventId |
| Fee disputes | Fee locked on booking row at create |
| KYC abandonment | pending status + dashboard nudge + email |
| Chargeback loss | dispute status + alerts; policy doc link in UI |

---

## 16. Follow-up audit prompt (paste after implementation)

```
You just implemented marketplace payouts per docs/marketplace-payouts-implementation.md.

Run a funds-critical audit and fix every real gap you find:

1) Separation: prove company_subscription webhooks cannot mutate OrganizationMarketplaceAccount and marketplace webhooks cannot mutate SaaS subscription columns. Add regression tests if missing.
2) Charge-ready gate: enumerate every public checkout / PaymentIntent creation path; ensure soft-hold, suspended, pending, !entitled, !chargesEnabled all fail closed.
3) Tenancy: cross-org package read/update/refund/export attempts denied; actor.orgId stamped server-side.
4) Idempotency: duplicate Stripe events and duplicate idempotencyKey checkouts.
5) Fee math: client cannot alter application_fee; fee < amount; currency consistency.
6) Secrets: grep for bankAccountCiphertext, decryptBank, account numbers in API responses, logs, export JSON — must be redacted.
7) UI honesty: Company profile bank section must state invoice-only vs /admin/payouts for live money.
8) Capacity / race on BookingPackage.
9) Refund + dispute paths update booking status and notify billingEmail.
10) Smokes: yarn smoke:marketplace-payouts (or equivalent) green; document residual risks in README (ZIP export, Paystack Phase B, full Events module not claimed).

Deliver: (a) short findings list with severity, (b) code fixes for High/Critical, (c) updated checklist ticks in the doc or PR body.
Do not weaken RBAC or billing entitlement to make tests pass.
Do not commit unless I ask.
```

---

## 17. Optional Phase B prompt (later markets / Paystack)

```
Extend MarketplacePaymentsProvider with Paystack subaccounts / split payments for orgs where Stripe Connect is unavailable. Reuse OrganizationMarketplaceAccount, MarketplaceBooking ledger, fee helpers, and assertOrgMarketplaceChargeReady. Do not fork a second booking schema. Keep Stripe Connect path working. Update smokes for provider=paystack test doubles.
```

---

## 18. What to tell Cursor in one sentence

> “Implement `docs/marketplace-payouts-implementation.md` so each approved entitled company onboards Stripe Connect on `/admin/payouts`, sells `BookingPackage`s, and guest card payments settle to that company’s connected account with a FECSYNC application fee — without touching SaaS `company_subscription` billing or pretending CompanyProfile bank fields move card money.”

---

*End of execution brief. Prefer fixing funds loopholes over shipping extra venue UI chrome.*

---

## Addendum — Franchise park Connect (Step 3)

Do **not** invent a second merchant table beyond:

| Table | Scope |
|---|---|
| `OrganizationMarketplaceAccount` | Company Connect (non-franchise / null-location catalog) |
| `VenueLocationMarketplaceAccount` | Franchise park Connect (`locationId` unique) |

**Resolver SSOT:** `resolveGuestPayoutDestination({ orgId, locationId })` in `src/lib/marketplace/guestPayoutDestination.ts`.

| Case | Destination |
|---|---|
| Franchise park + park charge-ready | Park connected account (`settlementScope=park`) |
| Franchise park not charge-ready | **Fail closed** (park payouts onboarding required) |
| Null `locationId` or non-franchise | Org Connect when charge-ready (`settlementScope=org`) |
| Non-franchise venue_booking without org Connect | Platform Checkout (legacy World C) — documented exception |

**APIs:** `/api/admin/marketplace/park-accounts*` (franchise managers: assigned parks only). Company routes `/api/admin/marketplace/connect/*` unchanged for org Connect.

**POS:** Live Stripe charges (sale, tabs, payment_link, and Terminal `card_present` → browser fallback via `convertCardPresentIntentToBrowser` in `saleEngine.ts`) must call `resolvePosConnectChargeFields` and stamp `connectedAccountId` / `platformFeeMinor` on `PosSalePayment`. Franchise parks fail closed until park charge-ready. `refundSale` claims `PosSalePayment.amountRefunded` under `pos_sales` FOR UPDATE (ticketing parity), reverses card / stored_card / payment_link PaymentIntents via `refundPayment` with `refundApplicationFee` when `connectedAccountId` is stamped (Stripe idempotency key per payment), writes `refund_cash` till movements for cash slices, and issues store credit only on refund-to-gift-card (no Stripe reverse).

**Cross-tab UI:** `broadcastMarketplacePayoutsChange` (`src/utils/marketplacePayoutsSync.ts`) + `invalidateMarketplacePayoutQueries` keep PayoutsPage, venues badges, HQ readiness, and MarketplacePayoutsNudge in sync after Connect sync/archive without full reload.

**SaaS World A:** Never written by park/org Connect `account.updated`. Guest money never uses `Organization.stripeCustomerId`.

**Smoke:** `yarn smoke:franchise-park-payouts` (+ keep `yarn smoke:marketplace-payouts`).
