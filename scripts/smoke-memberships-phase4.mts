/**
 * Memberships Phase 4 smoke — guest self-serve IDOR, click-to-cancel,
 * cancel alternatives (beta), agreement gate, reports totals, advanced dunning.
 *
 *   yarn smoke:memberships:p4
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

async function expectReject(
  name: string,
  fn: () => Promise<unknown>,
  predicate: (err: unknown) => boolean
) {
  try {
    await fn();
    check(name, false, "expected rejection");
  } catch (err) {
    check(
      name,
      predicate(err),
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    );
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
  const { createGuestProfile, getGuestProfileDetail } = await import(
    "../src/lib/memberships/guests.ts"
  );
  const { sellMembership, cancelMembership } = await import(
    "../src/lib/memberships/billingEngine.ts"
  );
  const {
    linkGuestProfileToUser,
    listOwnMemberships,
    getOwnMembershipDetail,
    selfServeCancel,
  } = await import("../src/lib/memberships/selfServe.ts");
  const { upsertCancelAlternative } = await import(
    "../src/lib/memberships/cancelAlternatives.ts"
  );
  const { signAgreementAsGuest } = await import(
    "../src/lib/memberships/agreements.ts"
  );
  const { getMembershipReports } = await import(
    "../src/lib/memberships/reports.ts"
  );
  const {
    dunningRetryDaysForPlan,
    markMembershipPastDue,
    listDunningWorkQueue,
  } = await import("../src/lib/memberships/dunning.ts");
  const { MembershipBillingError, MembershipErrorCodes } = await import(
    "../src/lib/memberships/errors.ts"
  );
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { ROLE_PRESETS, P, CLIENT_PROFILE_TAB_PERMISSIONS, API_PERMISSIONS } =
    await import("../src/lib/auth/permissions.ts");

  const isCode = (code: string) => (err: unknown) =>
    err instanceof MembershipBillingError && err.code === code;
  const isForbidden = (err: unknown) => err instanceof ForbiddenError;

  // --- Unit: permissions wiring ---
  check(
    "client-preset-has-memberships-own",
    ROLE_PRESETS.client.includes(P.MembershipsReadOwn) &&
      ROLE_PRESETS.client.includes(P.MembershipsWriteOwn)
  );
  check(
    "tailor-preset-lacks-memberships-own",
    !ROLE_PRESETS.tailor.includes(P.MembershipsReadOwn) &&
      !ROLE_PRESETS.tailor.includes(P.MembershipsWriteOwn)
  );
  check(
    "profile-tab-memberships",
    CLIENT_PROFILE_TAB_PERMISSIONS.memberships === P.MembershipsReadOwn
  );
  check(
    "api-rules-registered",
    [
      "GET /api/me/memberships",
      "POST /api/me/memberships/[id]/cancel",
      "GET /api/admin/memberships/reports",
      "GET /api/admin/memberships/dunning-queue",
      "POST /api/admin/memberships/cancel-alternatives",
    ].every((k) => k in API_PERMISSIONS)
  );

  // --- Unit: advanced dunning schedule differs by plan ---
  const growthDays = dunningRetryDaysForPlan("growth");
  const entDays = dunningRetryDaysForPlan("enterprise");
  check(
    "dunning-growth-vs-enterprise",
    growthDays.join(",") !== entDays.join(",") &&
      entDays.length > growthDays.length &&
      Math.max(...entDays) > Math.max(...growthDays),
    `growth=${growthDays.join("/")} enterprise=${entDays.join("/")}`
  );

  // --- Integration fixtures ---
  const stamp = Date.now();
  const mkUser = (tag: string) =>
    prisma.user.create({
      data: {
        email: `smoke-mem-p4-${tag}-${stamp}@test.local`,
        password: "x",
        username: `smokememp4${tag}${stamp}`,
        firstName: "Mem",
        lastName: tag.toUpperCase(),
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
  const owner = await mkUser("owner");
  const userA = await mkUser("a");
  const userB = await mkUser("b");

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem P4 ${stamp}`,
    slug: `smoke-mem-p4-${stamp}`,
    userId: owner.id,
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
  const staff = { orgId, sub: owner.id };
  const guestA = { sub: userA.id, orgId: null };
  const guestB = { sub: userB.id, orgId: null };

  const park = await createVenueLocation(staff, {
    name: `P4 Park ${stamp}`,
    slug: `p4-park-${stamp}`,
  });

  const plan = await createMembershipPlan(staff, {
    name: `P4 Plan ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 50,
    currency: "USD",
    entitlements: { entriesPerPeriod: 10, discountPercent: 5 },
  });
  const agreementPlan = await createMembershipPlan(staff, {
    name: `P4 Agreement Plan ${stamp}`,
    billing: "fixed",
    intervalCount: 1,
    intervalUnit: "month",
    price: 30,
    currency: "USD",
    agreementRequired: true,
    entitlements: { entriesPerPeriod: 4 },
  });

  const gA = await createGuestProfile(staff, {
    firstName: "Alice",
    lastName: "Guest",
    email: userA.email,
    locationId: park.id,
  });
  const gB = await createGuestProfile(staff, {
    firstName: "Bob",
    lastName: "Guest",
    email: userB.email,
    locationId: park.id,
  });

  const sell = (guestProfileId: string, planId: string, amount: number, key: string) =>
    sellMembership({
      orgId,
      locationId: park.id,
      homeLocationId: park.id,
      guestProfileId,
      planId,
      paymentMethod: "collected",
      collectedAmount: amount,
      actorUserId: owner.id,
      idempotencyKey: `p4-${key}-${stamp}`,
      source: "admin",
    });

  const mA = (await sell(gA.id, plan.id, 50, "a")).membership;
  const mB = (await sell(gB.id, plan.id, 50, "b")).membership;
  const now = new Date();
  await prisma.guestMembership.updateMany({
    where: { id: { in: [mA.id, mB.id] } },
    data: {
      currentPeriodStart: new Date(now.getTime() - 86400000),
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
    },
  });

  // --- Link flow ---
  await expectReject(
    "unlinked-list-denied",
    () => listOwnMemberships(guestA),
    isCode(MembershipErrorCodes.NOT_LINKED_TO_GUEST)
  );
  await expectReject(
    "link-email-mismatch-denied",
    () => linkGuestProfileToUser(guestA, { guestProfileId: gB.id, orgId }),
    isCode(MembershipErrorCodes.NOT_LINKED_TO_GUEST)
  );
  await linkGuestProfileToUser(guestA, { guestProfileId: gA.id, orgId });
  await linkGuestProfileToUser(guestB, { guestProfileId: gB.id, orgId });
  await expectReject(
    "link-claimed-profile-denied",
    () => linkGuestProfileToUser(guestA, { guestProfileId: gB.id, orgId }),
    isForbidden
  );

  const listA = await listOwnMemberships(guestA);
  check(
    "list-own-only",
    listA.length === 1 && listA[0]!.id === mA.id,
    `ids=${listA.map((m) => m.id).join(",")}`
  );

  // --- Guest IDOR ---
  await expectReject(
    "idor-detail-denied",
    () => getOwnMembershipDetail(guestA, mB.id),
    isForbidden
  );
  await expectReject(
    "idor-cancel-denied",
    () =>
      selfServeCancel({
        actor: guestA,
        guestMembershipId: mB.id,
        when: "immediate",
        confirm: true,
        declineAlternatives: true,
        idempotencyKey: `idor-${stamp}`,
      }),
    isForbidden
  );
  const mBAfterIdor = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mB.id },
  });
  check("idor-no-side-effect", mBAfterIdor.status === "active");

  const detailA = await getOwnMembershipDetail(guestA, mA.id);
  check("own-detail-ok", detailA.membership.id === mA.id);

  // --- Cancel alternatives (beta) ---
  const alt = await upsertCancelAlternative(staff, {
    name: "Stay for $5 credit",
    kind: "discount",
    config: { creditMajor: 5 },
  });
  check("alternative-created", alt.kind === "discount" && alt.active);

  await expectReject(
    "cancel-requires-confirm",
    () =>
      selfServeCancel({
        actor: guestA,
        guestMembershipId: mA.id,
        when: "end_of_period",
        confirm: false,
        idempotencyKey: `noconfirm-${stamp}`,
      }),
    isCode(MembershipErrorCodes.SELF_SERVE_DENIED)
  );

  const offered = await selfServeCancel({
    actor: guestA,
    guestMembershipId: mA.id,
    when: "end_of_period",
    confirm: true,
    idempotencyKey: `offer-${stamp}`,
  });
  check(
    "alternatives-offered-first",
    offered.requiresAlternatives === true &&
      "alternatives" in offered &&
      offered.alternatives.some((a) => a.id === alt.id)
  );
  const notYetCancelled = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mA.id },
  });
  check(
    "offer-does-not-cancel",
    notYetCancelled.status === "active" && !notYetCancelled.cancelAtPeriodEnd
  );

  const accepted = await selfServeCancel({
    actor: guestA,
    guestMembershipId: mA.id,
    when: "end_of_period",
    confirm: true,
    alternativeId: alt.id,
    idempotencyKey: `accept-${stamp}`,
  });
  const afterAccept = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mA.id },
  });
  check(
    "alternative-accept-applies-credit",
    accepted.requiresAlternatives === false &&
      "alternativeApplied" in accepted &&
      accepted.alternativeApplied.kind === "discount" &&
      afterAccept.creditBalanceMinor === 500 &&
      afterAccept.status === "active" &&
      !afterAccept.cancelAtPeriodEnd,
    `credit=${afterAccept.creditBalanceMinor}`
  );

  // --- Click-to-cancel (decline alternatives → schedule end of period) ---
  const declined = await selfServeCancel({
    actor: guestA,
    guestMembershipId: mA.id,
    when: "end_of_period",
    confirm: true,
    declineAlternatives: true,
    reason: "not_using: smoke",
    idempotencyKey: `decline-${stamp}`,
  });
  const afterDecline = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mA.id },
  });
  check(
    "click-to-cancel-eop-scheduled",
    declined.requiresAlternatives === false &&
      afterDecline.cancelAtPeriodEnd === true &&
      afterDecline.status === "active" &&
      afterDecline.cancelReason === "not_using: smoke"
  );
  await expectReject(
    "cancel-eop-already-scheduled",
    () =>
      selfServeCancel({
        actor: guestA,
        guestMembershipId: mA.id,
        when: "end_of_period",
        confirm: true,
        declineAlternatives: true,
        idempotencyKey: `again-${stamp}`,
      }),
    isCode(MembershipErrorCodes.CANCEL_ALREADY_SCHEDULED)
  );

  // Click-to-cancel disabled at park → denied
  await prisma.membershipSettings.create({
    data: { orgId, locationId: park.id, clickToCancelEnabled: false },
  });
  await expectReject(
    "click-to-cancel-disabled",
    () =>
      selfServeCancel({
        actor: guestB,
        guestMembershipId: mB.id,
        when: "immediate",
        confirm: true,
        declineAlternatives: true,
        idempotencyKey: `disabled-${stamp}`,
      }),
    isCode(MembershipErrorCodes.CLICK_TO_CANCEL_DISABLED)
  );
  await prisma.membershipSettings.deleteMany({
    where: { orgId, locationId: park.id },
  });

  // Staff immediate cancel on B for churn fixture
  await cancelMembership({
    orgId,
    membershipId: mB.id,
    actorUserId: owner.id,
    when: "immediate",
    reason: "too_expensive",
  });

  // --- Agreement gate ---
  const mAgree = (await sell(gA.id, agreementPlan.id, 30, "agree")).membership;
  check(
    "agreement-blocks-activation",
    mAgree.status === "pending",
    `status=${mAgree.status}`
  );
  await expectReject(
    "agreement-not-accepted-denied",
    () =>
      signAgreementAsGuest({
        actor: guestA,
        guestMembershipId: mAgree.id,
        accepted: false,
      }),
    isCode(MembershipErrorCodes.AGREEMENT_REQUIRED)
  );
  await expectReject(
    "agreement-idor-denied",
    () =>
      signAgreementAsGuest({
        actor: guestB,
        guestMembershipId: mAgree.id,
        accepted: true,
      }),
    isForbidden
  );
  const signed = await signAgreementAsGuest({
    actor: guestA,
    guestMembershipId: mAgree.id,
    accepted: true,
  });
  const afterSign = await prisma.guestMembership.findUniqueOrThrow({
    where: { id: mAgree.id },
  });
  check(
    "agreement-sign-activates",
    signed.membershipStatus === "active" &&
      afterSign.status === "active" &&
      afterSign.agreementSignedAt != null &&
      signed.agreement.status === "signed"
  );

  // --- Past due fixture (failed payment) ---
  const pd = await markMembershipPastDue({
    guestMembershipId: mAgree.id,
    orgId,
    amountMajor: 30,
    currency: "USD",
    stripeInvoiceId: `in_smoke_p4_${stamp}`,
    errorMessage: "smoke card_declined",
  });
  check("past-due-marked", pd.updated === true);
  const queue = await listDunningWorkQueue({ orgId });
  check(
    "dunning-queue-enterprise-advanced",
    queue.advanced === true &&
      queue.retryDays.join(",") === entDays.join(",") &&
      queue.items.some((i) => i.id === mAgree.id && i.dunningFailCount === 1)
  );

  // --- Reports totals match fixtures ---
  // Fixtures: sold 3 (A, B, agreement); active 1 (A, EOP scheduled);
  // cancelled 1 (B); past_due 1 (agreement); failed payments 1 × 30.
  const report = await getMembershipReports(staff, {
    from: new Date(stamp - 60_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
  });
  check("report-sold", report.soldInRange === 3, String(report.soldInRange));
  check("report-active", report.activeMembers === 1, String(report.activeMembers));
  check(
    "report-churn",
    report.churnCancelledInRange === 1,
    String(report.churnCancelledInRange)
  );
  check("report-past-due", report.pastDueCount === 1, String(report.pastDueCount));
  check(
    "report-failed-payments",
    report.failedPayments.count === 1 && report.failedPayments.amountMajor === 30,
    `${report.failedPayments.count} / ${report.failedPayments.amountMajor}`
  );
  const parkReport = await getMembershipReports(staff, {
    from: new Date(stamp - 60_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
    locationId: park.id,
  });
  check(
    "report-park-scope-matches",
    parkReport.scope === "park" && parkReport.soldInRange === 3
  );
  const hqReport = await getMembershipReports(staff, {
    from: new Date(stamp - 60_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
    hqRollup: true,
  });
  check(
    "report-hq-rollup-enterprise",
    hqReport.scope === "hq_rollup" && hqReport.soldInRange === 3
  );

  await prisma.organization.update({
    where: { id: orgId },
    data: { subscriptionPlan: "growth" },
  });
  await expectReject(
    "report-hq-rollup-growth-denied",
    () =>
      getMembershipReports(staff, {
        from: new Date(stamp - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
        hqRollup: true,
      }),
    (err) => err instanceof Error
  );
  await prisma.organization.update({
    where: { id: orgId },
    data: { subscriptionPlan: "enterprise" },
  });

  // --- Guest CRM detail ---
  const crm = await getGuestProfileDetail(staff, gA.id);
  check(
    "guest-detail-memberships",
    crm.guest.id === gA.id &&
      crm.memberships.length === 2 &&
      crm.memberships.some((m) => m.id === mAgree.id && m.dunningFailCount === 1)
  );

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
