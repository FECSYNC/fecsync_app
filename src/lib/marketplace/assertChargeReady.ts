/**
 * Charge-ready gate for marketplace destination charges.
 * Compose SaaS entitlement + org lifecycle + Connect flags.
 * Soft-hold / Demo / DEFAULT_ORG / pending / suspended all fail closed.
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrganizationActive,
  getStorefrontOrgId,
} from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";

export const MARKETPLACE_STOREFRONT_MESSAGE =
  "FECSYNC storefront cannot be a Connect merchant for tenant marketplace bookings";
export const MARKETPLACE_NOT_CHARGE_READY_MESSAGE =
  "Payouts are not ready — complete Connect onboarding on /admin/payouts before accepting online booking payments";
export const MARKETPLACE_SOFT_HOLD_MESSAGE =
  "Billing soft-hold is active — marketplace checkout and Connect refresh are locked. Contact FECSYNC or renew Billing.";
export const MARKETPLACE_ACCOUNT_DISABLED_MESSAGE =
  "Marketplace payouts are disabled for this company";

export type MarketplaceChargeReadyAccount = {
  id: string;
  orgId: string;
  stripeConnectedAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingStatus: string;
  platformFeeBpsOverride: number | null;
  defaultCurrency: string;
};

/**
 * Assert org may accept live marketplace card charges (destination charges).
 * Returns the marketplace account snapshot for fee/connectedAccount use.
 */
export async function assertOrgMarketplaceChargeReady(
  orgId: string
): Promise<MarketplaceChargeReadyAccount> {
  const id = requireId(orgId, "orgId");

  const storefrontId = await getStorefrontOrgId();
  if (id === storefrontId) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionPlan: true,
    },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
  }

  // Demo companies cannot take live marketplace money (fail closed).
  await assertNotDemoPlanLocked(id);

  // Soft-hold before Fresh active gate so callers get marketplace-specific copy
  // (Fresh soft-deny would otherwise surface as a generic suspended message).
  if (
    isSoftBillingHoldRow({
      status: org.status,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt,
      subscriptionPlan: org.subscriptionPlan,
    })
  ) {
    throw new ForbiddenError(MARKETPLACE_SOFT_HOLD_MESSAGE);
  }

  // Active + not soft-held (Fresh soft-deny).
  await assertOrganizationActive(id);

  await assertCompanyBillingEntitled(id);

  const account = await prisma.organizationMarketplaceAccount.findUnique({
    where: { orgId: id },
  });

  if (!account) {
    throw new ForbiddenError(MARKETPLACE_NOT_CHARGE_READY_MESSAGE);
  }
  if (account.onboardingStatus === "disabled") {
    throw new ForbiddenError(
      account.disabledReason?.trim() || MARKETPLACE_ACCOUNT_DISABLED_MESSAGE
    );
  }
  if (account.onboardingStatus !== "complete") {
    throw new ForbiddenError(MARKETPLACE_NOT_CHARGE_READY_MESSAGE);
  }
  if (!account.chargesEnabled || !account.payoutsEnabled) {
    throw new ForbiddenError(MARKETPLACE_NOT_CHARGE_READY_MESSAGE);
  }
  const connected = account.stripeConnectedAccountId?.trim() || "";
  if (!connected) {
    throw new ForbiddenError(MARKETPLACE_NOT_CHARGE_READY_MESSAGE);
  }

  return {
    id: account.id,
    orgId: account.orgId,
    stripeConnectedAccountId: connected,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    onboardingStatus: account.onboardingStatus,
    platformFeeBpsOverride: account.platformFeeBpsOverride,
    defaultCurrency: account.defaultCurrency,
  };
}

/** Non-throwing readiness probe for admin UI / dashboard nudge. */
export async function getMarketplaceChargeReadyState(orgId: string): Promise<{
  chargeReady: boolean;
  reason: string | null;
  account: MarketplaceChargeReadyAccount | null;
}> {
  try {
    const account = await assertOrgMarketplaceChargeReady(orgId);
    return { chargeReady: true, reason: null, account };
  } catch (err) {
    const message =
      err instanceof ForbiddenError
        ? err.message
        : err instanceof Error
          ? err.message
          : MARKETPLACE_NOT_CHARGE_READY_MESSAGE;
    return { chargeReady: false, reason: message, account: null };
  }
}
