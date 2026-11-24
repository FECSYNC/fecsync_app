/**
 * Phase 1 Guest park Memberships smoke:
 * - Growth/Enterprise allow plan CRUD
 * - Demo / Starter / storefront / unpaid / cross-tenant deny
 * - eligibility + settings + guest create
 * - staff Membership seat libs unchanged (smoke does not touch them)
 *
 *   yarn smoke:memberships:p1
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
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { DEMO_FEATURE_LOCKED_MESSAGE } = await import(
    "../src/lib/demoPlanLock.ts"
  );
  const { BILLING_REQUIRED_MESSAGE } = await import("../src/lib/planLimits.ts");
  const {
    assertModuleEnabled,
    assertPlanIncludesModule,
    MODULE_NOT_ENABLED_MESSAGE,
    MODULE_STOREFRONT_MESSAGE,
    planAllowsModule,
  } = await import("../src/lib/moduleEntitlement.ts");
  const { assertMembershipsEnabled } = await import(
    "../src/lib/memberships/assert.ts"
  );
  const {
    createMembershipPlan,
    listMembershipPlans,
    archiveMembershipPlan,
    updateMembershipPlan,
  } = await import("../src/lib/memberships/plans.ts");
  const {
    putMembershipEligibility,
    listMembershipEligibility,
  } = await import("../src/lib/memberships/eligibility.ts");
  const { upsertMembershipSettings, getMembershipSettings } = await import(
    "../src/lib/memberships/settings.ts"
  );
  const { createGuestProfile, searchGuestProfiles } = await import(
    "../src/lib/memberships/guests.ts"
  );
  const { listGuestMemberships } = await import(
    "../src/lib/memberships/members.ts"
  );
  const { SHIPPED_MODULE_HINT_IDS } = await import(
    "../src/lib/subscriptionPlans.ts"
  );

  const stamp = Date.now();

  check(
    "shipped-hints-include-memberships",
    (SHIPPED_MODULE_HINT_IDS as readonly string[]).includes("memberships")
  );
  check("plan-growth-allows-memberships", planAllowsModule("growth", "memberships"));
  check(
    "plan-enterprise-allows-memberships",
    planAllowsModule("enterprise", "memberships")
  );
  check("plan-starter-no-memberships", !planAllowsModule("starter", "memberships"));
  check("plan-demo-no-memberships", !planAllowsModule("demo", "memberships"));

  let hintDenied = false;
  try {
    assertPlanIncludesModule("starter", "memberships");
  } catch (err) {
    hintDenied =
      err instanceof ForbiddenError &&
      err.message === MODULE_NOT_ENABLED_MESSAGE;
  }
  check("moduleHints without memberships deny", hintDenied);

  const user = await prisma.user.create({
    data: {
      email: `smoke-mem-${stamp}@test.local`,
      password: "x",
      username: `smokemem${stamp}`,
      firstName: "Mem",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Memberships Co ${stamp}`,
    slug: `smoke-mem-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-mem-other-${stamp}@test.local`,
      password: "x",
      username: `smokememo${stamp}`,
      firstName: "Other",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const otherOrg = await createOrganizationWithPlatformAdmin({
    name: `Smoke Mem Other ${stamp}`,
    slug: `smoke-mem-other-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = otherOrg.organization.id;
  await prisma.organization.update({
    where: { id: otherOrgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  const otherActor = { orgId: otherOrgId, sub: otherUser.id };
  const otherVenue = await createVenueLocation(otherActor, {
    name: `Other Park ${stamp}`,
    slug: `other-park-${stamp}`,
  });

  try {
    // Unpaid deny
    let unpaidDenied = false;
    try {
      await assertMembershipsEnabled(orgId);
    } catch (err) {
      unpaidDenied =
        err instanceof ForbiddenError &&
        String(err.message).includes(BILLING_REQUIRED_MESSAGE.slice(0, 20));
      if (!unpaidDenied && err instanceof ForbiddenError) unpaidDenied = true;
    }
    check("unpaid org deny memberships", unpaidDenied);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });

    await assertMembershipsEnabled(orgId);
    check("growth entitled allow", true);

    const venue = await createVenueLocation(actor, {
      name: `Mem Park ${stamp}`,
      slug: `mem-park-${stamp}`,
    });
    const venue2 = await createVenueLocation(actor, {
      name: `Mem Park 2 ${stamp}`,
      slug: `mem-park-2-${stamp}`,
    });

    const recurring = await createMembershipPlan(actor, {
      name: `Recurring Gold ${stamp}`,
      billing: "recurring",
      intervalCount: 1,
      intervalUnit: "month",
      price: 49.99,
      currency: "USD",
      entitlements: {
        entriesPerPeriod: 8,
        discountPercent: 10,
        guestCount: 2,
        perkFlags: ["skip_line"],
      },
      familyAllowed: true,
      upgradeGroupKey: `gold-${stamp}`,
      agreementRequired: true,
    });
    check("create recurring plan", Boolean(recurring.id));

    const fixed = await createMembershipPlan(actor, {
      name: `Fixed Season ${stamp}`,
      billing: "fixed",
      intervalCount: 6,
      intervalUnit: "month",
      price: 199,
      entitlements: { entriesPerPeriod: null },
    });
    check("create fixed plan", Boolean(fixed.id));

    const listed = await listMembershipPlans(actor);
    check(
      "list plans includes created",
      listed.some((p) => p.id === recurring.id) &&
        listed.some((p) => p.id === fixed.id)
    );

    const elig = await putMembershipEligibility(actor, {
      planId: recurring.id,
      rows: [
        {
          locationId: venue.id,
          eligible: true,
          localPerksAdd: { perkFlags: ["free_locker"] },
          localPerksRemove: { perkFlags: ["skip_line"] },
        },
        { locationId: venue2.id, eligible: true },
      ],
    });
    check("eligibility matrix save", elig.length === 2);
    check(
      "eligibility local perks",
      Array.isArray(
        (elig.find((r) => r.locationId === venue.id)?.localPerksAdd as
          | { perkFlags?: string[] }
          | null)?.perkFlags
      ) &&
        (
          elig.find((r) => r.locationId === venue.id)?.localPerksAdd as {
            perkFlags: string[];
          }
        ).perkFlags.includes("free_locker")
    );

    const eligListed = await listMembershipEligibility(actor, {
      planId: recurring.id,
    });
    check("eligibility list", eligListed.length === 2);

    const settings = await upsertMembershipSettings(actor, {
      locationId: null,
      requirePhotoOnRedeem: true,
      dunningEnabled: true,
      clickToCancelEnabled: true,
      defaultHomeLocationId: venue.id,
      graceDays: 7,
    });
    check("settings upsert", settings.requirePhotoOnRedeem === true);

    const settingsRead = await getMembershipSettings(actor, null);
    check(
      "settings read",
      settingsRead.defaultHomeLocationId === venue.id &&
        settingsRead.graceDays === 7
    );

    const guest = await createGuestProfile(actor, {
      firstName: "Ada",
      lastName: "Guest",
      email: `ada-${stamp}@test.local`,
      phone: "555-0100",
      locationId: venue.id,
    });
    check("guest create", Boolean(guest.id) && guest.displayName === "Ada Guest");

    const guests = await searchGuestProfiles(actor, { q: "Ada" });
    check("guest search", guests.some((g) => g.id === guest.id));

    const membersShell = await listGuestMemberships(actor);
    check("members list shell", Array.isArray(membersShell.members));

    await putMembershipEligibility(actor, {
      planId: fixed.id,
      rows: [{ locationId: venue.id, eligible: true }],
    });
    await archiveMembershipPlan(actor, fixed.id);
    const afterArchive = await listMembershipPlans(actor, {
      includeArchived: false,
    });
    check(
      "archive hides from active list",
      !afterArchive.some((p) => p.id === fixed.id)
    );
    const eligAfterArchive = await listMembershipEligibility(actor, {
      planId: fixed.id,
    });
    check(
      "archive clears eligibility",
      eligAfterArchive.length === 0
    );

    let archivedEditDenied = false;
    try {
      await updateMembershipPlan(actor, fixed.id, { name: "Nope" });
    } catch (err) {
      archivedEditDenied =
        err instanceof Error && err.message.includes("Archived plans");
    }
    check("archived plan edit denied", archivedEditDenied);

    // locationId change clears eligibility (stamp move)
    await putMembershipEligibility(actor, {
      planId: recurring.id,
      rows: [
        { locationId: venue.id, eligible: true },
        { locationId: venue2.id, eligible: true },
      ],
    });
    await updateMembershipPlan(actor, recurring.id, {
      locationId: venue2.id,
    });
    const eligAfterMove = await listMembershipEligibility(actor, {
      planId: recurring.id,
    });
    check("locationId change clears eligibility", eligAfterMove.length === 0);

    // Cross-tenant: other actor cannot see our plan via get/list on our id
    let crossDenied = false;
    try {
      await putMembershipEligibility(otherActor, {
        planId: recurring.id,
        rows: [{ locationId: otherVenue.id, eligible: true }],
      });
    } catch (err) {
      crossDenied = err instanceof ForbiddenError;
    }
    check("cross-tenant eligibility deny", crossDenied);

    // Demo deny
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "demo" },
    });
    const { clearCachedStaffGatesForOrg } = await import(
      "../src/lib/ticketing/staffGateCache.ts"
    );
    clearCachedStaffGatesForOrg(orgId);
    let demoDenied = false;
    try {
      await assertModuleEnabled(orgId, "memberships");
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError &&
        err.message === DEMO_FEATURE_LOCKED_MESSAGE;
    }
    check("demo deny", demoDenied);

    // Starter deny
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    clearCachedStaffGatesForOrg(orgId);
    let starterDenied = false;
    try {
      await assertMembershipsEnabled(orgId);
    } catch (err) {
      starterDenied =
        err instanceof ForbiddenError &&
        err.message === MODULE_NOT_ENABLED_MESSAGE;
    }
    check("starter deny", starterDenied);

    // Storefront deny
    const storefrontId = await getStorefrontOrgId();
    let storefrontDenied = false;
    try {
      await assertModuleEnabled(storefrontId, "memberships");
    } catch (err) {
      storefrontDenied =
        err instanceof ForbiddenError &&
        (err.message === MODULE_STOREFRONT_MESSAGE ||
          err.message === DEMO_FEATURE_LOCKED_MESSAGE ||
          err.message === MODULE_NOT_ENABLED_MESSAGE);
    }
    check("storefront deny", storefrontDenied);

    // Bad locationId (other org venue) on plan create after restore growth
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "growth",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    let badLocDenied = false;
    try {
      await createMembershipPlan(actor, {
        name: `Bad Loc ${stamp}`,
        billing: "fixed",
        price: 10,
        locationId: otherVenue.id,
      });
    } catch (err) {
      badLocDenied = err instanceof ForbiddenError;
    }
    check("foreign locationId deny", badLocDenied);
  } finally {
    // Cleanup smoke orgs (best-effort)
    try {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
      await prisma.organization
        .delete({ where: { id: otherOrgId } })
        .catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll Memberships Phase 1 smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
