/**
 * Admin-created staff users (Step 8).
 */

import bcrypt from "bcrypt";
import dbConnect from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere } from "@/lib/ids";
import { generateUsername, splitFullName } from "@/lib/utils";
import {
  hasPermission,
  parsePermissionList,
  P,
  resolveCompanyWideView,
  PRESET_TO_DB_ROLE,
  isStaffPreset,
  type RolePresetId,
} from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  assertInviteStatusAllowed,
  invalidateUserSessions,
  logMembershipActivity,
  serializeMembership,
  syncUserRoleFromMemberships,
  notifyMembershipInvite,
  type MembershipRolePreset,
  type MembershipStatus,
} from "@/lib/memberAdmin";
import { membershipInviteExpiresAt } from "@/lib/membershipInvites";
import {
  assertAssignableGrantsExtended,
  loadOrgRoleTemplate,
} from "@/lib/roleTemplateAdmin";
import { isMembershipRolePreset } from "@/lib/membership";
import type { NextRequest } from "next/server";
import { assertNotBlacklisted } from "@/lib/userBlacklist";
import { actorHasCompanyWideView } from "@/lib/staffOrg";
import { stampCreate } from "@/lib/audit/recordAudit";
import {
  ensurePendingTailorProfile,
  deleteTailorDomainForUser,
} from "@/lib/tailors";

export type CreateStaffUserInput = {
  fullName: string;
  email: string;
  password: string;
  rolePreset: MembershipRolePreset;
  roleTemplateId?: string | null;
  permissionsOverride?: string[];
  companyWideView?: boolean;
  status: MembershipStatus;
  actorSub: string;
  orgId: string;
  actorPermissions: Iterable<string> | null | undefined;
  actorPreset?: string | null;
  actorMembershipRole?: string | null;
  actorCompanyWideView?: boolean | null;
  actorStorefrontOrgId?: string | null;
  request?: NextRequest;
};

export async function createStaffUserWithMembership(
  input: CreateStaffUserInput
) {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email || !fullName) {
    throw new Error("Full name and email are required");
  }
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (!isMembershipRolePreset(input.rolePreset)) {
    throw new Error("Invalid rolePreset");
  }

  await dbConnect();
  await assertNotBlacklisted(input.orgId, { email });

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, accountDeleted: true },
  });
  if (existing && !existing.accountDeleted) {
    throw new Error("Email already registered");
  }

  let templatePermissions: string[] | null = null;
  let roleTemplateId: string | null = null;
  if (input.roleTemplateId) {
    const template = await loadOrgRoleTemplate(input.orgId, input.roleTemplateId);
    if (!template) {
      throw new Error("Role template not found");
    }
    templatePermissions = parsePermissionList(template.permissions);
    roleTemplateId = String(template._id);
    if (input.rolePreset !== "custom") {
      throw new Error("rolePreset must be custom when using a role template");
    }
  }

  assertInviteStatusAllowed(input.actorPermissions, input.status);
  const permissionsOverride =
    input.permissionsOverride !== undefined
      ? parsePermissionList(input.permissionsOverride)
      : undefined;

  if (
    permissionsOverride !== undefined &&
    !hasPermission(input.actorPermissions, P.UsersManageRoles)
  ) {
    throw new ForbiddenError("Missing required permission");
  }

  assertAssignableGrantsExtended(
    input.actorPermissions,
    {
      rolePreset: input.rolePreset,
      permissionsOverride,
      templatePermissions,
    },
    {
      permissions: input.actorPermissions,
      preset: input.actorPreset,
      membershipRole: input.actorMembershipRole,
      orgId: input.orgId,
      storefrontOrgId:
        input.actorStorefrontOrgId ??
        (await (await import("@/lib/org")).getStorefrontOrgId()),
    }
  );

  const { expireOverdueMembershipInvitesForOrg } = await import(
    "@/lib/membershipInvites"
  );
  await expireOverdueMembershipInvitesForOrg(input.orgId);

  const { assertWithinPlanLimit } = await import("@/lib/planLimits");
  await assertWithinPlanLimit(input.orgId, "members");
  // Brand-new user cannot already occupy a studio seat.
  if (input.rolePreset === "tailor") {
    await assertWithinPlanLimit(input.orgId, "tailorSeats");
  }

  const actorCanCwv = actorHasCompanyWideView({
    companyWideView: input.actorCompanyWideView,
    preset: input.actorPreset,
    membershipRole: input.actorMembershipRole,
  });
  if (!actorCanCwv) {
    throw new ForbiddenError(
      "Company-wide view is required to create other members"
    );
  }
  // Actor has CWV here — grant CWV is allowed; resolveCompanyWideView still
  // forces true for platform_admin, false for tailor, and defaults omitted → false.
  const companyWideView =
    input.rolePreset === "tailor"
      ? false
      : resolveCompanyWideView({
          companyWideView:
            input.companyWideView !== undefined
              ? input.companyWideView
              : false,
          rolePreset: input.rolePreset,
        });

  const joinedAt = new Date();
  const hashedPassword = await bcrypt.hash(input.password, 12);
  const username = await generateUsername(joinedAt, fullName);
  const { firstName, lastName } = await splitFullName(fullName);

  // Tailor providers need an active membership so login JWT resolves to
  // preset `tailor` (invited-only rows used to fall back to client claims).
  const membershipStatus =
    input.rolePreset === "tailor" && input.status === "invited"
      ? "active"
      : input.status;

  const { user, membership } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        username,
        isVerified: true,
        joinedAt,
        role: "client",
      },
    });

    await tx.profile.create({
      data: {
        userId: user.id,
        firstName: firstName || "",
        lastName: lastName || "",
      },
    });

    await tx.wallet.create({
      data: { userId: user.id, balance: 0 },
    });

    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        orgId: input.orgId,
        rolePreset: input.rolePreset,
        roleTemplateId,
        permissionsOverride:
          permissionsOverride && permissionsOverride.length > 0
            ? permissionsOverride
            : [],
        companyWideView,
        status: membershipStatus,
        invitedById: input.actorSub,
        ...(membershipStatus === "invited"
          ? { inviteExpiresAt: membershipInviteExpiresAt() }
          : {}),
      },
    });

    if (
      membershipStatus === "active" &&
      isStaffPreset(input.rolePreset as RolePresetId)
    ) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          role: PRESET_TO_DB_ROLE[input.rolePreset as RolePresetId] ?? "admin",
        },
      });
    }

    return { user, membership };
  });

  // Sync before invalidate so bootstrap cannot briefly re-elevate.
  await syncUserRoleFromMemberships(user.id);
  await invalidateUserSessions(user.id);

  if (input.rolePreset === "tailor") {
    const audit = await stampCreate(input.actorSub);
    try {
      // Active: ensure live studio. Invited: no profile so membership reserves seat.
      if (membershipStatus === "active") {
        await ensurePendingTailorProfile(input.orgId, user.id, audit);
      }
    } catch (ensureErr) {
      // Compensate atomic create so retry is not blocked by orphaned email.
      // Purge tailor domain first — TailorProfile.userId has no onDelete Cascade.
      try {
        await deleteTailorDomainForUser(user.id);
        await prisma.$transaction([
          prisma.membership.deleteMany({ where: { userId: user.id } }),
          prisma.wallet.deleteMany({ where: { userId: user.id } }),
          prisma.profile.deleteMany({ where: { userId: user.id } }),
          prisma.user.delete({ where: { id: user.id } }),
        ]);
      } catch (rollbackErr) {
        console.error(
          "[adminUsers] tailor profile ensure failed; account rollback failed:",
          ensureErr,
          rollbackErr
        );
        throw new Error(
          "Tailor profile setup failed and account rollback failed. Manual cleanup may be required.",
          { cause: rollbackErr }
        );
      }
      throw ensureErr;
    }
  }

  await logMembershipActivity({
    actorSub: input.actorSub,
    orgId: String(input.orgId),
    action: "Created Staff User",
    membershipId: membership.id,
    targetUserId: user.id,
    description: `Created ${email} as ${input.rolePreset} (${membershipStatus})`,
    request: input.request,
    metadata: {
      rolePreset: input.rolePreset,
      roleTemplateId,
      status: membershipStatus,
      permissionsOverride: permissionsOverride ?? [],
      companyWideView,
      orgId: String(input.orgId),
    },
  });

  if (membershipStatus === "invited" && email) {
    await notifyMembershipInvite({
      to: email,
      rolePreset: input.rolePreset,
      orgId: input.orgId,
      invitedBySub: input.actorSub,
      inviteExpiresAt: membership.inviteExpiresAt ?? null,
    });
  } else if (input.rolePreset === "tailor" && email) {
    try {
      const { sendTailorStudioInviteEmail } = await import("@/lib/mailer");
      const org = await prisma.organization.findFirst({
        where: { id: input.orgId },
        select: { name: true },
      });
      await sendTailorStudioInviteEmail({
        to: email,
        displayName: fullName || email,
        orgName: org?.name ? String(org.name) : undefined,
        status: "pending",
        orgId: input.orgId,
      });
    } catch (mailErr) {
      console.error("[adminUsers] tailor studio invite email failed:", mailErr);
    }
  }

  const templateMeta = roleTemplateId
    ? await loadOrgRoleTemplate(input.orgId, roleTemplateId)
    : null;

  const syncedUser = await prisma.user.findFirst({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });

  return serializeMembership(
    membership,
    syncedUser ?? {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
    templateMeta
      ? {
          _id: templateMeta._id,
          name: templateMeta.name,
          permissions: parsePermissionList(templateMeta.permissions),
        }
      : null
  );
}
