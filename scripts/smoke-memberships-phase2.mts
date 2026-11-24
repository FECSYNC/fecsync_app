/**
 * Memberships Phase 2 unit + integration smoke (billingEngine, proration,
 * status machine, dunning, Stripe-absent honesty, idempotency).
 *
 *   yarn smoke:memberships:p2
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
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const { createVenueLocation } = await import("../src/lib/venueLocations.ts");
  const {
    assertMembershipTransition,
    membershipBenefitsActive,
  } = await import("../src/lib/memberships/statusMachine.ts");
  const { computeProration } = await import(
    "../src/lib/memberships/proration.ts"
  );
  const {
    dunningExhausted,
    scheduleNextRetry,
    runMembershipsDunningTick,
  } = await import("../src/lib/memberships/dunning.ts");
  const {
    sellMembership,
    renewMembership,
    upgradeMembership,
    downgradeMembership,
    pauseMembership,
    resumeMembership,
    cancelMembership,
    reactivateMembership,
    applyCredit,
  } = await import("../src/lib/memberships/billingEngine.ts");
  const { createMembershipPlan } = await import(
    "../src/lib/memberships/plans.ts"
  );
  const { createGuestProfile } = await import(
    "../src/lib/memberships/guests.ts"
  );
  const { MembershipBillingError, MembershipErrorCodes } = await import(
    "../src/lib/memberships/errors.ts"
  );
  const { isStripeConfigured } = await import(
    "../src/lib/memberships/stripeGuest.ts"
  );
  const { handleGuestMembershipStripeEvent } = await import(
    "../src/lib/memberships/webhookGuest.ts"
  );

  // --- Unit: status machine ---
  try {
    assertMembershipTransition("active", "past_due");
    assertMembershipTransition("past_due", "active");
    check("status-active-past_due", true);
  } catch {
    check("status-active-past_due", false);
  }
  try {
    assertMembershipTransition("cancelled", "paused");
    check("status-invalid-cancelled-paused", false);
  } catch (err) {
    check(
      "status-invalid-cancelled-paused",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.INVALID_TRANSITION
    );
  }
  check("benefits-only-active", membershipBenefitsActive("active") === true);
  check("benefits-paused-off", membershipBenefitsActive("paused") === false);

  // --- Unit: proration ---
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-31T00:00:00Z");
  const mid = new Date("2026-01-16T00:00:00Z");
  const last = new Date("2026-01-30T12:00:00Z");
  const atStart = computeProration({
    oldPriceMajor: 100,
    newPriceMajor: 200,
    periodStart: start,
    periodEnd: end,
    asOf: start,
  });
  check(
    "proration-start-full",
    Math.abs(atStart.amountDueMajor - 100) < 0.02,
    String(atStart.amountDueMajor)
  );
  const atMid = computeProration({
    oldPriceMajor: 100,
    newPriceMajor: 200,
    periodStart: start,
    periodEnd: end,
    asOf: mid,
  });
  check(
    "proration-mid-halfish",
    atMid.fractionRemaining > 0.4 && atMid.fractionRemaining < 0.6,
    String(atMid.fractionRemaining)
  );
  const atLast = computeProration({
    oldPriceMajor: 100,
    newPriceMajor: 200,
    periodStart: start,
    periodEnd: end,
    asOf: last,
  });
  check(
    "proration-last-day-small",
    atLast.amountDueMajor < 20,
    String(atLast.amountDueMajor)
  );
  const down = computeProration({
    oldPriceMajor: 200,
    newPriceMajor: 100,
    periodStart: start,
    periodEnd: end,
    asOf: mid,
  });
  check("proration-downgrade-credit", down.amountDueMajor < 0);

  // --- Unit: dunning schedule ---
  check("dunning-not-exhausted-1", !dunningExhausted(1, 7));
  check("dunning-exhausted-4", dunningExhausted(4, 7));
  const next = scheduleNextRetry(new Date("2026-01-01T00:00:00Z"), 1, 7);
  check("dunning-next-day3", Boolean(next && next.getUTCDate() === 4));
  const { gapDaysUntilNextRetry } = await import(
    "../src/lib/memberships/dunning.ts"
  );
  check("dunning-gap-first", gapDaysUntilNextRetry(1, 7) === 3);
  check("dunning-gap-second", gapDaysUntilNextRetry(2, 7) === 2);

  // --- Integration ---
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mem-p2-${stamp}@test.local`,
      password: "x",
      username: `smokememp2${stamp}`,
      firstName: "Mem",
      lastName: "P2",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem P2 ${stamp}`,
    slug: `smoke-mem-p2-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const actor = { orgId, sub: user.id };

  const venue = await createVenueLocation(actor, {
    name: `Park P2 ${stamp}`,
    slug: `park-p2-${stamp}`,
  });

  const planLow = await createMembershipPlan(actor, {
    name: `Basic ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 50,
    currency: "USD",
    upgradeGroupKey: `grp-${stamp}`,
  });
  const planHigh = await createMembershipPlan(actor, {
    name: `Premium ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 100,
    currency: "USD",
    upgradeGroupKey: `grp-${stamp}`,
  });
  const guest = await createGuestProfile(actor, {
    firstName: "Ada",
    lastName: "Member",
    email: `ada_p2_${stamp}@example.com`,
  });

  check("stripe-may-be-absent", typeof isStripeConfigured() === "boolean");

  const sellKey = `sell-${stamp}`;
  const sold = await sellMembership({
    orgId,
    locationId: venue.id,
    homeLocationId: venue.id,
    guestProfileId: guest.id,
    planId: planLow.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    actorUserId: user.id,
    idempotencyKey: sellKey,
    source: "admin",
  });
  check("sell-active", sold.membership.status === "active");

  const replay = await sellMembership({
    orgId,
    locationId: venue.id,
    homeLocationId: venue.id,
    guestProfileId: guest.id,
    planId: planLow.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    actorUserId: user.id,
    idempotencyKey: sellKey,
    source: "admin",
  });
  check(
    "sell-idempotent",
    replay.membership.id === sold.membership.id &&
      replay.note === "idempotent_replay"
  );

  const guest2 = await createGuestProfile(actor, {
    firstName: "Bob",
    lastName: "Pending",
    email: `bob_p2_${stamp}@example.com`,
  });
  if (!isStripeConfigured()) {
    let stripePendingOk = false;
    try {
      await sellMembership({
        orgId,
        locationId: venue.id,
        homeLocationId: venue.id,
        guestProfileId: guest2.id,
        planId: planLow.id,
        paymentMethod: "stripe",
        actorUserId: user.id,
        idempotencyKey: `stripe-fail-${stamp}`,
        source: "admin",
      });
    } catch (err) {
      stripePendingOk =
        err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.STRIPE_NOT_CONFIGURED;
    }
    check("stripe-absent-throws-without-allow", stripePendingOk);
    const pendingSell = await sellMembership({
      orgId,
      locationId: venue.id,
      homeLocationId: venue.id,
      guestProfileId: guest2.id,
      planId: planLow.id,
      paymentMethod: "stripe",
      actorUserId: user.id,
      idempotencyKey: `stripe-pending-${stamp}`,
      source: "admin",
      allowPendingWithoutStripe: true,
    });
    check(
      "stripe-absent-pending-path",
      pendingSell.membership.status === "pending"
    );
  } else {
    check("stripe-absent-throws-without-allow", true, "skipped");
    check("stripe-absent-pending-path", true, "skipped");
  }

  const upgraded = await upgradeMembership({
    orgId,
    membershipId: sold.membership.id,
    newPlanId: planHigh.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    idempotencyKey: `up-${stamp}`,
  });
  check("upgrade-plan", upgraded.membership.planId === planHigh.id);

  const downgraded = await downgradeMembership({
    orgId,
    membershipId: sold.membership.id,
    newPlanId: planLow.id,
    actorUserId: user.id,
    idempotencyKey: `down-${stamp}`,
  });
  check(
    "downgrade-credit",
    downgraded.membership.planId === planLow.id &&
      downgraded.membership.creditBalanceMinor > 0
  );

  const credited = await applyCredit({
    orgId,
    membershipId: sold.membership.id,
    actorUserId: user.id,
    amountMajor: 5,
    reason: "smoke",
    idempotencyKey: `credit-${stamp}`,
  });
  check(
    "apply-credit",
    credited.membership.creditBalanceMinor >
      downgraded.membership.creditBalanceMinor
  );

  const paused = await pauseMembership({
    orgId,
    membershipId: sold.membership.id,
    actorUserId: user.id,
  });
  check("pause", paused.membership.status === "paused");

  const resumed = await resumeMembership({
    orgId,
    membershipId: sold.membership.id,
    actorUserId: user.id,
  });
  check("resume", resumed.membership.status === "active");

  const renewed = await renewMembership({
    orgId,
    membershipId: sold.membership.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    idempotencyKey: `renew-${stamp}`,
  });
  check("renew", renewed.membership.status === "active");

  const cancelledEop = await cancelMembership({
    orgId,
    membershipId: sold.membership.id,
    actorUserId: user.id,
    when: "end_of_period",
    reason: "smoke",
  });
  check(
    "cancel-eop",
    cancelledEop.membership.cancelAtPeriodEnd === true &&
      cancelledEop.membership.status === "active"
  );

  const guest3 = await createGuestProfile(actor, {
    firstName: "Cara",
    lastName: "Cancel",
  });
  const sold2 = await sellMembership({
    orgId,
    locationId: venue.id,
    homeLocationId: venue.id,
    guestProfileId: guest3.id,
    planId: planLow.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    actorUserId: user.id,
    idempotencyKey: `sell2-${stamp}`,
    source: "admin",
  });
  const cancelledNow = await cancelMembership({
    orgId,
    membershipId: sold2.membership.id,
    actorUserId: user.id,
    when: "immediate",
  });
  check("cancel-immediate", cancelledNow.membership.status === "cancelled");

  const reactivated = await reactivateMembership({
    orgId,
    membershipId: sold2.membership.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 50,
    idempotencyKey: `re-${stamp}`,
  });
  check("reactivate", reactivated.membership.status === "active");

  const fakeEvent = {
    id: `evt_smoke_${stamp}`,
    type: "invoice.paid",
    data: {
      object: {
        id: `in_smoke_${stamp}`,
        amount_paid: 5000,
        currency: "usd",
        metadata: { type: "guest_membership_subscription" },
      },
    },
  } as unknown as import("stripe").Stripe.Event;
  const wh = await handleGuestMembershipStripeEvent(fakeEvent);
  check("webhook-guest-unknown-handled", wh.handled === true);

  const tick = await runMembershipsDunningTick({ take: 10 });
  check(
    "dunning-tick-runs",
    typeof tick.pastDueTicked === "number" && typeof tick.expired === "number"
  );

  const otherPlan = await createMembershipPlan(actor, {
    name: `Other ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 120,
    currency: "USD",
    upgradeGroupKey: `other-${stamp}`,
  });
  try {
    await upgradeMembership({
      orgId,
      membershipId: sold.membership.id,
      newPlanId: otherPlan.id,
      actorUserId: user.id,
      paymentMethod: "collected",
      collectedAmount: 100,
      idempotencyKey: `bad-up-${stamp}`,
    });
    check("upgrade-group-deny", false);
  } catch (err) {
    check(
    "upgrade-group-deny",
    err instanceof MembershipBillingError &&
      err.code === MembershipErrorCodes.UPGRADE_GROUP_MISMATCH
    );
  }

  // Renew from cancelled must fail (use reactivate)
  try {
    await renewMembership({
      orgId,
      membershipId: sold.membership.id,
      actorUserId: user.id,
      paymentMethod: "collected",
      collectedAmount: 50,
      idempotencyKey: `renew-cancel-${stamp}`,
    });
    // sold still active with cancelAtPeriodEnd — force cancel first
    check("renew-while-active-ok-skip", true);
  } catch {
    check("renew-while-active-ok-skip", false);
  }
  await cancelMembership({
    orgId,
    membershipId: sold2.membership.id,
    actorUserId: user.id,
    when: "immediate",
  });
  try {
    await renewMembership({
      orgId,
      membershipId: sold2.membership.id,
      actorUserId: user.id,
      paymentMethod: "collected",
      collectedAmount: 50,
      idempotencyKey: `renew-bad-${stamp}`,
    });
    check("renew-from-cancelled-deny", false);
  } catch (err) {
    check(
      "renew-from-cancelled-deny",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.INVALID_TRANSITION
    );
  }

  // Webhook replay idempotency
  const { markMembershipPastDue, recoverMembershipFromPastDue } = await import(
    "../src/lib/memberships/dunning.ts"
  );
  const past1 = await markMembershipPastDue({
    guestMembershipId: sold.membership.id,
    orgId,
    amountMajor: 50,
    currency: "USD",
    stripeInvoiceId: `in_replay_${stamp}`,
    eventId: `evt_fail_${stamp}`,
  });
  const past2 = await markMembershipPastDue({
    guestMembershipId: sold.membership.id,
    orgId,
    amountMajor: 50,
    currency: "USD",
    stripeInvoiceId: `in_replay_${stamp}`,
    eventId: `evt_fail_${stamp}`,
  });
  check("webhook-fail-idempotent", past1.updated === true && past2.updated === false);
  const rec1 = await recoverMembershipFromPastDue({
    guestMembershipId: sold.membership.id,
    orgId,
    amountMajor: 50,
    currency: "USD",
    stripeInvoiceId: `in_replay_paid_${stamp}`,
    eventId: `evt_paid_${stamp}`,
  });
  const rec2 = await recoverMembershipFromPastDue({
    guestMembershipId: sold.membership.id,
    orgId,
    amountMajor: 50,
    currency: "USD",
    stripeInvoiceId: `in_replay_paid_${stamp}`,
    eventId: `evt_paid_${stamp}`,
  });
  check(
    "webhook-recover-idempotent",
    rec1.updated === true && rec2.updated === false
  );

  // Demo org cannot sell
  const demoUser = await prisma.user.create({
    data: {
      email: `smoke-mem-p2-demo-${stamp}@test.local`,
      password: "x",
      username: `smokememp2d${stamp}`,
      firstName: "Demo",
      lastName: "Mem",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const demoOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem P2 Demo ${stamp}`,
    slug: `smoke-mem-p2-demo-${stamp}`,
    userId: demoUser.id,
  });
  await prisma.organization.update({
    where: { id: demoOrg.organization.id },
    data: {
      status: "active",
      subscriptionPlan: "demo",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { DEMO_FEATURE_LOCKED_MESSAGE } = await import(
    "../src/lib/demoPlanLock.ts"
  );
  let demoDenied = false;
  try {
    await sellMembership({
      orgId: demoOrg.organization.id,
      locationId: venue.id,
      homeLocationId: venue.id,
      guestProfileId: guest.id,
      planId: planLow.id,
      paymentMethod: "collected",
      collectedAmount: 50,
      actorUserId: demoUser.id,
      idempotencyKey: `demo-sell-${stamp}`,
      source: "admin",
    });
  } catch (err) {
    demoDenied =
      err instanceof ForbiddenError &&
      String(err.message).includes(DEMO_FEATURE_LOCKED_MESSAGE.slice(0, 12));
  }
  check("demo-sell-deny", demoDenied);

  // Upgrade idempotent replay (use a fresh higher plan so prior up/down leaves are irrelevant)
  const planElite = await createMembershipPlan(actor, {
    name: `Elite ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 250,
    currency: "USD",
    upgradeGroupKey: `grp-${stamp}`,
  });
  const upKey = `up-idem-${stamp}`;
  const up1 = await upgradeMembership({
    orgId,
    membershipId: sold.membership.id,
    newPlanId: planElite.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 250,
    idempotencyKey: upKey,
  });
  const up2 = await upgradeMembership({
    orgId,
    membershipId: sold.membership.id,
    newPlanId: planElite.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 250,
    idempotencyKey: upKey,
  });
  check(
    "upgrade-idempotent",
    up2.note === "idempotent_replay" && up1.membership.planId === planElite.id
  );

  await prisma.guestMembership.updateMany({
    where: { orgId },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  console.log(`\nDone. failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
