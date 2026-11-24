/**
 * Only bootstrap path for admins. Public signup and Google OAuth always create
 * role "client" and ignore any client-supplied admin role.
 *
 * Create or promote an admin user (Postgres via Prisma / DATABASE_URL from .env.local).
 *
 * Does NOT reactivate revoked/suspended storefront seats unless
 * --force-reactivate (aligned with runtime ensureAdminMembership).
 *
 * Usage:
 *   node scripts/create-admin.mjs you@email.com YourPassword123
 *   node scripts/create-admin.mjs you@email.com YourPassword123 --force-reactivate
 */
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { loadDatabaseUrl } from "./prisma-env.mjs";

loadDatabaseUrl();
const prisma = new PrismaClient();

const args = process.argv.slice(2).filter((a) => a !== "--force-reactivate");
const forceReactivate = process.argv.includes("--force-reactivate");
const [email, password] = args;

if (!email || !password) {
  console.error(
    "Usage: node scripts/create-admin.mjs <email> <password> [--force-reactivate]"
  );
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const hashed = await bcrypt.hash(password, 12);
const normalizedEmail = email.toLowerCase();
const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

let defaultOrg = await prisma.organization.findFirst({ where: { isDefault: true } });
if (!defaultOrg) {
  defaultOrg = await prisma.organization.findUnique({ where: { slug: "harewa" } });
}
if (!defaultOrg) {
  console.error("No default Organization found — run yarn ensure-default-org first.");
  await prisma.$disconnect();
  process.exit(1);
}

if (existing) {
  const otherOrgMembership = await prisma.membership.findFirst({
    where: {
      userId: existing.id,
      orgId: { not: defaultOrg.id },
    },
    select: { id: true, orgId: true, status: true },
  });
  if (otherOrgMembership) {
    console.error(
      "REFUSED: user already has Membership on another org (",
      otherOrgMembership.orgId,
      otherOrgMembership.status +
        "). create-admin is storefront-only; do not invent a Harewa dual seat."
    );
    await prisma.$disconnect();
    process.exit(1);
  }
}

let userId;

if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: "admin",
      isVerified: true,
      password: hashed,
      verificationCode: null,
    },
  });
  userId = existing.id;
  console.log("UPDATED existing user → admin + verified");
  console.log("email:", normalizedEmail);
} else {
  const joinedAt = new Date();
  const base =
    email
      .split("@")[0]
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 12) || "admin";
  const username = `${base}${joinedAt.getFullYear()}${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const created = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password: hashed,
      username,
      firstName: "Admin",
      lastName: "User",
      isVerified: true,
      accountDeleted: false,
      verificationCode: null,
      refreshTokenJTI: null,
      role: "admin",
      joinedAt,
    },
  });
  userId = created.id;
  console.log("CREATED new admin user (already verified)");
  console.log("email:", normalizedEmail);
  console.log("username:", username);
}

const existingProfile = await prisma.profile.findUnique({ where: { userId } });
if (!existingProfile) {
  await prisma.profile.create({
    data: {
      userId,
      firstName: existing?.firstName || "Admin",
      lastName: existing?.lastName || "User",
      addresses: [],
    },
  });
  console.log("CREATED profile linked to user");
} else {
  console.log("Profile already exists");
}

{
  const existingMembership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId: defaultOrg.id } },
  });
  if (existingMembership) {
    if (
      (existingMembership.status === "revoked" ||
        existingMembership.status === "suspended") &&
      !forceReactivate
    ) {
      console.error(
        "REFUSED: storefront membership is",
        existingMembership.status +
          ". Pass --force-reactivate to restore active platform_admin (matches runtime: no silent re-elevation)."
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    if (
      existingMembership.status !== "active" ||
      existingMembership.rolePreset !== "platform_admin"
    ) {
      await prisma.membership.update({
        where: { id: existingMembership.id },
        data: {
          rolePreset: "platform_admin",
          status: "active",
          roleTemplateId: null,
          permissionsOverride: [],
          companyWideView: true,
        },
      });
      await prisma.user.update({
        where: { id: userId },
        data: {
          authzVersion: { increment: 1 },
          refreshTokenJTI: `revoked:${randomUUID()}`,
        },
      });
      console.log("REPAIRED Membership → active platform_admin on default org");
    } else {
      console.log("Membership already exists on default org");
    }
  } else {
    await prisma.membership.create({
      data: {
        userId,
        orgId: defaultOrg.id,
        rolePreset: "platform_admin",
        status: "active",
        companyWideView: true,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: {
        authzVersion: { increment: 1 },
        refreshTokenJTI: `revoked:${randomUUID()}`,
      },
    });
    console.log("CREATED Membership platform_admin on default org");
  }
}

await prisma.$disconnect();
console.log("Done. Sign in at http://localhost:3000/signin then open /admin");
