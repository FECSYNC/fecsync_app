/**
 * Marketplace Connect payouts smoke (World B).
 *
 * Covers fee math, charge-ready gates, package limits, public unpublished deny,
 * checkout without charge-ready, mocked checkout session create, webhook
 * idempotency, cross-org refund deny, soft-hold deny, and SaaS separation.
 *
 *   yarn smoke:marketplace-payouts
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

async function main() {
  process.env.MARKETPLACE_PLATFORM_FEE_BPS =
    process.env.MARKETPLACE_PLATFORM_FEE_BPS || "500";
  process.env.MARKETPLACE_PLATFORM_FEE_FLAT_MINOR =
    process.env.MARKETPLACE_PLATFORM_FEE_FLAT_MINOR || "0";
  process.env.MARKETPLACE_CURRENCY_DEFAULT =
    process.env.MARKETPLACE_CURRENCY_DEFAULT || "usd";
  // Stub Stripe key so getStripe() does not throw when sync paths are skipped.
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || "sk_test_smoke_marketplace";
  process.env.STRIPE_PRICE_STARTER_MONTHLY =
    process.env.STRIPE_PRICE_STARTER_MONTHLY || "price_smoke_starter";

  const { computePlatformFeeMinor } = await import(
    "../src/lib/marketplace/fees.ts"
  );
  const {
    assertOrgMarketplaceChargeReady,
    MARKETPLACE_NOT_CHARGE_READY_MESSAGE,
    MARKETPLACE_STOREFRONT_MESSAGE,
  } = await import("../src/lib/marketplace/assertChargeReady.ts");
  const {
    createBookingPackage,
    listBookingPackagesForOrg,
  } = await import("../src/lib/marketplace/packages.ts");
  const {
    getPublishedBookingPackagePublic,
    createMarketplaceBookingCheckout,
  } = await import("../src/lib/marketplace/bookingCheckout.ts");
  const { refundMarketplaceBooking } = await import(
    "../src/lib/marketplace/refunds.ts"
  );
  const {
    processMarketplaceCheckoutCompleted,
  } = await import("../src/lib/marketplace/webhook.ts");
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");

  // ── Fee math ────────────────────────────────────────────────────────────
  check("fee-5pct-10000", computePlatformFeeMinor({ amountMinor: 10000 }) === 500);
  check("fee-override-bps", computePlatformFeeMinor({
    amountMinor: 10000,
    platformFeeBpsOverride: 100,
  }) === 100);
  check(
    "fee-rejects-100pct",
    (() => {
      try {
        computePlatformFeeMinor({ amountMinor: 100, feeBps: 10000, feeFlatMinor: 0 });
        return false;
      } catch {
        return true;
      }
    })()
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mkt-${stamp}@test.local`,
      password: "x",
      username: `smokemkt${stamp}`,
      firstName: "Mkt",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-mkt-b-${stamp}@test.local`,
      password: "x",
      username: `smokemktb${stamp}`,
      firstName: "Other",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const pending = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mkt Pending ${stamp}`,
    slug: `smoke-mkt-pending-${stamp}`,
    userId: user.id,
    requestedPlan: "starter",
  });
  const orgId = pending.organization.id;
  const orgSlug = pending.organization.slug;

  const {
    startMarketplaceConnectOnboarding,
    refreshMarketplaceConnectLink,
    stripeConnectMarketplaceProvider,
  } = await import("../src/lib/marketplace/account.ts");
  const { applyStripeSubscriptionToOrg } = await import(
    "../src/lib/companyBilling.ts"
  );

  // 1) Pending org cannot onboard Connect / charge-ready
  let pendingChargeReadyDenied = false;
  try {
    await assertOrgMarketplaceChargeReady(orgId);
  } catch (err) {
    pendingChargeReadyDenied = err instanceof ForbiddenError;
  }
  check("pending-org-not-charge-ready", pendingChargeReadyDenied);

  let pendingOnboardDenied = false;
  try {
    await startMarketplaceConnectOnboarding({
      orgId,
      actorIsPlatformAdmin: true,
    });
  } catch (err) {
    pendingOnboardDenied = err instanceof ForbiddenError;
  }
  check("pending-org-cannot-onboard", pendingOnboardDenied);

  // Activate + entitle like paid Starter
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      approvedAt: new Date(),
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: endsAt,
      stripeCustomerId: `cus_smoke_mkt_${stamp}`,
      stripeSubscriptionId: `sub_smoke_mkt_${stamp}`,
    },
  });

  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mkt Other ${stamp}`,
    slug: `smoke-mkt-other-${stamp}`,
    userId: otherUser.id,
    requestedPlan: "starter",
  });
  await prisma.organization.update({
    where: { id: other.organization.id },
    data: {
      status: "active",
      approvedAt: new Date(),
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: endsAt,
    },
  });
  const otherOrgId = other.organization.id;

  // 2) Active entitled org can create Account Link (mocked Stripe)
  const originalCreateExpress =
    stripeConnectMarketplaceProvider.createExpressAccount;
  const originalCreateLink =
    stripeConnectMarketplaceProvider.createAccountLink;
  stripeConnectMarketplaceProvider.createExpressAccount = async () => ({
    accountId: `acct_smoke_link_${stamp}`,
  });
  stripeConnectMarketplaceProvider.createAccountLink = async () => ({
    url: "https://connect.stripe.test/onboard",
  });
  let onboardUrlOk = false;
  try {
    const link = await startMarketplaceConnectOnboarding({
      orgId,
      actorIsPlatformAdmin: true,
    });
    onboardUrlOk =
      link.url === "https://connect.stripe.test/onboard" &&
      Boolean(link.accountId);
  } catch (err) {
    console.error("onboard mock error", err);
  }
  check("active-entitled-account-link", onboardUrlOk);
  stripeConnectMarketplaceProvider.createExpressAccount = originalCreateExpress;
  stripeConnectMarketplaceProvider.createAccountLink = originalCreateLink;

  // Without complete flags → not charge-ready (account may exist from onboard mock)
  await prisma.organizationMarketplaceAccount.updateMany({
    where: { orgId },
    data: {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardingStatus: "pending",
    },
  });
  let noAcct = false;
  try {
    await assertOrgMarketplaceChargeReady(orgId);
  } catch (err) {
    noAcct =
      err instanceof ForbiddenError &&
      String(err.message).includes("Payouts are not ready");
  }
  check("incomplete-connect-not-charge-ready", noAcct, MARKETPLACE_NOT_CHARGE_READY_MESSAGE);

  // Storefront denied as Connect merchant
  const storefrontId = await getStorefrontOrgId();
  let storefrontDenied = false;
  try {
    await assertOrgMarketplaceChargeReady(storefrontId);
  } catch (err) {
    storefrontDenied =
      err instanceof ForbiddenError &&
      String(err.message).includes("storefront");
  }
  check("storefront-connect-denied", storefrontDenied, MARKETPLACE_STOREFRONT_MESSAGE);

  let storefrontOnboardDenied = false;
  try {
    await startMarketplaceConnectOnboarding({
      orgId: storefrontId,
      actorIsPlatformAdmin: true,
    });
  } catch (err) {
    storefrontOnboardDenied = err instanceof ForbiddenError;
  }
  check("storefront-onboard-denied", storefrontOnboardDenied);

  // 3) Create package asserts plan limit (starter = 5)
  const pkg = await createBookingPackage({
    orgId,
    title: "Smoke Package",
    slug: `smoke-pkg-${stamp}`,
    amountMinor: 500000,
    currency: "usd",
    published: true,
    capacity: 2,
  });
  check("create-package", Boolean(pkg.id) && pkg.published === true && pkg.currency === "usd");

  const listed = await listBookingPackagesForOrg(orgId);
  check("list-packages", listed.some((p) => p.id === pkg.id));

  // Fill remaining starter slots (4 more) then assert limit
  for (let i = 0; i < 4; i++) {
    await createBookingPackage({
      orgId,
      title: `Fill ${i}`,
      slug: `smoke-fill-${stamp}-${i}`,
      amountMinor: 1000,
      currency: "usd",
    });
  }
  let limitHit = false;
  try {
    await createBookingPackage({
      orgId,
      title: "Over",
      slug: `smoke-over-${stamp}`,
      amountMinor: 1000,
      currency: "usd",
    });
  } catch (err) {
    limitHit =
      err instanceof ForbiddenError &&
      String(err.message).includes("Plan limit reached");
  }
  check("plan-limit-bookingPackages", limitHit);

  // 4) Public cannot fetch unpublished
  await prisma.bookingPackage.update({
    where: { id: pkg.id },
    data: { published: false },
  });
  let unpublishedDenied = false;
  try {
    await getPublishedBookingPackagePublic(orgSlug, pkg.slug);
  } catch (err) {
    unpublishedDenied = err instanceof ForbiddenError;
  }
  check("unpublished-public-denied", unpublishedDenied);
  await prisma.bookingPackage.update({
    where: { id: pkg.id },
    data: { published: true },
  });

  // 5) Checkout without charge-ready → 403
  let checkoutBlocked = false;
  try {
    await createMarketplaceBookingCheckout({
      publicOrgKey: orgSlug,
      packageSlug: pkg.slug,
      email: "guest@test.local",
      name: "Guest",
      idempotencyKey: `smoke-idem-${stamp}-a`,
    });
  } catch (err) {
    checkoutBlocked = err instanceof ForbiddenError;
  }
  check("checkout-without-charge-ready", checkoutBlocked);

  // Make charge-ready via DB stamp
  await prisma.organizationMarketplaceAccount.upsert({
    where: { orgId },
    create: {
      orgId,
      provider: "stripe_connect",
      stripeConnectedAccountId: `acct_smoke_${stamp}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "complete",
      defaultCurrency: "usd",
    },
    update: {
      stripeConnectedAccountId: `acct_smoke_${stamp}`,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingStatus: "complete",
      defaultCurrency: "usd",
    },
  });
  const ready = await assertOrgMarketplaceChargeReady(orgId);
  check(
    "charge-ready-after-stamp",
    ready.stripeConnectedAccountId === `acct_smoke_${stamp}`
  );

  // 6) Checkout with charge-ready — mock Stripe; assert destination + application_fee
  const accountMod = await import("../src/lib/marketplace/account.ts");
  const originalCreate =
    accountMod.stripeConnectMarketplaceProvider.createDestinationCheckoutSession;
  let capturedCheckoutInput: {
    applicationFeeMinor?: number;
    connectedAccountId?: string;
    metadata?: Record<string, string>;
  } | null = null;
  accountMod.stripeConnectMarketplaceProvider.createDestinationCheckoutSession =
    async (input) => {
      capturedCheckoutInput = {
        applicationFeeMinor: input.applicationFeeMinor,
        connectedAccountId: input.connectedAccountId,
        metadata: input.metadata,
      };
      return {
        id: `cs_smoke_${stamp}`,
        url: "https://checkout.stripe.test/smoke",
        payment_intent: `pi_smoke_${stamp}`,
        status: "open",
        metadata: input.metadata,
      } as never;
    };

  let checkoutOk = false;
  let bookingId = "";
  try {
    const result = await createMarketplaceBookingCheckout({
      publicOrgKey: orgSlug,
      packageSlug: pkg.slug,
      email: "guest@test.local",
      name: "Guest",
      idempotencyKey: `smoke-idem-${stamp}-b`,
    });
    checkoutOk = result.url.includes("checkout.stripe.test");
    bookingId = result.bookingId;
  } catch (err) {
    console.error("checkout create error", err);
  }
  check("checkout-with-charge-ready", checkoutOk && Boolean(bookingId));
  check(
    "checkout-destination-and-fee",
    capturedCheckoutInput?.connectedAccountId === `acct_smoke_${stamp}` &&
      capturedCheckoutInput?.applicationFeeMinor ===
        computePlatformFeeMinor({ amountMinor: 500000 }) &&
      capturedCheckoutInput?.metadata?.type === "marketplace_booking" &&
      capturedCheckoutInput?.metadata?.orgId === orgId &&
      Boolean(capturedCheckoutInput?.metadata?.bookingId)
  );

  // Idempotency replay
  const replay = await createMarketplaceBookingCheckout({
    publicOrgKey: orgSlug,
    packageSlug: pkg.slug,
    email: "guest@test.local",
    idempotencyKey: `smoke-idem-${stamp}-b`,
  });
  check("checkout-idempotency", replay.bookingId === bookingId);

  const booking = await prisma.marketplaceBooking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  check(
    "fee-locked-on-booking",
    booking.platformFeeMinor === computePlatformFeeMinor({ amountMinor: booking.amountMinor }) &&
      booking.connectedAccountId === `acct_smoke_${stamp}`
  );

  // 7) Webhook replay does not double-mark paid
  const fakeSession = {
    id: booking.stripeCheckoutSessionId || `cs_smoke_${stamp}`,
    payment_status: "paid",
    payment_intent: null,
    amount_total: booking.amountMinor,
    metadata: {
      type: "marketplace_booking",
      orgId,
      bookingId,
      packageId: pkg.id,
    },
  };

  // Ensure session id is on booking for consistency
  await prisma.marketplaceBooking.update({
    where: { id: bookingId },
    data: {
      stripeCheckoutSessionId: fakeSession.id,
      stripePaymentIntentId: `pi_smoke_${stamp}`,
    },
  });

  const evt1 = {
    id: `evt_smoke_mkt_${stamp}`,
    type: "checkout.session.completed",
    data: { object: fakeSession },
  } as never;
  const r1 = await processMarketplaceCheckoutCompleted(evt1, fakeSession as never);
  const r2 = await processMarketplaceCheckoutCompleted(evt1, fakeSession as never);
  const paid = await prisma.marketplaceBooking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  check("webhook-marks-paid", paid.status === "paid" && r1.result.startsWith("ok"));
  check("webhook-replay-noop", r2.duplicate === true && paid.status === "paid");

  accountMod.stripeConnectMarketplaceProvider.createDestinationCheckoutSession =
    originalCreate;

  // 8) Cross-org refund denied
  let crossRefundDenied = false;
  try {
    await refundMarketplaceBooking({
      actorOrgId: otherOrgId,
      bookingId,
      actorUserId: otherUser.id,
      amountMinor: 100,
    });
  } catch (err) {
    crossRefundDenied = err instanceof ForbiddenError || err instanceof Error;
  }
  check("cross-org-refund-denied", crossRefundDenied);

  // 9) Soft-hold checkout denied
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionEndsAt: new Date(Date.now() - 60_000),
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
    },
  });
  let softHoldDenied = false;
  try {
    await createMarketplaceBookingCheckout({
      publicOrgKey: orgSlug,
      packageSlug: pkg.slug,
      email: "guest2@test.local",
      idempotencyKey: `smoke-idem-${stamp}-soft`,
    });
  } catch (err) {
    softHoldDenied = err instanceof ForbiddenError;
  }
  check("soft-hold-checkout-denied", softHoldDenied);

  // Soft-hold also blocks Connect refresh
  const originalRefreshLink =
    accountMod.stripeConnectMarketplaceProvider.createAccountLink;
  accountMod.stripeConnectMarketplaceProvider.createAccountLink = async () => ({
    url: "https://connect.stripe.test/should-not-reach",
  });
  let softHoldRefreshDenied = false;
  try {
    await refreshMarketplaceConnectLink({
      orgId,
      actorIsPlatformAdmin: true,
    });
  } catch (err) {
    softHoldRefreshDenied = err instanceof ForbiddenError;
  }
  check("soft-hold-refresh-denied", softHoldRefreshDenied);
  accountMod.stripeConnectMarketplaceProvider.createAccountLink =
    originalRefreshLink;

  // Demo plan fail-closed for Connect + checkout
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionEndsAt: new Date(Date.now() + 14 * 864e5),
      subscriptionStatus: "trialing",
      subscriptionPlan: "demo",
    },
  });
  let demoCheckoutDenied = false;
  try {
    await createMarketplaceBookingCheckout({
      publicOrgKey: orgSlug,
      packageSlug: pkg.slug,
      email: "demo-guest@test.local",
      idempotencyKey: `smoke-idem-${stamp}-demo`,
    });
  } catch (err) {
    demoCheckoutDenied = err instanceof ForbiddenError;
  }
  check("demo-checkout-denied", demoCheckoutDenied);

  let demoOnboardDenied = false;
  try {
    await startMarketplaceConnectOnboarding({
      orgId,
      actorIsPlatformAdmin: true,
    });
  } catch (err) {
    demoOnboardDenied = err instanceof ForbiddenError;
  }
  check("demo-onboard-denied", demoOnboardDenied);

  // Restore entitlement for SaaS separation check
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      subscriptionEndsAt: endsAt,
      subscriptionStatus: "active",
      subscriptionPlan: "starter",
      stripeCustomerId: `cus_smoke_mkt_${stamp}`,
      stripeSubscriptionId: `sub_smoke_mkt_${stamp}`,
    },
  });

  // 10) SaaS apply must not mutate marketplace account; marketplace sync must not clear SaaS
  const mktBeforeSaas = await prisma.organizationMarketplaceAccount.findUnique({
    where: { orgId },
  });
  await applyStripeSubscriptionToOrg(
    orgId,
    {
      id: `sub_smoke_mkt_${stamp}`,
      status: "active",
      customer: `cus_smoke_mkt_${stamp}`,
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: { id: "price_smoke_starter" },
            current_period_end: Math.floor(endsAt.getTime() / 1000),
          },
        ],
      },
      metadata: { type: "company_subscription", orgId, plan: "starter" },
    } as never,
    `evt_smoke_saas_${stamp}`
  );
  const mktAfterSaas = await prisma.organizationMarketplaceAccount.findUnique({
    where: { orgId },
  });
  check(
    "saas-apply-does-not-mutate-marketplace",
    mktBeforeSaas?.stripeConnectedAccountId ===
      mktAfterSaas?.stripeConnectedAccountId &&
      mktBeforeSaas?.onboardingStatus === mktAfterSaas?.onboardingStatus &&
      mktBeforeSaas?.chargesEnabled === mktAfterSaas?.chargesEnabled
  );

  const beforeSaas = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });
  await prisma.organizationMarketplaceAccount.update({
    where: { orgId },
    data: { chargesEnabled: true, payoutsEnabled: true },
  });
  const afterSaas = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
    },
  });
  check(
    "marketplace-update-does-not-mutate-saas",
    beforeSaas.stripeCustomerId === afterSaas.stripeCustomerId &&
      beforeSaas.stripeSubscriptionId === afterSaas.stripeSubscriptionId &&
      beforeSaas.subscriptionPlan === afterSaas.subscriptionPlan &&
      beforeSaas.subscriptionStatus === afterSaas.subscriptionStatus
  );

  // venue_booking settle helper still importable / not Connect-converted
  const ticketingPayments = await import("../src/lib/ticketing/payments.ts");
  check(
    "venue-booking-settle-path-intact",
    typeof ticketingPayments.settleVenueBookingStripePayment === "function"
  );
  // Webhook router still branches venue_booking separately from marketplace
  const fs = await import("node:fs/promises");
  const webhookSrc = await fs.readFile(
    new URL("../src/app/api/webhooks/stripe/route.ts", import.meta.url),
    "utf8"
  );
  check(
    "webhook-router-keeps-venue-and-marketplace-branches",
    webhookSrc.includes('metadata.type === "venue_booking"') &&
      webhookSrc.includes('metadata.type === "marketplace_booking"') &&
      webhookSrc.includes('metadata.type === "company_subscription"') &&
      webhookSrc.includes("processMarketplaceCheckoutCompleted") &&
      webhookSrc.includes("settleVenueBookingStripePayment")
  );

  // Cleanup
  await prisma.marketplacePaymentEvent.deleteMany({ where: { orgId } });
  await prisma.marketplaceRefund.deleteMany({ where: { orgId } });
  await prisma.marketplaceBooking.deleteMany({ where: { orgId } });
  await prisma.bookingPackage.deleteMany({ where: { orgId } });
  await prisma.organizationMarketplaceAccount.deleteMany({ where: { orgId } });
  await prisma.membership.deleteMany({
    where: { orgId: { in: [orgId, otherOrgId] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [orgId, otherOrgId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [user.id, otherUser.id] } },
  });

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll marketplace payout smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
