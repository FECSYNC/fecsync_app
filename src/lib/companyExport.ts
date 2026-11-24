/**
 * Step 4 — workspace export + offboard request (no hard-delete of orders/users).
 */

import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import { getStorefrontOrgId } from "@/lib/org";
import { getCompanyBillingState } from "@/lib/companyBilling";
import { getPlanUsageSnapshot } from "@/lib/planLimits";
import { toVenueLocationDto } from "@/lib/venueLocations";
import { serializeMembership } from "@/lib/memberAdmin";
import { buildPartiesExport } from "@/lib/parties/export";
import { buildAccountingExport } from "@/lib/accounting/companyExportSection";

export const COMPANY_EXPORT_STOREFRONT_MESSAGE =
  "Workspace export is only available for registered company workspaces.";
export const COMPANY_OFFBOARD_STOREFRONT_MESSAGE =
  "Offboard requests are only available for registered company workspaces.";
export const COMPANY_OFFBOARD_NOT_FOUND_MESSAGE =
  "Organization not found";

async function assertExportableCompanyOrg(orgId: string): Promise<void> {
  const id = requireId(orgId, "orgId");
  const storefrontId = await getStorefrontOrgId();
  if (id === storefrontId) {
    throw new ForbiddenError(COMPANY_EXPORT_STOREFRONT_MESSAGE);
  }
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, isDefault: true },
  });
  if (!org || org.isDefault) {
    throw new ForbiddenError(COMPANY_EXPORT_STOREFRONT_MESSAGE);
  }
}

/** Redacted company profile — never bank ciphertext / full account numbers. */
function redactCompanyProfile(
  profile: {
    legalName: string | null;
    tradingName: string | null;
    logoUrl: string | null;
    signinBackgroundUrl?: string | null;
    supportEmail: string | null;
    billingEmail: string | null;
    replyToEmail: string | null;
    phone: string | null;
    website: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    taxId: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountLast4: string | null;
    bankRoutingOrIban: string | null;
    bankCurrency: string | null;
    invoiceFooterNote: string | null;
    receiptFooterNote: string | null;
    letterheadColor: string | null;
    publicLogo?: boolean;
    publicPhone?: boolean;
    publicSupportEmail?: boolean;
    publicWebsite?: boolean;
    publicAddress?: boolean;
  } | null,
  embedOrigins: string[] = []
) {
  if (!profile) {
    return embedOrigins.length > 0 ? { embedOrigins } : null;
  }
  return {
    legalName: profile.legalName,
    tradingName: profile.tradingName,
    logoUrl: profile.logoUrl,
    signinBackgroundUrl: profile.signinBackgroundUrl ?? null,
    supportEmail: profile.supportEmail,
    billingEmail: profile.billingEmail,
    replyToEmail: profile.replyToEmail,
    phone: profile.phone,
    website: profile.website,
    address: {
      line1: profile.addressLine1,
      line2: profile.addressLine2,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      postalCode: profile.postalCode,
    },
    taxId: profile.taxId,
    bank: {
      bankName: profile.bankName,
      accountName: profile.bankAccountName,
      accountLast4: profile.bankAccountLast4,
      // Never export ciphertext or full routing/IBAN secrets.
      routingOrIbanRedacted: profile.bankRoutingOrIban
        ? "[redacted]"
        : null,
      currency: profile.bankCurrency,
    },
    invoiceFooterNote: profile.invoiceFooterNote,
    receiptFooterNote: profile.receiptFooterNote,
    letterheadColor: profile.letterheadColor,
    publicLogo: profile.publicLogo ?? true,
    publicPhone: profile.publicPhone ?? false,
    publicSupportEmail: profile.publicSupportEmail ?? false,
    publicWebsite: profile.publicWebsite ?? false,
    publicAddress: profile.publicAddress ?? false,
    embedOrigins,
  };
}

export async function buildCompanyWorkspaceExport(orgId: string): Promise<{
  exportedAt: string;
  organization: Record<string, unknown>;
  companyProfile: ReturnType<typeof redactCompanyProfile>;
  members: unknown[];
  venues: unknown[];
  usage: unknown;
  billing: unknown;
  resourceCounts: Record<string, number | Record<string, number>>;
  /** Guest park Memberships (Feature 08) — redacted rows (no Stripe / photo / QR). */
  membershipGuestProfiles: unknown[];
  membershipCategoriesExport: unknown[];
  membershipPlansExport: unknown[];
  guestMembershipsExport: unknown[];
  membershipVenueEligibilityExport: unknown[];
  membershipSettingsExport: unknown[];
  membershipFamilyLinksExport: unknown[];
  membershipUsageEventsExport: unknown[];
  membershipPaymentAttemptsExport: unknown[];
  membershipAgreementsExport: unknown[];
  membershipCancelAlternativesExport: unknown[];
  marketplaceAccount: Record<string, unknown> | null;
  parkMarketplaceAccounts: unknown[];
  bookingPackages: unknown[];
  marketplaceBookings: unknown[];
  /** Party Management — same-org packages, party summaries, rooms, menu, counts (no contacts / Stripe ids). */
  parties: Awaited<ReturnType<typeof buildPartiesExport>>;
  /** Accounting — settings/chart/journals/payables/banking/inventory; no bank ciphertext. */
  accounting: Awaited<ReturnType<typeof buildAccountingExport>>;
}> {
  const id = requireId(orgId, "orgId");
  await assertExportableCompanyOrg(id);

  const org = await prisma.organization.findUniqueOrThrow({
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
      subscriptionStatus: true,
      subscriptionEndsAt: true,
      subscriptionInterval: true,
      subscriptionCancelAtPeriodEnd: true,
      approvedAt: true,
      offboardRequestedAt: true,
      offboardedAt: true,
      createdAt: true,
      updatedAt: true,
      // Explicitly omit Stripe secret ids from default export payload shape —
      // expose only boolean presence.
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });

  const [profile, embedOriginRows] = await Promise.all([
    prisma.companyProfile.findUnique({
      where: { orgId: id },
    }),
    prisma.companyEmbedOrigin.findMany({
      where: { orgId: id },
      select: { origin: true },
      orderBy: { origin: "asc" },
    }),
  ]);

  const memberships = await prisma.membership.findMany({
    where: { orgId: id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          lastLoginAt: true,
          lastLogoutAt: true,
          // never password
        },
      },
      venueAssignments: {
        select: { locationId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Direct org-scoped query — works for soft-held active orgs when called from
  // requirePermissionFreshWorkspaceLifecycle (not full assertOrganizationActive).
  const venueRows = await prisma.venueLocation.findMany({
    where: { orgId: id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const venues = venueRows.map((row) => toVenueLocationDto(row, org.slug));
  const usage = await getPlanUsageSnapshot(id);
  const billing = await getCompanyBillingState(id);

  const [
    products,
    fabrics,
    categories,
    orders,
    roleTemplates,
    tailorProfiles,
    campaigns,
    fashionChats,
    admissionProducts,
    admissionCategorized,
    bookings,
    bookingInvoices,
    marketplaceAccount,
    parkMarketplaceAccounts,
    marketplaceBookings,
    bookingPackages,
  ] = await Promise.all([
    prisma.product.count({ where: { orgId: id } }),
    prisma.fabric.count({ where: { orgId: id } }),
    prisma.productCategory.count({ where: { orgId: id } }),
    prisma.order.count({ where: { orgId: id } }),
    prisma.roleTemplate.count({ where: { orgId: id } }),
    prisma.tailorProfile.count({ where: { orgId: id } }),
    prisma.measurementCampaign.count({ where: { orgId: id } }),
    prisma.fashionChat.count({ where: { orgId: id } }),
    prisma.admissionProduct.groupBy({
      by: ["type"],
      where: { orgId: id },
      _count: { _all: true },
    }),
    prisma.admissionProduct.count({
      where: { orgId: id, categoryId: { not: null }, archivedAt: null },
    }),
    prisma.booking.groupBy({
      by: ["status"],
      where: { orgId: id },
      _count: { _all: true },
    }),
    prisma.bookingInvoice.groupBy({
      by: ["status"],
      where: { orgId: id },
      _count: { _all: true },
    }),
    prisma.organizationMarketplaceAccount.findUnique({
      where: { orgId: id },
      select: {
        provider: true,
        onboardingStatus: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        payoutBankLast4: true,
        payoutBankName: true,
        defaultCurrency: true,
        disabledReason: true,
        stripeConnectedAccountId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.venueLocationMarketplaceAccount.findMany({
      where: { orgId: id },
      select: {
        locationId: true,
        provider: true,
        onboardingStatus: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        payoutBankLast4: true,
        payoutBankName: true,
        defaultCurrency: true,
        disabledReason: true,
        stripeConnectedAccountId: true,
        createdAt: true,
        updatedAt: true,
        location: { select: { name: true, isFranchise: true, status: true } },
      },
    }),
    prisma.marketplaceBooking.findMany({
      where: { orgId: id },
      select: {
        id: true,
        packageId: true,
        customerEmail: true,
        customerName: true,
        amountMinor: true,
        currency: true,
        platformFeeMinor: true,
        status: true,
        paidAt: true,
        createdAt: true,
        // omit Stripe ids / connectedAccountId from export for safety
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.bookingPackage.findMany({
      where: { orgId: id },
      select: {
        id: true,
        slug: true,
        title: true,
        amountMinor: true,
        currency: true,
        capacity: true,
        active: true,
        published: true,
        locationId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const [
    guestProfiles,
    membershipCategories,
    membershipPlans,
    guestMemberships,
    membershipEligibility,
    membershipSettingsRows,
    membershipFamilyLinks,
    membershipUsageEvents,
    membershipPaymentAttempts,
    membershipAgreements,
    membershipCancelAlternatives,
    guestProfileCount,
    membershipCategoryCount,
    membershipPlanCount,
    guestMembershipCount,
    membershipEligibilityCount,
    membershipSettingsCount,
    membershipFamilyLinkCount,
    membershipUsageEventCount,
    membershipPaymentAttemptCount,
    membershipAgreementCount,
    membershipCancelAlternativeCount,
  ] = await Promise.all([
    prisma.guestProfile.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        postalCode: true,
        bannedAt: true,
        createdAt: true,
        updatedAt: true,
        // omit stripeCustomerId / photoUrl / notes / userId
      },
      orderBy: { createdAt: "asc" },
      take: 2000,
    }),
    prisma.membershipCategory.findMany({
      where: { orgId: id },
      select: {
        id: true,
        name: true,
        description: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        publicPage: { select: { slug: true, active: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.membershipPlan.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        categoryId: true,
        name: true,
        description: true,
        detailedDescription: true,
        membershipType: true,
        billing: true,
        intervalCount: true,
        intervalUnit: true,
        price: true,
        currency: true,
        familyAllowed: true,
        upgradeGroupKey: true,
        agreementRequired: true,
        pauseAllowed: true,
        imageUrl: true,
        tags: true,
        daysValidFromPurchase: true,
        daysValidFromRedemption: true,
        redemptionStartsAt: true,
        redemptionEndsAt: true,
        customRedemptionDescription: true,
        salesStartsAt: true,
        salesEndsAt: true,
        hideFromOnlineSales: true,
        addOnsEnabled: true,
        formsEnabled: true,
        alternateAddress: true,
        cancellationTerms: true,
        instructions: true,
        reportingCategory: true,
        overrideTax: true,
        termsAndConditions: true,
        variations: true,
        archivedAt: true,
        entitlements: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.guestMembership.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        homeLocationId: true,
        guestProfileId: true,
        planId: true,
        status: true,
        customMembershipId: true,
        source: true,
        startsAt: true,
        endsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        cancelReason: true,
        agreementSignedAt: true,
        pauseStartsAt: true,
        pauseEndsAt: true,
        creditBalanceMinor: true,
        dunningFailCount: true,
        dunningNextAt: true,
        visitStatus: true,
        createdAt: true,
        updatedAt: true,
        // omit stripeSubscriptionId / qr / barcode / photo
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.membershipVenueEligibility.findMany({
      where: { orgId: id },
      select: {
        id: true,
        planId: true,
        locationId: true,
        eligible: true,
        localPerksAdd: true,
        localPerksRemove: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ planId: "asc" }, { locationId: "asc" }],
      take: 2000,
    }),
    prisma.membershipSettings.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        requirePhotoOnRedeem: true,
        requireAgreementBeforeActive: true,
        dunningEnabled: true,
        clickToCancelEnabled: true,
        cancelAlternativesEnabled: true,
        graceDays: true,
        allowPause: true,
        walletPassEnabled: true,
        defaultHomeLocationId: true,
        other: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.membershipFamilyLink.findMany({
      where: { orgId: id },
      select: {
        id: true,
        guestMembershipId: true,
        guestProfileId: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
    prisma.membershipUsageEvent.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        guestMembershipId: true,
        guestProfileId: true,
        kind: true,
        qty: true,
        remainingAfter: true,
        source: true,
        createdAt: true,
        // omit meta (may hold scan payloads) + actorUserId
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.membershipPaymentAttempt.findMany({
      where: { orgId: id },
      select: {
        id: true,
        guestMembershipId: true,
        amount: true,
        currency: true,
        status: true,
        attemptNumber: true,
        errorCode: true,
        createdAt: true,
        // omit stripeInvoiceId / stripePaymentIntentId / errorMessage / idempotencyKey
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.membershipAgreement.findMany({
      where: { orgId: id },
      select: {
        id: true,
        guestMembershipId: true,
        guestProfileId: true,
        planId: true,
        status: true,
        signedAt: true,
        bodyVersion: true,
        createdAt: true,
        updatedAt: true,
        // omit storageRef / waiverRecordId
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.membershipCancelAlternative.findMany({
      where: { orgId: id },
      select: {
        id: true,
        locationId: true,
        name: true,
        kind: true,
        active: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        // omit config JSON (may hold offer amounts)
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    prisma.guestProfile.count({ where: { orgId: id } }),
    prisma.membershipCategory.count({ where: { orgId: id } }),
    prisma.membershipPlan.count({ where: { orgId: id } }),
    prisma.guestMembership.count({ where: { orgId: id } }),
    prisma.membershipVenueEligibility.count({ where: { orgId: id } }),
    prisma.membershipSettings.count({ where: { orgId: id } }),
    prisma.membershipFamilyLink.count({ where: { orgId: id } }),
    prisma.membershipUsageEvent.count({ where: { orgId: id } }),
    prisma.membershipPaymentAttempt.count({ where: { orgId: id } }),
    prisma.membershipAgreement.count({ where: { orgId: id } }),
    prisma.membershipCancelAlternative.count({ where: { orgId: id } }),
  ]);

  const [
    waiverTemplateCount,
    waiverRecordCount,
    formResponseCount,
    waiverKioskDeviceCount,
    waiverWalkinPassCount,
    marketingSettingsCount,
    guestSurveyCount,
    marketingSendLogCount,
    marketingLeadsOptedInCount,
    marketingCampaignCount,
    marketingCampaignRecipientCount,
  ] = await Promise.all([
    prisma.waiverTemplate.count({ where: { orgId: id } }),
    prisma.waiverRecord.count({ where: { orgId: id } }),
    prisma.formResponse.count({ where: { orgId: id } }),
    prisma.waiverKioskDevice.count({ where: { orgId: id } }),
    prisma.waiverWalkinPass.count({ where: { orgId: id } }),
    prisma.marketingAutomationSettings.count({ where: { orgId: id } }),
    prisma.guestSurvey.count({ where: { orgId: id } }),
    prisma.marketingSendLog.count({ where: { orgId: id } }),
    prisma.guestProfile.count({
      where: { orgId: id, marketingEmailOptIn: true, bannedAt: null },
    }),
    prisma.marketingCampaign.count({ where: { orgId: id } }),
    prisma.marketingCampaignRecipient.count({ where: { orgId: id } }),
  ]);

  const [posDeviceCount, posProductCount, posSaleCount, tillSessionCount, giftCards] =
    await Promise.all([
      prisma.posDevice.count({ where: { orgId: id, archivedAt: null } }),
      prisma.posProduct.count({ where: { orgId: id, archivedAt: null } }),
      prisma.posSale.count({ where: { orgId: id } }),
      prisma.tillSession.count({ where: { orgId: id } }),
      prisma.giftCard.findMany({
        where: { orgId: id },
        select: { last4: true, remainingBalance: true, status: true },
        take: 500,
      }),
    ]);
  const giftCardLiability = giftCards.reduce(
    (sum, card) => sum + Number(card.remainingBalance),
    0
  );

  const venuesActive = venueRows.filter((v) => v.status === "active").length;
  const membersSeatMeter = memberships.filter(
    (m) => m.status === "active" || m.status === "invited"
  ).length;

  const admissionProductsByType: Record<string, number> = {};
  for (const row of admissionProducts) {
    admissionProductsByType[row.type] = row._count._all;
  }
  const bookingsByStatus: Record<string, number> = {};
  for (const row of bookings) {
    bookingsByStatus[row.status] = row._count._all;
  }
  const bookingInvoicesByStatus: Record<string, number> = {};
  for (const row of bookingInvoices) {
    bookingInvoicesByStatus[row.status] = row._count._all;
  }
  const parties = await buildPartiesExport(id);
  const accounting = await buildAccountingExport(id);

  return {
    exportedAt: new Date().toISOString(),
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      subscriptionPlan: org.subscriptionPlan,
      requestedPlan: org.requestedPlan,
      requestedDurationMonths: org.requestedDurationMonths,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt?.toISOString() ?? null,
      subscriptionInterval: org.subscriptionInterval,
      subscriptionCancelAtPeriodEnd: org.subscriptionCancelAtPeriodEnd,
      approvedAt: org.approvedAt?.toISOString() ?? null,
      offboardRequestedAt: org.offboardRequestedAt?.toISOString() ?? null,
      offboardedAt: org.offboardedAt?.toISOString() ?? null,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
      hasStripeCustomer: Boolean(org.stripeCustomerId?.trim()),
      hasStripeSubscription: Boolean(org.stripeSubscriptionId?.trim()),
      // Never export raw Stripe ids.
    },
    companyProfile: redactCompanyProfile(
      profile,
      embedOriginRows.map((row) => row.origin)
    ),
    members: memberships.map((m) =>
      serializeMembership(m, m.user, null, {
        includeHqLocationPreference: true,
        assignedLocationIds: (m.venueAssignments ?? []).map(
          (a) => a.locationId
        ),
      })
    ),
    venues,
    usage: {
      plan: usage.plan,
      planResolved: usage.planResolved,
      billingEntitled: usage.billingEntitled,
      meters: usage.meters,
      overLimitResources: usage.overLimitResources,
    },
    billing: {
      orgStatus: billing.orgStatus,
      plan: billing.plan,
      planResolved: billing.planResolved,
      subscriptionStatus: billing.subscriptionStatus,
      subscriptionEndsAt: billing.subscriptionEndsAt,
      pastDue: billing.pastDue,
      billingSoftHold: billing.billingSoftHold,
      billingEntitled: billing.billingEntitled,
      enterpriseHqEnabled: billing.enterpriseHqEnabled === true,
      hasCustomer: billing.hasCustomer,
      hasSubscription: billing.hasSubscription,
      daysUntilRenewal: billing.daysUntilRenewal,
      // No Stripe customer/subscription id strings.
    },
    // Inventory totals + plan-meter-aligned seats (must match usage.meters).
    // Ticketing: redacted counts only — no Stripe ids, card numbers, or pay-link secrets.
    resourceCounts: {
      products,
      fabrics,
      categories,
      orders,
      roleTemplates,
      tailorProfiles,
      measurementCampaigns: campaigns,
      fashionChats,
      venues: venues.length,
      venuesActive,
      members: memberships.length,
      membersSeatMeter,
      admissionProductsByType,
      admissionProductsCategorized: admissionCategorized,
      bookingsByStatus,
      bookingInvoicesByStatus,
      admissionProductsTotal: Object.values(admissionProductsByType).reduce(
        (s, n) => s + n,
        0
      ),
      bookingsTotal: Object.values(bookingsByStatus).reduce((s, n) => s + n, 0),
      bookingInvoicesTotal: Object.values(bookingInvoicesByStatus).reduce(
        (s, n) => s + n,
        0
      ),
      bookingPackages: bookingPackages.length,
      marketplaceBookings: marketplaceBookings.length,
      // Guest park Memberships (Feature 08) — counts; full redacted tables below.
      guestProfiles: guestProfileCount,
      membershipCategories: membershipCategoryCount,
      membershipPlans: membershipPlanCount,
      guestMemberships: guestMembershipCount,
      membershipVenueEligibility: membershipEligibilityCount,
      membershipSettings: membershipSettingsCount,
      membershipFamilyLinks: membershipFamilyLinkCount,
      membershipUsageEvents: membershipUsageEventCount,
      membershipPaymentAttempts: membershipPaymentAttemptCount,
      membershipAgreements: membershipAgreementCount,
      membershipCancelAlternatives: membershipCancelAlternativeCount,
      waiverTemplates: waiverTemplateCount,
      waiverRecords: waiverRecordCount,
      formResponses: formResponseCount,
      waiverKioskDevices: waiverKioskDeviceCount,
      waiverWalkinPasses: waiverWalkinPassCount,
      marketingAutomationSettings: marketingSettingsCount,
      guestSurveys: guestSurveyCount,
      marketingSendLogs: marketingSendLogCount,
      marketingLeadsOptedIn: marketingLeadsOptedInCount,
      marketingCampaigns: marketingCampaignCount,
      marketingCampaignRecipients: marketingCampaignRecipientCount,
      posDevices: posDeviceCount,
      posProducts: posProductCount,
      posSales: posSaleCount,
      tillSessions: tillSessionCount,
      giftCardLiability,
      giftCardLast4: giftCards.map((card) => card.last4).filter((v): v is string => Boolean(v)),
    },
    // Guest park Memberships tables (redacted — no Stripe / photo / QR secrets).
    membershipGuestProfiles: guestProfiles.map((g) => ({
      id: g.id,
      locationId: g.locationId,
      firstName: g.firstName,
      lastName: g.lastName,
      email: g.email,
      phone: g.phone,
      postalCode: g.postalCode,
      bannedAt: g.bannedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
    membershipCategoriesExport: membershipCategories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      archivedAt: c.archivedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      publicSlug: c.publicPage?.slug ?? null,
      publicActive: c.publicPage ? c.publicPage.active : null,
    })),
    membershipPlansExport: membershipPlans.map((p) => {
      const ent =
        p.entitlements &&
        typeof p.entitlements === "object" &&
        !Array.isArray(p.entitlements)
          ? (p.entitlements as Record<string, unknown>)
          : {};
      return {
        id: p.id,
        locationId: p.locationId,
        categoryId: p.categoryId,
        name: p.name,
        description: p.description,
        membershipType: p.membershipType,
        billing: p.billing,
        intervalCount: p.intervalCount,
        intervalUnit: p.intervalUnit,
        price: p.price.toString(),
        currency: p.currency,
        familyAllowed: p.familyAllowed,
        upgradeGroupKey: p.upgradeGroupKey,
        agreementRequired: p.agreementRequired,
        pauseAllowed: p.pauseAllowed,
        imageUrl: p.imageUrl,
        tags: p.tags,
        daysValidFromPurchase: p.daysValidFromPurchase,
        daysValidFromRedemption: p.daysValidFromRedemption,
        redemptionStartsAt: p.redemptionStartsAt?.toISOString() ?? null,
        redemptionEndsAt: p.redemptionEndsAt?.toISOString() ?? null,
        customRedemptionDescription: p.customRedemptionDescription,
        salesStartsAt: p.salesStartsAt?.toISOString() ?? null,
        salesEndsAt: p.salesEndsAt?.toISOString() ?? null,
        hideFromOnlineSales: p.hideFromOnlineSales,
        addOnsEnabled: p.addOnsEnabled,
        formsEnabled: p.formsEnabled,
        instructions: p.instructions,
        reportingCategory: p.reportingCategory,
        overrideTax: p.overrideTax,
        cancellationTerms: p.cancellationTerms,
        termsAndConditions: p.termsAndConditions,
        variations: p.variations,
        archivedAt: p.archivedAt?.toISOString() ?? null,
        entitlementsSummary: {
          entriesPerPeriod:
            typeof ent.entriesPerPeriod === "number"
              ? ent.entriesPerPeriod
              : null,
          discountPercent:
            typeof ent.discountPercent === "number" ? ent.discountPercent : 0,
          guestCount:
            typeof ent.guestCount === "number" ? ent.guestCount : null,
          perkFlags: Array.isArray(ent.perkFlags)
            ? ent.perkFlags.filter((x): x is string => typeof x === "string")
            : [],
        },
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    }),
    guestMembershipsExport: guestMemberships.map((m) => ({
      id: m.id,
      locationId: m.locationId,
      homeLocationId: m.homeLocationId,
      guestProfileId: m.guestProfileId,
      planId: m.planId,
      status: m.status,
      customMembershipId: m.customMembershipId,
      source: m.source,
      startsAt: m.startsAt?.toISOString() ?? null,
      endsAt: m.endsAt?.toISOString() ?? null,
      currentPeriodStart: m.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: m.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      cancelledAt: m.cancelledAt?.toISOString() ?? null,
      cancelReason: m.cancelReason,
      agreementSignedAt: m.agreementSignedAt?.toISOString() ?? null,
      pauseStartsAt: m.pauseStartsAt?.toISOString() ?? null,
      pauseEndsAt: m.pauseEndsAt?.toISOString() ?? null,
      creditBalanceMinor: m.creditBalanceMinor,
      dunningFailCount: m.dunningFailCount,
      dunningNextAt: m.dunningNextAt?.toISOString() ?? null,
      visitStatus: m.visitStatus,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
    membershipVenueEligibilityExport: membershipEligibility.map((e) => ({
      id: e.id,
      planId: e.planId,
      locationId: e.locationId,
      eligible: e.eligible,
      localPerksAdd: Array.isArray(e.localPerksAdd)
        ? e.localPerksAdd.filter((x): x is string => typeof x === "string")
        : [],
      localPerksRemove: Array.isArray(e.localPerksRemove)
        ? e.localPerksRemove.filter((x): x is string => typeof x === "string")
        : [],
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    membershipSettingsExport: membershipSettingsRows.map((s) => {
      const other =
        s.other && typeof s.other === "object" && !Array.isArray(s.other)
          ? (s.other as Record<string, unknown>)
          : {};
      return {
        id: s.id,
        locationId: s.locationId,
        requirePhotoOnRedeem: s.requirePhotoOnRedeem,
        requireAgreementBeforeActive: s.requireAgreementBeforeActive,
        dunningEnabled: s.dunningEnabled,
        clickToCancelEnabled: s.clickToCancelEnabled,
        cancelAlternativesEnabled: s.cancelAlternativesEnabled,
        graceDays: s.graceDays,
        allowPause: s.allowPause,
        walletPassEnabled: s.walletPassEnabled,
        defaultHomeLocationId: s.defaultHomeLocationId,
        allowPastDueRedeem: other.allowPastDueRedeem === true,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };
    }),
    membershipFamilyLinksExport: membershipFamilyLinks.map((l) => ({
      id: l.id,
      guestMembershipId: l.guestMembershipId,
      guestProfileId: l.guestProfileId,
      role: l.role,
      createdAt: l.createdAt.toISOString(),
    })),
    membershipUsageEventsExport: membershipUsageEvents.map((u) => ({
      id: u.id,
      locationId: u.locationId,
      guestMembershipId: u.guestMembershipId,
      guestProfileId: u.guestProfileId,
      kind: u.kind,
      qty: u.qty,
      remainingAfter: u.remainingAfter,
      source: u.source,
      createdAt: u.createdAt.toISOString(),
    })),
    membershipPaymentAttemptsExport: membershipPaymentAttempts.map((a) => ({
      id: a.id,
      guestMembershipId: a.guestMembershipId,
      amount: a.amount.toString(),
      currency: a.currency,
      status: a.status,
      attemptNumber: a.attemptNumber,
      errorCode: a.errorCode,
      createdAt: a.createdAt.toISOString(),
    })),
    membershipAgreementsExport: membershipAgreements.map((a) => ({
      id: a.id,
      guestMembershipId: a.guestMembershipId,
      guestProfileId: a.guestProfileId,
      planId: a.planId,
      status: a.status,
      signedAt: a.signedAt?.toISOString() ?? null,
      bodyVersion: a.bodyVersion,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    membershipCancelAlternativesExport: membershipCancelAlternatives.map(
      (c) => ({
        id: c.id,
        locationId: c.locationId,
        name: c.name,
        kind: c.kind,
        active: c.active,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })
    ),
    // World B marketplace — redacted (no Connect account ids, no Stripe PI/charge ids).
    marketplaceAccount: marketplaceAccount
      ? {
          provider: marketplaceAccount.provider,
          onboardingStatus: marketplaceAccount.onboardingStatus,
          chargesEnabled: marketplaceAccount.chargesEnabled,
          payoutsEnabled: marketplaceAccount.payoutsEnabled,
          detailsSubmitted: marketplaceAccount.detailsSubmitted,
          payoutBankLast4: marketplaceAccount.payoutBankLast4,
          payoutBankName: marketplaceAccount.payoutBankName,
          defaultCurrency: marketplaceAccount.defaultCurrency,
          disabledReason: marketplaceAccount.disabledReason,
          hasConnectedAccount: Boolean(
            marketplaceAccount.stripeConnectedAccountId?.trim()
          ),
          createdAt: marketplaceAccount.createdAt.toISOString(),
          updatedAt: marketplaceAccount.updatedAt.toISOString(),
        }
      : null,
    // Step 3 franchise park Connect — redacted readiness only (no acct ids / secrets).
    parkMarketplaceAccounts: parkMarketplaceAccounts.map((p) => ({
      locationId: p.locationId,
      locationName: p.location.name,
      isFranchise: p.location.isFranchise,
      locationStatus: p.location.status,
      provider: p.provider,
      onboardingStatus: p.onboardingStatus,
      chargesEnabled: p.chargesEnabled,
      payoutsEnabled: p.payoutsEnabled,
      detailsSubmitted: p.detailsSubmitted,
      payoutBankLast4: p.payoutBankLast4,
      payoutBankName: p.payoutBankName,
      defaultCurrency: p.defaultCurrency,
      disabledReason: p.disabledReason,
      hasConnectedAccount: Boolean(p.stripeConnectedAccountId?.trim()),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    bookingPackages: bookingPackages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      amountMinor: p.amountMinor,
      currency: p.currency,
      capacity: p.capacity,
      active: p.active,
      published: p.published,
      locationId: p.locationId,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    marketplaceBookings: marketplaceBookings.map((b) => ({
      id: b.id,
      packageId: b.packageId,
      customerEmail: b.customerEmail,
      customerName: b.customerName,
      amountMinor: b.amountMinor,
      currency: b.currency,
      platformFeeMinor: b.platformFeeMinor,
      status: b.status,
      paidAt: b.paidAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
    parties,
    accounting,
  };
}

export async function requestCompanyOffboard(input: {
  orgId: string;
  actorSub: string;
  reason?: string | null;
}): Promise<{
  orgId: string;
  offboardRequestedAt: string;
  /** False when offboard was already requested — callers should skip re-notice. */
  created: boolean;
}> {
  const id = requireId(input.orgId, "orgId");
  await assertExportableCompanyOrg(id);
  // actorSub / reason are for audit callers; stamp is org-scoped only.
  void input.actorSub;
  void input.reason;

  const existing = await prisma.organization.findUnique({
    where: { id },
    select: { offboardRequestedAt: true, isDefault: true },
  });
  if (!existing || existing.isDefault) {
    throw new ForbiddenError(COMPANY_OFFBOARD_STOREFRONT_MESSAGE);
  }
  if (existing.offboardRequestedAt) {
    return {
      orgId: id,
      offboardRequestedAt: existing.offboardRequestedAt.toISOString(),
      created: false,
    };
  }

  const now = new Date();
  const result = await prisma.organization.updateMany({
    where: { id, isDefault: false, offboardRequestedAt: null },
    data: {
      offboardRequestedAt: now,
      // Soft marker only — no hard-delete of orders/payments/users.
      // offboardedAt is reserved for a future ops completion job.
    },
  });
  if (result.count === 0) {
    // Race: another request stamped first — return current stamp, not create.
    const raced = await prisma.organization.findUnique({
      where: { id },
      select: { offboardRequestedAt: true },
    });
    if (raced?.offboardRequestedAt) {
      return {
        orgId: id,
        offboardRequestedAt: raced.offboardRequestedAt.toISOString(),
        created: false,
      };
    }
    throw new ForbiddenError(COMPANY_OFFBOARD_NOT_FOUND_MESSAGE);
  }

  return { orgId: id, offboardRequestedAt: now.toISOString(), created: true };
}
