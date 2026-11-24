/**
 * Enterprise HQ Steps 1–4 smoke:
 * - non-enterprise deny HQ overview / location-context
 * - enterprise allow overview + location context + venue update/archive
 * - Step 3: location scope filters venue list + HQ items; meters stay company-wide
 * - Step 3: listVenueLocations({ applyLocationScope: false }) stays complete (switcher)
 * - ops listRegisteredCompanies exposes enterpriseHqEligible + venuesActive
 * - archive frees venues quota (product helper)
 * - storefront deny HQ
 * - cross-tenant venue get denied
 * - Step 4 honesty covered in landing/docs (this smoke stays control-plane)
 *
 *   yarn smoke:enterprise-hq
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
  const { countPlanResource } = await import("../src/lib/planLimits.ts");
  const {
    createVenueLocation,
    updateVenueLocation,
    archiveVenueLocation,
    reactivateVenueLocation,
    getVenueLocation,
    listVenueLocations,
    VENUE_STOREFRONT_MESSAGE,
  } = await import("../src/lib/venueLocations.ts");
  const {
    assertEnterpriseHqEnabled,
    orgHasEnterpriseHq,
    ENTERPRISE_HQ_REQUIRED_MESSAGE,
  } = await import("../src/lib/enterpriseHq.ts");
  const { getHqOverview } = await import("../src/lib/hqOverview.ts");
  const { actorLocationScope } = await import("../src/lib/actorLocationScope.ts");
  const { listRegisteredCompanies } = await import(
    "../src/lib/companyApproval.ts"
  );
  const {
    getHqLocationContext,
    setHqLocationContext,
    HQ_LOCATION_ARCHIVED,
  } = await import("../src/lib/hqLocationContext.ts");
  const { getStorefrontOrgId, ORG_SUSPENDED_MESSAGE } = await import(
    "../src/lib/org.ts"
  );
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { BILLING_REQUIRED_MESSAGE } = await import("../src/lib/planLimits.ts");
  const { DEMO_FEATURE_LOCKED_MESSAGE } = await import(
    "../src/lib/demoPlanLock.ts"
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-hq-${stamp}@test.local`,
      password: "x",
      username: `smokehq${stamp}`,
      firstName: "Hq",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-hq-other-${stamp}@test.local`,
      password: "x",
      username: `smokehqo${stamp}`,
      firstName: "Other",
      lastName: "Org",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke HQ Co ${stamp}`,
    slug: `smoke-hq-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;

  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke HQ Other ${stamp}`,
    slug: `smoke-hq-other-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = other.organization.id;

  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.organization.update({
      where: { id: otherOrgId },
      data: {
        status: "active",
        subscriptionPlan: "enterprise",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const actor = { orgId, sub: user.id };
    const otherActor = { orgId: otherOrgId, sub: otherUser.id };

    check(
      "orgHasEnterpriseHq-starter-false",
      orgHasEnterpriseHq({
        isDefault: false,
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 86400000),
      }) === false
    );

    let starterDenied = false;
    try {
      await assertEnterpriseHqEnabled(orgId);
    } catch (err) {
      starterDenied =
        err instanceof ForbiddenError &&
        err.message === ENTERPRISE_HQ_REQUIRED_MESSAGE;
    }
    check("starter-assertEnterpriseHq-denied", starterDenied);

    let overviewDenied = false;
    try {
      await getHqOverview(actor);
    } catch (err) {
      overviewDenied =
        err instanceof ForbiddenError &&
        err.message === ENTERPRISE_HQ_REQUIRED_MESSAGE;
    }
    check("starter-hq-overview-denied", overviewDenied);

    let ctxDenied = false;
    try {
      await getHqLocationContext(actor);
    } catch (err) {
      ctxDenied =
        err instanceof ForbiddenError &&
        err.message === ENTERPRISE_HQ_REQUIRED_MESSAGE;
    }
    check("starter-hq-location-context-denied", ctxDenied);

    const venue = await createVenueLocation(actor, {
      name: `HQ Park ${stamp}`,
      slug: `hq-park-${stamp}`,
      city: "Lagos",
    });
    check("starter-can-create-venue", Boolean(venue.id));

    const updated = await updateVenueLocation(actor, venue.id, {
      city: "Abuja",
      timezone: "Africa/Lagos",
    });
    check(
      "starter-can-update-venue",
      updated.city === "Abuja" && updated.timezone === "Africa/Lagos"
    );

    // Pref pointing at venue must clear when archived (even before Enterprise HQ).
    // Use raw SQL so this smoke stays type-correct even if the IDE Prisma cache lags.
    await prisma.$executeRaw`
      UPDATE memberships
      SET "hqSelectedLocationId" = ${venue.id}
      WHERE "userId" = ${user.id} AND "orgId" = ${orgId}
    `;
    const archived = await archiveVenueLocation(actor, venue.id);
    check(
      "archive-sets-status-and-archivedAt",
      archived.status === "archived" && Boolean(archived.archivedAt)
    );
    const memAfterArchive = await prisma.$queryRaw<
      { hqSelectedLocationId: string | null }[]
    >`
      SELECT "hqSelectedLocationId"
      FROM memberships
      WHERE "userId" = ${user.id} AND "orgId" = ${orgId}
      LIMIT 1
    `;
    check(
      "archive-clears-hq-location-pref",
      memAfterArchive[0]?.hqSelectedLocationId == null
    );
    check(
      "archive-frees-quota",
      (await countPlanResource(orgId, "venues")) === 0
    );

    const reactivated = await reactivateVenueLocation(actor, venue.id);
    check(
      "reactivate-clears-archivedAt",
      reactivated.status === "active" && reactivated.archivedAt == null
    );
    check(
      "reactivate-burns-quota",
      (await countPlanResource(orgId, "venues")) === 1
    );

    const archiveAgain = await archiveVenueLocation(actor, venue.id);
    const archiveIdempotent = await archiveVenueLocation(actor, venue.id);
    check(
      "archive-idempotent-repeat",
      archiveAgain.status === "archived" &&
        archiveIdempotent.status === "archived" &&
        archiveIdempotent.id === venue.id
    );
    const reactivateAgain = await reactivateVenueLocation(actor, venue.id);
    const reactivateIdempotent = await reactivateVenueLocation(actor, venue.id);
    check(
      "reactivate-idempotent-repeat",
      reactivateAgain.status === "active" &&
        reactivateIdempotent.status === "active" &&
        (await countPlanResource(orgId, "venues")) === 1
    );

    // Cross-tenant: other enterprise org cannot read this venue.
    let crossDenied = false;
    try {
      await getVenueLocation(otherActor, venue.id);
    } catch (err) {
      crossDenied = err instanceof ForbiddenError;
    }
    check("cross-tenant-venue-get-denied", crossDenied);

    // Promote to Enterprise HQ.
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "enterprise" },
    });

    check(
      "orgHasEnterpriseHq-enterprise-true",
      orgHasEnterpriseHq({
        isDefault: false,
        status: "active",
        subscriptionPlan: "enterprise",
        subscriptionStatus: "active",
        subscriptionEndsAt: new Date(Date.now() + 86400000),
      }) === true
    );

    await assertEnterpriseHqEnabled(orgId);
    check("enterprise-assertEnterpriseHq-ok", true);

    const overview = await getHqOverview(actor);
    const venuesMeter = overview.usage.meters.find(
      (m: { resource: string }) => m.resource === "venues"
    );
    const ticketingMod = overview.modules.find(
      (m: { id: string }) => m.id === "ticketing"
    );
    const membershipsMod = overview.modules.find(
      (m: { id: string }) => m.id === "memberships"
    );
    const posMod = overview.modules.find((m: { id: string }) => m.id === "pos");
    const waiversMod = overview.modules.find(
      (m: { id: string }) => m.id === "waivers"
    );
    const futureMods = overview.modules.filter((m: { id: string }) =>
      ["access", "surveys", "loyalty", "dynamicPricing"].includes(m.id)
    );
    check(
      "enterprise-hq-overview",
      overview.enterpriseHq === true &&
        overview.venues.active === 1 &&
        ticketingMod?.status === "enabled" &&
        membershipsMod?.status === "enabled" &&
        posMod?.status === "enabled" &&
        // Waivers stays not_enabled until a template is published (honest gate).
        waiversMod?.status === "not_enabled" &&
        futureMods.every(
          (m: { status: string }) => m.status === "not_enabled"
        ),
      `active=${overview.venues.active} ticketing=${ticketingMod?.status} memberships=${membershipsMod?.status} pos=${posMod?.status} waivers=${waiversMod?.status}`
    );
    check(
      "enterprise-hq-overview-meter-matches-rollup",
      venuesMeter?.used === overview.venues.active
    );
    check(
      "enterprise-hq-overview-no-seat-occupant-ids",
      Array.isArray(overview.usage.tailorSeatOccupantUserIds) &&
        overview.usage.tailorSeatOccupantUserIds.length === 0
    );

    const setCtx = await setHqLocationContext(actor, venue.id);
    check(
      "enterprise-set-location-context",
      setCtx.locationId === venue.id && setCtx.location?.slug === venue.slug
    );
    const getCtx = await getHqLocationContext(actor);
    check("enterprise-get-location-context", getCtx.locationId === venue.id);

    const clearCtx = await setHqLocationContext(actor, null);
    check("enterprise-clear-location-context", clearCtx.locationId == null);

    // Step 3: second venue + location-scoped list / overview items.
    const venueB = await createVenueLocation(actor, {
      name: `HQ Park B ${stamp}`,
      slug: `hq-park-b-${stamp}`,
      city: "Ibadan",
    });
    check("enterprise-second-venue", Boolean(venueB.id));

    await setHqLocationContext(actor, venue.id);
    const scope = await actorLocationScope(actor);
    check(
      "actor-location-scope-park",
      scope.locationScoped === true && scope.locationId === venue.id
    );

    const scopedList = await listVenueLocations(actor);
    check(
      "location-scope-filters-venue-list",
      scopedList.length === 1 && scopedList[0]?.id === venue.id,
      `len=${scopedList.length}`
    );

    const unscopedList = await listVenueLocations(actor, {
      applyLocationScope: false,
    });
    check(
      "switcher-list-unscoped-complete",
      unscopedList.filter((v) => v.status === "active").length === 2,
      `active=${unscopedList.filter((v) => v.status === "active").length}`
    );

    const scopedOverview = await getHqOverview(actor);
    check(
      "hq-overview-items-filtered-meters-company-wide",
      scopedOverview.venues.items.length === 1 &&
        scopedOverview.venues.items[0]?.id === venue.id &&
        scopedOverview.venues.active === 2 &&
        scopedOverview.scopePolicy?.venuesListFiltered === true &&
        scopedOverview.scopePolicy?.catalogCompanyWide === true &&
        scopedOverview.locationScope?.locationScoped === true,
      `items=${scopedOverview.venues.items.length} active=${scopedOverview.venues.active}`
    );

    await setHqLocationContext(actor, null);
    const allScope = await actorLocationScope(actor);
    check(
      "actor-location-scope-all",
      allScope.locationScoped === false && allScope.locationId == null
    );
    const allList = await listVenueLocations(actor);
    check(
      "all-locations-list-unfiltered",
      allList.filter((v) => v.status === "active").length === 2
    );

    // Ops visibility: registered companies list flags.
    const opsRows = (
      await listRegisteredCompanies({ status: "all", limit: 200 })
    ).companies;
    const opsRow = opsRows.find((r) => r.id === orgId);
    check(
      "ops-enterprise-hq-eligible",
      opsRow?.enterpriseHqEligible === true &&
        typeof opsRow?.venuesActive === "number" &&
        opsRow.venuesActive >= 2,
      `eligible=${opsRow?.enterpriseHqEligible} venues=${opsRow?.venuesActive}`
    );

    // Cross-tenant location context must fail closed.
    let crossCtxDenied = false;
    try {
      await setHqLocationContext(otherActor, venue.id);
    } catch (err) {
      crossCtxDenied = err instanceof ForbiddenError;
    }
    check("cross-tenant-location-context-denied", crossCtxDenied);

    // Archived venues cannot be selected as HQ scope; archive also clears prefs.
    await setHqLocationContext(actor, venue.id);
    await archiveVenueLocation(actor, venue.id);
    const ctxAfterArchive = await getHqLocationContext(actor);
    check(
      "archive-hq-context-reads-all-locations",
      ctxAfterArchive.locationId == null
    );
    const listAfterArchive = await listVenueLocations(actor);
    check(
      "archive-scoped-list-heals-to-company-wide",
      listAfterArchive.every((v) => v.id !== venue.id || v.status === "archived") &&
        listAfterArchive.filter((v) => v.status === "active").length >= 1,
      `len=${listAfterArchive.length}`
    );
    const overviewAfterArchive = await getHqOverview(actor);
    check(
      "archive-hq-overview-not-scoped-to-archived",
      overviewAfterArchive.locationScope.locationScoped === false &&
        overviewAfterArchive.venues.items.every(
          (v) => v.id !== venue.id || v.status === "archived"
        )
    );
    let archivedCtxDenied = false;
    try {
      await setHqLocationContext(actor, venue.id);
    } catch (err) {
      archivedCtxDenied =
        err instanceof ForbiddenError && err.message === HQ_LOCATION_ARCHIVED;
    }
    check("archived-location-context-denied", archivedCtxDenied);
    await reactivateVenueLocation(actor, venue.id);

    // Demo plan fail-closed for HQ.
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "demo", subscriptionStatus: "trialing" },
    });
    let demoDenied = false;
    try {
      await assertEnterpriseHqEnabled(orgId);
    } catch (err) {
      demoDenied =
        err instanceof ForbiddenError &&
        err.message === DEMO_FEATURE_LOCKED_MESSAGE;
    }
    check("demo-hq-denied", demoDenied);

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "enterprise",
        subscriptionStatus: "active",
      },
    });

    // Soft-hold / overdue endsAt.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionEndsAt: new Date(Date.now() - 60_000),
      },
    });
    let softHoldDenied = false;
    try {
      await assertEnterpriseHqEnabled(orgId);
    } catch (err) {
      softHoldDenied =
        err instanceof ForbiddenError &&
        (err.message === BILLING_REQUIRED_MESSAGE ||
          err.message === ORG_SUSPENDED_MESSAGE ||
          err.message.includes("Subscribe"));
    }
    check("soft-hold-hq-denied", softHoldDenied);

    const opsSoftHold = (
      await listRegisteredCompanies({ status: "all", limit: 200 })
    ).companies;
    const softRow = opsSoftHold.find((r) => r.id === orgId);
    check(
      "ops-enterprise-hq-locked-on-soft-hold",
      softRow?.subscriptionPlan === "enterprise" &&
        softRow?.enterpriseHqEligible === false,
      `eligible=${softRow?.enterpriseHqEligible}`
    );

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Storefront deny.
    const storefrontOrgId = await getStorefrontOrgId();
    let storefrontDenied = false;
    try {
      await assertEnterpriseHqEnabled(storefrontOrgId);
    } catch (err) {
      storefrontDenied =
        err instanceof ForbiddenError &&
        err.message === VENUE_STOREFRONT_MESSAGE;
    }
    check("storefront-hq-denied", storefrontDenied);

    let storefrontOverviewDenied = false;
    try {
      await getHqOverview({ orgId: storefrontOrgId, sub: user.id });
    } catch (err) {
      storefrontOverviewDenied = err instanceof ForbiddenError;
    }
    check("storefront-hq-overview-denied", storefrontOverviewDenied);

    // Unpaid deny.
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "enterprise",
        subscriptionStatus: "none",
        subscriptionEndsAt: null,
      },
    });
    let unpaidDenied = false;
    try {
      await assertEnterpriseHqEnabled(orgId);
    } catch (err) {
      unpaidDenied =
        err instanceof ForbiddenError &&
        err.message === BILLING_REQUIRED_MESSAGE;
    }
    check("unpaid-enterprise-hq-denied", unpaidDenied);
  } finally {
    await prisma.venueLocation.deleteMany({
      where: { orgId: { in: [orgId, otherOrgId] } },
    });
    await prisma.membership.deleteMany({
      where: { orgId: { in: [orgId, otherOrgId] } },
    });
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.organization
      .delete({ where: { id: otherOrgId } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
  }
}

main()
  .then(() => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll Enterprise HQ smoke checks passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
