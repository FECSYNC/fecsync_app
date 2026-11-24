/**
 * VenueLocation multi-park foundation smoke:
 * - register-company leaves zero venues
 * - starter venues cap = 1
 * - unpaid creates blocked; entitled create + second create blocked
 *
 *   yarn smoke:venue-locations
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
  const {
    createOrganizationWithPlatformAdmin,
  } = await import("../src/lib/orgRegistration.ts");
  const {
    assertWithinPlanLimit,
    countPlanResource,
    getPlanUsageSnapshot,
    planLimitReachedMessage,
    BILLING_REQUIRED_MESSAGE,
    resolveOrgPlanResourceCap,
  } = await import("../src/lib/planLimits.ts");
  const { getPlanLimits } = await import("../src/lib/subscriptionPlans.ts");
  const { createVenueLocation, VENUE_STOREFRONT_MESSAGE } = await import(
    "../src/lib/venueLocations.ts"
  );
  const { getStorefrontOrgId } = await import("../src/lib/org.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-venue-${stamp}@test.local`,
      password: "x",
      username: `smokeven${stamp}`,
      firstName: "Ven",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Venue Co ${stamp}`,
    slug: `smoke-venue-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;

  try {
    check(
      "register-leaves-zero-venues",
      created.organization.status === "pending" &&
        (await prisma.venueLocation.count({ where: { orgId } })) === 0
    );

    const starterVenues = getPlanLimits("starter").venues;
    const growthVenues = getPlanLimits("growth").venues;
    const starterRoles = getPlanLimits("starter").roleTemplates;
    check("starter-venues-cap-1", starterVenues === 1, `cap=${starterVenues}`);
    check("growth-venues-cap-5", growthVenues === 5, `cap=${growthVenues}`);
    check(
      "starter-roleTemplates-cap-5",
      starterRoles === 5,
      `cap=${starterRoles}`
    );

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: null,
        subscriptionStatus: "none",
      },
    });

    let unpaidBlocked = false;
    try {
      await assertWithinPlanLimit(orgId, "venues");
    } catch (err) {
      unpaidBlocked =
        err instanceof Error && err.message === BILLING_REQUIRED_MESSAGE;
    }
    check("unpaid-venue-create-blocked", unpaidBlocked);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
      },
    });

    const actor = { orgId, sub: user.id };
    const venue = await createVenueLocation(actor, {
      name: `Park One ${stamp}`,
      slug: `park-one-${stamp}`,
    });
    check("first-venue-created", Boolean(venue.id), venue.slug);

    const used = await countPlanResource(orgId, "venues");
    check("venues-used-1", used === 1, `used=${used}`);

    // Archived rows stay in the org but must not burn the venues meter.
    const {
      archiveVenueLocation,
      reactivateVenueLocation,
    } = await import("../src/lib/venueLocations.ts");
    const archivedViaApi = await archiveVenueLocation(actor, venue.id);
    check(
      "product-archive-sets-archivedAt",
      archivedViaApi.status === "archived" &&
        Boolean(archivedViaApi.archivedAt)
    );
    const usedArchived = await countPlanResource(orgId, "venues");
    check("archived-frees-quota", usedArchived === 0, `used=${usedArchived}`);
    await reactivateVenueLocation(actor, venue.id);
    check(
      "reactivate-burns-quota",
      (await countPlanResource(orgId, "venues")) === 1
    );

    let atCap = false;
    try {
      await createVenueLocation(actor, {
        name: `Park Two ${stamp}`,
        slug: `park-two-${stamp}`,
      });
    } catch (err) {
      atCap =
        err instanceof Error &&
        err.message === planLimitReachedMessage("venues", "starter");
    }
    check("starter-second-venue-blocked", atCap);

    // Storefront / DEFAULT_ORG must not manage VenueLocation (UI+API parity).
    const storefrontOrgId = await getStorefrontOrgId();
    let storefrontBlocked = false;
    try {
      await createVenueLocation(
        { orgId: storefrontOrgId, sub: user.id },
        { name: `Storefront Block ${stamp}`, slug: `sf-block-${stamp}` }
      );
    } catch (err) {
      storefrontBlocked =
        err instanceof ForbiddenError &&
        err.message === VENUE_STOREFRONT_MESSAGE;
    }
    check("storefront-venue-create-blocked", storefrontBlocked);

    // Plan-limit path must also refuse storefront venues (defense in depth).
    let storefrontPlanBlocked = false;
    try {
      await assertWithinPlanLimit(storefrontOrgId, "venues");
    } catch (err) {
      storefrontPlanBlocked =
        err instanceof ForbiddenError &&
        err.message === VENUE_STOREFRONT_MESSAGE;
    }
    check("storefront-venues-plan-limit-blocked", storefrontPlanBlocked);

    check(
      "storefront-venues-ui-cap-0",
      (await resolveOrgPlanResourceCap(storefrontOrgId, "venues")) === 0
    );

    // Pending org cannot create venues even if somehow entitled.
    await prisma.organization.update({
      where: { id: orgId },
      data: { status: "pending" },
    });
    let pendingBlocked = false;
    try {
      await createVenueLocation(actor, {
        name: `Pending Park ${stamp}`,
        slug: `pending-park-${stamp}`,
      });
    } catch (err) {
      pendingBlocked =
        err instanceof ForbiddenError &&
        /pending|approval|suspended/i.test(err.message);
    }
    check("pending-venue-create-blocked", pendingBlocked);
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
      },
    });

    // body.orgId must be ignored — create stays on actor.orgId.
    const {
      parseCreateVenueLocationBody,
      VENUE_PRIVILEGED_FIELD,
    } = await import("../src/lib/venueLocations.ts");
    const parsed = parseCreateVenueLocationBody({
      name: `OrgId Ignore ${stamp}`,
      orgId: storefrontOrgId,
    });
    check(
      "parse-strips-body-orgId",
      parsed.name.includes("OrgId Ignore") && !("orgId" in parsed)
    );
    let privilegedRejected = false;
    try {
      parseCreateVenueLocationBody({
        name: `Status Probe ${stamp}`,
        status: "archived",
      });
    } catch (err) {
      privilegedRejected =
        err instanceof Error && err.message === VENUE_PRIVILEGED_FIELD;
    }
    check("parse-rejects-client-status", privilegedRejected);

    // Boundary / invalid input — no latin slug from CJK-only name (before plan check).
    let unicodeSlugBlocked = false;
    try {
      await createVenueLocation(actor, {
        name: "東京パーク",
      });
    } catch (err) {
      unicodeSlugBlocked =
        err instanceof Error && err.message === "Venue slug is invalid";
    }
    check("unicode-name-slug-invalid", unicodeSlugBlocked);

    // Duplicate slug is unique per org even when the prior row is archived
    // (frees quota so we hit P2002 rather than the plan cap).
    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { status: "archived" },
    });
    let slugTaken = false;
    try {
      await createVenueLocation(actor, {
        name: `Park One Dup ${stamp}`,
        slug: `park-one-${stamp}`,
      });
    } catch (err) {
      slugTaken =
        err instanceof Error &&
        err.message === "Venue slug already in use for this company";
    }
    check("duplicate-slug-rejected", slugTaken);
    await prisma.venueLocation.update({
      where: { id: venue.id },
      data: { status: "active" },
    });

    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "growth" },
    });
    const second = await createVenueLocation(actor, {
      name: `Park Two ${stamp}`,
      slug: `park-two-${stamp}`,
    });
    check("growth-allows-second-venue", Boolean(second.id));

    const snap = await getPlanUsageSnapshot(orgId);
    const venueMeter = snap.meters.find((m) => m.resource === "venues");
    check(
      "usage-snapshot-includes-venues",
      venueMeter?.used === 2 && venueMeter?.limit === 5,
      `used=${venueMeter?.used} limit=${venueMeter?.limit}`
    );
    const roleMeter = snap.meters.find((m) => m.resource === "roleTemplates");
    check("usage-snapshot-includes-roleTemplates", roleMeter != null);
  } finally {
    await prisma.venueLocation.deleteMany({ where: { orgId } });
    await prisma.membership.deleteMany({ where: { orgId } });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
}

main()
  .then(() => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll venue-location smoke checks passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
