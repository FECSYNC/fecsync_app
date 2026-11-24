/**
 * Memberships Phase 3 smoke — entitlementEngine, multi-venue, family,
 * wallet honesty, product→membership upgrade, concurrent redeem.
 *
 *   yarn smoke:memberships:p3
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
  const { createMembershipPlan } = await import(
    "../src/lib/memberships/plans.ts"
  );
  const { createGuestProfile } = await import(
    "../src/lib/memberships/guests.ts"
  );
  const { sellMembership } = await import(
    "../src/lib/memberships/billingEngine.ts"
  );
  const { putMembershipEligibility } = await import(
    "../src/lib/memberships/eligibility.ts"
  );
  const {
    verifyBenefits,
    consumeBenefit,
    redeemVisit,
    undoConsumeBenefit,
  } = await import("../src/lib/memberships/entitlementEngine.ts");
  const { computeVisitStatus, applyLocalPerks } = await import(
    "../src/lib/memberships/multiVenueStatus.ts"
  );
  const { generateMembershipWalletPass } = await import(
    "../src/lib/memberships/walletPass.ts"
  );
  const { posUpgradeProductToMembership } = await import(
    "../src/lib/memberships/posAdapter.ts"
  );
  const { setFamilyLinks } = await import("../src/lib/memberships/family.ts");
  const { MembershipBillingError, MembershipErrorCodes } = await import(
    "../src/lib/memberships/errors.ts"
  );

  // --- Unit: multi-venue labels ---
  check(
    "label-CURRENT",
    computeVisitStatus({
      homeLocationId: "home",
      actingLocationId: "home",
      eligibility: null,
    }).visitStatus === "CURRENT"
  );
  check(
    "label-VISITING",
    computeVisitStatus({
      homeLocationId: "home",
      actingLocationId: "park-b",
      eligibility: { eligible: true },
    }).visitStatus === "VISITING"
  );
  check(
    "label-INELIGIBLE-no-row",
    computeVisitStatus({
      homeLocationId: "home",
      actingLocationId: "park-c",
      eligibility: null,
    }).visitStatus === "INELIGIBLE"
  );
  check(
    "label-INELIGIBLE-false",
    computeVisitStatus({
      homeLocationId: "home",
      actingLocationId: "park-d",
      eligibility: { eligible: false },
    }).visitStatus === "INELIGIBLE"
  );
  check(
    "local-perk-remove",
    applyLocalPerks({
      planPerks: ["locker", "towel"],
      localPerksAdd: ["guest"],
      localPerksRemove: ["towel"],
    }).join(",") === "locker,guest"
  );

  // --- Integration ---
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mem-p3-${stamp}@test.local`,
      password: "x",
      username: `smokememp3${stamp}`,
      firstName: "Mem",
      lastName: "P3",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem P3 ${stamp}`,
    slug: `smoke-mem-p3-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "enterprise",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const actor = { orgId, sub: user.id };

  const parkA = await createVenueLocation(actor, {
    name: `Park A ${stamp}`,
    slug: `park-a-${stamp}`,
  });
  const parkB = await createVenueLocation(actor, {
    name: `Park B ${stamp}`,
    slug: `park-b-${stamp}`,
  });
  const parkC = await createVenueLocation(actor, {
    name: `Park C ${stamp}`,
    slug: `park-c-${stamp}`,
  });

  const plan = await createMembershipPlan(actor, {
    name: `P3 Plan ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 40,
    currency: "USD",
    familyAllowed: true,
    entitlements: {
      entriesPerPeriod: 3,
      discountPercent: 10,
      guestCount: 4,
      perkFlags: ["locker", "towel"],
      freeProductRefs: [],
    },
  });

  await putMembershipEligibility(actor, {
    planId: plan.id,
    rows: [
      {
        locationId: parkB.id,
        eligible: true,
        localPerksAdd: ["cafe"],
        localPerksRemove: ["towel"],
      },
      { locationId: parkC.id, eligible: false },
    ],
  });

  const primary = await createGuestProfile(actor, {
    firstName: "Pat",
    lastName: "Primary",
    email: `pat_p3_${stamp}@example.com`,
  });
  const dep1 = await createGuestProfile(actor, {
    firstName: "Dep",
    lastName: "One",
    email: `dep1_p3_${stamp}@example.com`,
  });
  const dep2 = await createGuestProfile(actor, {
    firstName: "Dep",
    lastName: "Two",
    email: `dep2_p3_${stamp}@example.com`,
  });

  const sold = await sellMembership({
    orgId,
    locationId: parkA.id,
    homeLocationId: parkA.id,
    guestProfileId: primary.id,
    planId: plan.id,
    paymentMethod: "collected",
    collectedAmount: 40,
    actorUserId: user.id,
    idempotencyKey: `p3-sell-${stamp}`,
    source: "admin",
    familyMemberIds: [dep1.id],
  });
  check("sell-active", sold.membership.status === "active");
  const memberId = sold.membership.id;

  // Ensure period window for usage counting
  const now = new Date();
  await prisma.guestMembership.update({
    where: { id: memberId },
    data: {
      currentPeriodStart: new Date(now.getTime() - 86400000),
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
      startsAt: new Date(now.getTime() - 86400000),
      endsAt: new Date(now.getTime() + 30 * 86400000),
    },
  });

  // Multi-venue verify matrix
  const atHome = await verifyBenefits(memberId, parkA.id, { orgId });
  check("verify-CURRENT", atHome.visitStatus === "CURRENT" && !atHome.blocked);
  check(
    "verify-home-perks",
    atHome.perks.includes("locker") && atHome.perks.includes("towel")
  );

  const atB = await verifyBenefits(memberId, parkB.id, { orgId });
  check("verify-VISITING", atB.visitStatus === "VISITING" && !atB.blocked);
  check(
    "verify-local-perk-remove",
    atB.perks.includes("locker") &&
      atB.perks.includes("cafe") &&
      !atB.perks.includes("towel"),
    atB.perks.join(",")
  );

  const atC = await verifyBenefits(memberId, parkC.id, { orgId });
  check(
    "verify-INELIGIBLE",
    atC.visitStatus === "INELIGIBLE" &&
      atC.blocked &&
      atC.blockReason === "ineligible_venue"
  );

  // Local perk consume blocked for removed perk at B
  try {
    await consumeBenefit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkB.id,
      kind: "perk_consumed",
      perkFlag: "towel",
      actorUserId: user.id,
      source: "admin",
    });
    check("perk-remove-blocks", false);
  } catch (err) {
    check(
      "perk-remove-blocks",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.PERK_NOT_AVAILABLE
    );
  }

  // Visiting redeem
  const visitB = await redeemVisit({
    orgId,
    guestMembershipId: memberId,
    locationId: parkB.id,
    actorUserId: user.id,
    source: "admin",
  });
  check(
    "redeem-visiting",
    visitB.visitStatus === "VISITING" && visitB.remainingEntries === 2
  );

  // Family shared cap — add second dependent and redeem two guests
  await setFamilyLinks(actor, memberId, {
    guestProfileIds: [dep1.id, dep2.id],
  });
  const familyRedeem = await redeemVisit({
    orgId,
    guestMembershipId: memberId,
    locationId: parkA.id,
    guestProfileIds: [dep1.id, dep2.id],
    actorUserId: user.id,
    source: "admin",
  });
  check(
    "family-shared-cap",
    familyRedeem.remainingEntries === 0 && familyRedeem.events.length === 2,
    `remaining=${familyRedeem.remainingEntries} events=${familyRedeem.events.length}`
  );

  // Exhaustion
  try {
    await redeemVisit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      actorUserId: user.id,
      source: "admin",
    });
    check("entitlement-exhaustion", false);
  } catch (err) {
    check(
      "entitlement-exhaustion",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.ENTITLEMENT_EXHAUSTED
    );
  }

  // Undo one event to free capacity, then concurrent double-redeem
  const undo = await undoConsumeBenefit({
    orgId,
    usageEventId: familyRedeem.events[0].id,
    actorUserId: user.id,
    source: "admin",
  });
  check("undo-frees-slot", undo.remainingEntries === 1);

  const mid = await verifyBenefits(memberId, parkA.id, { orgId });
  check("remaining-after-undo", mid.remainingEntries === 1);

  const results = await Promise.allSettled([
    redeemVisit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      actorUserId: user.id,
      source: "admin",
      idempotencyKey: `conc-a-${stamp}`,
    }),
    redeemVisit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      actorUserId: user.id,
      source: "admin",
      idempotencyKey: `conc-b-${stamp}`,
    }),
  ]);
  const successes = results.filter((r) => r.status === "fulfilled").length;
  const failures = results.filter((r) => r.status === "rejected").length;
  check(
    "concurrent-double-redeem",
    successes === 1 && failures === 1,
    `ok=${successes} fail=${failures}`
  );

  // Wallet honest not_configured
  const wallet = await generateMembershipWalletPass({
    orgId,
    guestMembershipId: memberId,
  });
  check(
    "wallet-not-configured",
    wallet.status === "not_configured" &&
      Boolean(wallet.digitalCard?.qrPayload || wallet.digitalCard?.customMembershipId)
  );

  // Discount / perk still available after visit exhaustion
  const { applyMembershipDiscount } = await import(
    "../src/lib/memberships/entitlementEngine.ts"
  );
  // Exhaust member fully if concurrent left remaining somehow
  let exhaustedVerify = await verifyBenefits(memberId, parkA.id, { orgId });
  while (
    exhaustedVerify.remainingEntries != null &&
    exhaustedVerify.remainingEntries > 0
  ) {
    await redeemVisit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      actorUserId: user.id,
      source: "admin",
    });
    exhaustedVerify = await verifyBenefits(memberId, parkA.id, { orgId });
  }
  check(
    "exhausted-not-hard-blocked",
    exhaustedVerify.visitsExhausted === true && exhaustedVerify.blocked === false,
    `blocked=${exhaustedVerify.blocked} exhausted=${exhaustedVerify.visitsExhausted}`
  );
  const disc = await applyMembershipDiscount({
    guestMembershipId: memberId,
    locationId: parkA.id,
    amountMajor: 100,
    orgId,
  });
  check(
    "discount-after-exhaustion",
    disc.allowed === true && disc.discountAmount === 10,
    String(disc.discountAmount)
  );
  try {
    await consumeBenefit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      kind: "perk_consumed",
      perkFlag: "locker",
      actorUserId: user.id,
      source: "admin",
    });
    check("perk-after-exhaustion", true);
  } catch {
    check("perk-after-exhaustion", false);
  }
  try {
    await consumeBenefit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      kind: "free_product",
      meta: { freeProductRef: "not-on-plan" },
      actorUserId: user.id,
      source: "admin",
    });
    check("free-product-invalid-ref", false);
  } catch (err) {
    check(
      "free-product-invalid-ref",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.PERK_NOT_AVAILABLE
    );
  }

  // Product → membership upgrade idempotency
  const upgradeGuest = await createGuestProfile(actor, {
    firstName: "Up",
    lastName: "Grade",
    email: `up_p3_${stamp}@example.com`,
  });
  const lineId = `sale-line-${stamp}`;
  const up1 = await posUpgradeProductToMembership({
    orgId,
    actorUserId: user.id,
    posSaleLineId: lineId,
    guestProfileId: upgradeGuest.id,
    planId: plan.id,
    locationId: parkA.id,
    homeLocationId: parkA.id,
    paymentMethod: "collected",
    collectedAmount: 40,
    originalProductRef: "sku-daypass",
    originalProductName: "Day Pass",
  });
  const up2 = await posUpgradeProductToMembership({
    orgId,
    actorUserId: user.id,
    posSaleLineId: lineId,
    guestProfileId: upgradeGuest.id,
    planId: plan.id,
    locationId: parkA.id,
    homeLocationId: parkA.id,
    paymentMethod: "collected",
    collectedAmount: 40,
    originalProductRef: "sku-daypass",
  });
  check(
    "upgrade-product-idempotent",
    up1.membership.id === up2.membership.id,
    up1.membership.id
  );

  // Ineligible redeem failure
  try {
    // Reset remaining by adjusting period usage — create fresh member for clean test
    const g2 = await createGuestProfile(actor, {
      firstName: "In",
      lastName: "Elig",
      email: `inel_p3_${stamp}@example.com`,
    });
    const m2 = await sellMembership({
      orgId,
      locationId: parkA.id,
      homeLocationId: parkA.id,
      guestProfileId: g2.id,
      planId: plan.id,
      paymentMethod: "collected",
      collectedAmount: 40,
      actorUserId: user.id,
      idempotencyKey: `p3-inel-${stamp}`,
      source: "admin",
    });
    await prisma.guestMembership.update({
      where: { id: m2.membership.id },
      data: {
        currentPeriodStart: new Date(now.getTime() - 86400000),
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
      },
    });
    await redeemVisit({
      orgId,
      guestMembershipId: m2.membership.id,
      locationId: parkC.id,
      actorUserId: user.id,
      source: "admin",
    });
    check("redeem-ineligible-fails", false);
  } catch (err) {
    check(
      "redeem-ineligible-fails",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.INELIGIBLE_VENUE
    );
  }

  // Cleanup soft — leave org for debugging if needed
  console.log(`\nDone. failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
