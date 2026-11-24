# SaaS module extension contract

**Audience:** future Cursor prompts / feature teams shipping venue modules (ticketing, POS, waivers, access control, surveys, loyalty, dynamic pricing, analytics, events).

**Prerequisite:** Company SaaS control plane Steps 1–4 are complete. Do **not** re-litigate tenancy, registration duality, billing entitlement, or plan SSOT in module epics — extend them.

**Guest Marketing Automation (Growth+):** `MarketingAutomationSettings`, `MarketingSendLog`, `GuestSurvey` / invites / responses — all require `orgId`; settings and sends may use optional `locationId`. Enforce `assertModuleEnabled("marketing")`. See `src/lib/marketing/`.

**Shipped venue modules:** Online Booking / Ticketing (Phases 1–5) — see `docs/online-booking-ticketing-complete-spec.md` and `docs/ticketing-env.md`. Guest park Memberships **Phases 1–5 complete** (foundation + billing/lifecycle + entitlement redeem/verify + guest self-serve / click-to-cancel / agreements / CRM / reports / advanced dunning + production hardening; Growth+ `moduleHints`) — see `docs/memberships-complete-spec.md`. Digital Waivers **Phases 1–5** (templates, guest signing, kiosk, desk verify/void/import/export, expiry reminders, booking confirmation links, party waiver list, production smokes; Growth+ `moduleHints`) — see `docs/digital-waivers-complete-spec.md`. **POS terminal Steps 1–2 live** (catalog/sale engine + staff terminal/check-in/tills/tabs/capacity; Growth+ `assertModuleEnabled("pos")`; `posTerminals` meter) — see `docs/pos-two-step-prompts.md` and `docs/pos-env.md`. The separate **check-in scanner product** and the **ticket-purchase kiosk** are **not** shipped. Do **not** fake those, OTAs, or Intercard in unrelated PRs. Do **not** re-stub guest signing. **Memberships owns guest billing** — POS check-in must call `billingEngine` / `entitlementEngine` (never a second membership commerce product).

See also: `README.md` (Product thesis / Company SaaS hardening), `docs/enterprise-hq-controls.md` (shipped HQ routes/gates), `docs/marketplace-payouts-implementation.md` (Connect marketplace payouts + BookingPackage), `.cursor/rules/saas-venue-platform.mdc`, `src/lib/subscriptionPlans.ts`, `src/lib/planLimits.ts`, `src/lib/staffOrg.ts`.

**Shipped marketplace money path (v1):** Stripe Connect Express destination charges for `BookingPackage` — not full Events/Memberships. Tables (all require `orgId`): `OrganizationMarketplaceAccount`, `BookingPackage` (optional `locationId`), `MarketplaceBooking`, `MarketplacePaymentEvent`, `MarketplaceRefund`. Reuse the same Connect account + `assertOrgMarketplaceChargeReady` + fee helpers for future `marketplace_event` / `marketplace_membership` metadata types. Do **not** invent a second Connect merchant table.

**Accounting auto-post (shipped):** after entitled business events, call `enqueueSource` / `flushAccountingQueueSoon` from the owning module (bookings, POS, shop, memberships, tailoring, payables) — do **not** write `JournalEntry` rows directly from feature code. New source types belong in `AccountingSourceType` + posting router in `src/lib/accounting/posting/`.

---

## 1. Schema rules (every new business table)

For Online Ticketing, POS, Memberships, Digital Waivers, Access Control, Guest Surveys, Loyalty, Dynamic Pricing, Reporting facts, Events, etc.:

| Column | Required | Notes |
|---|---|---|
| `orgId` | **Yes** | `String`, indexed, FK → `Organization`. Never nullable for tenant business data. |
| `locationId` | When park-specific | `String?`, FK → `VenueLocation`. Omit only for true HQ-only resources. |

Also:

- Prefer composite indexes that include `orgId` (and `locationId` when filtered).
- Do **not** invent a second “account” or “merchant” table that bypasses `Organization`.
- Do **not** store cross-tenant denormalized copies without an `orgId` gate on every read/write.
- **Catalog reuse:** Food sales menu items use org-scoped `ProductCategory`. Online Ticketing admission products classify via **`BookingCategory`** (`AdmissionProduct.categoryId`, optional) under Online Booking → Booking category — not shop Catalog categories. Ecommerce `Product.categoryId` remains required; ticketing stays optional so legacy rows stay uncategorized.

## 2. Create / mutate API rules

Every staff create (and entitled mutate that burns a capped resource) **must**:

1. `requirePermissionFresh` (or `requireAnyPermissionFresh`) with the correct `P.*`
2. `requireActorOrgId(actor)` — stamp writes from JWT, never from body
3. `assertOrganizationActive(orgId)` (or the shared Fresh path that already does this)
4. `assertCompanyBillingEntitled(orgId)` **or** `assertWithinPlanLimit(orgId, resource)` (which already requires entitlement)
5. If the resource is newly capped, add it to `subscriptionPlans` / `PlanLimits` + `planLimits.ts` **before** shipping creates

Never trust client `orgId` / `locationId`:

- Ignore or reject body/`?orgId=`
- `assertActorOrgMatch(actorOrgId, resource.orgId)` on detail/update/delete
- When `locationId` is provided: load `VenueLocation` and assert `venue.orgId === actor.orgId`
- Enterprise HQ location preference (`Membership.hqSelectedLocationId`, via `/api/admin/hq/location-context` or `/api/admin/park-context`) is **not** a substitute for stamping `locationId` on module rows — modules must still store and assert their own `locationId` when park-specific
- **Location-scope policy (honest):** `actorLocationScope(actor)` → `{ orgId, locationId, companyWideView, locationScoped, parkLocked, assignedLocationIds }` (SSOT: `parkAdminScope.ts`). When a park is selected **or** the seat is park-locked:
  - Venue lists + HQ venue *items* filter
  - **Park-stamped modules** (Online Ticketing products/sessions/resources/bookings/payments/invoices — live; guest Memberships sold/home-stamped; Digital Waivers records/kiosks; POS devices/tills/tabs/sales/capacity — live; Product/Order when `venueLocationId` is stamped) must apply `assignedLocationFilter` / `venueStampedResourceFilter` and keep stamping their own `locationId`
  - **Members roster** and **plan meters** stay company-wide (HQ preference does not filter `/api/admin/members`)
  - `MembershipVenueAssignment` park-locks Growth/Starter seats **without** Enterprise; platform software owner bypasses to company-wide
  - `companyWideView` remains Layer-2 ownership visibility and does **not** by itself expand park assignments (CWV + assignments → still park-locked)
- HQ / park switchers load venues with `?scope=all` so options stay complete for CWV seats; park-locked lists stay assigned-only even with `scope=all`

Register every new route in `API_PERMISSIONS` (`src/lib/auth/permissions.ts`).

Enterprise HQ APIs (`/api/admin/hq/*`) additionally require `assertEnterpriseHqEnabled` (entitled `subscriptionPlan === "enterprise"`). Do not open those routes to Starter/Growth. Park-context (`/api/admin/park-context`) is available without Enterprise.

## 3. Public / guest booking (Phases 1–5 complete)

Guest booking and ticket purchase on a published park page (`/book/{orgSlug}/{venueSlug}`) are live for entitled companies with ticketing enabled. Control-plane sync (cron hold/payment-link expiry, HQ search/export, Demo/suspend gates, Stripe webhook idempotency) and production readiness (Phase 5) are shipped. Waiver signing remains a separate epic. Spec SSOT: [`docs/online-booking-ticketing-complete-spec.md`](./online-booking-ticketing-complete-spec.md). Env: [`docs/ticketing-env.md`](./ticketing-env.md).

- Use **storefront** catalog org **or** a **published location** bound to that venue’s `orgId` (public path is also `/book/{venueSlug}` when the app already supports it)
- **Never** accept another tenant’s JWT `orgId` as authority for writes
- Public reads may be location-token scoped; staff admin remains under `/admin` (or future `/venue/*` with the **same** tenant RBAC)
- POS terminal live under `/admin/pos` + `/api/pos/*` (Growth+). Card tenders confirm in-browser via Stripe Elements (`cardClientSecrets` / `confirm-card`) or payment link; Stripe Terminal reader collect is not wired. Thin booking adapter `/api/pos/bookings*` remains for channel pos. Check-in scanner product and ticket-purchase kiosk stay out of scope.

## 4. Surfaces (do not blur)

| Surface | Path | Owns |
|---|---|---|
| Customer | shop + `/profile` | Guest purchases, measurements as customer |
| Tailor | `/tailor/*` | Studio roster/jobs/campaigns for that Membership |
| Company admin | `/admin/*` (or future `/venue/*` under same RBAC) | Venue ops modules for the tenant |

Do **not** dump venue ops tools into `/profile`. Do **not** put company billing/profile editors on `/tailor/*`.

## 5. Landing navbar feature anchors

Landing / header anchors (`#ticketing`, `#pos`, `#waivers`, …) may stay **honest stubs** until each module’s guest/ops surface ships.

- `#ticketing` may describe **Phases 1–5** (staff catalog, booking/payment APIs, public + admin booking UI, cron/HQ/export/gates, production readiness) without claiming every park is live. Guest waiver signing is the separate Digital Waivers module. POS is a separate Growth+ module.
- Hold + expired payment-link cleanup runs via `expireBookingHolds` / `expireBookingPaymentLinks` on the hourly reconcile cron sibling (`runBookingExpiryMaintenance` — same path for HTTP cron and `yarn reconcile:subscriptions`)
- `#enterprise` is a **real** shipped section (HQ multi-venue control plane) — link to pricing Enterprise card (`#pricing-enterprise`) and `/register-company?plan=enterprise`
- `#waivers` may describe **Phases 1–5** (templates, guest signing, desk verify, import/export, reminders, booking confirmation links, party waiver list on Growth+). Do **not** claim the check-in scanner product, the ticket-purchase kiosk, the Party Command Center, or a legal-compliance certificate.
- `#pos` may describe the live staff terminal (sell, check-in station, tills, tabs, capacity) on Growth+. Do **not** claim the separate check-in scanner product or the ticket-purchase kiosk.
- Do **not** claim Ticketing/POS/Waivers as one mega-suite that includes the check-in scanner product or ticket-purchase kiosk (those remain unshipped; ticketing, waivers, and POS terminal are live)
- `plan.features[]` / `moduleHints` may advertise package story; **ticketing**, **memberships** (guest park, Feature 08), **waivers** (Feature 05 Phases 1–5), and **pos** (Steps 1–2) enforce `moduleHints` via `assertModuleEnabled` / `assertPosEnabled`
- **Enforcement** of other modules only when they ship (`assertModuleEnabled` still requires billing entitlement first). Memberships Phases 1–5 = catalog/settings + admin sell/lifecycle billing + entitlementEngine redeem/verify + guest self-serve / click-to-cancel / agreements / CRM polish / reports / advanced dunning + production smokes/docs. POS Steps 1–2 = catalog/sale engine + staff terminal/check-in/tills/tabs/capacity (`posTerminals` meter). Check-in scanner product and ticket-purchase kiosk remain unshipped.
- HQ location preference is documented in `docs/enterprise-hq-controls.md` — modules must still stamp their own `locationId`
- Residual: optional hold/reserve reminder emails (not required for confirmation)

## 6. Isolation & audit

- App-layer tenancy SSOT: `staffOrg.ts` (`actorOrgFilter`, `assertActorOrgMatch`, `assertStorefrontStaffOrg`)
- Harewa ops acting on another company: `logPlatformActionOnCompany` (storefront actor + `metadata.targetOrgId`)
- Workspace export / soft offboard: `companyExport.ts` — no hard-delete of orders/payments/users in module epics either
- Postgres RLS: **deferred** — see `docs/postgres-rls.md`. Compensating controls are Fresh + actor.orgId filters + smokes.

## 7. Checklist paste for future Cursor prompts

```
[ ] Table has orgId (required, indexed, FK Organization)
[ ] locationId when park-specific (FK VenueLocation; belongs-to-actor-org asserted)
[ ] Creates: Fresh + requireActorOrgId + active + entitled/limit
[ ] No client orgId/locationId trust
[ ] Reuse ProductCategory for catalog classification when applicable (no parallel category entity)
[ ] API_PERMISSIONS + ADMIN_PAGES/nav if UI
[ ] Customer / Tailor / Admin surfaces unchanged
[ ] No fake module complete claim in README
[ ] Smokes: same-org allow + cross-tenant deny
```
