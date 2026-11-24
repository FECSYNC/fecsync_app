/**
 * Server-only Demo plan fail-closed gate.
 * Import from API routes / requirePermissionFresh — not from client components.
 *
 * Never locks the platform host (isDefault / storefrontOrgId) — ops must keep
 * catalog + registered-companies even if subscriptionPlan were stamped demo.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isDemoPlanId } from "@/lib/subscriptionPlans";
import { DEMO_FEATURE_LOCKED_MESSAGE } from "@/lib/demoPlanLock";
import { getStorefrontOrgId } from "@/lib/org";

/**
 * Throws when the org is on Demo and the caller did not opt into a Demo-safe
 * surface (`allowOnDemo` on requirePermissionFresh).
 */
export async function assertNotDemoPlanLocked(
  orgId: string | null | undefined
): Promise<void> {
  if (!orgId) return;
  const id = requireId(orgId, "orgId");
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { subscriptionPlan: true, isDefault: true },
  });
  if (!org || org.isDefault) return;
  // Align with DEFAULT_ORG_ID resolution — identity may be storefront without isDefault.
  try {
    const storefrontOrgId = await getStorefrontOrgId();
    if (id === storefrontOrgId) return;
  } catch {
    // Storefront unresolved — fall through to plan check for this org.
  }
  const plan = org.subscriptionPlan?.trim().toLowerCase() || "";
  if (isDemoPlanId(plan)) {
    throw new ForbiddenError(DEMO_FEATURE_LOCKED_MESSAGE);
  }
}
