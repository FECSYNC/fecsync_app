/**
 * Phase 2: cross-tenant 403 + CWV=false own-scope for fabric/category/product.
 * Usage: npx tsx scripts/smoke-phase2-tenancy.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { createOrganizationWithPlatformAdmin } = await import(
  "../src/lib/orgRegistration.ts"
);
const {
  assertActorOrgMatch,
  assertStaffCreatedByOwnScope,
  assertStaffProductOwnScope,
  staffOwnProductFilter,
  withStaffDataScope,
  actorHasCompanyWideView,
  CROSS_TENANT_MESSAGE,
} = await import("../src/lib/staffOrg.ts");
const { getDefaultOrgId, getStorefrontOrgId } = await import(
  "../src/lib/org.ts"
);
const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");

const stamp = Date.now();
let failed = 0;
function check(label, ok, detail = "") {
  console.log(ok ? "PASS" : "FAIL", label, detail ? `:: ${detail}` : "");
  if (!ok) failed += 1;
}

const storefrontOrgId = await getStorefrontOrgId();
const defaultOrgId = await getDefaultOrgId();

const userA = await prisma.user.create({
  data: {
    email: `rbac-p2-a-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `p2a${stamp}`,
  },
});
const userB = await prisma.user.create({
  data: {
    email: `rbac-p2-b-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `p2b${stamp}`,
  },
});

const regA = await createOrganizationWithPlatformAdmin({
  name: `P2 Co A ${stamp}`,
  slug: `p2-co-a-${stamp}`,
  userId: userA.id,
});
const regB = await createOrganizationWithPlatformAdmin({
  name: `P2 Co B ${stamp}`,
  slug: `p2-co-b-${stamp}`,
  userId: userB.id,
});

const fabricB = await prisma.fabric.create({
  data: {
    orgId: regB.organization.id,
    name: `Fabric B ${stamp}`,
    image: "https://example.com/f.jpg",
    type: "cotton",
    color: "blue",
    createdById: userB.id,
    createdByName: "B",
  },
});
const catB = await prisma.productCategory.create({
  data: {
    orgId: regB.organization.id,
    name: `Cat B ${stamp}`,
    legacyStringId: `cat-b-${stamp}`,
    createdById: userB.id,
    createdByName: "B",
  },
});

// Cross-tenant assert
try {
  assertActorOrgMatch(regA.organization.id, fabricB.orgId);
  check("cross-tenant fabric assert throws", false);
} catch (e) {
  check(
    "cross-tenant fabric → Cross-tenant access denied",
    e instanceof ForbiddenError && e.message === CROSS_TENANT_MESSAGE
  );
}
try {
  assertActorOrgMatch(regA.organization.id, catB.orgId);
  check("cross-tenant category assert throws", false);
} catch (e) {
  check(
    "cross-tenant category → Cross-tenant access denied",
    e instanceof ForbiddenError && e.message === CROSS_TENANT_MESSAGE
  );
}

// Same-org match OK
try {
  assertActorOrgMatch(regB.organization.id, fabricB.orgId);
  check("same-org fabric match OK", true);
} catch {
  check("same-org fabric match OK", false);
}

// CWV false own-scope
const editor = {
  sub: userA.id,
  orgId: regA.organization.id,
  companyWideView: false,
  preset: "catalog_editor",
  membershipRole: "catalog_editor",
};
check("editor CWV false", actorHasCompanyWideView(editor) === false);

const adminForcedCwv = {
  sub: userA.id,
  orgId: regA.organization.id,
  companyWideView: false,
  preset: "platform_admin",
  membershipRole: "platform_admin",
};
check(
  "platform_admin CWV forced true even if claim false",
  actorHasCompanyWideView(adminForcedCwv) === true
);

const fabricAOwn = await prisma.fabric.create({
  data: {
    orgId: regA.organization.id,
    name: `Fabric A own ${stamp}`,
    image: "https://example.com/a.jpg",
    type: "silk",
    color: "red",
    createdById: userA.id,
    createdByName: "A",
  },
});
const fabricAOther = await prisma.fabric.create({
  data: {
    orgId: regA.organization.id,
    name: `Fabric A other ${stamp}`,
    image: "https://example.com/ao.jpg",
    type: "wool",
    color: "green",
    createdById: userB.id,
    createdByName: "other",
  },
});
const catA = await prisma.productCategory.create({
  data: {
    orgId: regA.organization.id,
    name: `Cat A ${stamp}`,
    legacyStringId: `cat-a-${stamp}`,
    createdById: userA.id,
    createdByName: "A",
  },
});

try {
  assertStaffCreatedByOwnScope(editor, fabricAOwn.createdById);
  check("CWV false allows own fabric", true);
} catch {
  check("CWV false allows own fabric", false);
}
try {
  assertStaffCreatedByOwnScope(editor, fabricAOther.createdById);
  check("CWV false blocks coworker fabric", false);
} catch (e) {
  check(
    "CWV false blocks coworker fabric",
    e instanceof ForbiddenError
  );
}
try {
  assertStaffCreatedByOwnScope(editor, null);
  check("CWV false blocks null createdById", false);
} catch (e) {
  check(
    "CWV false blocks null createdById",
    e instanceof ForbiddenError
  );
}

const listFilter = withStaffDataScope(
  editor,
  { orgId: regA.organization.id },
  { createdById: editor.sub }
);
const listed = await prisma.fabric.findMany({ where: listFilter });
check(
  "CWV false list only own createdById",
  listed.every((f) => f.createdById === userA.id) &&
    listed.some((f) => f.id === fabricAOwn.id) &&
    !listed.some((f) => f.id === fabricAOther.id)
);

const adminActor = {
  sub: userA.id,
  orgId: regA.organization.id,
  companyWideView: true,
  preset: "platform_admin",
  membershipRole: "platform_admin",
};
check("platform_admin CWV true", actorHasCompanyWideView(adminActor) === true);
try {
  assertStaffCreatedByOwnScope(adminActor, fabricAOther.createdById);
  check("CWV true sees coworker fabric", true);
} catch {
  check("CWV true sees coworker fabric", false);
}

const wideList = withStaffDataScope(
  adminActor,
  { orgId: regA.organization.id },
  { createdById: adminActor.sub }
);
check(
  "CWV true list ignores own filter",
  !("createdById" in wideList) && wideList.orgId === regA.organization.id
);

// Product own-scope: sellerId OR createdById
const productSellerOnly = await prisma.product.create({
  data: {
    orgId: regA.organization.id,
    name: `P2 seller ${stamp}`,
    description: "x",
    location: "x",
    price: 1,
    quantity: 1,
    remainingInStock: 1,
    discount: 0,
    taxExempt: false,
    images: [],
    sizes: [],
    gender: "unisex",
    categoryId: catA.id,
    fabricTypeId: fabricAOwn.id,
    sellerId: userA.id,
    createdById: userB.id,
    createdByName: "other",
  },
});
const productCreatedOnly = await prisma.product.create({
  data: {
    orgId: regA.organization.id,
    name: `P2 created ${stamp}`,
    description: "x",
    location: "x",
    price: 1,
    quantity: 1,
    remainingInStock: 1,
    discount: 0,
    taxExempt: false,
    images: [],
    sizes: [],
    gender: "unisex",
    categoryId: catA.id,
    fabricTypeId: fabricAOwn.id,
    sellerId: null,
    createdById: userA.id,
    createdByName: "A",
  },
});
const productCoworker = await prisma.product.create({
  data: {
    orgId: regA.organization.id,
    name: `P2 coworker ${stamp}`,
    description: "x",
    location: "x",
    price: 1,
    quantity: 1,
    remainingInStock: 1,
    discount: 0,
    taxExempt: false,
    images: [],
    sizes: [],
    gender: "unisex",
    categoryId: catA.id,
    fabricTypeId: fabricAOwn.id,
    sellerId: userB.id,
    createdById: userB.id,
    createdByName: "B",
  },
});

try {
  assertStaffProductOwnScope(editor, productSellerOnly);
  check("CWV false allows product by sellerId", true);
} catch {
  check("CWV false allows product by sellerId", false);
}
try {
  assertStaffProductOwnScope(editor, productCreatedOnly);
  check("CWV false allows product by createdById", true);
} catch {
  check("CWV false allows product by createdById", false);
}
try {
  assertStaffProductOwnScope(editor, productCoworker);
  check("CWV false blocks coworker product", false);
} catch (e) {
  check(
    "CWV false blocks coworker product",
    e instanceof ForbiddenError
  );
}

const productList = withStaffDataScope(
  editor,
  { orgId: regA.organization.id },
  staffOwnProductFilter(editor)
);
const productsListed = await prisma.product.findMany({ where: productList });
check(
  "CWV false product list seller OR createdBy",
  productsListed.some((p) => p.id === productSellerOnly.id) &&
    productsListed.some((p) => p.id === productCreatedOnly.id) &&
    !productsListed.some((p) => p.id === productCoworker.id)
);

// Storefront org unchanged by registration
check(
  "storefront org unchanged",
  storefrontOrgId === defaultOrgId || Boolean(storefrontOrgId)
);
const storefrontStillDefault = await prisma.organization.findFirst({
  where: { isDefault: true },
});
check(
  "registered orgs not isDefault",
  regA.organization.isDefault === false &&
    regB.organization.isDefault === false &&
    storefrontStillDefault?.id === defaultOrgId
);

// Cleanup
await prisma.product.deleteMany({
  where: {
    id: {
      in: [productSellerOnly.id, productCreatedOnly.id, productCoworker.id],
    },
  },
});
await prisma.fabric.deleteMany({
  where: { id: { in: [fabricB.id, fabricAOwn.id, fabricAOther.id] } },
});
await prisma.productCategory.deleteMany({
  where: { id: { in: [catB.id, catA.id] } },
});
await prisma.activityLog.deleteMany({
  where: { orgId: { in: [regA.organization.id, regB.organization.id] } },
});
await prisma.membership.deleteMany({
  where: { orgId: { in: [regA.organization.id, regB.organization.id] } },
});
await prisma.organization.deleteMany({
  where: { id: { in: [regA.organization.id, regB.organization.id] } },
});
await prisma.user.deleteMany({
  where: { id: { in: [userA.id, userB.id] } },
});
await prisma.$disconnect();

if (failed) process.exit(1);
console.log("PASS phase2 tenancy smoke");
