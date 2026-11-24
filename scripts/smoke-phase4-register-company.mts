/**
 * Phase 4 smoke: company registration helper + authz preferOrgId +
 * cross-tenant isolation + signup role ignore + revoked no-elevate +
 * sole-admin DELETE /me guard + PAYMENT_POLICY shape.
 *
 *   yarn smoke:phase4-register
 * HTTP E2E (register cookies, Fresh 401, proxy): yarn verify-rbac blocks L/H/I
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
    findPendingRegisteredCompanyAdminOrgId,
    findRegisteredCompanyAdminOrgId,
  } = await import("../src/lib/orgRegistration.ts");
  const { resolveAuthzForUser } = await import("../src/lib/membership.ts");
  const { isStaffActor } = await import("../src/lib/auth/routePolicy.ts");
  const stamp = Date.now();

  // --- Company A register ---
  const userA = await prisma.user.create({
    data: {
      email: `smoke-p4-a-${stamp}@test.local`,
      password: "x",
      username: `smokep4a${stamp}`,
      firstName: "A",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const regA = await createOrganizationWithPlatformAdmin({
    name: `Smoke Co A ${stamp}`,
    slug: `smoke-co-a-${stamp}`,
    userId: userA.id,
    invalidateSessions: true,
  });
  check(
    "company-a-starts-pending",
    regA.organization.status === "pending",
    String(regA.organization.status)
  );
  check(
    "company-a-subscription-none",
    regA.organization.subscriptionStatus === "none",
    String(regA.organization.subscriptionStatus)
  );
  const venueCountA = await prisma.venueLocation.count({
    where: { orgId: regA.organization.id },
  });
  check(
    "company-a-zero-venues-on-register",
    venueCountA === 0,
    `venues=${venueCountA}`
  );
  const { getPlanLimits } = await import("../src/lib/subscriptionPlans.ts");
  check(
    "plan-ssot-has-venues-cap",
    getPlanLimits("starter").venues === 1 &&
      getPlanLimits("growth").venues === 5 &&
      getPlanLimits("starter").roleTemplates === 5,
    "venues/roleTemplates"
  );
  const pendingOrgId = await findPendingRegisteredCompanyAdminOrgId(userA.id);
  check(
    "idempotent-find-pending-company-admin-org",
    pendingOrgId === regA.organization.id,
    `org=${pendingOrgId}`
  );
  const activeFindBeforeApprove = await findRegisteredCompanyAdminOrgId(userA.id);
  check(
    "active-find-empty-while-pending",
    activeFindBeforeApprove === null,
    `org=${activeFindBeforeApprove}`
  );
  const refreshedA = await prisma.user.findUniqueOrThrow({
    where: { id: userA.id },
  });
  const authzA = await resolveAuthzForUser(refreshedA, {
    preferOrgId: regA.organization.id,
  });
  check(
    "company-a-platform-admin",
    authzA.preset === "platform_admin" &&
      authzA.orgId === regA.organization.id &&
      authzA.companyWideView === true,
    `${authzA.preset} org=${authzA.orgId}`
  );
  check(
    "company-a-not-default",
    regA.organization.isDefault === false,
    "isDefault"
  );
  check(
    "company-a-user-role-admin",
    refreshedA.role === "admin",
    refreshedA.role
  );
  check(
    "company-a-session-invalidated",
    typeof refreshedA.refreshTokenJTI === "string" &&
      refreshedA.refreshTokenJTI.startsWith("revoked:"),
    "JTI"
  );

  // --- Company B register ---
  const userB = await prisma.user.create({
    data: {
      email: `smoke-p4-b-${stamp}@test.local`,
      password: "x",
      username: `smokep4b${stamp}`,
      firstName: "B",
      lastName: "Admin",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const regB = await createOrganizationWithPlatformAdmin({
    name: `Smoke Co B ${stamp}`,
    slug: `smoke-co-b-${stamp}`,
    userId: userB.id,
    invalidateSessions: true,
  });
  check(
    "two-companies-distinct",
    regA.organization.id !== regB.organization.id,
    "org ids"
  );

  // Cross-tenant: fabric stamped for A must not match B's org filter.
  const fabricA = await prisma.fabric.create({
    data: {
      name: `Smoke Fabric A ${stamp}`,
      orgId: regA.organization.id,
      createdById: userA.id,
      type: "cotton",
      color: "white",
      image: "",
    },
  });
  const bSeesA = await prisma.fabric.findFirst({
    where: { id: fabricA.id, orgId: regB.organization.id },
  });
  check("cross-tenant-fabric-403-shape", bSeesA === null, "B cannot load A fabric by org");

  // Signup role ignore: simulate signup invariant (client only, no membership).
  const customer = await prisma.user.create({
    data: {
      email: `smoke-p4-cust-${stamp}@test.local`,
      password: "x",
      username: `smokep4c${stamp}`,
      firstName: "Cust",
      lastName: "Omer",
      role: "client", // signup ignores body.role=admin
      isVerified: false,
      joinedAt: new Date(),
    },
  });
  const custMemberships = await prisma.membership.count({
    where: { userId: customer.id },
  });
  check(
    "customer-signup-no-org",
    customer.role === "client" && custMemberships === 0,
    "client + no membership"
  );
  check(
    "client-not-staff-edge",
    !isStaffActor(customer.role, "client"),
    "isStaffActor"
  );

  // Revoked membership must not elevate via User.role=admin.
  await prisma.membership.update({
    where: { id: regA.membership.id },
    data: { status: "revoked" },
  });
  const revokedAuthz = await resolveAuthzForUser(
    await prisma.user.findUniqueOrThrow({ where: { id: userA.id } })
  );
  check(
    "revoked-no-elevate",
    revokedAuthz.preset === "client" ||
      (revokedAuthz.permissions?.length ?? 0) === 0,
    `${revokedAuthz.preset} perms=${revokedAuthz.permissions?.length ?? 0}`
  );
  check(
    "revoked-not-staff-edge",
    !isStaffActor("admin", revokedAuthz.preset),
    `preset=${revokedAuthz.preset}`
  );

  // Stale JWT shape: after authzVersion bump, claim av must be below DB
  // (Fresh rejects with "Session outdated; sign in again").
  const afterBump = await prisma.user.update({
    where: { id: userB.id },
    data: { authzVersion: { increment: 1 } },
    select: { authzVersion: true },
  });
  const staleAv = (afterBump.authzVersion ?? 1) - 1;
  check(
    "stale-jwt-av-behind-db",
    staleAv < (afterBump.authzVersion ?? 0),
    `claimAv=${staleAv} dbAv=${afterBump.authzVersion}`
  );

  // Tailor preset is not staff at the edge (default landing /tailor/home).
  check(
    "tailor-not-staff-edge",
    !isStaffActor("client", "tailor"),
    "tailor preset"
  );
  check(
    "platform-admin-is-staff-edge",
    isStaffActor("admin", "platform_admin"),
    "platform_admin"
  );

  // DELETE /api/auth/me refuses sole platform_admin (same helper the route uses).
  const { assertNotLastPlatformAdmin, LAST_PLATFORM_ADMIN_MESSAGE } =
    await import("../src/lib/memberAdmin.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  try {
    await assertNotLastPlatformAdmin(
      {
        id: regB.membership.id,
        orgId: regB.organization.id,
        rolePreset: "platform_admin",
        status: "active",
      },
      { status: "revoked" }
    );
    check("sole-admin-delete-me-blocked", false, "expected ForbiddenError");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(
      "sole-admin-delete-me-blocked",
      err instanceof ForbiddenError &&
        (msg.includes("platform_admin") ||
          msg.includes(LAST_PLATFORM_ADMIN_MESSAGE)),
      msg
    );
  }

  const { PAYMENT_POLICY } = await import("../src/lib/auth/permissions.ts");
  check(
    "payment-policy-unchanged",
    PAYMENT_POLICY.methods.stripe.uiEnabled === true &&
      PAYMENT_POLICY.methods.paystack.uiEnabled === false,
    "Stripe on / Paystack off"
  );

  // Cleanup
  await prisma.fabric.deleteMany({ where: { id: fabricA.id } });
  await prisma.membership.deleteMany({
    where: { userId: { in: [userA.id, userB.id, customer.id] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [regA.organization.id, regB.organization.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userA.id, userB.id, customer.id] } },
  });

  await prisma.$disconnect();
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nPhase 4 register-company smoke passed.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
