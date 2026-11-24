/**
 * Regression: bootstrap admin recovery + multi-membership primary must both work.
 * Usage: npx tsx scripts/smoke-membership-primary-regression.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { createOrganizationWithPlatformAdmin } = await import(
  "../src/lib/orgRegistration.ts"
);
const {
  ensureAdminMembership,
  resolveAuthzForUser,
  resolvePrimaryMembership,
} = await import("../src/lib/membership.ts");
const { getDefaultOrgId } = await import("../src/lib/org.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");

const stamp = Date.now();
const defaultOrgId = await getDefaultOrgId();
let failed = 0;

function check(label, ok) {
  console.log(ok ? "PASS" : "FAIL", label);
  if (!ok) failed += 1;
}

// --- A: sole stuck empty custom on default still self-heals (bootstrap) ---
const sole = await prisma.user.create({
  data: {
    email: `rbac-reg-sole-${stamp}@test.local`,
    password: "x",
    role: "admin",
    isVerified: true,
    username: `rsole${stamp}`,
  },
});
const soleMem = await prisma.membership.create({
  data: {
    userId: sole.id,
    orgId: defaultOrgId,
    rolePreset: "custom",
    permissionsOverride: [],
    companyWideView: false,
    status: "active",
  },
});
const ensuredSole = await ensureAdminMembership({
  id: sole.id,
  role: "admin",
});
const soleAfter = await prisma.membership.findUniqueOrThrow({
  where: { id: soleMem.id },
});
check(
  "bootstrap sole stuck custom → platform_admin heal",
  ensuredSole?.rolePreset === "platform_admin" &&
    soleAfter.rolePreset === "platform_admin"
);
const soleAuthz = await resolveAuthzForUser({ id: sole.id, role: "admin" });
check(
  "bootstrap sole heal yields staff permissions",
  soleAuthz.permissions.length > 0 && soleAuthz.orgId === defaultOrgId
);

await prisma.membership.delete({ where: { id: soleMem.id } });
await prisma.user.delete({ where: { id: sole.id } });

// --- B: User.role=admin with no membership → attach default platform_admin ---
const bare = await prisma.user.create({
  data: {
    email: `rbac-reg-bare-${stamp}@test.local`,
    password: "x",
    role: "admin",
    isVerified: true,
    username: `rbare${stamp}`,
  },
});
const ensuredBare = await ensureAdminMembership({
  id: bare.id,
  role: "admin",
});
check(
  "admin with no membership gets default platform_admin",
  ensuredBare?.rolePreset === "platform_admin" &&
    ensuredBare?.orgId === defaultOrgId
);
if (ensuredBare) {
  await prisma.membership.delete({ where: { id: ensuredBare.id } });
}
await prisma.user.delete({ where: { id: bare.id } });

// --- C: company PA + stuck Harewa custom → usable company primary, no Harewa promote ---
const dual = await prisma.user.create({
  data: {
    email: `rbac-reg-dual-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `rdual${stamp}`,
  },
});
const { organization, membership } = await createOrganizationWithPlatformAdmin({
  name: `Reg Dual Co ${stamp}`,
  slug: `reg-dual-co-${stamp}`,
  userId: dual.id,
});
const harewaStuck = await prisma.membership.create({
  data: {
    userId: dual.id,
    orgId: defaultOrgId,
    rolePreset: "custom",
    permissionsOverride: [],
    companyWideView: false,
    status: "active",
  },
});
const primary = await resolvePrimaryMembership(dual.id);
const authz = await resolveAuthzForUser({ id: dual.id, role: "admin" });
const harewaAfter = await prisma.membership.findUniqueOrThrow({
  where: { id: harewaStuck.id },
});

check(
  "skips stuck Harewa custom → company primary",
  primary?.id === membership.id && authz.orgId === organization.id
);
check(
  "company primary keeps platform_admin permissions",
  authz.preset === "platform_admin" && authz.permissions.length > 0
);
check(
  "stuck Harewa custom not promoted to platform_admin",
  harewaAfter.rolePreset === "custom"
);

// --- D: empty custom (+ empty template) on registered company must NOT escalate ---
const esc = await prisma.user.create({
  data: {
    email: `rbac-reg-esc-${stamp}@test.local`,
    password: "x",
    role: "admin",
    isVerified: true,
    username: `resc${stamp}`,
  },
});
const escOrg = await createOrganizationWithPlatformAdmin({
  name: `Reg Esc Co ${stamp}`,
  slug: `reg-esc-co-${stamp}`,
  userId: esc.id,
});
// Demote company PA seat to empty custom with empty template (attack shape).
const emptyTpl = await prisma.roleTemplate.create({
  data: {
    orgId: escOrg.organization.id,
    name: `Empty ${stamp}`,
    permissions: [],
  },
});
await prisma.membership.update({
  where: { id: escOrg.membership.id },
  data: {
    rolePreset: "custom",
    roleTemplateId: emptyTpl.id,
    permissionsOverride: [],
    companyWideView: false,
  },
});
const escAuthz = await resolveAuthzForUser({ id: esc.id, role: "admin" });
const escMemAfter = await prisma.membership.findUniqueOrThrow({
  where: { id: escOrg.membership.id },
});
check(
  "empty custom+template on company does not become platform_admin",
  escMemAfter.rolePreset === "custom" &&
    escAuthz.preset !== "platform_admin" &&
    escAuthz.permissions.length === 0
);

// client-only path unchanged
const client = await prisma.user.create({
  data: {
    email: `rbac-reg-client-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `rcli${stamp}`,
  },
});
const clientAuthz = await resolveAuthzForUser({
  id: client.id,
  role: "client",
});
check(
  "client without membership stays client preset",
  clientAuthz.preset === "client" && clientAuthz.orgId == null
);

await prisma.activityLog.deleteMany({ where: { orgId: organization.id } });
await prisma.membership.deleteMany({ where: { userId: dual.id } });
await prisma.organization.delete({ where: { id: organization.id } });
await prisma.user.delete({ where: { id: dual.id } });
await prisma.user.delete({ where: { id: client.id } });

await prisma.activityLog.deleteMany({ where: { orgId: escOrg.organization.id } });
await prisma.membership.deleteMany({ where: { userId: esc.id } });
await prisma.roleTemplate.delete({ where: { id: emptyTpl.id } });
await prisma.organization.delete({ where: { id: escOrg.organization.id } });
await prisma.user.delete({ where: { id: esc.id } });
await prisma.$disconnect();

if (failed) process.exit(1);
console.log("PASS membership primary regression");
