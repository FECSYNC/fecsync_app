# Enterprise HQ controls (shipped)

**Audience:** agents and operators extending company admin after the Enterprise HQ epic (Steps 1–4) and park-admin assignments.

**Related:** [`README.md`](../README.md) (control plane + next epics), [`saas-module-extension.md`](./saas-module-extension.md), `src/lib/subscriptionPlans.ts`, `.cursor/rules/saas-venue-platform.mdc`, `src/lib/parkAdminScope.ts`.

---

## What shipped

| Surface | Meaning |
|---|---|
| `/admin/hq` | Cross-park HQ dashboard: real `VenueLocation` health + company-wide plan meters. Soft-upsell for non-Enterprise (no rollup leak). |
| Header HQ switcher | Entitled Enterprise + company-wide seats — persists `Membership.hqSelectedLocationId` (`null` = All locations). |
| Header park switcher | Growth/Starter multi-venue CWV filter **or** park-locked seats via `/api/admin/park-context` (no HQ rollup claim; park-locked never gets All). |
| `/admin/venues` | Create / edit / soft-archive / reactivate. When scope is set, **list filters** to that park (`?scope=all` for switchers; park-locked still assigned-only). |
| Location scope policy | Filters **venue lists + HQ venue items + park-stamped modules** (ticketing; POS devices/sales; Product/Order when `venueLocationId` stamped). When Accounting is initialized, HQ overview also rolls up **MTD revenue, expenses, net profit, cash, and AR** for the selected park scope (soft-fails if Accounting is off). Plan meters (including **`posTerminals`**) stay **company-wide**. Members roster is company-wide for CWV seats; **franchise park managers** see a park-local roster only. |
| Park assignments | `MembershipVenueAssignment` — one+ active rows park-locks the seat (Growth/Starter OK; **no Enterprise required**). Platform software owner / FECSYNC storefront ops bypass to company-wide. |
| Ops | `/admin/registered-companies` shows `venuesActive` + `enterpriseHqEligible`. Unlock via contact-sales + Approve / Set plan. |

### Park assignments vs HQ preference

| Concept | Storage | Who | Effect |
|---|---|---|---|
| **HQ / park preference** | `Membership.hqSelectedLocationId` | Actor’s own seat via HQ location-context **or** park-context | View filter for CWV seats (`null` = All). Park-locked may only pick an assigned park (never All). |
| **Park lock** | `MembershipVenueAssignment` rows | Company-wide / `platform_admin` / software owner via `PUT …/venue-assignments` | Authority boundary: seat may only operate inside assigned venues. Independent of Enterprise entitlement. |
| **CWV** | `Membership.companyWideView` | Layer-2 ownership visibility | Does **not** by itself expand park assignments. CWV + assignments → still park-locked. |

Archive of a venue clears that venue’s assignments **and** any `hqSelectedLocationId` pointing at it. Reactivate restores the venue (and venues quota) only — it does **not** restore park assignments.

**Empty assignments:** CWV / `platform_admin` with zero assignment rows → company-wide. Non-CWV with zero rows → own-records (Layer-2 visibility; not park-locked).

### Franchise parks (Step 2)

| Concept | Meaning |
|---|---|
| **Franchise park** | A `VenueLocation` with `isFranchise` (+ optional franchise profile fields) under the **same** Organization. Not a second company tenant and not a second SaaS Stripe Customer. |
| **Franchise park manager** | `Membership.franchiseParkManager` on a **park-locked** seat. May invite and manage staff only inside their assigned parks. Never `platform_admin`, never `companyWideView`, never empty assignments. |
| **Park-local roster** | `GET /api/admin/members` for a franchise manager returns only memberships with an active assignment intersecting the manager’s parks. |
| **Company SaaS billing** | `/admin/billing`, company profile, plan meters (members + venues), and Enterprise HQ company meters stay on the parent Organization. |
| **Park-lock** | Remains the isolation boundary (`MembershipVenueAssignment` + `resolveEffectiveParkScope`). |
| **Per-park Connect guest payouts** | **Step 3 shipped:** `VenueLocationMarketplaceAccount` per franchise park. Guest card money for park-stamped catalog uses `resolveGuestPayoutDestination` → park Connect when charge-ready (fail closed otherwise). Org `OrganizationMarketplaceAccount` remains for non-franchise / null-location catalog. SaaS billing stays company-wide on `/admin/billing`. Franchise managers onboard only assigned parks via `/admin/payouts?locationId=…`. |

Company-wide admins mark parks as franchise on `/admin/venues`, grant/revoke `franchiseParkManager`, and see the full roster. Soft-archive of a franchise park still clears assignments (and clears `franchiseParkManager` when the seat has no remaining parks). Smoke: `yarn smoke:franchise-parks`.

**Platform ops vs tenant HQ:** Storefront `platform_admin` manages **all companies** (approve / set plan / suspend) and **any user** (platform-accounts), and may open `/admin/venues` + `/admin/hq` as **ops consoles** (venue counts + HQ eligibility). That is unrestricted **ops visibility**, not “log into every company’s tenant HQ.” Tenant create/archive/switcher/rollup stay registered-company-only so ops never becomes a cross-tenant data browser. Company admins remain hard-scoped to `actor.orgId`. Software-owner path resolves **company-wide** (all parks) via `resolveEffectiveParkScope`.

**Shipped module entitlement (honest):** Online Ticketing / Bookings (Starter+; catalog, staff + public wizards, payments, invoices, HQ search/export, park scope) — see `docs/online-booking-ticketing-complete-spec.md`. Guest park Memberships Phases 1–5 (Growth+) — see `docs/memberships-complete-spec.md`. Digital Waivers Phases 1–5 (Growth+) — see `docs/digital-waivers-complete-spec.md`. POS terminal Steps 1–2 (Growth+; `posTerminals` meter) — see `docs/pos-two-step-prompts.md`. HQ overview shows real POS device/sale counts and signed waiver counts for the selected park scope when entitled.

**Not shipped:** Access Control, Guest Surveys, Loyalty, Dynamic Pricing as working apps; the separate **check-in scanner product** and **ticket-purchase kiosk**. Do not claim those complete because Enterprise is entitled.

---

## Gates

1. `requirePermissionFresh` + `settings:manage` (HQ / venues)
2. Registered company (`actor.orgId`, not storefront / `isDefault`)
3. Demo plan locked (`assertNotDemoPlanLocked` / Fresh) — HQ is **not** a Demo-allowed surface
4. HQ APIs: `assertEnterpriseHqEnabled` (entitled `subscriptionPlan === "enterprise"`)
5. Park-context APIs: any of settings/analytics/products/orders/ticketing/bookings/memberships/waivers/pos — **no** Enterprise required
6. Venue assignments: `users:park_assign` (`UsersParkAssign`; expanded from `users:manage_roles`) + company-wide / platform_admin / software owner
7. Session soft-gate: `user.enterpriseHqEnabled` + `user.parkLocked` / `assignedLocationIds` from `/me`

Never trust client `orgId` / `locationId` / `userId` / `membershipId` as authority.

---

## APIs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/hq/overview` | Rollup + meters; items may be location-scoped |
| `GET`/`PUT` | `/api/admin/hq/location-context` | Read/set Membership park preference (Enterprise) |
| `GET`/`PUT` | `/api/admin/park-context` | Same preference field; Growth/park-locked (no Enterprise) |
| `PUT` | `/api/admin/members/[id]/venue-assignments` | Replace-set park assignments |
| `GET` | `/api/admin/venue-locations` | Default applies `actorLocationScope`; `?scope=all` skips preference filter |
| `POST`/`PATCH`/`DELETE` | `/api/admin/venue-locations` (+`/[id]`) | CRUD / soft-archive / reactivate; archive clears HQ prefs + assignments |

Libs: `enterpriseHq.ts`, `actorLocationScope.ts`, `parkAdminScope.ts`, `parkContext.ts`, `hqLocationContext.ts`, `hqOverview.ts`, `venueLocations.ts`.

---

## Dashboards / marketing

- **Company admin:** `/admin`, `/admin/hq`, `/admin/venues`, `/admin/billing` — HQ + park-admin copy aligned with control plane
- **Ops:** `/admin/registered-companies` — HQ available / HQ locked badges
- **Landing:** `/home` (`VenueFlowLanding` + header) + static `public/venueflow/*` — `#enterprise` is a real section; CTAs → `/register-company?plan=enterprise`
- **Tailor / customer:** no HQ nav or admin leakage

Plan SSOT feature strings: `subscriptionPlans.ts` enterprise package.

---

## Smokes

```bash
yarn smoke:venue-locations
yarn smoke:enterprise-hq
yarn smoke:park-admin-scope
yarn smoke:franchise-parks
yarn smoke:franchise-park-payouts
```

---

## Non-goals (next epics)

Module tables must stamp their own `orgId` + optional `locationId` — HQ preference is **not** a substitute. See `saas-module-extension.md`.
