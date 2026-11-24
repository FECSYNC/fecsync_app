/**
 * Demo plan surface lock (client-safe).
 *
 * Demo **company** tenants may only use:
 * - `/admin` dashboard shell
 * - `/admin/company-profile`
 * - `/admin/billing` (upgrade CTA — not a full ops app)
 * - `/admin/profile` (self-service account)
 *
 * All other admin apps stay locked until Starter / Growth / Enterprise.
 * Enterprise HQ (`/admin/hq`, `/api/admin/hq/*`) is NOT Demo-allowed — fail closed
 * via requirePermissionFresh → assertNotDemoPlanLocked + assertEnterpriseHqEnabled.
 * Server fail-closed: `assertNotDemoPlanLocked` via requirePermissionFresh.
 *
 * Platform host (storefront / DEFAULT_ORG) is never Demo-locked — matches server
 * `assertNotDemoPlanLocked` (`isDefault` + storefrontOrgId). Same Membership
 * preset name `platform_admin` means different powers by org:
 * - storefront + platform_admin → ops (all companies / platform users)
 * - registered company + platform_admin → that org only
 */

import { isDemoPlanId } from "@/lib/subscriptionPlans";

export const DEMO_FEATURE_LOCKED_MESSAGE =
  "This app is locked on the Demo plan. Open Billing to upgrade to Starter, Growth, or Enterprise.";

/** Paths demo company staff may open (exact `/admin` only — not every `/admin/*`). */
export function isDemoAllowedAdminPath(pathname: string): boolean {
  const p =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (p === "/admin") return true;
  if (p === "/admin/profile" || p.startsWith("/admin/profile/")) return true;
  if (
    p === "/admin/company-profile" ||
    p.startsWith("/admin/company-profile/")
  ) {
    return true;
  }
  if (p === "/admin/billing" || p.startsWith("/admin/billing/")) return true;
  return false;
}

/**
 * True when this session should get the Demo UI lock.
 * Storefront / platform host never locks (ops must keep products, companies, CMS).
 */
export function sessionIsDemoPlan(
  user:
    | {
        subscriptionPlan?: string | null;
        orgId?: string | null;
        storefrontOrgId?: string | null;
      }
    | null
    | undefined
): boolean {
  const orgId = typeof user?.orgId === "string" ? user.orgId.trim() : "";
  const storefront =
    typeof user?.storefrontOrgId === "string"
      ? user.storefrontOrgId.trim()
      : "";
  if (orgId && storefront && orgId === storefront) return false;
  return isDemoPlanId(user?.subscriptionPlan?.trim().toLowerCase() ?? null);
}
