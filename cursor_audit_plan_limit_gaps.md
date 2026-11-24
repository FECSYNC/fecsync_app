# Audit plan-limit gaps — HISTORICAL

_Exported on 9/8/2026 at 15:47:01 GMT+1 from Cursor (3.18.9)_

> **HISTORICAL — not actionable SSOT.** Do not treat this file as a live backlog.
> Venue/attraction plan SSOT is `src/lib/subscriptionPlans.ts` (includes `venues` +
> `roleTemplates`). Enforcement lives in `src/lib/planLimits.ts`. Prefer live code +
> `yarn smoke:plan-limits` / `yarn smoke:venue-locations`. Do not implement from this file.

---

**User**

Deep audit of Company SaaS Step 3 plan limits in this Next.js/Prisma repo at C:\Users\user\Downloads\ROLLER APP CLONE\roller_clone_app.

Goal: Find EVERY create/invite/assign path that should enforce plan limits but might not, plus UI/API disconnects.

Resources that must be capped (registered company orgs only; storefront/isDefault skipped):
- members (active+invited)
- products
- fabrics
- categories
- tailorSeats (rolePreset tailor)
- campaigns
- tailorClients

Known enforcement files (verify still wired):
- src/lib/planLimits.ts
- src/lib/subscriptionPlans.ts
- POST product, product/bulk, fabric, product-category
- admin members POST/PATCH, adminUsers createStaffUserWithMembership, admin tailors POST
- createCampaignForTailor, createTailorClient in measurementCampaigns.ts
- GET /api/admin/billing/usage
- GET /api/admin/registered-companies/metrics

Please search thoroughly for:
1. Alternate create paths (duplicate APIs, admin campaign create, import/bulk, seed, clone product, etc.) that bypass assertWithinPlanLimit
2. Hardcoded 25 client limits still used as SSOT instead of getPlanLimits
3. UI that says campaigns are free / Basic plan / wrong copy
4. Whether admin campaign routes exist separate from tailor campaigns
5. CreateUserModal / invite paths
6. Whether membership status changes (revoked→active) skip limits
7. Whether fabric/category bulk or import exists
8. Disconnected: CompaniesOverviewCards permissions, CompanyPlanUsageCards, adminNav billing visibility for storefront
9. Duplicate limit logic that could diverge

Return a structured list:
- Confirmed wired correctly
- Gaps / bugs (file:line if possible)
- False positives to ignore
- Suggested fixes ranked by severity

Be very thorough. Do not modify files.

---

**Cursor**

I'll audit plan-limit enforcement across create/invite/assign paths, starting from the known limit helpers and every related API/UI entry point.

# Company SaaS Step 3 — Plan Limits Audit

Enforcement SSOT is `getPlanLimits` / `assertWithinPlanLimit` in `src/lib/subscriptionPlans.ts` + `src/lib/planLimits.ts`. Storefront / `isDefault` orgs are correctly uncapped.

---

## Confirmed wired correctly

| Resource | Path | Notes |
|---|---|---|
| **products** | `POST /api/product` (~82–83) | `assertWithinPlanLimit(products)` |
| **products** | `POST /api/product/bulk` (~65–66) | `adding = productsPayload.length` |
| **fabrics** | `POST /api/fabric` (~201–202) | Wired |
| **categories** | `POST /api/product-category` (~123–124) | Wired |
| **members / tailorSeats** | `POST /api/admin/members` (~392–410) | Only when seating; skips if already live; tailor seats when newly tailor |
| **members / tailorSeats** | `PATCH /api/admin/members/[id]` (~184–197) | Members on revoked/suspended→live; seats only if **role becomes** tailor |
| **members / tailorSeats** | `createStaffUserWithMembership` (`adminUsers.ts` ~130–134) via `POST /api/admin/users` | CreateUserModal → this path |
| **tailorSeats + members** | `POST /api/admin/tailors` (~103–105) | Asserts before `createAdminTailor` (see over-assert gap below) |
| **campaigns** | `createCampaignForTailor` (~1536–1537) via `POST /api/tailor/campaigns` | Only create path in repo |
| **tailorClients** | `createTailorClient` (~3863–3864) via `POST /api/tailor/clients` | Only create path in repo |
| **usage API** | `GET /api/admin/billing/usage` | `getPlanUsageSnapshot` + registered-company gate |
| **metrics API** | `GET /api/admin/registered-companies/metrics` | Storefront platform_admin + manage_roles |
| **UI mirrors** | Invite modal, Add Product/Fabric/Category | `usageMeterFor` + disable/toast |
| **Billing nav** | `ADMIN_REGISTERED_COMPANY_ONLY_PATHS` + `isAdminPageAllowed` | Billing hidden for storefront org |
| **Dashboard split** | `AdminDashboard` | Storefront → `CompaniesOverviewCards`; company → `CompanyPlanUsageCards` |

No admin campaign create routes. No fabric/category bulk/import create APIs. No product clone/duplicate create. Seller/shop product routes are `410 Gone`. Campaign/client Prisma creates only in `measurementCampaigns.ts`.

---

## Gaps / bugs

### Critical — limit bypasses

1. **Reactivate revoked/suspended tailor skips `tailorSeats`**  
   `src/app/api/admin/members/[id]/route.ts` ~191–197: seats asserted only when `prevRolePreset !== "tailor"`.  
   Flow: revoke tailor (seat freed) → reactivate same tailor → **members checked, seats not** → can exceed `tailorSeats`.

2. **Approve tailor can force-activate seat without plan check**  
   `src/lib/tailors.ts` `updateAdminTailor` ~1033–1034 → `ensureTailorMembership(..., { forceActive: true })` with **no** `assertWithinPlanLimit`.  
   Reactivates existing `rolePreset: "tailor"` membership (revoked/suspended → active). Same bypass as (1). Called from `PATCH/PUT /api/admin/tailors/[id]`.

3. **`ensureTailorMembership` itself never calls plan limits**  
   `src/lib/tailors.ts` ~439–503: create/promote/forceActive membership writes are unprotected; only callers that assert first are safe. Approve path is not.

### High — incorrect enforcement / UX that enables overshoot

4. **`POST /api/admin/tailors` always asserts `members` +1** (~104–105)  
   Even when promoting an **already live** member. Can falsely block at member cap, or (worse pairing with (2)) force ops toward approve/reactivate paths that bypass seats.

5. **Tailor client UI uses per-tailor `total` vs org-wide cap**  
   - Server: `countPlanResource(tailorClients)` = **org-wide**  
   - List returns org `planLimit` but pagination `total` = **this tailor only** (`measurementCampaigns.ts` ~3826–3829)  
   - `TailorHomePage.tsx` ~91–96: `used = total`, `limit = planLimit`  
   Multi-tailor org: UI can show headroom while create correctly fails (or worse, understates usage). Campaigns correctly use org `planUsed` (~1463–1465); clients do not.

6. **Stale “campaigns are free” copy (contradicts caps 2 / 20)**  
   - `CampaignsPage.tsx` ~255–256: “Creating campaigns is free on every plan.”  
   - `TailorCreditsPage.tsx` ~88–89: “Campaigns are free to create.”  
   Header meter (~216–218) and `CampaignFormModal` are plan-aware; marketing copy is not.

### Medium — UI / API disconnects

7. **`CreateUserModal` has no usage meter / at-limit gate**  
   `CreateUserModal.tsx` — no `useBillingUsageQuery`. Invite modal does (~744–855). API still enforces via `createStaffUserWithMembership`. Soft gap: UX allows submit then 403.

8. **Edit membership modal has no plan-limit UI**  
   Reactivate / promote-to-tailor relies on API only; plus seats bypass in (1).

9. **`CompaniesOverviewCards` permission softer than API**  
   UI: `UsersManageRoles` + storefront session (~29–30).  
   API: also `assertStorefrontPlatformAdmin` (preset must be `platform_admin`).  
   Non–platform-admin with `users:manage_roles` sees cards → API 403 / “—”.

10. **Hardcoded `25` / `2` fallbacks still as local defaults (not SSOT)**  
    - `TailorHomePage.tsx` ~92: `?? 25`  
    - `AddClientModal.tsx` ~59: `remaining = 25`  
    - `resolveTailorClientPlanLimit` ~3840: `return 25` if no orgId  
    - campaign list ~1462: `planLimit = … : 2`  
    Live path usually uses `getPlanLimits`; fallbacks reintroduce starter magic numbers if profile/org missing.

11. **Permissions docs still say “25-client plan limit”**  
    `permissions.ts` ~134, ~1556 — stale vs plan-driven caps.

12. **Starter/Growth `features[]` omit campaign limits**  
    `subscriptionPlans.ts` lists members/seats/clients but not “2/20 campaigns” — billing UI under-describes enforcement.

### Low

13. **Duplicate limit resolution**  
    `resolveOrgPlanResourceCap` in `measurementCampaigns.ts` ~1476–1493 reimplements storefront/`isDefault` + `getPlanLimits` (unlimited as `MAX_SAFE_INTEGER`) instead of sharing `getPlanUsageSnapshot` / a thin helper from `planLimits.ts`. Drift risk (already: UI unlimited vs assert null).

14. **`CreateUserModal` / invite: no shared “seat delta” helper**  
    Invite computes remaining client-side; create user does not — easy to diverge again.

---

## False positives (ignore)

| Item | Why |
|---|---|
| Coordinator invite `.max(25)` / `inviteRows.length >= 25` | Batch invite size, not plan `tailorClients` |
| `listTailorClients` page `limit` default 25 | Pagination page size |
| CSS `opacity-25`, mock `25.7K`, shipping width 25 | Unrelated |
| Smoke scripts creating products/members | Test harness, not product paths |
| `orgRegistration` / first company admin membership | Bootstrap; not a recurring create subject to SaaS caps |
| `ensureAdminMembership` storefront bootstrap | Platform recovery, not company catalog |
| No admin campaign API | By design — tailor-only create |
| No fabric/category bulk create | Only product bulk exists (and is capped) |
| Billing hidden for storefront | Correct via `ADMIN_REGISTERED_COMPANY_ONLY_PATHS` |
| `CompanyPlanUsageCards` permission set | Aligns with usage API’s `requireAnyPermissionFresh` list |

---

## Suggested fixes (by severity)

1. **P0 — Tailor seat reactivation**  
   On `PATCH /api/admin/members/[id]`, assert `tailorSeats` when `willBeLive && rolePreset === "tailor" && !(wasLive && prevRolePreset === "tailor")` (any new live tailor seat, including same-preset reactivate).

2. **P0 — Gate `ensureTailorMembership`**  
   Before create / promote / `forceActive` that turns a non-live tailor into a live tailor seat, call `assertWithinPlanLimit(orgId, "tailorSeats")` (and `members` when creating a new membership). Prefer asserting inside `ensureTailorMembership` so approve + admin create cannot diverge.

3. **P0 — Fix `POST /api/admin/tailors` asserts**  
   Inspect existing membership: assert `members` only if adding a new live seat; assert `tailorSeats` only if not already a live tailor. Do not blindly `+1` both.

4. **P1 — Org-wide `planUsed` for tailor clients**  
   Mirror campaigns: return `planUsed` via `countPlanResource(orgId, "tailorClients")`; update `TailorHomePage` / `AddClientModal` to use it (drop `?? 25` defaults where API provides caps).

5. **P1 — Fix campaign copy**  
   Replace “free on every plan” with plan-aware text (e.g. remaining / upgrade), including `TailorCreditsPage`.

6. **P2 — CreateUserModal + EditMember**  
   Reuse invite’s `usageMeterFor` gates for create and for reactivate/promote-to-tailor.

7. **P2 — CompaniesOverviewCards**  
   Gate with platform_admin (or `isPlatformAdminActor`) to match `assertStorefrontPlatformAdmin`.

8. **P3 — Deduplicate**  
   Move `resolveOrgPlanResourceCap` into `planLimits.ts`; refresh permissions comments; add campaign lines to plan `features[]`.

---

**Bottom line:** Catalog creates (product/fabric/category/bulk) and the primary invite/create-user/campaign/client paths are wired. The dangerous holes are **tailor seat reactivation / approve forceActive** (real bypasses), **admin tailor POST over-asserting members**, **org-wide vs per-tailor client meter mismatch**, and **“campaigns are free” UI lying against Starter/Growth caps**.

