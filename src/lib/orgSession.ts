/**
 * Thin Organization snapshot for auth responses (login / register-company).
 * Keep in sync with /api/auth/me organization + orgStatus + billingSoftHold
 * fields used by the FE (AdminLayout / company-pending lifecycle UI).
 */
import prisma from "@/lib/prisma";
import { asIdString } from "@/lib/ids";
import { applyLazySubscriptionExpiryIfNeeded } from "@/lib/org";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";

export type OrganizationAuthSnapshot = {
  organization: {
    id: string;
    name: string;
    status: string;
    billingSoftHold: boolean;
    billingGraceEndsAt: string | null;
    subscriptionPlan: string | null;
    /** Landing / Checkout interest — never entitles alone. */
    requestedPlan: string | null;
    requestedDurationMonths: number | null;
    subscriptionInterval: string | null;
    subscriptionStatus: string | null;
    subscriptionEndsAt: Date | null;
    /** Entitled Enterprise HQ soft-gate for company admin UI (Step 2+). */
    enterpriseHqEnabled: boolean;
    profileCompleteness: number;
    hasLogo: boolean;
    /** Company logo for the white-label dashboard; null for the platform storefront org. */
    logoUrl: string | null;
    slug: string;
    legalName: string | null;
    tradingName: string | null;
    companyDisplayName: string;
  } | null;
  orgStatus: string | null;
  billingSoftHold: boolean;
  billingGraceEndsAt: string | null;
  enterpriseHqEnabled: boolean;
};

export async function organizationAuthSnapshot(
  orgId: string | null | undefined,
  actor?: {
    preset?: string | null;
    membershipRole?: string | null;
    orgId?: string | null;
    storefrontOrgId?: string | null;
  } | null
): Promise<OrganizationAuthSnapshot> {
  const id = asIdString(orgId);
  if (!id) {
    return {
      organization: null,
      orgStatus: null,
      billingSoftHold: false,
      billingGraceEndsAt: null,
      enterpriseHqEnabled: false,
    };
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      isDefault: true,
      subscriptionPlan: true,
      requestedPlan: true,
      requestedDurationMonths: true,
      subscriptionInterval: true,
      subscriptionStatus: true,
      subscriptionEndsAt: true,
    },
  });
  if (!org) {
    return {
      organization: null,
      orgStatus: null,
      billingSoftHold: false,
      billingGraceEndsAt: null,
      enterpriseHqEnabled: false,
    };
  }

  // Align login/register session with Fresh lazy-expire so AdminLayout /
  // company-pending see suspended without waiting for a PermissionFresh hit.
  const after = await applyLazySubscriptionExpiryIfNeeded(
    {
      id: org.id,
      status: org.status,
      isDefault: org.isDefault,
      subscriptionEndsAt: org.subscriptionEndsAt,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionPlan: org.subscriptionPlan,
    },
    "session:subscriptionEndsAt passed"
  );

  // Soft-hold only for registered companies with DB still `active`.
  // Use pre-lazy org.status — hard-suspended must never soft-hold.
  // Storefront / isDefault never soft-holds.
  const billingSoftHold =
    org.isDefault || after.didExpire
      ? false
      : isSoftBillingHoldRow({
          status: org.status,
          subscriptionStatus: after.subscriptionStatus,
          subscriptionEndsAt: after.subscriptionEndsAt,
          subscriptionPlan:
            after.subscriptionPlan ?? org.subscriptionPlan,
        });

  const { billingGraceEndsAt } = await import("@/lib/billingGrace");
  const billingGraceEndsAtIso =
    billingSoftHold && after.subscriptionEndsAt
      ? billingGraceEndsAt(after.subscriptionEndsAt).toISOString()
      : null;

  const {
    computeProfileCompleteness,
    computeCompanyDisplayName,
  } = await import("@/lib/companyProfile");
  const profile = await prisma.companyProfile.findUnique({
    where: { orgId: org.id },
    select: {
      legalName: true,
      tradingName: true,
      logoUrl: true,
      supportEmail: true,
      addressLine1: true,
      city: true,
      country: true,
      bankAccountLast4: true,
      bankAccountCiphertext: true,
      bankRoutingOrIban: true,
    },
  });
  const completeness = computeProfileCompleteness({
    legalName: profile?.legalName ?? null,
    tradingName: profile?.tradingName ?? null,
    logoUrl: profile?.logoUrl ?? null,
    supportEmail: profile?.supportEmail ?? null,
    addressLine1: profile?.addressLine1 ?? null,
    city: profile?.city ?? null,
    country: profile?.country ?? null,
    hasBankAccount: Boolean(
      profile?.bankAccountLast4 || profile?.bankAccountCiphertext
    ),
    hasBankRoutingOrIban: Boolean(profile?.bankRoutingOrIban?.trim()),
  });
  const plan =
    after.subscriptionPlan !== undefined
      ? after.subscriptionPlan
      : org.subscriptionPlan;

  const { orgHasEnterpriseHq } = await import("@/lib/enterpriseHq");
  const { resolveIsPlatformSoftwareOwner } = await import(
    "@/lib/resolvePlatformSoftwareOwner"
  );
  const { getStorefrontOrgId } = await import("@/lib/org");
  const storefrontOrgId =
    typeof actor?.storefrontOrgId === "string" && actor.storefrontOrgId.trim()
      ? actor.storefrontOrgId.trim()
      : await getStorefrontOrgId();
  const ownerHost = await resolveIsPlatformSoftwareOwner({
    preset: actor?.preset,
    membershipRole: actor?.membershipRole,
    orgId: org.id,
    storefrontOrgId,
  });
  const enterpriseHqEnabled =
    ownerHost ||
    (!billingSoftHold &&
      orgHasEnterpriseHq({
        isDefault: org.isDefault,
        status: after.status,
        subscriptionPlan: plan,
        subscriptionStatus: after.subscriptionStatus,
        subscriptionEndsAt: after.subscriptionEndsAt,
      }));

  return {
    organization: {
      id: org.id,
      name: org.name,
      status: after.status,
      billingSoftHold,
      billingGraceEndsAt: billingGraceEndsAtIso,
      subscriptionPlan: plan,
      requestedPlan: org.requestedPlan ?? null,
      requestedDurationMonths: org.requestedDurationMonths ?? null,
      subscriptionInterval: org.subscriptionInterval ?? null,
      subscriptionStatus: after.subscriptionStatus,
      subscriptionEndsAt: after.subscriptionEndsAt,
      enterpriseHqEnabled,
      profileCompleteness: completeness,
      hasLogo: Boolean(profile?.logoUrl),
      logoUrl: org.isDefault ? null : profile?.logoUrl?.trim() || null,
      slug: org.slug,
      legalName: profile?.legalName ?? null,
      tradingName: profile?.tradingName ?? null,
      companyDisplayName: computeCompanyDisplayName({
        legalName: profile?.legalName,
        tradingName: profile?.tradingName,
        organizationName: org.name,
      }),
    },
    orgStatus: after.status,
    billingSoftHold,
    billingGraceEndsAt: billingGraceEndsAtIso,
    enterpriseHqEnabled,
  };
}

/** Flat fields for auth JSON payloads (toUserProfile-compatible). */
export function organizationAuthFlatFields(snap: OrganizationAuthSnapshot) {
  return {
    organization: snap.organization,
    orgStatus: snap.orgStatus,
    billingSoftHold: snap.billingSoftHold === true,
    billingGraceEndsAt: snap.billingGraceEndsAt ?? null,
    enterpriseHqEnabled: snap.enterpriseHqEnabled === true,
    organizationName: snap.organization?.name ?? null,
    companyDisplayName: snap.organization?.companyDisplayName ?? null,
    legalName: snap.organization?.legalName ?? null,
    tradingName: snap.organization?.tradingName ?? null,
    profileCompleteness: snap.organization?.profileCompleteness ?? null,
    hasLogo: snap.organization?.hasLogo ?? null,
    companyLogoUrl: snap.organization?.logoUrl ?? null,
    organizationSlug: snap.organization?.slug ?? null,
    subscriptionPlan: snap.organization?.subscriptionPlan ?? null,
    requestedPlan: snap.organization?.requestedPlan ?? null,
    requestedDurationMonths: snap.organization?.requestedDurationMonths ?? null,
    subscriptionInterval: snap.organization?.subscriptionInterval ?? null,
    subscriptionStatus: snap.organization?.subscriptionStatus ?? null,
    subscriptionEndsAt: snap.organization?.subscriptionEndsAt ?? null,
  };
}
