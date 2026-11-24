/**
 * Enterprise HQ entitlement — multi-venue control plane under company `/admin/*`.
 *
 * Organization already IS tenant HQ. This gate unlocks Enterprise-only HQ APIs
 * (overview rollup, location context). Basic VenueLocation create/list/update/
 * archive stays available to registered companies (Starter/Growth/Enterprise);
 * create/reactivate still require Billing entitlement + `venues` caps.
 *
 * Do NOT treat `moduleHints: ["all"]` as enforcement for unbuilt POS.
 * Ticketing, Memberships (guest), and Digital Waivers enforce `moduleHints` via `assertModuleEnabled`
 * separately.
 * Storefront / isDefault never gets company HQ console access — except the
 * platform software owner (storefront platform_admin) on the host org.
 */
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrganizationActive,
  getStorefrontOrgId,
} from "@/lib/org";
import {
  BILLING_REQUIRED_MESSAGE,
  isCompanyBillingCreateEntitled,
} from "@/lib/planLimits";
import { DEMO_FEATURE_LOCKED_MESSAGE } from "@/lib/demoPlanLock";
import { isDemoPlanId } from "@/lib/subscriptionPlans";
import { VENUE_STOREFRONT_MESSAGE } from "@/lib/venueLocationMeter";
import type { PlatformOwnerActor } from "@/lib/platformSoftwareOwner";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";

export const ENTERPRISE_HQ_REQUIRED_MESSAGE =
  "Enterprise HQ (venue switcher + cross-park dashboard) requires an entitled Enterprise plan. Open Billing or contact sales.";

export type EnterpriseHqOrgSnapshot = {
  isDefault?: boolean | null;
  status?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndsAt?: Date | string | null;
};

/**
 * Pure read helper for UI soft-gates / ops payloads.
 * Does not hit the DB — pass org fields from session or list APIs.
 * Platform software owner uses session enterpriseHqEnabled (set at /me), not this.
 */
export function orgHasEnterpriseHq(org: EnterpriseHqOrgSnapshot): boolean {
  if (org.isDefault === true) return false;
  if (org.status != null && org.status !== "active") return false;
  const plan = org.subscriptionPlan?.trim().toLowerCase() || "";
  if (plan !== "enterprise") return false;
  return isCompanyBillingCreateEntitled({
    subscriptionStatus: org.subscriptionStatus,
    subscriptionEndsAt: org.subscriptionEndsAt,
    orgStatus: org.status ?? "active",
  });
}

/**
 * Fail-closed server gate for Enterprise HQ APIs (overview, location context).
 * Also denies storefront / Demo / unpaid / non-enterprise — except platform
 * software owner on the storefront host org.
 * Callers should still use requirePermissionFresh (org active + Demo lock).
 */
export async function assertEnterpriseHqEnabled(
  orgId: string,
  actor?: PlatformOwnerActor | null
): Promise<void> {
  const id = requireId(orgId, "orgId");
  if (actor && (await resolveIsPlatformSoftwareOwner(actor))) {
    const ownerOrg =
      typeof actor.orgId === "string" ? actor.orgId.trim() : "";
    if (ownerOrg && ownerOrg === id) {
      await assertOrganizationActive(id);
      return;
    }
  }

  const storefrontOrgId = await getStorefrontOrgId();
  if (id === storefrontOrgId) {
    throw new ForbiddenError(VENUE_STOREFRONT_MESSAGE);
  }

  await assertOrganizationActive(id);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      isDefault: true,
      status: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(VENUE_STOREFRONT_MESSAGE);
  }

  const plan = org.subscriptionPlan?.trim().toLowerCase() || "";
  if (isDemoPlanId(plan)) {
    throw new ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE);
  }
  if (
    !isCompanyBillingCreateEntitled({
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt,
      orgStatus: org.status,
    })
  ) {
    throw new ForbiddenError(BILLING_REQUIRED_MESSAGE);
  }
  if (plan !== "enterprise") {
    throw new ForbiddenError(ENTERPRISE_HQ_REQUIRED_MESSAGE);
  }
}
