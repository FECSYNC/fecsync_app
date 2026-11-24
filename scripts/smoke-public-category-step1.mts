/**
 * Step 1 public category pages: slug stability, collisions, reserved words,
 * cross-tenant denial, demo lock, archive deactivation, private fields.
 * yarn npx tsx scripts/smoke-public-category-step1.mts
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
// Same interactive transaction window as src/lib/prisma.ts (remote Supabase RTT).
const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function firstAppSegments(appDir: string): string[] {
  const segments = new Set<string>();
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith("(") && ent.name.endsWith(")")) {
        walk(path.join(dir, ent.name));
        continue;
      }
      if (ent.name.startsWith("[") || ent.name.startsWith("_")) continue;
      segments.add(ent.name);
    }
  };
  walk(appDir);
  return [...segments];
}

async function main() {
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const { createOrganizationWithPlatformAdmin } = await import(
    "../src/lib/orgRegistration.ts"
  );
  const {
    createBookingCategory,
    listBookingCategories,
    updateBookingCategory,
    archiveBookingCategory,
    getBookingCategory,
  } = await import("../src/lib/ticketing/categories.ts");
  const { createMembershipCategory, updateMembershipCategory } = await import(
    "../src/lib/memberships/categories.ts"
  );
  const {
    insertPublicCategoryPage,
    applyPublicPagePatch,
    parsePublicPageSettingsPatch,
  } = await import("../src/lib/publicCategory/pages.ts");
  const { resolveCompanyCategory } = await import(
    "../src/lib/publicCategory/resolve.ts"
  );
  const {
    allocateCategorySlug,
    assertEditableCategorySlug,
    isReservedCategorySlug,
    RESERVED_CATEGORY_SLUGS,
    slugifyCategoryName,
  } = await import("../src/lib/publicCategory/slug.ts");
  const {
    publicCategoryEmbedSnippet,
    publicUrlPayloadHasPrivateFields,
  } = await import("../src/lib/publicCategory/snippet.ts");
  const { assertAllowedPublicProfileKeys, parseEmbedOrigin } = await import(
    "../src/lib/publicCategory/origins.ts"
  );
  const { upsertCompanyProfile } = await import("../src/lib/companyProfile.ts");

  const required = [
    "book",
    "admin",
    "shop",
    "cart",
    "checkout",
    "api",
    "payment",
    "sign",
    "kiosk",
    "profile",
    "tailor",
    "tailors",
    "signin",
    "signup",
    "register-company",
    "home",
    "privacy",
    "terms",
    "join",
    "fabrics",
    "customize",
    "trending-fashion",
    "memberships",
    "waivers",
    "users",
    "company-pending",
    "forgot-password",
    "reset-password",
    "verify-email",
    "check-email",
    "success",
    "cancel",
    "embed",
  ];
  const reserved = new Set<string>(RESERVED_CATEGORY_SLUGS);
  const appDir = path.join(process.cwd(), "src", "app");
  const scanned = firstAppSegments(appDir);
  const missingScanned = scanned.filter((segment) => !reserved.has(segment));
  const missingRequired = required.filter((segment) => !reserved.has(segment));
  check(
    "reserved list covers src/app first segments",
    missingScanned.length === 0,
    missingScanned.join(",")
  );
  check(
    "reserved list includes required words",
    missingRequired.length === 0,
    missingRequired.join(",")
  );
  check("book is reserved", isReservedCategorySlug("book"));
  check("birthday is not reserved", !isReservedCategorySlug("birthday"));
  check(
    "reserved base gets -2",
    allocateCategorySlug("Book", []) === "book-2"
  );
  check(
    "collision suffix",
    allocateCategorySlug("Birthday", ["birthday"]) === "birthday-2"
  );
  const longSlug = slugifyCategoryName(`${"hello ".repeat(12)}party`);
  let longSlugResavable = false;
  try {
    longSlugResavable = assertEditableCategorySlug(longSlug) === longSlug;
  } catch {
    longSlugResavable = false;
  }
  check(
    "long name slug can be saved again",
    longSlugResavable && !longSlug.endsWith("-") && !longSlug.includes("--")
  );

  const snippet = publicCategoryEmbedSnippet("skyline-play", "birthday");
  check(
    "snippet url and script",
    snippet.includes("/skyline-play/birthday?embed=1") &&
      snippet.includes("/embed/category.js") &&
      snippet.includes('width="100%"') &&
      snippet.includes("border:0")
  );
  const escaped = publicCategoryEmbedSnippet('a<b', 'c"d');
  check(
    "snippet escapes slugs",
    !escaped.includes("<b") && !escaped.includes('"d') && escaped.includes("%3C")
  );

  let rejectedPrivate = false;
  try {
    assertAllowedPublicProfileKeys({ publicTaxId: true, publicBankName: true });
  } catch {
    rejectedPrivate = true;
  }
  check("bank and tax public flags rejected", rejectedPrivate);
  let rejectedBilling = false;
  try {
    assertAllowedPublicProfileKeys({ publicBillingEmail: true });
  } catch {
    rejectedBilling = true;
  }
  check("billing email public flag rejected", rejectedBilling);

  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8"
  );
  const profileBlock = schema.split("model CompanyProfile {")[1]?.split("model ")[0] ?? "";
  check(
    "company profile has no bank or tax public switch",
    profileBlock.includes("publicLogo") &&
      profileBlock.includes("publicSupportEmail") &&
      !/public(Bank|Tax|Billing)/.test(profileBlock)
  );

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      email: `smoke-pubcat-${stamp}@test.local`,
      password: "x",
      username: `smokepub${stamp}`,
      firstName: "Pub",
      lastName: "Cat",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const created = await createOrganizationWithPlatformAdmin({
    name: `Smoke Public Cat ${stamp}`,
    slug: `smoke-pubcat-${stamp}`,
    userId: user.id,
  });
  const orgId = created.organization.id;
  const actor = { orgId, sub: user.id };
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });

  const otherUser = await prisma.user.create({
    data: {
      email: `smoke-pubcat-o-${stamp}@test.local`,
      password: "x",
      username: `smokepubo${stamp}`,
      firstName: "Other",
      lastName: "Cat",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const other = await createOrganizationWithPlatformAdmin({
    name: `Smoke Public Other ${stamp}`,
    slug: `smoke-pubcat-o-${stamp}`,
    userId: otherUser.id,
  });
  const otherOrgId = other.organization.id;
  const otherActor = { orgId: otherOrgId, sub: otherUser.id };
  await prisma.organization.update({
    where: { id: otherOrgId },
    data: {
      status: "active",
      subscriptionPlan: "growth",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
    },
  });

  const booking = await createBookingCategory(actor, { name: "Birthday" });
  const menu = await prisma.$transaction(async (tx) => {
    const row = await tx.productCategory.create({
      data: { orgId, name: "Birthday", description: "menu" },
    });
    await insertPublicCategoryPage(tx, {
      orgId,
      kind: "menu",
      name: "Birthday",
      productCategoryId: row.id,
    });
    return row;
  });
  const membership = await createMembershipCategory(actor, { name: "Birthday" });
  const otherBooking = await createBookingCategory(otherActor, {
    name: "Birthday",
  });

  const menuPage = await prisma.publicCategoryPage.findFirst({
    where: { productCategoryId: menu.id },
  });
  const slugs = [
    booking.publicPage?.slug,
    menuPage?.slug,
    membership.publicPage?.slug,
  ].sort();
  check(
    "in-org collision suffixes",
    slugs.join(",") === "birthday,birthday-2,birthday-3"
  );
  check(
    "two companies share birthday",
    booking.publicPage?.slug === "birthday" &&
      otherBooking.publicPage?.slug === "birthday" &&
      booking.publicPage?.url.includes(`/smoke-pubcat-${stamp}/birthday`) &&
      otherBooking.publicPage?.url.includes(`/smoke-pubcat-o-${stamp}/birthday`)
  );

  const renamed = await updateBookingCategory(actor, booking.id, {
    name: "Super Party",
  });
  check(
    "rename keeps slug",
    renamed.name === "Super Party" && renamed.publicPage?.slug === "birthday"
  );

  let reservedDenied = false;
  try {
    await updateBookingCategory(actor, booking.id, { slug: "admin" });
  } catch (err) {
    reservedDenied = err instanceof Error && /reserved/i.test(err.message);
  }
  check("reserved slug rejected", reservedDenied);
  const afterReserved = await prisma.publicCategoryPage.findFirst({
    where: { bookingCategoryId: booking.id },
  });
  check("reserved reject did not change slug", afterReserved?.slug === "birthday");

  const orgSlug = `smoke-pubcat-${stamp}`;
  const patched = await updateBookingCategory(actor, booking.id, {
    slug: "Party-Time",
    layout: "stack",
    embedEnabled: false,
  });
  const patchedRow = await prisma.publicCategoryPage.findFirst({
    where: { bookingCategoryId: booking.id },
  });
  check(
    "public link, layout and embed flag save together (response + row)",
    patched.publicPage?.slug === "party-time" &&
      patched.publicPage.layout === "stack" &&
      patched.publicPage.embedEnabled === false &&
      patched.publicPage.url.includes(`/${orgSlug}/party-time`) &&
      patchedRow?.slug === "party-time" &&
      patchedRow.layout === "stack" &&
      patchedRow.embedEnabled === false,
    patched.publicPage?.url
  );
  const byNew = await resolveCompanyCategory(orgSlug, "party-time");
  const byOld = await resolveCompanyCategory(orgSlug, "birthday");
  check(
    "new public link resolves with saved settings, old link is gone",
    byNew?.page.categoryId === booking.id &&
      byNew.page.layout === "stack" &&
      byNew.page.embedEnabled === false &&
      byOld == null
  );

  let invalidAllRejected = true;
  for (const body of [
    { layout: "masonry" },
    { embedEnabled: "yes" },
    { slug: "bad slug!" },
    { slug: "" },
  ]) {
    try {
      await updateBookingCategory(actor, booking.id, body);
      invalidAllRejected = false;
    } catch {
      /* expected */
    }
  }
  const afterInvalid = await prisma.publicCategoryPage.findFirst({
    where: { bookingCategoryId: booking.id },
  });
  check(
    "invalid layout, embed flag and link are rejected without changes",
    invalidAllRejected &&
      afterInvalid?.slug === "party-time" &&
      afterInvalid.layout === "stack" &&
      afterInvalid.embedEnabled === false
  );

  let duplicateDenied = false;
  try {
    await updateMembershipCategory(actor, membership.id, { slug: "party-time" });
  } catch (err) {
    duplicateDenied = err instanceof Error && /already used/i.test(err.message);
  }
  const membershipAfterDuplicate = await prisma.publicCategoryPage.findFirst({
    where: { membershipCategoryId: membership.id },
  });
  check(
    "duplicate public link rejected, other category's link unchanged",
    duplicateDenied &&
      membershipAfterDuplicate?.slug === membership.publicPage?.slug
  );

  const membershipPatched = await updateMembershipCategory(actor, membership.id, {
    slug: "members-club",
    layout: "grid",
  });
  check(
    "membership public link and layout save, embed flag untouched",
    membershipPatched.publicPage?.slug === "members-club" &&
      membershipPatched.publicPage.layout === "grid" &&
      membershipPatched.publicPage.embedEnabled === true
  );

  const menuPatch = parsePublicPageSettingsPatch(
    { publicSlug: "snacks", layout: "grid", embedEnabled: false },
    { slugKey: "publicSlug" }
  );
  await prisma.$transaction((tx) =>
    applyPublicPagePatch(
      tx,
      { orgId, kind: "menu", name: "Birthday", productCategoryId: menu.id },
      menuPatch!
    )
  );
  const menuAfter = await prisma.publicCategoryPage.findFirst({
    where: { productCategoryId: menu.id },
  });
  check(
    "menu category publicSlug, layout and embed flag save",
    menuAfter?.slug === "snacks" &&
      menuAfter.layout === "grid" &&
      menuAfter.embedEnabled === false
  );

  let crossDenied = false;
  try {
    await getBookingCategory(otherActor, booking.id);
  } catch (err) {
    crossDenied = err instanceof ForbiddenError;
  }
  check("cross-tenant category read is 403", crossDenied);

  const ignored = await createBookingCategory(actor, {
    name: `Ignore Org ${stamp}`,
    orgId: otherOrgId,
  });
  const leaked = await prisma.bookingCategory.findFirst({
    where: { orgId: otherOrgId, name: `Ignore Org ${stamp}` },
  });
  check(
    "client orgId ignored and stamped to actor",
    ignored.orgId === orgId && leaked == null
  );
  const ignoredMembership = await createMembershipCategory(actor, {
    name: `Ignore Org M ${stamp}`,
    orgId: otherOrgId,
  });
  const leakedMembership = await prisma.membershipCategory.findFirst({
    where: { orgId: otherOrgId, name: `Ignore Org M ${stamp}` },
  });
  check(
    "membership client orgId ignored",
    ignoredMembership.orgId === orgId && leakedMembership == null
  );

  const archived = await archiveBookingCategory(actor, booking.id);
  const archivedPage = await prisma.publicCategoryPage.findFirst({
    where: { bookingCategoryId: booking.id },
  });
  check(
    "archive deactivates public page",
    archived.archivedAt != null && archivedPage?.active === false
  );

  const bare = await prisma.bookingCategory.create({
    data: { orgId, name: `Bare ${stamp}`, description: "legacy" },
  });
  const listed = await listBookingCategories(actor);
  const bareRow = listed.find((row) => row.id === bare.id);
  const listedAgain = await listBookingCategories(actor);
  check(
    "legacy category gains a stable public page on staff list",
    Boolean(bareRow?.publicPage?.slug) &&
      listedAgain.find((row) => row.id === bare.id)?.publicPage?.slug ===
        bareRow?.publicPage?.slug
  );
  const renamedBare = await updateBookingCategory(actor, bare.id, {
    name: `Bare Renamed ${stamp}`,
  });
  check(
    "legacy rename keeps slug",
    renamedBare.name.startsWith("Bare Renamed") &&
      renamedBare.publicPage?.slug === bareRow?.publicPage?.slug
  );
  const bareArchived = await prisma.bookingCategory.create({
    data: {
      orgId,
      name: `Bare Arch ${stamp}`,
      archivedAt: new Date(),
    },
  });
  const withArchived = await listBookingCategories(actor, {
    includeArchived: true,
  });
  check(
    "archived legacy page is inactive",
    withArchived.find((row) => row.id === bareArchived.id)?.publicPage
      ?.active === false
  );

  check(
    "staff public url payload has no bank tax or billing email",
    !publicUrlPayloadHasPrivateFields(renamed) &&
      !publicUrlPayloadHasPrivateFields(archived.publicPage) &&
      Boolean(renamed.publicPage?.embedSnippet.includes("/embed/category.js"))
  );

  const demoUser = await prisma.user.create({
    data: {
      email: `smoke-pubcat-d-${stamp}@test.local`,
      password: "x",
      username: `smokepubd${stamp}`,
      firstName: "Demo",
      lastName: "Cat",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const demo = await createOrganizationWithPlatformAdmin({
    name: `Smoke Public Demo ${stamp}`,
    slug: `smoke-pubcat-d-${stamp}`,
    userId: demoUser.id,
  });
  await prisma.organization.update({
    where: { id: demo.organization.id },
    data: {
      status: "active",
      subscriptionPlan: "demo",
      subscriptionStatus: "active",
      subscriptionEndsAt: new Date(Date.now() + 10 * 86400000),
    },
  });
  const demoActor = { orgId: demo.organization.id, sub: demoUser.id };
  let demoCategoryDenied = false;
  try {
    await createBookingCategory(demoActor, { name: "Birthday" });
  } catch (err) {
    demoCategoryDenied = err instanceof ForbiddenError;
  }
  check("demo lock rejects category write", demoCategoryDenied);

  const demoProfile = await upsertCompanyProfile(demoActor, {
    legalName: "Demo Legal",
  });
  let demoPublicDenied = false;
  try {
    await upsertCompanyProfile(demoActor, { publicLogo: false });
  } catch (err) {
    demoPublicDenied = err instanceof ForbiddenError;
  }
  check("demo can save company profile", demoProfile.profile.legalName === "Demo Legal");
  check("demo lock rejects public field write", demoPublicDenied);

  const stamped = await upsertCompanyProfile(actor, {
    embedOrigins: ["https://booking.example"],
    orgId: otherOrgId,
  } as { embedOrigins: string[] });
  const ownOrigins = await prisma.companyEmbedOrigin.findMany({
    where: { orgId },
  });
  const foreignOrigins = await prisma.companyEmbedOrigin.findMany({
    where: { orgId: otherOrgId },
  });
  check(
    "embed origin stamped to actor org",
    stamped.profile.embedOrigins.includes("https://booking.example") &&
      ownOrigins.some((row) => row.origin === "https://booking.example") &&
      foreignOrigins.length === 0
  );

  let badOrigin = false;
  try {
    parseEmbedOrigin("https://booking.example/extra");
  } catch {
    badOrigin = true;
  }
  let wildcard = false;
  try {
    parseEmbedOrigin("https://*.example.com");
  } catch {
    wildcard = true;
  }
  let httpOrigin = false;
  try {
    parseEmbedOrigin("http://booking.example");
  } catch {
    httpOrigin = true;
  }
  check("origins reject path wildcard and http", badOrigin && wildcard && httpOrigin);

  const storefront = await prisma.organization.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!storefront) {
    check("default storefront org exists", false);
  } else {
    const storeCategory = await prisma.productCategory.create({
      data: {
        orgId: storefront.id,
        name: `Storefront Skip ${stamp}`,
        description: "no public page",
      },
    });
    await insertPublicCategoryPage(prisma, {
      orgId: storefront.id,
      kind: "menu",
      name: storeCategory.name,
      productCategoryId: storeCategory.id,
    });
    const storePage = await prisma.publicCategoryPage.findFirst({
      where: { productCategoryId: storeCategory.id },
    });
    check("default storefront has no public category page", storePage == null);
    await prisma.productCategory.delete({ where: { id: storeCategory.id } });
  }

  await prisma.publicCategoryPage
    .deleteMany({ where: { orgId: { in: [orgId, otherOrgId, demo.organization.id] } } })
    .catch(() => undefined);
  await prisma.companyEmbedOrigin
    .deleteMany({ where: { orgId: { in: [orgId, otherOrgId, demo.organization.id] } } })
    .catch(() => undefined);
  await prisma.companyProfile
    .deleteMany({ where: { orgId: { in: [orgId, otherOrgId, demo.organization.id] } } })
    .catch(() => undefined);
  await prisma.productCategory.deleteMany({ where: { orgId } }).catch(() => undefined);
  await prisma.membershipCategory
    .deleteMany({ where: { orgId: { in: [orgId, otherOrgId] } } })
    .catch(() => undefined);
  await prisma.bookingCategory
    .deleteMany({ where: { orgId: { in: [orgId, otherOrgId, demo.organization.id] } } })
    .catch(() => undefined);
  await prisma.membership
    .deleteMany({
      where: { orgId: { in: [orgId, otherOrgId, demo.organization.id] } },
    })
    .catch(() => undefined);
  await prisma.organization
    .deleteMany({
      where: { id: { in: [orgId, otherOrgId, demo.organization.id] } },
    })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { id: { in: [user.id, otherUser.id, demoUser.id] } } })
    .catch(() => undefined);

  if (failed) {
    console.error(`\n${failed} public category step 1 check(s) failed`);
    process.exit(1);
  }
  console.log("\nPublic category step 1 smoke OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
