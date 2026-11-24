/**
 * Plan limits smoke: starter product cap, growth unlock, tailorClients SSOT,
 * usage snapshot counts.
 *
 *   yarn smoke:plan-limits
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
  } = await import("../src/lib/planLimits.ts");
  const { getPlanLimits } = await import("../src/lib/subscriptionPlans.ts");

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-limits-${stamp}@test.local`,
      password: "x",
      username: `smokelim${stamp}`,
      firstName: "Lim",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });

  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Limits ${stamp}`,
    slug: `smoke-limits-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;

  try {
    // Approve without Checkout / ops stamp → creates stay locked.
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
      await assertWithinPlanLimit(orgId, "products");
    } catch (err) {
      unpaidBlocked =
        err instanceof Error && err.message === BILLING_REQUIRED_MESSAGE;
    }
    check("unpaid-approved-creates-blocked", unpaidBlocked);

    let unpaidVenuesBlocked = false;
    try {
      await assertWithinPlanLimit(orgId, "venues");
    } catch (err) {
      unpaidVenuesBlocked =
        err instanceof Error && err.message === BILLING_REQUIRED_MESSAGE;
    }
    check("unpaid-approved-venues-blocked", unpaidVenuesBlocked);

    const unpaidSnap = await getPlanUsageSnapshot(orgId);
    check(
      "unpaid-usage-not-entitled",
      unpaidSnap.billingEntitled === false &&
        unpaidSnap.meters.every((m) => m.limit === 0 && !m.unlimited)
    );

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        status: "active",
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
      },
    });

    const starterCap = getPlanLimits("starter").products!;
    check("starter-products-cap", starterCap === 50, `cap=${starterCap}`);

    // Seed category + fabric refs for products
    const category = await prisma.productCategory.create({
      data: {
        orgId,
        name: `Smoke Cat ${stamp}`,
        legacyStringId: `smoke-cat-${stamp}`,
      },
    });
    const fabric = await prisma.fabric.create({
      data: {
        orgId,
        name: `Smoke Fab ${stamp}`,
        image: "https://example.com/f.jpg",
        type: "cotton",
        color: "white",
      },
    });

    for (let i = 0; i < starterCap; i++) {
      await prisma.product.create({
        data: {
          orgId,
          name: `P${i}-${stamp}`,
          description: "smoke",
          location: "x",
          price: 1,
          quantity: 1,
          remainingInStock: 1,
          gender: "unisex",
          categoryId: category.id,
          fabricTypeId: fabric.id,
        },
      });
    }

    const used = await countPlanResource(orgId, "products");
    check("starter-at-cap", used === starterCap, `used=${used}`);

    let blocked = false;
    try {
      await assertWithinPlanLimit(orgId, "products");
    } catch (err) {
      blocked =
        err instanceof Error &&
        err.message === planLimitReachedMessage("products", "starter");
    }
    check("starter-next-create-blocked", blocked);

    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "growth" },
    });
    let growthOk = false;
    try {
      await assertWithinPlanLimit(orgId, "products");
      growthOk = true;
    } catch {
      growthOk = false;
    }
    check("growth-allows-more-products", growthOk);

    const clientCap = getPlanLimits("starter").tailorClients;
    check("tailorClients-ssot-starter-25", clientCap === 25);

    const venueCap = getPlanLimits("starter").venues;
    check("venues-ssot-starter-1", venueCap === 1);
    const roleCap = getPlanLimits("starter").roleTemplates;
    check("roleTemplates-ssot-starter-5", roleCap === 5);

    const snap = await getPlanUsageSnapshot(orgId);
    check(
      "usage-snapshot-plan-growth",
      snap.planResolved === "growth",
      snap.planResolved
    );
    const productMeter = snap.meters.find((m) => m.resource === "products");
    check(
      "usage-snapshot-products-used",
      productMeter?.used === starterCap,
      `used=${productMeter?.used}`
    );
    check(
      "usage-snapshot-products-limit-growth",
      productMeter?.limit === 500,
      `limit=${productMeter?.limit}`
    );

    // Null plan with entitled status → starter floors (ops / legacy stamp)
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: null, subscriptionStatus: "active" },
    });
    const nullPlan = await getPlanUsageSnapshot(orgId);
    check(
      "null-plan-entitled-resolves-starter",
      nullPlan.planResolved === "starter" &&
        nullPlan.plan == null &&
        nullPlan.billingEntitled === true
    );

    // Staff-owned live studio must burn tailorSeats (Starter cap = 1).
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: "starter",
        subscriptionStatus: "active",
      },
    });
    const { assertNewTailorSeat, userOccupiesTailorSeat } = await import(
      "../src/lib/planLimits.ts"
    );
    // platform_admin membership already exists for `user` — create their studio.
    await prisma.tailorProfile.create({
      data: {
        userId: user.id,
        orgId,
        slug: `smoke-staff-studio-${stamp}`,
        displayName: "Staff Studio",
        status: "approved",
      },
    });
    check(
      "staff-studio-occupies-seat",
      await userOccupiesTailorSeat(orgId, user.id)
    );
    const seatsUsed = await countPlanResource(orgId, "tailorSeats");
    check("staff-studio-counts-as-seat", seatsUsed === 1, `used=${seatsUsed}`);

    const other = await prisma.user.create({
      data: {
        email: `smoke-limits-t2-${stamp}@test.local`,
        password: "x",
        username: `smokelimt2${stamp}`,
        firstName: "T2",
        lastName: "Tailor",
        role: "client",
        isVerified: true,
        joinedAt: new Date(),
      },
    });
    let secondSeatBlocked = false;
    try {
      await assertNewTailorSeat(orgId, other.id);
    } catch (err) {
      secondSeatBlocked =
        err instanceof Error &&
        err.message === planLimitReachedMessage("tailorSeats", "starter");
    }
    check("staff-studio-blocks-second-seat", secondSeatBlocked);

    // Promoting the same staff user into rolePreset=tailor must not double-charge.
    let promoteSameOk = false;
    try {
      await assertNewTailorSeat(orgId, user.id);
      promoteSameOk = true;
    } catch {
      promoteSameOk = false;
    }
    check("same-user-promote-no-double-charge", promoteSameOk);

    // Suspending the staff studio must free the seat (membership stays platform_admin).
    await prisma.tailorProfile.updateMany({
      where: { orgId },
      data: { status: "suspended" },
    });
    check(
      "suspended-studio-frees-seat",
      (await countPlanResource(orgId, "tailorSeats")) === 0
    );
    check(
      "suspended-studio-not-occupant",
      !(await userOccupiesTailorSeat(orgId, user.id))
    );

    // Over-limit: starter products already at cap — one more → overLimitResources.
    await prisma.organization.update({
      where: { id: orgId },
      data: { subscriptionPlan: "starter", subscriptionStatus: "active" },
    });
    const cat = await prisma.productCategory.findFirst({ where: { orgId } });
    const fab = await prisma.fabric.findFirst({ where: { orgId } });
    if (cat && fab) {
      await prisma.product.create({
        data: {
          orgId,
          name: `Over-limit product ${stamp}`,
          description: "smoke",
          location: "x",
          price: 1,
          quantity: 1,
          remainingInStock: 1,
          gender: "unisex",
          categoryId: cat.id,
          fabricTypeId: fab.id,
        },
      });
    }
    const overSnap = await getPlanUsageSnapshot(orgId);
    check(
      "overLimitResources-includes-products",
      overSnap.overLimitResources.includes("products"),
      `over=${overSnap.overLimitResources.join(",")}`
    );
    check(
      "roleTemplates-meter-present",
      overSnap.meters.some((m) => m.resource === "roleTemplates")
    );
    check(
      "venues-meter-present",
      overSnap.meters.some((m) => m.resource === "venues")
    );

    await prisma.tailorProfile.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: other.id } }).catch(() => {});
  } finally {
    await prisma.tailorProfile.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.product.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.fabric.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.productCategory.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.activityLog.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.membership.deleteMany({ where: { orgId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.profile.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  if (failed > 0) {
    console.error(`\n${failed} plan-limits smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll plan-limits smoke checks passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
