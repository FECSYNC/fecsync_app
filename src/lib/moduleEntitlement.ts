/**
 * Venue module entitlement gate (README Module entitlement contract).
 *
 * Order (fail closed):
 * 1) assertOrganizationActive
 * 2) assertCompanyBillingEntitled
 * 3) Demo plan → DEMO_FEATURE_LOCKED_MESSAGE
 * 4) Storefront / isDefault → Forbidden (park modules are registered-company only)
 * 5) plan.moduleHints includes moduleId OR "all"
 */
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrganizationActive,
  getStorefrontOrgId,
} from "@/lib/org";
import {
  assertCompanyBillingEntitled,
  resolveOrgPlanId,
} from "@/lib/planLimits";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { DEMO_FEATURE_LOCKED_MESSAGE } from "@/lib/demoPlanLock";
import {
  isDemoPlanId,
  planAllowsModule as planAllowsModuleHint,
} from "@/lib/subscriptionPlans";
import {
  getCachedStaffGate,
  setCachedStaffGate,
} from "@/lib/ticketing/staffGateCache";

export type VenueModuleId =
  | "ticketing"
  | "pos"
  | "waivers"
  | "loyalty"
  | "memberships"
  | "marketing"
  | "access_control"
  | "surveys"
  | "dynamic_pricing"
  | "accounting";

export const MODULE_NOT_ENABLED_MESSAGE =
  "This module is not included in your subscription package. Open Billing to upgrade.";

export const MODULE_STOREFRONT_MESSAGE =
  "Park venue modules are available on registered company workspaces only.";

/** Re-export client-safe SSOT from subscriptionPlans (Prisma-free). */
export function planAllowsModule(
  planId: string | null | undefined,
  moduleId: VenueModuleId
): boolean {
  return planAllowsModuleHint(planId, moduleId);
}

/** Hint-only gate (for smokes / unit checks without org state). */
export function assertPlanIncludesModule(
  planId: string | null | undefined,
  moduleId: VenueModuleId
): void {
  if (!planAllowsModule(planId, moduleId)) {
    throw new ForbiddenError(MODULE_NOT_ENABLED_MESSAGE);
  }
}

async function isStorefrontOrDefaultOrg(orgId: string): Promise<boolean> {
  const id = requireId(orgId, "orgId");
  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) return true;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { isDefault: true },
  });
  return Boolean(org?.isDefault);
}

/**
 * Fail-closed module access for staff and public booking surfaces.
 * Call after Fresh permission checks on staff mutates; public paths call this
 * before serving catalog/checkout for a published venue.
 */
export async function assertModuleEnabled(
  orgId: string,
  moduleId: VenueModuleId
): Promise<void> {
  const id = requireId(orgId, "orgId");
  const cacheKey = `module:${id}:${moduleId}`;
  if (getCachedStaffGate(cacheKey)) return;

  await assertOrganizationActive(id);
  await assertCompanyBillingEntitled(id);

  const resolved = await resolveOrgPlanId(id);
  if (isDemoPlanId(resolved.plan)) {
    throw new ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE);
  }

  if (await isStorefrontOrDefaultOrg(id)) {
    throw new ForbiddenError(MODULE_STOREFRONT_MESSAGE);
  }

  // Entitled null plan floors to starter for limits — same for module hints.
  const planForHints = resolved.plan ?? resolved.planResolved;
  if (!planAllowsModule(planForHints, moduleId)) {
    throw new ForbiddenError(MODULE_NOT_ENABLED_MESSAGE);
  }
  setCachedStaffGate(cacheKey);
}
