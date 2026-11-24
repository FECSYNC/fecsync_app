/**
 * Guest payout destination resolver (Step 3).
 *
 * Resolution order (server-stamped locationId only — never trust client):
 * 1) Franchise park + park Connect charge-ready → settlementScope=park
 * 2) Null locationId OR non-franchise park → OrganizationMarketplaceAccount when
 *    org charge-ready → settlementScope=org
 * 3) Franchise park not charge-ready → fail closed (park payouts onboarding required)
 *
 * Soft-hold / Demo / DEFAULT_ORG / suspended inherit org charge-ready gates.
 */

import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrgMarketplaceChargeReady,
  type MarketplaceChargeReadyAccount,
  MARKETPLACE_NOT_CHARGE_READY_MESSAGE,
  MARKETPLACE_ACCOUNT_DISABLED_MESSAGE,
  MARKETPLACE_SOFT_HOLD_MESSAGE,
  MARKETPLACE_STOREFRONT_MESSAGE,
} from "@/lib/marketplace/assertChargeReady";
import { getStorefrontOrgId, assertOrganizationActive } from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";

/** Admin / staff-facing — may mention /admin/payouts onboarding. */
export const PARK_PAYOUTS_NOT_READY_MESSAGE =
  "Park payouts are not ready — complete Connect onboarding for this franchise park on /admin/payouts before accepting online card payments";
export const PARK_PAYOUTS_ARCHIVED_MESSAGE =
  "This franchise park is archived — new park card charges are blocked";
export const PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE =
  "Park Connect onboarding is only available for franchise parks";
export const PARK_PAYOUTS_DISABLED_MESSAGE =
  "Park payouts are disabled for this franchise park";

/** Guest-facing copy — client-safe module (no prisma). Re-export for server call sites. */
export {
  PARK_PAYOUTS_NOT_READY_GUEST_MESSAGE,
  PARK_PAYOUTS_ARCHIVED_GUEST_MESSAGE,
  PARK_PAYOUTS_DISABLED_GUEST_MESSAGE,
  guestSafeParkPayoutsMessage,
} from "@/lib/marketplace/guestParkPayoutsMessage";

export type GuestSettlementScope = "park" | "org";

export type GuestPayoutDestination = {
  settlementScope: GuestSettlementScope;
  orgId: string;
  locationId: string | null;
  connectedAccountId: string;
  platformFeeBpsOverride: number | null;
  defaultCurrency: string;
  accountId: string;
};

async function assertTenantOrgGates(orgId: string): Promise<void> {
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
  await assertNotDemoPlanLocked(id);
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
  await assertOrganizationActive(id);
  await assertCompanyBillingEntitled(id);
}

/**
 * Assert a franchise park may accept live destination charges.
 */
export async function assertParkMarketplaceChargeReady(
  orgId: string,
  locationId: string
): Promise<MarketplaceChargeReadyAccount & { locationId: string }> {
  const oid = requireId(orgId, "orgId");
  const lid = requireId(locationId, "locationId");
  await assertTenantOrgGates(oid);

  const venue = await prisma.venueLocation.findFirst({
    where: { id: lid, orgId: oid },
    select: {
      id: true,
      orgId: true,
      status: true,
      isFranchise: true,
    },
  });
  if (!venue || !venue.isFranchise) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE);
  }
  if (venue.status !== "active") {
    throw new ForbiddenError(PARK_PAYOUTS_ARCHIVED_MESSAGE);
  }

  const account = await prisma.venueLocationMarketplaceAccount.findUnique({
    where: { locationId: lid },
  });
  if (!account || account.orgId !== oid) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_READY_MESSAGE);
  }
  if (account.onboardingStatus === "disabled") {
    throw new ForbiddenError(
      account.disabledReason?.trim() || PARK_PAYOUTS_DISABLED_MESSAGE
    );
  }
  if (account.onboardingStatus !== "complete") {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_READY_MESSAGE);
  }
  if (!account.chargesEnabled || !account.payoutsEnabled) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_READY_MESSAGE);
  }
  const connected = account.stripeConnectedAccountId?.trim() || "";
  if (!connected) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_READY_MESSAGE);
  }

  return {
    id: account.id,
    orgId: account.orgId,
    locationId: lid,
    stripeConnectedAccountId: connected,
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    detailsSubmitted: account.detailsSubmitted,
    onboardingStatus: account.onboardingStatus,
    platformFeeBpsOverride: account.platformFeeBpsOverride,
    defaultCurrency: account.defaultCurrency,
  };
}

export async function getParkMarketplaceChargeReadyState(
  orgId: string,
  locationId: string
): Promise<{
  chargeReady: boolean;
  reason: string | null;
  account: (MarketplaceChargeReadyAccount & { locationId: string }) | null;
}> {
  try {
    const account = await assertParkMarketplaceChargeReady(orgId, locationId);
    return { chargeReady: true, reason: null, account };
  } catch (err) {
    const message =
      err instanceof ForbiddenError
        ? err.message
        : err instanceof Error
          ? err.message
          : PARK_PAYOUTS_NOT_READY_MESSAGE;
    return { chargeReady: false, reason: message, account: null };
  }
}

/**
 * Resolve where guest card money for a catalog row must settle.
 * `locationId` must come from the server-side catalog / booking row.
 */
export async function resolveGuestPayoutDestination(input: {
  orgId: string;
  locationId: string | null | undefined;
}): Promise<GuestPayoutDestination> {
  const orgId = requireId(input.orgId, "orgId");
  const locationId =
    typeof input.locationId === "string" && isValidId(input.locationId)
      ? input.locationId.trim()
      : null;

  if (!locationId) {
    const orgReady = await assertOrgMarketplaceChargeReady(orgId);
    return {
      settlementScope: "org",
      orgId,
      locationId: null,
      connectedAccountId: orgReady.stripeConnectedAccountId,
      platformFeeBpsOverride: orgReady.platformFeeBpsOverride,
      defaultCurrency: orgReady.defaultCurrency,
      accountId: orgReady.id,
    };
  }

  const venue = await prisma.venueLocation.findFirst({
    where: { id: locationId, orgId },
    select: {
      id: true,
      status: true,
      isFranchise: true,
    },
  });
  if (!venue) {
    throw new ForbiddenError("Venue not found for payout routing");
  }

  if (venue.isFranchise) {
    if (venue.status !== "active") {
      throw new ForbiddenError(PARK_PAYOUTS_ARCHIVED_MESSAGE);
    }
    const parkReady = await assertParkMarketplaceChargeReady(orgId, locationId);
    return {
      settlementScope: "park",
      orgId,
      locationId,
      connectedAccountId: parkReady.stripeConnectedAccountId,
      platformFeeBpsOverride: parkReady.platformFeeBpsOverride,
      defaultCurrency: parkReady.defaultCurrency,
      accountId: parkReady.id,
    };
  }

  // Non-franchise park → org Connect fallback when company is charge-ready.
  const orgReady = await assertOrgMarketplaceChargeReady(orgId);
  return {
    settlementScope: "org",
    orgId,
    locationId,
    connectedAccountId: orgReady.stripeConnectedAccountId,
    platformFeeBpsOverride: orgReady.platformFeeBpsOverride,
    defaultCurrency: orgReady.defaultCurrency,
    accountId: orgReady.id,
  };
}

/** Non-throwing probe for UI publish / nudge gates. */
export async function getGuestPayoutDestinationState(input: {
  orgId: string;
  locationId: string | null | undefined;
}): Promise<{
  ready: boolean;
  reason: string | null;
  destination: GuestPayoutDestination | null;
}> {
  try {
    const destination = await resolveGuestPayoutDestination(input);
    return { ready: true, reason: null, destination };
  } catch (err) {
    const message =
      err instanceof ForbiddenError
        ? err.message
        : err instanceof Error
          ? err.message
          : MARKETPLACE_NOT_CHARGE_READY_MESSAGE;
    return { ready: false, reason: message, destination: null };
  }
}

/**
 * Venue booking / ticketing Checkout destination.
 * - Franchise parks: resolveGuestPayoutDestination (fail closed until park ready).
 * - Non-franchise: org Connect when charge-ready; else platform (null) so
 *   legacy World C companies without Connect keep working.
 */
export async function resolveVenueBookingCheckoutDestination(input: {
  orgId: string;
  locationId: string;
  amountMinor: number;
}): Promise<{
  settlementScope: GuestSettlementScope | "platform";
  connectedAccountId: string | null;
  applicationFeeMinor: number | null;
}> {
  const orgId = requireId(input.orgId, "orgId");
  const locationId = requireId(input.locationId, "locationId");
  const venue = await prisma.venueLocation.findFirst({
    where: { id: locationId, orgId },
    select: { id: true, isFranchise: true, status: true },
  });
  if (!venue) {
    throw new ForbiddenError("Venue not found for payout routing");
  }

  if (venue.isFranchise) {
    const dest = await resolveGuestPayoutDestination({ orgId, locationId });
    const { computePlatformFeeMinor } = await import("@/lib/marketplace/fees");
    const applicationFeeMinor = computePlatformFeeMinor({
      amountMinor: input.amountMinor,
      platformFeeBpsOverride: dest.platformFeeBpsOverride,
    });
    return {
      settlementScope: dest.settlementScope,
      connectedAccountId: dest.connectedAccountId,
      applicationFeeMinor,
    };
  }

  try {
    const dest = await resolveGuestPayoutDestination({ orgId, locationId });
    const { computePlatformFeeMinor } = await import("@/lib/marketplace/fees");
    const applicationFeeMinor = computePlatformFeeMinor({
      amountMinor: input.amountMinor,
      platformFeeBpsOverride: dest.platformFeeBpsOverride,
    });
    return {
      settlementScope: dest.settlementScope,
      connectedAccountId: dest.connectedAccountId,
      applicationFeeMinor,
    };
  } catch {
    return {
      settlementScope: "platform",
      connectedAccountId: null,
      applicationFeeMinor: null,
    };
  }
}
