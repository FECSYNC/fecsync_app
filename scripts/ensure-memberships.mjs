/**
 * Step 5.2 — migrate User.role === "admin" → Membership platform_admin
 * on the default Organization. Idempotent. Clients get no staff membership.
 * Step 7.1 — also archives User.role "seller" → "client".
 *
 * Does NOT reactivate revoked/suspended seats unless --force-reactivate
 * (aligned with runtime ensureAdminMembership).
 *
 * Usage:
 *   yarn ensure-memberships
 *   yarn ensure-memberships --force-reactivate
 *
 * Prefer running after yarn ensure-default-org.
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();
const forceReactivate = process.argv.includes("--force-reactivate");

let defaultOrg = await prisma.organization.findFirst({ where: { isDefault: true } });
if (!defaultOrg) {
  defaultOrg = await prisma.organization.findUnique({ where: { slug: "harewa" } });
}
if (!defaultOrg) {
  console.error("No default Organization found. Run yarn ensure-default-org first.");
  await prisma.$disconnect();
  process.exit(1);
}

const orgId = defaultOrg.id;
console.log("Default org:", defaultOrg.name || "Harewa", orgId);
if (forceReactivate) {
  console.log("NOTE: --force-reactivate will restore revoked/suspended seats");
}

const admins = await prisma.user.findMany({ where: { role: "admin" } });
console.log("Admin users found:", admins.length);

const sellerResult = await prisma.user.updateMany({
  where: { role: "seller" },
  data: { role: "client" },
});
if (sellerResult.count > 0) {
  console.log("Archived seller → client:", sellerResult.count);
}

let created = 0;
let reused = 0;
let repaired = 0;
let skippedTerminal = 0;

async function bumpAuthz(userId) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      authzVersion: { increment: 1 },
      // Match invalidateUserSessions — null JTI would allow old refresh cookies.
      refreshTokenJTI: `revoked:${randomUUID()}`,
    },
  });
}

for (const admin of admins) {
  const email = String(admin.email || "");
  if (email.includes("rbac-matrix")) {
    reused += 1;
    continue;
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: admin.id, orgId } },
  });

  // Align with runtime ensureAdminMembership: any Membership on another org
  // (any status) blocks inventing/repairing a storefront platform_admin seat.
  const otherOrgMembership = await prisma.membership.findFirst({
    where: {
      userId: admin.id,
      orgId: { not: orgId },
    },
    select: { id: true, orgId: true, status: true },
  });
  if (otherOrgMembership) {
    reused += 1;
    console.log(
      "SKIP (has membership on other org)",
      email || admin.id,
      "→",
      otherOrgMembership.orgId,
      otherOrgMembership.status
    );
    continue;
  }

  if (existing) {
    if (
      (existing.status === "revoked" || existing.status === "suspended") &&
      !forceReactivate
    ) {
      skippedTerminal += 1;
      console.log(
        "SKIP (terminal status; pass --force-reactivate to restore)",
        email || admin.id,
        existing.status
      );
      continue;
    }

    const needsRepair =
      existing.rolePreset !== "platform_admin" ||
      existing.status !== "active" ||
      Boolean(existing.roleTemplateId) ||
      (existing.rolePreset === "custom" &&
        !(existing.permissionsOverride || []).length);

    if (needsRepair) {
      await prisma.membership.update({
        where: { id: existing.id },
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
      console.log("REPAIRED membership for", email || admin.id);
      continue;
    }

    reused += 1;
    continue;
  }

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
  console.log("CREATED membership for", email || admin.id);
}

console.log(
  `Done. created=${created}, reused=${reused}, repaired=${repaired}, skippedTerminal=${skippedTerminal}`
);
console.log(
  "Effective permissions = rolePreset ∪ permissionsOverride (union)."
);
console.log("Clients without membership keep legacy User.role expansion.");

await prisma.$disconnect();
