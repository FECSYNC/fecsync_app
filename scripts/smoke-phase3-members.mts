/**
 * Phase 3 helper smoke (no HTTP): grant ⊆ actor, last-admin demote/hard-delete,
 * template ⊆ actor + in-use, tailor non-staff CWV.
 * Run: yarn smoke:phase3-members
 * HTTP matrix (client/catalog_editor GET, Fresh 401): yarn verify-rbac blocks K/H.
 */
import { PrismaClient } from "@prisma/client";
import {
  loadDatabaseUrl,
} from "./prisma-env.mjs";

loadDatabaseUrl();

async function main() {
  const {
    assertAssignableGrantsExtended,
    assertTemplatePermissionsSubset,
    assertRoleTemplateDeletable,
    ROLE_TEMPLATE_IN_USE_MESSAGE,
  } = await import("../src/lib/roleTemplateAdmin.ts");
  const { ForbiddenError } = await import("../src/lib/auth/http-error.ts");
  const {
    updateMembershipGuardingLastAdmin,
    hardDeleteOrgMemberUser,
    LAST_PLATFORM_ADMIN_MESSAGE,
  } = await import("../src/lib/memberAdmin.ts");
  const { isStaffPreset } = await import("../src/lib/auth/permissions.ts");

  const prisma = new PrismaClient();
  let failed = 0;
  const check = (id: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed += 1;
  };

  check("tailor-not-staff", isStaffPreset("tailor") === false, "isStaffPreset");

  // Over-grant: limited actor cannot assign catalog_editor
  try {
    assertAssignableGrantsExtended(
      ["users:read", "users:invite", "users:manage_roles", "orders:read"],
      { rolePreset: "catalog_editor" },
      { permissions: ["users:read", "users:invite", "users:manage_roles", "orders:read"] }
    );
    check("over-grant", false, "expected ForbiddenError");
  } catch (err) {
    check(
      "over-grant",
      err instanceof ForbiddenError,
      err instanceof Error ? err.message : String(err)
    );
  }

  // Template over-grant: ops-held set cannot include settings:manage
  try {
    assertTemplatePermissionsSubset(
      ["users:read", "users:manage_roles", "orders:read"],
      ["users:read", "settings:manage"]
    );
    check("template-over-grant", false, "expected ForbiddenError");
  } catch (err) {
    check(
      "template-over-grant",
      err instanceof ForbiddenError,
      err instanceof Error ? err.message : String(err)
    );
  }

  const org =
    (await prisma.organization.findFirst({ where: { isDefault: true } })) ||
    (await prisma.organization.findFirst());
  if (!org) {
    console.error("No organization — run ensure-default-org");
    process.exit(1);
  }

  // Last admin: create throwaway sole admin membership and demote → 403
  const email = `smoke-phase3-lastadmin-${Date.now()}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      password: "x",
      username: `smoke${Date.now()}`,
      firstName: "Smoke",
      lastName: "Admin",
      role: "admin",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      orgId: org.id,
      rolePreset: "platform_admin",
      companyWideView: true,
      status: "active",
    },
  });

  // Temporarily demote other platform_admins in this org so `membership` is sole.
  const others = await prisma.membership.findMany({
    where: {
      orgId: org.id,
      rolePreset: "platform_admin",
      status: "active",
      id: { not: membership.id },
    },
  });
  for (const o of others) {
    await prisma.membership.update({
      where: { id: o.id },
      data: { rolePreset: "ops_manager" },
    });
  }

  try {
    try {
      await updateMembershipGuardingLastAdmin({
        membership: {
          id: membership.id,
          orgId: org.id,
          rolePreset: "platform_admin",
          status: "active",
        },
        next: { rolePreset: "ops_manager" },
        data: { rolePreset: "ops_manager" },
      });
      check("last-admin", false, "expected ForbiddenError");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      check(
        "last-admin",
        err instanceof ForbiddenError && msg.includes("platform_admin"),
        msg
      );
    }

    try {
      await hardDeleteOrgMemberUser({
        membership: {
          id: membership.id,
          orgId: org.id,
          userId: user.id,
          rolePreset: "platform_admin",
          status: "active",
        },
        actorSub: "smoke-phase3-actor",
      });
      check("last-admin-hard-delete", false, "expected ForbiddenError");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      check(
        "last-admin-hard-delete",
        err instanceof ForbiddenError &&
          (msg.includes("platform_admin") ||
            msg.includes(LAST_PLATFORM_ADMIN_MESSAGE)),
        msg
      );
    }
  } finally {
    for (const o of others) {
      await prisma.membership.update({
        where: { id: o.id },
        data: { rolePreset: "platform_admin", status: "active" },
      });
    }
    await prisma.membership.delete({ where: { id: membership.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  // Template in-use
  const tpl = await prisma.roleTemplate.create({
    data: {
      orgId: org.id,
      name: `smoke-phase3-${Date.now()}`,
      description: "",
      permissions: ["orders:read"],
    },
  });
  const assignee = await prisma.user.create({
    data: {
      email: `smoke-phase3-assignee-${Date.now()}@test.local`,
      password: "x",
      username: `smoketa${Date.now()}`,
      firstName: "T",
      lastName: "A",
      role: "client",
      isVerified: true,
      joinedAt: new Date(),
    },
  });
  await prisma.membership.create({
    data: {
      userId: assignee.id,
      orgId: org.id,
      rolePreset: "custom",
      roleTemplateId: tpl.id,
      companyWideView: false,
      status: "invited",
    },
  });
  try {
    await assertRoleTemplateDeletable(org.id, tpl.id);
    check("template-in-use", false, "expected ForbiddenError");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(
      "template-in-use",
      err instanceof ForbiddenError &&
        msg.includes("role template"),
      msg || ROLE_TEMPLATE_IN_USE_MESSAGE
    );
  }

  // After revoke, Part 9 allows template delete; must not leave Restrict FK orphans.
  await prisma.membership.update({
    where: { id: (await prisma.membership.findFirst({
      where: { userId: assignee.id, orgId: org.id },
      select: { id: true },
    }))!.id },
    data: { status: "revoked" },
  });
  try {
    await assertRoleTemplateDeletable(org.id, tpl.id);
    const { detachRevokedRoleTemplateAssignments } = await import(
      "@/lib/roleTemplateAdmin"
    );
    await detachRevokedRoleTemplateAssignments(org.id, tpl.id);
    await prisma.roleTemplate.delete({ where: { id: tpl.id } });
    check("template-delete-after-revoke", true, "deleted");
  } catch (err) {
    check(
      "template-delete-after-revoke",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  await prisma.membership.deleteMany({ where: { userId: assignee.id } });
  await prisma.user.delete({ where: { id: assignee.id } });
  await prisma.roleTemplate.deleteMany({ where: { id: tpl.id } });

  // Tailor CWV must stay false even if Membership flag is true (staff CWV semantics).
  const { resolveCompanyWideView } = await import("@/lib/auth/permissions");
  check(
    "tailor-cwv-forced-false",
    resolveCompanyWideView({
      rolePreset: "tailor",
      companyWideView: true,
    }) === false,
    "tailor CWV"
  );
  await prisma.$disconnect();
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nPhase 3 smoke passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
