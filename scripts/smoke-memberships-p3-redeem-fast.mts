/**
 * Fast redeem-path check — only the hotspot that was timing out.
 *   npx tsx scripts/smoke-memberships-p3-redeem-fast.mts
 */
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
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
  const { redeemVisit, verifyBenefits } = await import(
    "../src/lib/memberships/entitlementEngine.ts"
  );
  const { setFamilyLinks } = await import("../src/lib/memberships/family.ts");
  const { MembershipBillingError, MembershipErrorCodes } = await import(
    "../src/lib/memberships/errors.ts"
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mem-p3f-${stamp}@test.local`,
      password: "x",
      username: `smokememp3f${stamp}`,
      firstName: "Mem",
      lastName: "P3F",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem P3F ${stamp}`,
    slug: `smoke-mem-p3f-${stamp}`,
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
    slug: `park-af-${stamp}`,
  });
  const parkB = await createVenueLocation(actor, {
    name: `Park B ${stamp}`,
    slug: `park-bf-${stamp}`,
  });

  const plan = await createMembershipPlan(actor, {
    name: `P3F Plan ${stamp}`,
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
    ],
  });

  const primary = await createGuestProfile(actor, {
    firstName: "Pat",
    lastName: "Primary",
    email: `pat-p3f-${stamp}@test.local`,
  });
  const dep1 = await createGuestProfile(actor, {
    firstName: "Dep",
    lastName: "One",
    email: `dep1-p3f-${stamp}@test.local`,
  });
  const dep2 = await createGuestProfile(actor, {
    firstName: "Dep",
    lastName: "Two",
    email: `dep2-p3f-${stamp}@test.local`,
  });

  const sold = await sellMembership({
    orgId,
    guestProfileId: primary.id,
    planId: plan.id,
    locationId: parkA.id,
    homeLocationId: parkA.id,
    paymentMethod: "collected",
    collectedAmount: 40,
    actorUserId: user.id,
    idempotencyKey: `p3f-sell-${stamp}`,
    familyMemberIds: [dep1.id],
    allowPendingWithoutStripe: true,
  });
  const memberId = sold.membership.id;
  check("sell-active", sold.membership.status === "active");

  const t0 = Date.now();
  const visitB = await redeemVisit({
    orgId,
    guestMembershipId: memberId,
    locationId: parkB.id,
    actorUserId: user.id,
    source: "admin",
  });
  check(
    "redeem-visiting",
    visitB.visitStatus === "VISITING" && visitB.remainingEntries === 2,
    `${Date.now() - t0}ms rem=${visitB.remainingEntries}`
  );

  await setFamilyLinks(actor, memberId, {
    guestProfileIds: [dep1.id, dep2.id],
  });
  const t1 = Date.now();
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
    `${Date.now() - t1}ms rem=${familyRedeem.remainingEntries} events=${familyRedeem.events.length}`
  );

  try {
    await redeemVisit({
      orgId,
      guestMembershipId: memberId,
      locationId: parkA.id,
      actorUserId: user.id,
      source: "admin",
    });
    check("exhaustion-blocks", false);
  } catch (err) {
    check(
      "exhaustion-blocks",
      err instanceof MembershipBillingError &&
        err.code === MembershipErrorCodes.ENTITLEMENT_EXHAUSTED
    );
  }

  const after = await verifyBenefits(memberId, parkA.id, { orgId });
  check(
    "discount-after-exhaustion",
    !after.blocked &&
      after.visitsExhausted === true &&
      after.discountPercent === 10
  );

  console.log(`Done. failed=${failed}`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
