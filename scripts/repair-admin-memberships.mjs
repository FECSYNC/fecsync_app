/**
 * Diagnose + repair User.role === "admin" memberships that are not
 * active platform_admin (root cause of 403 Missing required permission).
 *
 * Does NOT reactivate revoked/suspended seats unless --force-reactivate
 * (aligned with runtime ensureAdminMembership).
 *
 * Usage:
 *   node scripts/repair-admin-memberships.mjs
 *   node scripts/repair-admin-memberships.mjs --dry-run
 *   node scripts/repair-admin-memberships.mjs --force-reactivate
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const forceReactivate = process.argv.includes("--force-reactivate");

let defaultOrg = await prisma.organization.findFirst({ where: { isDefault: true } });
if (!defaultOrg) {
  defaultOrg = await prisma.organization.findUnique({ where: { slug: "harewa" } });
}
if (!defaultOrg) {
  console.error("No default Organization. Run yarn ensure-default-org first.");
  await prisma.$disconnect();
  process.exit(1);
}

const orgId = defaultOrg.id;
console.log(dryRun ? "[DRY RUN]" : "[REPAIR]", "Default org:", orgId);
if (forceReactivate) {
  console.log("NOTE: --force-reactivate will restore revoked/suspended seats");
}

const admins = await prisma.user.findMany({ where: { role: "admin" } });
console.log("Admin users:", admins.length);

let ok = 0;
let repaired = 0;
let created = 0;
let skippedTerminal = 0;

async function bumpAuthz(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      authzVersion: { increment: 1 },
      refreshTokenJTI: `revoked:${randomUUID()}`,
      role: "admin",
    },
  });
}

for (const admin of admins) {
  const email = String(admin.email || "");
  if (email.includes("rbac-matrix")) {
    ok += 1;
    console.log("SKIP (matrix fixture)", email);
    continue;
  }

  const rows = await prisma.membership.findMany({ where: { userId: admin.id } });
  const onDefault = rows.find((r) => r.orgId === orgId);
  const activePlatform = rows.find(
    (r) =>
      r.rolePreset === "platform_admin" &&
      r.status === "active" &&
      !r.roleTemplateId
  );

  if (activePlatform) {
    ok += 1;
    console.log("OK ", email, "→", activePlatform.rolePreset, activePlatform.status);
    continue;
  }

  // Align with runtime: any other-org Membership (any status) blocks Harewa invent/repair.
  const otherOrg = rows.find((r) => r.orgId !== orgId);
  if (otherOrg) {
    ok += 1;
    console.log(
      "SKIP (has membership on other org)",
      email,
      "→",
      otherOrg.orgId,
      otherOrg.rolePreset,
      otherOrg.status
    );
    continue;
  }

  if (
    onDefault &&
    (onDefault.status === "revoked" || onDefault.status === "suspended") &&
    !forceReactivate
  ) {
    skippedTerminal += 1;
    console.log(
      "SKIP (terminal status; pass --force-reactivate to restore)",
      email,
      onDefault.status
    );
    continue;
  }

  console.log(
    "NEED",
    email,
    "memberships:",
    rows.map((r) => ({
      org: r.orgId,
      preset: r.rolePreset,
      status: r.status,
      template: r.roleTemplateId,
      override: (r.permissionsOverride || []).length,
    }))
  );

  if (dryRun) continue;

  if (onDefault) {
    await prisma.membership.update({
      where: { id: onDefault.id },
      data: {
        rolePreset: "platform_admin",
        status: "active",
        roleTemplateId: null,
        permissionsOverride: [],
        companyWideView: true,
      },
    });
    await bumpAuthz(admin.id);
    repaired += 1;
    console.log("  → repaired to active platform_admin (sessions invalidated)");
  } else {
    await prisma.membership.create({
      data: {
        userId: admin.id,
        orgId,
        rolePreset: "platform_admin",
        status: "active",
        companyWideView: true,
      },
    });
    await bumpAuthz(admin.id);
    created += 1;
    console.log("  → created active platform_admin membership");
  }
}

console.log(
  `Summary: ok=${ok}, repaired=${repaired}, created=${created}, skippedTerminal=${skippedTerminal}${dryRun ? " (dry-run)" : ""}`
);
console.log(
  dryRun
    ? "Re-run without --dry-run to apply repairs. Then sign out and sign in again."
    : "Sign out and sign in again so JWT picks up full platform_admin permissions."
);

await prisma.$disconnect();
