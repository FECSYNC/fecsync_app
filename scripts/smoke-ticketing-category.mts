/**
 * Focused BookingCategory ↔ AdmissionProduct smoke (fast alternative to full p1).
 * yarn npx tsx scripts/smoke-ticketing-category.mts
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
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const {
    createAdmissionProduct,
    listAdmissionProducts,
    updateAdmissionProduct,
    archiveAdmissionProduct,
  } = await import("../src/lib/ticketing/products.ts");
  const { archiveBookingCategory } = await import(
    "../src/lib/ticketing/categories.ts"
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-cat-${stamp}@test.local`,
      password: "x",
      username: `smokecat${stamp}`,
      firstName: "Cat",
      lastName: "Smoke",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Category Co ${stamp}`,
    slug: `smoke-cat-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-cat-o-${stamp}@test.local`,
      password: "x",
      username: `smokecato${stamp}`,
      firstName: "Other",
      lastName: "Org",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Category Other ${stamp}`,
    slug: `smoke-cat-o-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = other.organization.id;
  await prisma.organization.update({
    where: { id: otherOrgId },
    data: {
      status: "active",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });

  const venue = await createVenueLocation(actor, {
    name: `Cat Venue ${stamp}`,
    slug: `cat-venue-${stamp}`,
    timezone: "America/New_York",
  });

  const ownCategory = await prisma.bookingCategory.create({
    data: {
      orgId,
      name: `Own Cat ${stamp}`,
      description: "own",
    },
  });
  const foreignCategory = await prisma.bookingCategory.create({
    data: {
      orgId: otherOrgId,
      name: `Foreign Cat ${stamp}`,
      description: "other",
    },
  });

  const product = await createAdmissionProduct(actor, {
    type: "day_pass",
    name: `Categorized ${stamp}`,
    locationId: venue.id,
    categoryId: ownCategory.id,
    prices: [{ code: "adult", amount: 12 }],
    published: false,
  });
  check(
    "same-org category assignment",
    product.categoryId === ownCategory.id &&
      product.category?.name === ownCategory.name
  );

  let crossCreateDenied = false;
  try {
    await createAdmissionProduct(actor, {
      type: "day_pass",
      name: `Cross ${stamp}`,
      locationId: venue.id,
      categoryId: foreignCategory.id,
      prices: [{ code: "adult", amount: 12 }],
    });
  } catch (err) {
    crossCreateDenied =
      err instanceof ForbiddenError ||
      (err instanceof Error && /category|not found|forbidden/i.test(err.message));
  }
  check("cross-org category assignment denied", crossCreateDenied);

  const filtered = await listAdmissionProducts(actor, {
    categoryId: ownCategory.id,
    includeArchived: true,
  });
  check(
    "category filter",
    filtered.some((p) => p.id === product.id) &&
      filtered.every((p) => p.categoryId === ownCategory.id)
  );

  let crossFilterDenied = false;
  try {
    await listAdmissionProducts(actor, {
      categoryId: foreignCategory.id,
      includeArchived: true,
    });
  } catch (err) {
    crossFilterDenied =
      err instanceof ForbiddenError ||
      (err instanceof Error && /category|not found|forbidden/i.test(err.message));
  }
  check("cross-org category filter denied", crossFilterDenied);

  const cleared = await updateAdmissionProduct(actor, product.id, {
    categoryId: null,
  });
  check("category update clear", cleared.categoryId === null);

  let crossUpdateDenied = false;
  try {
    await updateAdmissionProduct(actor, product.id, {
      categoryId: foreignCategory.id,
    });
  } catch (err) {
    crossUpdateDenied =
      err instanceof ForbiddenError ||
      (err instanceof Error && /category|not found|forbidden/i.test(err.message));
  }
  check("cross-org category update denied", crossUpdateDenied);

  await updateAdmissionProduct(actor, product.id, {
    categoryId: ownCategory.id,
  });

  const archivedCat = await archiveBookingCategory(actor, ownCategory.id);
  check(
    "category archive marks archivedAt",
    archivedCat.archivedAt != null
  );
  const afterCatArchive = await prisma.admissionProduct.findFirst({
    where: { id: product.id },
    select: { categoryId: true },
  });
  check(
    "category archive unlinks products",
    afterCatArchive?.categoryId === null
  );

  const product2 = await createAdmissionProduct(actor, {
    type: "day_pass",
    name: `Categorized2 ${stamp}`,
    locationId: venue.id,
    categoryId: null,
    prices: [{ code: "adult", amount: 12 }],
    published: false,
  });
  // Restore category by name (create restores archived)
  const { createBookingCategory } = await import(
    "../src/lib/ticketing/categories.ts"
  );
  const restored = await createBookingCategory(actor, {
    name: ownCategory.name,
    description: "restored",
  });
  check("category restore by recreate", restored.archivedAt === null);

  await updateAdmissionProduct(actor, product2.id, {
    categoryId: restored.id,
  });

  const archived = await archiveAdmissionProduct(actor, product2.id);
  check(
    "archive clears categoryId",
    archived.categoryId === null && archived.archivedAt != null
  );

  // Cleanup (best-effort)
  await prisma.admissionProduct
    .deleteMany({ where: { orgId } })
    .catch(() => undefined);
  await prisma.bookingCategory
    .deleteMany({ where: { id: { in: [ownCategory.id, foreignCategory.id] } } })
    .catch(() => undefined);
  await prisma.venueLocation.deleteMany({ where: { orgId } }).catch(() => undefined);
  await prisma.membership.deleteMany({ where: { orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.bookingCategory
    .deleteMany({ where: { orgId: otherOrgId } })
    .catch(() => undefined);
  await prisma.membership
    .deleteMany({ where: { orgId: otherOrgId } })
    .catch(() => undefined);
  await prisma.organization
    .delete({ where: { id: otherOrgId } })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { id: { in: [user.id, otherUser.id] } } })
    .catch(() => undefined);

  if (failed) {
    console.error(`\n${failed} category smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nCategory smoke OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
