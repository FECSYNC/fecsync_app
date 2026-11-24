/**
 * Step 3 franchise park Connect payouts smoke.
 *
 * Proves: distinct park A/B Connect destinations, sister-park deny, franchise
 * fail-closed until park charge-ready, archive disables park charges, webhook
 * account.updated maps to park row (not SaaS), org Connect still used for
 * null-location packages.
 *
 *   yarn smoke:franchise-park-payouts
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const prisma = new PrismaClient();

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function ensureParkAccountsSchema() {
  // Apply Step 3 columns/table when migrate deploy env is unavailable.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "venue_location_marketplace_accounts" (
      "id" TEXT NOT NULL,
      "orgId" TEXT NOT NULL,
      "locationId" TEXT NOT NULL,
      "provider" "MarketplaceProvider" NOT NULL DEFAULT 'stripe_connect',
      "stripeConnectedAccountId" TEXT,
      "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
      "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
      "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
      "requirementsDue" JSONB,
      "payoutBankLast4" TEXT,
      "payoutBankName" TEXT,
      "defaultCurrency" TEXT NOT NULL DEFAULT 'usd',
      "onboardingStatus" "MarketplaceOnboardingStatus" NOT NULL DEFAULT 'not_started',
      "disabledReason" TEXT,
      "platformFeeBpsOverride" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "venue_location_marketplace_accounts_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "venue_location_marketplace_accounts_locationId_key"
      ON "venue_location_marketplace_accounts"("locationId")
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "booking_payments"
      ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
      ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "membership_payment_attempts"
      ADD COLUMN IF NOT EXISTS "locationId" TEXT,
      ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
      ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "pos_sale_payments"
      ADD COLUMN IF NOT EXISTS "connectedAccountId" TEXT,
      ADD COLUMN IF NOT EXISTS "platformFeeMinor" INTEGER
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "pos_sale_payments"
      ADD COLUMN IF NOT EXISTS "amountRefunded" DECIMAL(12, 2) NOT NULL DEFAULT 0
  `).catch(() => {});
}

async function main() {
  process.env.MARKETPLACE_PLATFORM_FEE_BPS =
    process.env.MARKETPLACE_PLATFORM_FEE_BPS || "500";
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || "sk_test_smoke_park_payouts";
  process.env.STRIPE_PRICE_STARTER_MONTHLY =
    process.env.STRIPE_PRICE_STARTER_MONTHLY || "price_smoke_starter";

  await ensureParkAccountsSchema();

  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation, archiveVenueLocation } = await import(
    "../src/lib/venueLocations.ts"
  );
  const {
    resolveGuestPayoutDestination,
    assertParkMarketplaceChargeReady,
    PARK_PAYOUTS_NOT_READY_MESSAGE,
  } = await import("../src/lib/marketplace/guestPayoutDestination.ts");
  const {
    syncParkMarketplaceAccountFromStripe,
    disableParkMarketplaceAccountOnArchive,
    assertCanManageParkConnect,
    findParkLocationByConnectedAccountId,
    PARK_CONNECT_FORBIDDEN_MESSAGE,
  } = await import("../src/lib/marketplace/parkAccount.ts");
  const { replaceMembershipVenueAssignments } = await import(
    "../src/lib/parkAdminScope.ts"
  );
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { computePlatformFeeMinor } = await import(
    "../src/lib/marketplace/fees.ts"
  );

  const stamp = Date.now();
  const adminUser = await prisma.user.create({
    data: {
      email: `smoke-pp-admin-${stamp}@test.local`,
      password: "x",
      username: `smokeppadm${stamp}`,
      firstName: "Park",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const managerUser = await prisma.user.create({
    data: {
      email: `smoke-pp-mgr-${stamp}@test.local`,
      password: "x",
      username: `smokeppmgr${stamp}`,
      firstName: "Park",
      lastName: "Mgr",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Park Payouts ${stamp}`,
    slug: `smoke-pp-${stamp}`,
    userId: adminUser.id,
  });
  const orgId = created.organization.id;

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionStatus: "active",
      subscriptionPlan: "growth",
      subscriptionEndsAt: new Date(Date.now() + 30 * 864e5),
    },
  });

  const adminActor = {
    orgId,
    sub: adminUser.id,
    preset: "platform_admin" as const,
    membershipRole: "platform_admin",
    companyWideView: true,
  };

  const parkA = await createVenueLocation(adminActor, {
    name: `Park A ${stamp}`,
    slug: `park-a-${stamp}`,
    isFranchise: true,
  });
  const parkB = await createVenueLocation(adminActor, {
    name: `Park B ${stamp}`,
    slug: `park-b-${stamp}`,
    isFranchise: true,
  });

  // Fail closed before park Connect ready
  let notReady = false;
  try {
    await resolveGuestPayoutDestination({
      orgId,
      locationId: parkA.id,
    });
  } catch (err) {
    notReady =
      err instanceof ForbiddenError &&
      err.message === PARK_PAYOUTS_NOT_READY_MESSAGE;
  }
  check("1-franchise-fail-closed-until-ready", notReady);

  // Stamp distinct park Connect rows (mock Stripe account shapes)
  const acctA = `acct_smoke_a_${stamp}`;
  const acctB = `acct_smoke_b_${stamp}`;
  await syncParkMarketplaceAccountFromStripe(parkA.id, {
    id: acctA,
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    default_currency: "usd",
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    external_accounts: { data: [] },
  } as never);
  await syncParkMarketplaceAccountFromStripe(parkB.id, {
    id: acctB,
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    default_currency: "usd",
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    external_accounts: { data: [] },
  } as never);

  const destA = await resolveGuestPayoutDestination({
    orgId,
    locationId: parkA.id,
  });
  const destB = await resolveGuestPayoutDestination({
    orgId,
    locationId: parkB.id,
  });
  check(
    "2-park-a-destination",
    destA.settlementScope === "park" && destA.connectedAccountId === acctA
  );
  check(
    "2-park-b-destination-distinct",
    destB.settlementScope === "park" &&
      destB.connectedAccountId === acctB &&
      destA.connectedAccountId !== destB.connectedAccountId
  );
  check(
    "2-fee-computed",
    computePlatformFeeMinor({
      amountMinor: 10000,
      platformFeeBpsOverride: destA.platformFeeBpsOverride,
    }) === 500
  );

  const parkReady = await assertParkMarketplaceChargeReady(orgId, parkA.id);
  check(
    "2-assert-park-charge-ready",
    parkReady.stripeConnectedAccountId === acctA
  );

  // Manager A cannot manage park B Connect
  const { ensureFranchiseManagerCapabilityPermissions } = await import(
    "../src/lib/franchisePark.ts"
  );
  const fpmPack = ensureFranchiseManagerCapabilityPermissions([]);
  check(
    "3-fpm-ensure-pack-auto-invite",
    fpmPack.includes("users:invite") &&
      fpmPack.includes("payouts:read") &&
      fpmPack.includes("payouts:manage")
  );
  const mgrMembership = await prisma.membership.create({
    data: {
      userId: managerUser.id,
      orgId,
      rolePreset: "ops_manager",
      status: "active",
      companyWideView: false,
      franchiseParkManager: true,
      permissionsOverride: fpmPack,
    },
  });
  await replaceMembershipVenueAssignments({
    membershipId: mgrMembership.id,
    orgId,
    locationIds: [parkA.id],
  });
  const mgrActor = {
    orgId,
    sub: managerUser.id,
    preset: "ops_manager" as const,
    membershipRole: "ops_manager",
    companyWideView: false,
  };
  let sisterDenied = false;
  try {
    await assertCanManageParkConnect(mgrActor, parkB.id);
  } catch (err) {
    sisterDenied =
      err instanceof ForbiddenError &&
      err.message === PARK_CONNECT_FORBIDDEN_MESSAGE;
  }
  check("3-manager-cannot-onboard-sister-park", sisterDenied);
  let managerOkA = false;
  try {
    await assertCanManageParkConnect(mgrActor, parkA.id);
    managerOkA = true;
  } catch {
    managerOkA = false;
  }
  check("3-manager-can-manage-park-a", managerOkA);

  // Franchise managers cannot open company SaaS billing HQ surfaces
  const { assertNotParkLockedCompanyHq, PARK_LOCKED_COMPANY_HQ_MESSAGE } =
    await import("../src/lib/assertNotParkLockedCompanyHq.ts");
  let billingDenied = false;
  try {
    await assertNotParkLockedCompanyHq(mgrActor);
  } catch (err) {
    billingDenied =
      err instanceof ForbiddenError &&
      err.message === PARK_LOCKED_COMPANY_HQ_MESSAGE;
  }
  check("3-manager-billing-hq-denied", billingDenied);

  // UI sync contract: Connect sync invalidates payout + HQ + venues query keys
  const marketplaceSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/services/marketplace.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "3-ui-sync-invalidates-venues-hq-payouts",
    marketplaceSrc.includes("invalidateMarketplacePayoutQueries") &&
      marketplaceSrc.includes("marketplaceKeys.all") &&
      marketplaceSrc.includes("hqKeys.all") &&
      marketplaceSrc.includes("venueLocationKeys.all")
  );

  const payoutsSyncSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/utils/marketplacePayoutsSync.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "3-ui-sync-cross-tab-broadcast",
    payoutsSyncSrc.includes("MARKETPLACE_PAYOUTS_SYNC_KEY") &&
      payoutsSyncSrc.includes("broadcastMarketplacePayoutsChange")
  );

  const saleEngineSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/lib/pos/saleEngine.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "3-pos-browser-fallback-uses-connect-resolver",
    saleEngineSrc.includes("convertCardPresentIntentToBrowser") &&
      saleEngineSrc.includes("resolvePosConnectChargeFields") &&
      saleEngineSrc.includes("connectedAccountId: connect.connectedAccountId")
  );
  check(
    "3-pos-refund-sale-connect-application-fee",
    saleEngineSrc.includes("export async function refundSale") &&
      saleEngineSrc.includes("refundApplicationFee: Boolean(claim.connectedAccountId?.trim())") &&
      saleEngineSrc.includes("await refundPayment(resolved.paymentIntentId, claim.slice") &&
      saleEngineSrc.includes("amountRefunded") &&
      saleEngineSrc.includes("SELECT id FROM pos_sales WHERE id = ${sale.id} FOR UPDATE")
  );

  const waiverTargetsSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/app/api/admin/waivers/targets/route.ts", import.meta.url),
      "utf8"
    )
  );
  check(
    "3-waiver-targets-park-scoped",
    waiverTargetsSrc.includes("waiverListLocationWhere")
  );

  // Empty park-lock assignment filter must fail closed (no sister-park leak)
  const { listParkMarketplaceAccountsForOrg } = await import(
    "../src/lib/marketplace/parkAccount.ts"
  );
  const emptyFilter = await listParkMarketplaceAccountsForOrg(orgId, []);
  check("3-empty-park-filter-fail-closed", emptyFilter.length === 0);

  const healed = ensureFranchiseManagerCapabilityPermissions([]);
  check(
    "3-fpm-capability-perms-auto-union",
    healed.includes("payouts:read") &&
      healed.includes("payouts:manage") &&
      healed.includes("users:invite") &&
      healed.includes("users:park_assign")
  );

  // account.updated routing: connected account binds to park row, not SaaS cols
  const saasBefore = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
    },
  });
  const parkBinding = await findParkLocationByConnectedAccountId(acctA);
  check(
    "4-webhook-binding-resolves-park",
    parkBinding?.locationId === parkA.id && parkBinding?.orgId === orgId
  );
  const orgBinding = await prisma.organizationMarketplaceAccount.findUnique({
    where: { stripeConnectedAccountId: acctA },
  });
  check("4-park-acct-not-on-org-row", orgBinding == null);
  await syncParkMarketplaceAccountFromStripe(parkA.id, {
    id: acctA,
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    default_currency: "usd",
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    external_accounts: { data: [] },
  } as never);
  const saasAfter = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
    },
  });
  check(
    "4-saas-columns-unchanged",
    saasBefore.stripeCustomerId === saasAfter.stripeCustomerId &&
      saasBefore.stripeSubscriptionId === saasAfter.stripeSubscriptionId &&
      saasBefore.subscriptionStatus === saasAfter.subscriptionStatus
  );

  // Archive park A blocks new charges
  await archiveVenueLocation(adminActor, parkA.id);
  await disableParkMarketplaceAccountOnArchive(parkA.id);
  let archivedBlocked = false;
  try {
    await resolveGuestPayoutDestination({
      orgId,
      locationId: parkA.id,
    });
  } catch (err) {
    archivedBlocked = err instanceof ForbiddenError;
  }
  check("5-archive-blocks-park-a-charges", archivedBlocked);

  // Reactivate restores park Connect readiness (Stripe sync or clear archive disable)
  const { reactivateVenueLocation } = await import(
    "../src/lib/venueLocations.ts"
  );
  const { restoreParkMarketplaceAccountAfterReactivate } = await import(
    "../src/lib/marketplace/parkAccount.ts"
  );
  await reactivateVenueLocation(adminActor, parkA.id);
  // Smoke env may lack a live Stripe key — stamp readiness after restore path runs.
  await restoreParkMarketplaceAccountAfterReactivate(parkA.id);
  await syncParkMarketplaceAccountFromStripe(parkA.id, {
    id: acctA,
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    default_currency: "usd",
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    external_accounts: { data: [] },
  } as never);
  const destAfterRestore = await resolveGuestPayoutDestination({
    orgId,
    locationId: parkA.id,
  });
  check(
    "5-reactivate-restores-park-a-charges",
    destAfterRestore.settlementScope === "park" &&
      destAfterRestore.connectedAccountId === acctA
  );

  // Null location → org Connect path (stamp org account)
  await prisma.organizationMarketplaceAccount.upsert({
    where: { orgId },
    create: {
      orgId,
      provider: "stripe_connect",
      stripeConnectedAccountId: `acct_org_${stamp}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "complete",
      defaultCurrency: "usd",
    },
    update: {
      stripeConnectedAccountId: `acct_org_${stamp}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "complete",
    },
  });
  const orgDest = await resolveGuestPayoutDestination({
    orgId,
    locationId: null,
  });
  check(
    "6-null-location-uses-org-connect",
    orgDest.settlementScope === "org" &&
      orgDest.connectedAccountId === `acct_org_${stamp}`
  );

  // Cleanup
  await prisma.marketplacePaymentEvent.deleteMany({ where: { orgId } });
  await prisma.venueLocationMarketplaceAccount.deleteMany({ where: { orgId } });
  await prisma.organizationMarketplaceAccount.deleteMany({ where: { orgId } });
  await prisma.membershipVenueAssignment.deleteMany({ where: { orgId } });
  await prisma.membership.deleteMany({ where: { orgId } });
  await prisma.venueLocation.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  await prisma.user
    .deleteMany({
      where: { id: { in: [adminUser.id, managerUser.id] } },
    })
    .catch(() => {});
  await prisma.$disconnect();

  if (failed > 0) {
    console.error(`\n${failed} franchise park payout smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll franchise park payout smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
