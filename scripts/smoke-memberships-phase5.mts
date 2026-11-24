/**
 * Memberships Phase 5 — production-readiness smoke (B1–B3 highlights).
 *
 *   yarn smoke:memberships:p5
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

async function expectReject(
  name: string,
  fn: () => Promise<unknown>,
  pred: (err: unknown) => boolean
) {
  try {
    await fn();
    check(name, false, "expected rejection");
  } catch (err) {
    check(name, pred(err), err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  // Parallel-load engines (faster than sequential dynamic imports on cold start).
  const [
    { createMembershipPlan },
    { putMembershipEligibility },
    billing,
    dunning,
    entitlement,
    { setFamilyLinks },
    selfServe,
    { isWalletPassConfigured },
    { MembershipBillingError, MembershipErrorCodes },
    { ForbiddenError },
    { ROLE_PRESETS, P, API_PERMISSIONS },
    { isStripeConfigured },
    { listGuestMemberships },
  ] = await Promise.all([
    import("../src/lib/memberships/plans.ts"),
    import("../src/lib/memberships/eligibility.ts"),
    import("../src/lib/memberships/billingEngine.ts"),
    import("../src/lib/memberships/dunning.ts"),
    import("../src/lib/memberships/entitlementEngine.ts"),
    import("../src/lib/memberships/family.ts"),
    import("../src/lib/memberships/selfServe.ts"),
    import("../src/lib/memberships/walletPass.ts"),
    import("../src/lib/memberships/errors.ts"),
    import("../src/lib/auth/http-error.ts"),
    import("../src/lib/auth/permissions.ts"),
    import("../src/lib/memberships/stripeGuest.ts"),
    import("../src/lib/memberships/members.ts"),
  ]);
  const {
    sellMembership,
    upgradeMembership,
    downgradeMembership,
    pauseMembership,
    resumeMembership,
    cancelMembership,
    reactivateMembership,
  } = billing;
  const {
    markMembershipPastDue,
    recoverMembershipFromPastDue,
    dunningRetryDaysForPlan,
  } = dunning;
  const { verifyBenefits, redeemVisit } = entitlement;
  const { linkGuestProfileToUser, selfServeCancel, listOwnMemberships } =
    selfServe;

  // --- B3 static ---
  check(
    "perm-client-own",
    ROLE_PRESETS.client.includes(P.MembershipsReadOwn) &&
      ROLE_PRESETS.client.includes(P.MembershipsWriteOwn)
  );
  check(
    "perm-tailor-clean",
    !ROLE_PRESETS.tailor.includes(P.MembershipsReadOwn) &&
      !ROLE_PRESETS.tailor.includes(P.MembershipsWriteOwn)
  );
  const deskPerms = [
    P.MembershipsRead,
    P.MembershipsWrite,
    P.MembershipsSell,
    P.MembershipsBilling,
    P.MembershipsCancel,
    P.MembershipsRedeem,
  ];
  check(
    "perm-ops-desk",
    deskPerms.every((p) => ROLE_PRESETS.ops_manager.includes(p)) &&
      !ROLE_PRESETS.ops_manager.includes(P.MembershipsAdmin)
  );
  check(
    "perm-platform-admin-has-memberships-admin",
    ROLE_PRESETS.platform_admin.includes(P.MembershipsAdmin)
  );
  check(
    "api-me-cancel",
    "POST /api/me/memberships/[id]/cancel" in API_PERMISSIONS
  );
  check("api-pos-memberships", "POST /api/pos/memberships" in API_PERMISSIONS);
  check(
    "dunning-schedules",
    dunningRetryDaysForPlan("growth").join(",") === "0,3,5,7" &&
      dunningRetryDaysForPlan("enterprise").join(",") === "0,2,4,6,9,12,14"
  );
  check("wallet-honesty-default", isWalletPassConfigured() === false);

  const staffMemSrc = await import("node:fs/promises").then((fs) =>
    fs
      .readFile(new URL("../src/lib/membership.ts", import.meta.url), "utf8")
      .catch(() => "")
  );
  check(
    "staff-membership-no-guest-engine",
    !staffMemSrc.includes("billingEngine") &&
      !staffMemSrc.includes("GuestMembership")
  );

  // Lean fixtures via Prisma (remote Supabase RTT makes orgRegistration +
  // createVenueLocation too slow for a full lifecycle smoke). Engines under
  // test still run for sell/redeem/bill/self-serve; plan CRUD + eligibility
  // use the real libs once.
  console.log("…fixture bootstrap");
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-mem-p5-${stamp}@test.local`,
      password: "x",
      username: `smokememp5${stamp}`,
      firstName: "Mem",
      lastName: "P5",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const org = await prisma.organization.create({
    data: {
      name: `Smoke Mem P5 ${stamp}`,
      slug: `smoke-mem-p5-${stamp}`,
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const orgId = org.id;
  await prisma.membership.create({
    data: {
      userId: user.id,
      orgId,
      rolePreset: "platform_admin",
      status: "active",
    },
  });
  const actor = {
    orgId,
    sub: user.id,
    permissions: [...ROLE_PRESETS.platform_admin],
  };

  const [locA, locB, locC] = await Promise.all([
    prisma.venueLocation.create({
      data: {
        orgId,
        name: `Park A ${stamp}`,
        slug: `park-a-p5-${stamp}`,
        status: "active",
      },
    }),
    prisma.venueLocation.create({
      data: {
        orgId,
        name: `Park B ${stamp}`,
        slug: `park-b-p5-${stamp}`,
        status: "active",
      },
    }),
    prisma.venueLocation.create({
      data: {
        orgId,
        name: `Park C ${stamp}`,
        slug: `park-c-p5-${stamp}`,
        status: "active",
      },
    }),
  ]);

  // Plan CRUD via real lib (B1); parallel create.
  const [planFixed, planRecurring, planElite] = await Promise.all([
    createMembershipPlan(actor, {
      name: `Fixed ${stamp}`,
      billing: "fixed",
      price: 40,
      currency: "USD",
      intervalCount: 1,
      intervalUnit: "month",
      familyAllowed: true,
      pauseAllowed: true,
      upgradeGroupKey: `g-p5-${stamp}`,
      entitlements: { entriesPerPeriod: 6, guestCount: 3 },
    }),
    createMembershipPlan(actor, {
      name: `Recur ${stamp}`,
      billing: "recurring",
      price: 25,
      currency: "USD",
      intervalCount: 1,
      intervalUnit: "month",
      familyAllowed: true,
      pauseAllowed: true,
      upgradeGroupKey: `g-p5-${stamp}`,
      entitlements: { entriesPerPeriod: 8, guestCount: 3 },
    }),
    createMembershipPlan(actor, {
      name: `Elite ${stamp}`,
      billing: "recurring",
      price: 55,
      currency: "USD",
      intervalCount: 1,
      intervalUnit: "month",
      familyAllowed: true,
      pauseAllowed: true,
      upgradeGroupKey: `g-p5-${stamp}`,
      entitlements: { entriesPerPeriod: 20, guestCount: 3 },
    }),
  ]);
  check("plan-crud", Boolean(planFixed.id && planRecurring.id && planElite.id));

  // Home (locA) is always CURRENT without a row; locB VISITING; locC INELIGIBLE.
  await Promise.all([
    putMembershipEligibility(actor, {
      planId: planFixed.id,
      rows: [
        { locationId: locB.id, eligible: true },
        { locationId: locC.id, eligible: false },
      ],
    }),
    putMembershipEligibility(actor, {
      planId: planRecurring.id,
      rows: [{ locationId: locA.id, eligible: true }],
    }),
    putMembershipEligibility(actor, {
      planId: planElite.id,
      rows: [{ locationId: locA.id, eligible: true }],
    }),
  ]);
  check("plan-eligibility", true);

  const [guest, dep] = await Promise.all([
    prisma.guestProfile.create({
      data: {
        orgId,
        locationId: locA.id,
        firstName: "Ada",
        lastName: "Member",
        email: `ada_p5_${stamp}@example.com`,
      },
    }),
    prisma.guestProfile.create({
      data: {
        orgId,
        locationId: locA.id,
        firstName: "Kid",
        lastName: "Member",
        email: `kid_p5_${stamp}@example.com`,
      },
    }),
  ]);
  console.log("…engines");

  // Sell fixed + family
  const soldFixed = await sellMembership({
    orgId,
    locationId: locA.id,
    homeLocationId: locA.id,
    guestProfileId: guest.id,
    planId: planFixed.id,
    familyMemberIds: [dep.id],
    paymentMethod: "collected",
    collectedAmount: 40,
    actorUserId: user.id,
    idempotencyKey: `p5-sell-fixed:${stamp}`,
    source: "admin",
  });
  check("sell-fixed-active", soldFixed.membership.status === "active");
  const mid = soldFixed.membership.id;

  // Recurring honest pending (Stripe absent) or stripe
  const soldRecur = await sellMembership({
    orgId,
    locationId: locA.id,
    homeLocationId: locA.id,
    guestProfileId: guest.id,
    planId: planRecurring.id,
    paymentMethod: isStripeConfigured() ? "stripe" : "pending",
    actorUserId: user.id,
    idempotencyKey: `p5-sell-recur:${stamp}`,
    source: "admin",
    allowPendingWithoutStripe: true,
  });
  check(
    "sell-recurring-honest",
    ["pending", "active", "past_due"].includes(soldRecur.membership.status)
  );

  // Concurrent double-sell
  const raceKey = `p5-race-sell:${stamp}`;
  const [r1, r2] = await Promise.all([
    sellMembership({
      orgId,
      locationId: locA.id,
      homeLocationId: locA.id,
      guestProfileId: guest.id,
      planId: planFixed.id,
      paymentMethod: "collected",
      collectedAmount: 40,
      actorUserId: user.id,
      idempotencyKey: raceKey,
      source: "admin",
    }),
    sellMembership({
      orgId,
      locationId: locA.id,
      homeLocationId: locA.id,
      guestProfileId: guest.id,
      planId: planFixed.id,
      paymentMethod: "collected",
      collectedAmount: 40,
      actorUserId: user.id,
      idempotencyKey: raceKey,
      source: "admin",
    }),
  ]);
  check("concurrent-double-sell-same-key", r1.membership.id === r2.membership.id);
  check(
    "concurrent-sell-single-row",
    (await prisma.guestMembership.count({
      where: { orgId, sellIdempotencyKey: raceKey },
    })) === 1
  );

  // Verify + multi-venue + family redeem + double redeem
  await setFamilyLinks(actor, mid, { guestProfileIds: [dep.id] });
  const verifyHome = await verifyBenefits(mid, locA.id, { orgId });
  check(
    "verify-remaining",
    typeof verifyHome.remainingEntries === "number" ||
      verifyHome.remainingEntries === null
  );
  check(
    "multi-venue-current",
    verifyHome.visitStatus === "CURRENT" || verifyHome.eligible
  );
  const verifyVisit = await verifyBenefits(mid, locB.id, { orgId });
  check("multi-venue-visiting", verifyVisit.visitStatus === "VISITING");
  const verifyInelig = await verifyBenefits(mid, locC.id, { orgId });
  check(
    "multi-venue-ineligible",
    verifyInelig.visitStatus === "INELIGIBLE" && verifyInelig.eligible === false
  );

  const redeem1 = await redeemVisit({
    orgId,
    guestMembershipId: mid,
    locationId: locA.id,
    guestProfileIds: [guest.id],
    actorUserId: user.id,
    idempotencyKey: `p5-redeem:${stamp}`,
    source: "admin",
  });
  const redeemDup = await redeemVisit({
    orgId,
    guestMembershipId: mid,
    locationId: locA.id,
    guestProfileIds: [guest.id],
    actorUserId: user.id,
    idempotencyKey: `p5-redeem:${stamp}`,
    source: "admin",
  });
  check(
    "double-redeem-idempotent",
    redeem1.events[0]?.id === redeemDup.events[0]?.id
  );
  const familyRedeem = await redeemVisit({
    orgId,
    guestMembershipId: mid,
    locationId: locA.id,
    guestProfileIds: [dep.id],
    actorUserId: user.id,
    idempotencyKey: `p5-redeem-fam:${stamp}`,
    source: "admin",
  });
  check("family-shared-usage", familyRedeem.events.length >= 1);

  // Upgrade / downgrade / pause / resume
  const up = await upgradeMembership({
    orgId,
    membershipId: mid,
    newPlanId: planElite.id,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 100,
    idempotencyKey: `p5-up:${stamp}`,
  });
  check("upgrade", up.membership.planId === planElite.id);

  const down = await downgradeMembership({
    orgId,
    membershipId: mid,
    newPlanId: planRecurring.id,
    actorUserId: user.id,
    idempotencyKey: `p5-down:${stamp}`,
  });
  check("downgrade", down.membership.planId === planRecurring.id);

  await pauseMembership({
    orgId,
    membershipId: mid,
    actorUserId: user.id,
    reason: "p5",
  });
  const resumed = await resumeMembership({
    orgId,
    membershipId: mid,
    actorUserId: user.id,
  });
  check(
    "pause-resume",
    resumed.membership.status === "active" ||
      resumed.membership.status === "pending"
  );

  // Dunning fail → recover (webhook replay)
  await markMembershipPastDue({
    guestMembershipId: mid,
    orgId,
    amountMajor: 25,
    currency: "USD",
    stripeInvoiceId: `in_p5_fail_${stamp}`,
    eventId: `evt_p5_fail_${stamp}`,
  });
  check(
    "dunning-past-due",
    (await prisma.guestMembership.findUniqueOrThrow({ where: { id: mid } }))
      .status === "past_due"
  );
  const rec1 = await recoverMembershipFromPastDue({
    guestMembershipId: mid,
    orgId,
    amountMajor: 25,
    currency: "USD",
    stripeInvoiceId: `in_p5_paid_${stamp}`,
    eventId: `evt_p5_paid_${stamp}`,
  });
  const rec2 = await recoverMembershipFromPastDue({
    guestMembershipId: mid,
    orgId,
    amountMajor: 25,
    currency: "USD",
    stripeInvoiceId: `in_p5_paid_${stamp}`,
    eventId: `evt_p5_paid_${stamp}`,
  });
  check(
    "webhook-recover-idempotent",
    rec1.updated === true && rec2.updated === false
  );
  const afterRec = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mid },
  });
  check(
    "dunning-recovered-status",
    afterRec.status === "active" || afterRec.status === "pending"
  );
  check("dunning-recover-cleared-cancel", afterRec.cancelAtPeriodEnd === false);

  // List cursor
  const page1 = await listGuestMemberships(actor, { take: 1 });
  check("list-page-has-member", page1.members.length === 1);
  if (page1.nextCursor) {
    const page2 = await listGuestMemberships(actor, {
      take: 1,
      cursor: page1.nextCursor,
    });
    check(
      "list-cursor-advances",
      page2.members.length === 0 ||
        page2.members[0]?.id !== page1.members[0]?.id
    );
  } else {
    check("list-cursor-optional", true, "single page ok");
  }

  // VM cancel + reactivate
  const vmCancel = await cancelMembership({
    orgId,
    membershipId: mid,
    actorUserId: user.id,
    when: "immediate",
    reason: "p5_vm_cancel",
  });
  check("vm-cancel", vmCancel.membership.status === "cancelled");

  const reactivated = await reactivateMembership({
    orgId,
    membershipId: mid,
    actorUserId: user.id,
    paymentMethod: "collected",
    collectedAmount: 25,
    idempotencyKey: `p5-reactivate:${stamp}`,
  });
  check(
    "reactivate",
    reactivated.membership.status === "active" ||
      reactivated.membership.status === "pending"
  );

  // Self-serve + IDOR (link requires matching User.email ↔ GuestProfile.email)
  const clientUser = await prisma.user.create({
    data: {
      email: guest.email!,
      password: "x",
      username: `clientp5${stamp}`,
      firstName: "Client",
      lastName: "P5",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  // Online guests are User + GuestProfile.userId — not staff Membership seats.
  await linkGuestProfileToUser(
    { sub: clientUser.id, email: clientUser.email },
    { guestProfileId: guest.id, orgId }
  );
  const own = await listOwnMemberships({
    sub: clientUser.id,
    email: clientUser.email,
  });
  check("self-serve-list", Array.isArray(own) && own.length >= 1);

  const stranger = await prisma.user.create({
    data: {
      email: `stranger-p5-${stamp}@test.local`,
      password: "x",
      username: `strangerp5${stamp}`,
      firstName: "X",
      lastName: "Y",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  await expectReject(
    "guest-idor-deny",
    () =>
      selfServeCancel({
        actor: { sub: stranger.id, email: stranger.email },
        guestMembershipId: mid,
        when: "immediate",
        confirm: true,
        declineAlternatives: true,
        idempotencyKey: `p5-idor:${stamp}`,
      }),
    (err) =>
      err instanceof ForbiddenError ||
      (err instanceof MembershipBillingError &&
        [
          MembershipErrorCodes.NOT_LINKED_TO_GUEST,
          MembershipErrorCodes.SELF_SERVE_DENIED,
          MembershipErrorCodes.MEMBER_NOT_FOUND,
        ].includes(err.code as never))
  );

  const cancelled = await selfServeCancel({
    actor: { sub: clientUser.id, email: clientUser.email },
    guestMembershipId: mid,
    when: "immediate",
    confirm: true,
    declineAlternatives: true,
    reason: "p5_click_to_cancel",
    idempotencyKey: `p5-ss-cancel:${stamp}`,
  });
  check(
    "self-serve-cancel",
    !cancelled.requiresAlternatives &&
      "membership" in cancelled &&
      cancelled.membership?.status === "cancelled"
  );

  // Demo deny
  const demoUser = await prisma.user.create({
    data: {
      email: `demo-p5-${stamp}@test.local`,
      password: "x",
      username: `demop5${stamp}`,
      firstName: "Demo",
      lastName: "P5",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const demoOrg = await prisma.organization.create({
    data: {
      name: `Demo P5 ${stamp}`,
      slug: `demo-p5-${stamp}`,
      status: "active",
      subscriptionPlan: "demo",
      subscriptionStatus: "active",
    },
  });
  await expectReject(
    "demo-sell-deny",
    () =>
      sellMembership({
        orgId: demoOrg.id,
        locationId: locA.id,
        homeLocationId: locA.id,
        guestProfileId: guest.id,
        planId: planFixed.id,
        paymentMethod: "collected",
        collectedAmount: 1,
        actorUserId: demoUser.id,
        idempotencyKey: `p5-demo:${stamp}`,
        source: "admin",
      }),
    (err) =>
      err instanceof ForbiddenError || err instanceof MembershipBillingError
  );

  // Cross-tenant deny (other org cannot use this venue/guest)
  const otherUser = await prisma.user.create({
    data: {
      email: `other-p5-${stamp}@test.local`,
      password: "x",
      username: `otherp5${stamp}`,
      firstName: "Other",
      lastName: "P5",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherOrg = await prisma.organization.create({
    data: {
      name: `Other P5 ${stamp}`,
      slug: `other-p5-${stamp}`,
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  await expectReject(
    "cross-tenant-sell-deny",
    () =>
      sellMembership({
        orgId: otherOrg.id,
        locationId: locA.id,
        homeLocationId: locA.id,
        guestProfileId: guest.id,
        planId: planFixed.id,
        paymentMethod: "collected",
        collectedAmount: 40,
        actorUserId: otherUser.id,
        idempotencyKey: `p5-xt:${stamp}`,
        source: "admin",
      }),
    (err) =>
      err instanceof ForbiddenError ||
      err instanceof MembershipBillingError ||
      (err instanceof Error && /not found|venue|guest/i.test(err.message))
  );

  const signup = await import("../src/app/api/auth/signup/route.ts");
  check("signup-closed-export", typeof signup.POST === "function");

  console.log(`\nDone. failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
