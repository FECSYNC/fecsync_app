/**
 * Security: registered company admin (User.role=admin) must NOT get promoted to
 * platform_admin on a second org just because that membership is stuck empty custom.
 * Also: primary resolution must skip that stuck row so JWT stays usable.
 * Usage: npx tsx scripts/smoke-org-registration-no-cross-promote.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { createOrganizationWithPlatformAdmin } = await import(
  "../src/lib/orgRegistration.ts"
);
const { resolveAuthzForUser, ensureAdminMembership } = await import(
  "../src/lib/membership.ts"
);
const { getDefaultOrgId } = await import("../src/lib/org.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");

const stamp = Date.now();
const user = await prisma.user.create({
  data: {
    email: `rbac-p1-xpromo-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `p1xp${stamp}`,
  },
});

const { organization, membership } = await createOrganizationWithPlatformAdmin({
  name: `XPromo Co ${stamp}`,
  slug: `xpromo-co-${stamp}`,
  userId: user.id,
});

const defaultOrgId = await getDefaultOrgId();

// Stuck empty custom on Harewa while User.role=admin from company org.
const harewaStuck = await prisma.membership.create({
  data: {
    userId: user.id,
    orgId: defaultOrgId,
    rolePreset: "custom",
    permissionsOverride: [],
    companyWideView: false,
    status: "active",
  },
});

const authz = await resolveAuthzForUser({
  id: user.id,
  role: "admin",
});

const harewaAfter = await prisma.membership.findUniqueOrThrow({
  where: { id: harewaStuck.id },
});

// Revoked company membership must not auto-reactivate via User.role=admin.
await prisma.membership.update({
  where: { id: membership.id },
  data: { status: "revoked" },
});
await prisma.membership.update({
  where: { id: harewaStuck.id },
  data: { status: "revoked" },
});
const authzAfterRevoke = await resolveAuthzForUser({
  id: user.id,
  role: "admin",
});
const companyAfter = await prisma.membership.findUniqueOrThrow({
  where: { id: membership.id },
});

const checks = [
  [
    "primary skips stuck Harewa custom → company org",
    authz.orgId === organization.id && authz.preset === "platform_admin",
  ],
  [
    "empty custom on Harewa NOT promoted to platform_admin (other org exists)",
    harewaAfter.rolePreset === "custom",
  ],
  [
    "revoked company membership stays revoked",
    companyAfter.status === "revoked",
  ],
  [
    "admin with only revoked company+Harewa does not keep company platform_admin claims",
    authzAfterRevoke.preset !== "platform_admin" ||
      authzAfterRevoke.orgId === defaultOrgId,
  ],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", label);
  if (!ok) failed += 1;
}

await prisma.activityLog.deleteMany({ where: { orgId: organization.id } });
await prisma.membership.deleteMany({ where: { userId: user.id } });
await prisma.organization.delete({ where: { id: organization.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();

if (failed) process.exit(1);
console.log("PASS no-cross-promote security");
void ensureAdminMembership;
