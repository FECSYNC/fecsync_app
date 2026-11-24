/**
 * Franchise park Stripe Connect Express lifecycle (Step 3).
 *
 * SEPARATION: Never read/write Organization.stripeCustomerId /
 * stripeSubscriptionId here. Never write OrganizationMarketplaceAccount from
 * park Connect sync unless the connected account id matches that org row.
 */

import type {
  MarketplaceOnboardingStatus,
  VenueLocationMarketplaceAccount,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId, isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertOrganizationActive,
  getStorefrontOrgId,
} from "@/lib/org";
import { assertCompanyBillingEntitled } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";
import { getStripe } from "@/lib/stripe";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  getMarketplaceCurrencyDefault,
  getMarketplaceConnectCountryDefault,
} from "@/lib/marketplace/fees";
import {
  MARKETPLACE_SOFT_HOLD_MESSAGE,
  MARKETPLACE_STOREFRONT_MESSAGE,
} from "@/lib/marketplace/assertChargeReady";
import {
  PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE,
  PARK_PAYOUTS_ARCHIVED_MESSAGE,
  getParkMarketplaceChargeReadyState,
} from "@/lib/marketplace/guestPayoutDestination";
import {
  deriveOnboardingStatus,
  redactRequirementsDue,
  stripeConnectMarketplaceProvider,
} from "@/lib/marketplace/account";
import type Stripe from "stripe";
import {
  resolveEffectiveParkScope,
  type ParkAdminActor,
} from "@/lib/parkAdminScope";
import { isFranchiseParkManager } from "@/lib/franchisePark";
import { resolveIsPlatformSoftwareOwner } from "@/lib/resolvePlatformSoftwareOwner";

export const PARK_CONNECT_FORBIDDEN_MESSAGE =
  "You cannot manage Connect onboarding for this park";
export const PARK_CONNECT_INCOMPLETE_MESSAGE =
  "Complete park Connect onboarding before opening the Express Dashboard";

function parkConnectRefreshUrl(locationId: string): string {
  return `${publicAppBaseUrl()}/admin/payouts?locationId=${encodeURIComponent(locationId)}&connect=refresh`;
}

function parkConnectReturnUrl(locationId: string): string {
  return `${publicAppBaseUrl()}/admin/payouts?locationId=${encodeURIComponent(locationId)}&connect=return`;
}

function extractBankDisplay(account: Stripe.Account): {
  payoutBankLast4: string | null;
  payoutBankName: string | null;
} {
  const ext = account.external_accounts?.data?.[0] as
    | (Stripe.BankAccount | Stripe.Card)
    | undefined;
  if (!ext) return { payoutBankLast4: null, payoutBankName: null };
  if (ext.object === "bank_account") {
    return {
      payoutBankLast4: ext.last4 ?? null,
      payoutBankName: ext.bank_name ?? null,
    };
  }
  if (ext.object === "card") {
    return {
      payoutBankLast4: ext.last4 ?? null,
      payoutBankName: ext.brand ?? "card",
    };
  }
  return { payoutBankLast4: null, payoutBankName: null };
}

async function assertParkMarketplaceTenantOrg(orgId: string) {
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
      name: true,
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
  return org;
}

async function loadFranchiseVenueOrThrow(orgId: string, locationId: string) {
  const oid = requireId(orgId, "orgId");
  const lid = requireId(locationId, "locationId");
  const venue = await prisma.venueLocation.findFirst({
    where: { id: lid, orgId: oid },
    select: {
      id: true,
      orgId: true,
      name: true,
      status: true,
      isFranchise: true,
    },
  });
  if (!venue) throw new ForbiddenError("Venue not found");
  if (!venue.isFranchise) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE);
  }
  if (venue.status !== "active") {
    throw new ForbiddenError(PARK_PAYOUTS_ARCHIVED_MESSAGE);
  }
  return venue;
}

async function assertParkPayoutActorScope(
  actor: ParkAdminActor,
  locationId: string,
  opts: { requireActive: boolean }
): Promise<{ orgId: string; locationId: string }> {
  const orgId = requireId(
    typeof actor.orgId === "string" ? actor.orgId : "",
    "orgId"
  );
  const lid = requireId(locationId, "locationId");
  if (opts.requireActive) {
    await loadFranchiseVenueOrThrow(orgId, lid);
  } else {
    const venue = await prisma.venueLocation.findFirst({
      where: { id: lid, orgId },
      select: { id: true, isFranchise: true },
    });
    if (!venue) throw new ForbiddenError("Venue not found");
    if (!venue.isFranchise) {
      throw new ForbiddenError(PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE);
    }
  }

  if (await resolveIsPlatformSoftwareOwner(actor)) {
    return { orgId, locationId: lid };
  }

  const scope = await resolveEffectiveParkScope(actor);
  if (!scope.parkLocked) {
    // Match GET /park-accounts list: any company-wide seat may view; manage
    // routes still require payouts:manage via requirePermissionFresh.
    return { orgId, locationId: lid };
  }

  if (!isFranchiseParkManager(scope)) {
    throw new ForbiddenError(PARK_CONNECT_FORBIDDEN_MESSAGE);
  }
  if (!scope.assignedLocationIds.includes(lid)) {
    throw new ForbiddenError(PARK_CONNECT_FORBIDDEN_MESSAGE);
  }
  return { orgId, locationId: lid };
}

/**
 * Actor may view park Connect status for locationId (incl. archived parks).
 * Company-wide seats: any franchise park in org. Franchise managers: assigned only.
 */
export async function assertCanAccessParkPayouts(
  actor: ParkAdminActor,
  locationId: string
): Promise<{ orgId: string; locationId: string }> {
  return assertParkPayoutActorScope(actor, locationId, { requireActive: false });
}

/**
 * Actor may manage park Connect for locationId (active franchise parks only):
 * - company-wide / software owner → any franchise park in org
 * - franchiseParkManager → only assigned franchise parks
 */
export async function assertCanManageParkConnect(
  actor: ParkAdminActor,
  locationId: string
): Promise<{ orgId: string; locationId: string }> {
  return assertParkPayoutActorScope(actor, locationId, { requireActive: true });
}

export type ParkMarketplaceAccountDto = {
  orgId: string;
  locationId: string;
  locationName: string;
  isFranchise: boolean;
  provider: string;
  onboardingStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  payoutBankLast4: string | null;
  payoutBankName: string | null;
  defaultCurrency: string;
  disabledReason: string | null;
  hasConnectedAccount: boolean;
  chargeReady: boolean;
  requirementsDue: unknown;
};

export function toParkMarketplaceAccountDto(
  row: VenueLocationMarketplaceAccount | null,
  venue: { id: string; orgId: string; name: string; isFranchise: boolean },
  chargeReady: boolean
): ParkMarketplaceAccountDto {
  if (!row) {
    return {
      orgId: venue.orgId,
      locationId: venue.id,
      locationName: venue.name,
      isFranchise: venue.isFranchise,
      provider: "stripe_connect",
      onboardingStatus: "not_started",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      payoutBankLast4: null,
      payoutBankName: null,
      defaultCurrency: getMarketplaceCurrencyDefault(),
      disabledReason: null,
      hasConnectedAccount: false,
      chargeReady: false,
      requirementsDue: null,
    };
  }
  return {
    orgId: row.orgId,
    locationId: row.locationId,
    locationName: venue.name,
    isFranchise: venue.isFranchise,
    provider: row.provider,
    onboardingStatus: row.onboardingStatus,
    chargesEnabled: row.chargesEnabled,
    payoutsEnabled: row.payoutsEnabled,
    detailsSubmitted: row.detailsSubmitted,
    payoutBankLast4: row.payoutBankLast4,
    payoutBankName: row.payoutBankName,
    defaultCurrency: row.defaultCurrency,
    disabledReason: row.disabledReason,
    hasConnectedAccount: Boolean(row.stripeConnectedAccountId?.trim()),
    chargeReady,
    requirementsDue: row.requirementsDue,
  };
}

export async function getParkMarketplaceAccount(
  locationId: string
): Promise<VenueLocationMarketplaceAccount | null> {
  if (!isValidId(locationId)) return null;
  return prisma.venueLocationMarketplaceAccount.findUnique({
    where: { locationId },
  });
}

export async function syncParkMarketplaceAccountFromStripe(
  locationId: string,
  stripeAccount: Stripe.Account
): Promise<VenueLocationMarketplaceAccount> {
  const lid = requireId(locationId, "locationId");
  const venue = await prisma.venueLocation.findUnique({
    where: { id: lid },
    select: { id: true, orgId: true, isFranchise: true, status: true },
  });
  if (!venue) throw new ForbiddenError("Venue not found");
  if (!venue.isFranchise) {
    throw new ForbiddenError(PARK_PAYOUTS_NOT_FRANCHISE_MESSAGE);
  }

  const bank = extractBankDisplay(stripeAccount);
  const onboardingStatus = deriveOnboardingStatus(stripeAccount);
  const requirementsDue = redactRequirementsDue(stripeAccount);
  const disabledReason =
    stripeAccount.requirements?.disabled_reason?.trim() ||
    (venue.status !== "active" ? "Park archived" : null);

  // Soft-archived parks stay fail-closed even if Stripe says complete.
  const archived = venue.status !== "active";
  const effectiveStatus: MarketplaceOnboardingStatus = archived
    ? "disabled"
    : onboardingStatus;
  const chargesEnabled = archived
    ? false
    : Boolean(stripeAccount.charges_enabled);
  const payoutsEnabled = archived
    ? false
    : Boolean(stripeAccount.payouts_enabled);

  return prisma.venueLocationMarketplaceAccount.upsert({
    where: { locationId: lid },
    create: {
      orgId: venue.orgId,
      locationId: lid,
      provider: "stripe_connect",
      stripeConnectedAccountId: stripeAccount.id,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted: Boolean(stripeAccount.details_submitted),
      requirementsDue,
      payoutBankLast4: bank.payoutBankLast4,
      payoutBankName: bank.payoutBankName,
      defaultCurrency:
        stripeAccount.default_currency?.toLowerCase() ||
        getMarketplaceCurrencyDefault(),
      onboardingStatus: effectiveStatus,
      disabledReason,
    },
    update: {
      stripeConnectedAccountId: stripeAccount.id,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted: Boolean(stripeAccount.details_submitted),
      requirementsDue,
      payoutBankLast4: bank.payoutBankLast4,
      payoutBankName: bank.payoutBankName,
      defaultCurrency:
        stripeAccount.default_currency?.toLowerCase() ||
        getMarketplaceCurrencyDefault(),
      onboardingStatus: effectiveStatus,
      disabledReason,
    },
  });
}

/** Resolve park locationId from Connect account id (webhook account.updated). */
export async function findParkLocationByConnectedAccountId(
  connectedAccountId: string
): Promise<{ orgId: string; locationId: string } | null> {
  const acct = connectedAccountId?.trim();
  if (!acct) return null;
  const row = await prisma.venueLocationMarketplaceAccount.findUnique({
    where: { stripeConnectedAccountId: acct },
    select: { orgId: true, locationId: true },
  });
  return row ? { orgId: row.orgId, locationId: row.locationId } : null;
}

export async function startParkMarketplaceConnectOnboarding(opts: {
  orgId: string;
  locationId: string;
}): Promise<{ url: string; accountId: string }> {
  const org = await assertParkMarketplaceTenantOrg(opts.orgId);
  const venue = await loadFranchiseVenueOrThrow(org.id, opts.locationId);
  const profile = await prisma.companyProfile.findUnique({
    where: { orgId: org.id },
    select: {
      supportEmail: true,
      billingEmail: true,
      legalName: true,
      tradingName: true,
      country: true,
    },
  });

  let row = await getParkMarketplaceAccount(venue.id);
  let accountId = row?.stripeConnectedAccountId?.trim() || "";

  if (!accountId) {
    const stripe = getStripe();
    const account = await stripe.accounts.create(
      {
        type: "express",
        country: getMarketplaceConnectCountryDefault(profile?.country)
          .toUpperCase()
          .slice(0, 2),
        email: profile?.billingEmail || profile?.supportEmail || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name:
            venue.name ||
            profile?.legalName ||
            profile?.tradingName ||
            org.name ||
            undefined,
        },
        metadata: {
          orgId: org.id,
          locationId: venue.id,
          type: "park_marketplace_connect",
        },
      },
      { idempotencyKey: `park-marketplace-express:${venue.id}` }
    );
    accountId = account.id;
    row = await prisma.venueLocationMarketplaceAccount.upsert({
      where: { locationId: venue.id },
      create: {
        orgId: org.id,
        locationId: venue.id,
        provider: "stripe_connect",
        stripeConnectedAccountId: accountId,
        onboardingStatus: "pending",
        defaultCurrency: getMarketplaceCurrencyDefault(),
      },
      update: {
        stripeConnectedAccountId: accountId,
        onboardingStatus:
          row?.onboardingStatus === "complete" ? "complete" : "pending",
      },
    });
  }

  const link = await stripeConnectMarketplaceProvider.createAccountLink({
    accountId,
    refreshUrl: parkConnectRefreshUrl(venue.id),
    returnUrl: parkConnectReturnUrl(venue.id),
  });
  return { url: link.url, accountId };
}

export async function refreshParkMarketplaceConnectLink(opts: {
  orgId: string;
  locationId: string;
}): Promise<{ url: string }> {
  await assertParkMarketplaceTenantOrg(opts.orgId);
  const venue = await loadFranchiseVenueOrThrow(opts.orgId, opts.locationId);
  const row = await getParkMarketplaceAccount(venue.id);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId) {
    return startParkMarketplaceConnectOnboarding(opts);
  }
  const link = await stripeConnectMarketplaceProvider.createAccountLink({
    accountId,
    refreshUrl: parkConnectRefreshUrl(venue.id),
    returnUrl: parkConnectReturnUrl(venue.id),
  });
  return { url: link.url };
}

export async function createParkMarketplaceExpressLoginLink(opts: {
  orgId: string;
  locationId: string;
}): Promise<{ url: string }> {
  await assertParkMarketplaceTenantOrg(opts.orgId);
  const venue = await loadFranchiseVenueOrThrow(opts.orgId, opts.locationId);
  const row = await getParkMarketplaceAccount(venue.id);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId || row?.onboardingStatus !== "complete") {
    throw new ForbiddenError(PARK_CONNECT_INCOMPLETE_MESSAGE);
  }
  return stripeConnectMarketplaceProvider.createLoginLink(accountId);
}

export async function syncParkMarketplaceAccountFromProvider(
  orgId: string,
  locationId: string
): Promise<VenueLocationMarketplaceAccount> {
  await assertParkMarketplaceTenantOrg(orgId);
  const venue = await loadFranchiseVenueOrThrow(orgId, locationId);
  const row = await getParkMarketplaceAccount(venue.id);
  const accountId = row?.stripeConnectedAccountId?.trim();
  if (!accountId) {
    throw new ForbiddenError(
      "No park Connect account to sync — start onboarding first"
    );
  }
  const stripeAccount =
    await stripeConnectMarketplaceProvider.retrieveAccount(accountId);
  return syncParkMarketplaceAccountFromStripe(venue.id, stripeAccount);
}

/** Soft-archive: disable park Connect for new charges without deleting history. */
export async function disableParkMarketplaceAccountOnArchive(
  locationId: string
): Promise<void> {
  if (!isValidId(locationId)) return;
  await prisma.venueLocationMarketplaceAccount.updateMany({
    where: { locationId },
    data: {
      onboardingStatus: "disabled",
      disabledReason: "Park archived — new park charges blocked",
      chargesEnabled: false,
      payoutsEnabled: false,
    },
  });
}

/**
 * After venue reactivate: re-pull Stripe flags so a previously charge-ready
 * franchise park is not stuck disabled until a manual Sync click.
 * Fail-soft when Stripe is unavailable — clear archive disable markers only.
 */
export async function restoreParkMarketplaceAccountAfterReactivate(
  locationId: string
): Promise<void> {
  if (!isValidId(locationId)) return;
  const row = await prisma.venueLocationMarketplaceAccount.findUnique({
    where: { locationId },
    select: {
      stripeConnectedAccountId: true,
      disabledReason: true,
      onboardingStatus: true,
    },
  });
  if (!row) return;
  const accountId = row.stripeConnectedAccountId?.trim() || "";
  if (!accountId) {
    if (
      row.onboardingStatus === "disabled" ||
      row.disabledReason?.includes("Park archived")
    ) {
      await prisma.venueLocationMarketplaceAccount.updateMany({
        where: { locationId },
        data: {
          onboardingStatus: "not_started",
          disabledReason: null,
          chargesEnabled: false,
          payoutsEnabled: false,
        },
      });
    }
    return;
  }
  try {
    const stripeAccount =
      await stripeConnectMarketplaceProvider.retrieveAccount(accountId);
    await syncParkMarketplaceAccountFromStripe(locationId, stripeAccount);
  } catch (err) {
    console.warn(
      "[restoreParkMarketplaceAccountAfterReactivate] Stripe sync deferred:",
      err instanceof Error ? err.message : err
    );
    await prisma.venueLocationMarketplaceAccount.updateMany({
      where: { locationId },
      data: {
        onboardingStatus:
          row.onboardingStatus === "disabled" ? "pending" : row.onboardingStatus,
        disabledReason: null,
      },
    });
  }
}

export async function listParkMarketplaceAccountsForOrg(
  orgId: string,
  /**
   * `null` / `undefined` = company-wide (all franchise parks).
   * `[]` = fail-closed empty set (park-locked with no assignments).
   * non-empty = restrict to those location ids.
   */
  locationIdsFilter?: string[] | null
): Promise<ParkMarketplaceAccountDto[]> {
  const oid = requireId(orgId, "orgId");
  // Empty array must not widen to all parks (sister-park leak).
  if (Array.isArray(locationIdsFilter) && locationIdsFilter.length === 0) {
    return [];
  }
  const venues = await prisma.venueLocation.findMany({
    where: {
      orgId: oid,
      isFranchise: true,
      ...(locationIdsFilter && locationIdsFilter.length > 0
        ? { id: { in: locationIdsFilter } }
        : {}),
    },
    select: {
      id: true,
      orgId: true,
      name: true,
      isFranchise: true,
      status: true,
    },
    orderBy: { name: "asc" },
  });
  const accounts = await prisma.venueLocationMarketplaceAccount.findMany({
    where: { orgId: oid, locationId: { in: venues.map((v) => v.id) } },
  });
  const byLoc = new Map(accounts.map((a) => [a.locationId, a]));
  const out: ParkMarketplaceAccountDto[] = [];
  for (const v of venues) {
    const ready = await getParkMarketplaceChargeReadyState(oid, v.id);
    out.push(
      toParkMarketplaceAccountDto(byLoc.get(v.id) ?? null, v, ready.chargeReady)
    );
  }
  return out;
}
