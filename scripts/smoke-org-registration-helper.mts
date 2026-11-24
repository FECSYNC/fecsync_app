/**
 * Smoke the real TypeScript helper (Phase 1).
 * Usage: npx tsx scripts/smoke-org-registration-helper.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { createOrganizationWithPlatformAdmin } = await import(
  "../src/lib/orgRegistration.ts"
);
const { resolvePrimaryMembership } = await import("../src/lib/membership.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");

const stamp = Date.now();
const email = `rbac-p1-helper-${stamp}@test.local`;

const user = await prisma.user.create({
  data: {
    email,
    password: "x",
    role: "client",
    isVerified: true,
    username: `p1h${stamp}`,
  },
});

const { organization, membership } = await createOrganizationWithPlatformAdmin({
  name: `Helper Co ${stamp}`,
  slug: `helper-co-${stamp}`,
  userId: user.id,
});

const primary = await resolvePrimaryMembership(user.id, {
  preferOrgId: organization.id,
});
const log = await prisma.activityLog.findFirst({
  where: { orgId: organization.id, action: "Organization Registered" },
});
const refreshed = await prisma.user.findUniqueOrThrow({
  where: { id: user.id },
  select: { role: true, refreshTokenJTI: true, authzVersion: true },
});

const ok =
  organization.isDefault === false &&
  organization.status === "pending" &&
  membership.rolePreset === "platform_admin" &&
  membership.companyWideView === true &&
  primary?.id === membership.id &&
  Boolean(log?.orgId) &&
  refreshed.role === "admin" &&
  typeof refreshed.refreshTokenJTI === "string" &&
  refreshed.refreshTokenJTI.startsWith("revoked:") &&
  (refreshed.authzVersion ?? 0) >= 1;

console.log(ok ? "PASS helper createOrganizationWithPlatformAdmin" : "FAIL helper");
if (!ok) {
  console.log({
    isDefault: organization.isDefault,
    rolePreset: membership.rolePreset,
    companyWideView: membership.companyWideView,
    primaryOk: primary?.id === membership.id,
    logOrgId: log?.orgId,
    userRole: refreshed.role,
    refreshJti: refreshed.refreshTokenJTI,
    authzVersion: refreshed.authzVersion,
  });
}

await prisma.activityLog.deleteMany({ where: { orgId: organization.id } });
await prisma.membership.delete({ where: { id: membership.id } });
await prisma.organization.delete({ where: { id: organization.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();

if (!ok) process.exit(1);
