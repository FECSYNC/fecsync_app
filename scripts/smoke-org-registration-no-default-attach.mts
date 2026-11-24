/**
 * Prove registration does not attach the user to the default/storefront org.
 * Usage: npx tsx scripts/smoke-org-registration-no-default-attach.mts
 */
import { loadDatabaseUrl } from "./prisma-env.mjs";
loadDatabaseUrl();

const { createOrganizationWithPlatformAdmin } = await import(
  "../src/lib/orgRegistration.ts"
);
const { ensureAdminMembership, resolvePrimaryMembership, resolveAuthzForUser } =
  await import("../src/lib/membership.ts");
const { getDefaultOrgId } = await import("../src/lib/org.ts");
const { default: prisma } = await import("../src/lib/prisma.ts");

const stamp = Date.now();
const user = await prisma.user.create({
  data: {
    email: `rbac-p1-nodflt-${stamp}@test.local`,
    password: "x",
    role: "client",
    isVerified: true,
    username: `p1nd${stamp}`,
  },
});

const { organization, membership } = await createOrganizationWithPlatformAdmin({
  name: `NoDefault Co ${stamp}`,
  slug: `no-default-co-${stamp}`,
  userId: user.id,
});

const refreshed = await prisma.user.findUniqueOrThrow({
  where: { id: user.id },
  select: { id: true, role: true },
});

const ensured = await ensureAdminMembership({
  id: user.id,
  role: "admin",
});
const defaultOrgId = await getDefaultOrgId();
const onDefault = await prisma.membership.findUnique({
  where: { userId_orgId: { userId: user.id, orgId: defaultOrgId } },
});

const primary = await resolvePrimaryMembership(user.id, {
  preferOrgId: organization.id,
});
const authzPreferred = await resolveAuthzForUser(
  { id: user.id, role: refreshed.role },
  { preferOrgId: organization.id }
);
const authzDefault = await resolveAuthzForUser({
  id: user.id,
  role: refreshed.role,
});

const checks = [
  ["User.role synced to admin after register", refreshed.role === "admin"],
  ["ensureAdminMembership did not create default row", ensured === null],
  ["no membership on default org", onDefault === null],
  ["preferOrgId primary is new org", primary?.id === membership.id],
  [
    "preferOrgId authz → new org platform_admin",
    authzPreferred.preset === "platform_admin" &&
      authzPreferred.orgId === organization.id,
  ],
  [
    "single-membership login authz → new org (no storefront steal)",
    authzDefault.preset === "platform_admin" &&
      authzDefault.orgId === organization.id,
  ],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", label);
  if (!ok) failed += 1;
}

await prisma.activityLog.deleteMany({ where: { orgId: organization.id } });
await prisma.membership.delete({ where: { id: membership.id } });
await prisma.organization.delete({ where: { id: organization.id } });
await prisma.user.delete({ where: { id: user.id } });
await prisma.$disconnect();

if (failed) process.exit(1);
console.log("PASS no-default-attach reconciliation");
