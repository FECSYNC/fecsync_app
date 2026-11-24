# Postgres RLS (Step 4 stance)

## Decision: deferred (honest)

This repo does **not** enable Postgres Row Level Security (RLS) policies that set `app.current_org_id` session variables on every Prisma query.

### Why not fake RLS

Prisma’s connection pool + interactive transactions do not safely guarantee a session GUC is set for every query without a custom driver middleware and careful pool isolation. Shipping “RLS enabled” without that would be a false security claim.

### Compensating controls (live)

1. **Fresh auth** — `requirePermissionFresh` / `requireAuthFresh` bind Membership + org status
2. **Actor stamp** — `requireActorOrgId`; never trust client `orgId`
3. **Filters** — `actorOrgFilter` / `assertActorOrgMatch` / `assertStorefrontStaffOrg`
4. **Storefront separation** — public catalog uses `DEFAULT_ORG` / `getStorefrontOrgId()`
5. **Smokes** — `smoke:phase2-tenancy`, `smoke:venue-locations`, `smoke:company-saas-hardening` (cross-tenant deny)
6. **Platform ops audit** — `logPlatformActionOnCompany` stamps `metadata.targetOrgId`

### When to revisit

A dedicated epic may add:

- Prisma `$extends` / driver adapter that `SET LOCAL app.current_org_id` inside transactions
- Policies on tenant tables (`USING (org_id = current_setting('app.current_org_id')::text)`)
- Bypass role only for migrations / Harewa ops jobs

Until then, treat **app-layer isolation** as the control plane SSOT.
