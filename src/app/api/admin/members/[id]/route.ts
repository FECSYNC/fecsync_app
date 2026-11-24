export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  forbidden,
  routeErrorResponse,
} from "@/lib/response";
import {
  requirePermissionFresh,
  requireAnyPermissionFresh,
} from "@/lib/middleware/requireAuth";
import {
  P,
  parsePermissionList,
  isPlatformAdminActor,
  resolveCompanyWideView,
  hasPermission,
} from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId, actorHasCompanyWideView } from "@/lib/staffOrg";
import { isMembershipRolePreset } from "@/lib/membership";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  assertMembershipMutationGrants,
  updateMembershipGuardingLastAdmin,
  invalidateUserSessions,
  hardDeleteOrgMemberUser,
  loadOrgMembership,
  logMembershipActivity,
  serializeMembership,
  serializeMembershipWithTemplate,
  syncUserRoleFromMemberships,
  notifyMembershipInvite,
  loadMembershipAssignedLocationIds,
  isMembershipStatus,
  findLiveOtherOrgMembership,
  ORG_DUAL_SEAT_LIVE_MESSAGE,
  MEMBER_NOT_FOUND_MESSAGE,
} from "@/lib/memberAdmin";
import { loadOrgRoleTemplate } from "@/lib/roleTemplateAdmin";
import { stampCreate, stampUpdate } from "@/lib/audit/recordAudit";
import {
  ensurePendingTailorProfile,
  suspendTailorProfilesForUser,
  deleteTailorDomainForUser,
  snapshotTailorProfileStatuses,
  restoreTailorProfileStatuses,
} from "@/lib/tailors";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    // Company-wide: manage_roles. Franchise managers: invite|manage_roles + scope checks.
    actor = await requireAnyPermissionFresh(request, [
      P.UsersManageRoles,
      P.UsersInvite,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/members/[id]", {
          permission: `${P.UsersManageRoles}|${P.UsersInvite}`,
          metadata: { domain: "membership" },
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(MEMBER_NOT_FOUND_MESSAGE);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) {
    return badRequest("Invalid JSON");
  }

  const nextRole =
    typeof body.rolePreset === "string" ? body.rolePreset.trim() : undefined;
  if (nextRole !== undefined && !isMembershipRolePreset(nextRole)) {
    return badRequest("Invalid rolePreset");
  }

  const nextStatus =
    typeof body.status === "string" ? body.status.trim() : undefined;
  if (nextStatus !== undefined && !isMembershipStatus(nextStatus)) {
    return badRequest("Invalid status");
  }
  void body.orgId;
  void body.userId;
  // Step 3 invite TTL is server-stamped only — never honor client expiry.
  void body.inviteExpiresAt;

  const hasRoleTemplate = Object.prototype.hasOwnProperty.call(
    body,
    "roleTemplateId"
  );
  const nextRoleTemplateRaw = hasRoleTemplate
    ? body.roleTemplateId === null
      ? null
      : typeof body.roleTemplateId === "string"
        ? body.roleTemplateId.trim()
        : undefined
    : undefined;

  const hasOverride = Object.prototype.hasOwnProperty.call(
    body,
    "permissionsOverride"
  );
  const nextOverride = hasOverride
    ? parsePermissionList(body.permissionsOverride)
    : undefined;

  const hasCompanyWideView = Object.prototype.hasOwnProperty.call(
    body,
    "companyWideView"
  );
  let nextCompanyWideView: boolean | undefined;
  if (hasCompanyWideView) {
    if (typeof body.companyWideView !== "boolean") {
      return badRequest("companyWideView must be a boolean");
    }
    nextCompanyWideView = body.companyWideView;
  }

  const hasFranchiseParkManager = Object.prototype.hasOwnProperty.call(
    body,
    "franchiseParkManager"
  );
  let nextFranchiseParkManager: boolean | undefined;
  if (hasFranchiseParkManager) {
    if (typeof body.franchiseParkManager !== "boolean") {
      return badRequest("franchiseParkManager must be a boolean");
    }
    nextFranchiseParkManager = body.franchiseParkManager;
  }

  if (
    nextRole === undefined &&
    nextStatus === undefined &&
    !hasOverride &&
    !hasRoleTemplate &&
    !hasCompanyWideView &&
    !hasFranchiseParkManager
  ) {
    return badRequest(
      "Provide rolePreset, roleTemplateId, status, permissionsOverride, companyWideView, and/or franchiseParkManager"
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { PARK_LOCKED_STAFF_ADMIN_MESSAGE } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    const {
      assertCompanyWideStaffAdminOrFranchiseManager,
      isFranchiseParkManager,
      assertMembershipInFranchiseRoster,
      assertFranchiseManagerSeatInvariants,
      ensureFranchiseManagerCapabilityPermissions,
      resolveFranchiseStaffSeatGrants,
      FRANCHISE_INVITE_NO_CWV,
      FRANCHISE_INVITE_NO_PLATFORM_ADMIN,
    } = await import("@/lib/franchisePark");
    const patchScope = await assertCompanyWideStaffAdminOrFranchiseManager(
      actor,
      PARK_LOCKED_STAFF_ADMIN_MESSAGE
    );
    const franchisePatch = isFranchiseParkManager(patchScope);
    const canManageRoles = hasPermission(
      actor.permissions,
      P.UsersManageRoles
    );
    // Invite-only without franchise manager must not use PATCH (Edit / revoke).
    if (!canManageRoles && !franchisePatch) {
      return (
        authErrorToResponse(
          new ForbiddenError("Missing required permission"),
          authAudit(request, "PATCH /api/admin/members/[id]", {
            permission: P.UsersManageRoles,
          })
        ) ?? serverError("Failed to authorize")
      );
    }
    const { expireOverdueMembershipInvitesForOrg } = await import(
      "@/lib/membershipInvites"
    );
    await expireOverdueMembershipInvitesForOrg(orgId);
    const membership = await loadOrgMembership(orgId, id);
    if (!membership) {
      return notFound(MEMBER_NOT_FOUND_MESSAGE);
    }

    const { assertCanManageStaffUserTarget } = await import(
      "@/lib/resolvePlatformSoftwareOwner"
    );
    try {
      await assertCanManageStaffUserTarget(actor, membership.userId);
    } catch (ownerErr) {
      if (ownerErr instanceof ForbiddenError) {
        return notFound(MEMBER_NOT_FOUND_MESSAGE);
      }
      throw ownerErr;
    }

    if (franchisePatch) {
      await assertMembershipInFranchiseRoster(
        orgId,
        membership.id,
        patchScope.assignedLocationIds
      );
      if (nextRole === "platform_admin") {
        return (
          authErrorToResponse(
            new ForbiddenError(FRANCHISE_INVITE_NO_PLATFORM_ADMIN),
            authAudit(request, `PATCH /api/admin/members/${id}`, {
              permission: P.UsersManageRoles,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      if (hasCompanyWideView && nextCompanyWideView === true) {
        return (
          authErrorToResponse(
            new ForbiddenError(FRANCHISE_INVITE_NO_CWV),
            authAudit(request, `PATCH /api/admin/members/${id}`, {
              permission: P.UsersManageRoles,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      // Franchise managers cannot grant/revoke franchiseParkManager or CWV.
      nextCompanyWideView = false;
      nextFranchiseParkManager = undefined;
      // Invite-only franchise managers: status/revoke only (no role elevation).
      if (!canManageRoles) {
        if (
          nextRole !== undefined ||
          hasOverride ||
          hasRoleTemplate ||
          hasCompanyWideView ||
          hasFranchiseParkManager
        ) {
          return (
            authErrorToResponse(
              new ForbiddenError(
                "Franchise park managers without users:manage_roles may only change status"
              ),
              authAudit(request, `PATCH /api/admin/members/${id}`, {
                permission: P.UsersInvite,
              })
            ) ?? serverError("Failed to authorize")
          );
        }
      }
    } else if (
      !actorHasCompanyWideView(actor) &&
      membership.userId !== actor.sub
    ) {
      return (
        authErrorToResponse(
          new ForbiddenError("Forbidden"),
          authAudit(request, `PATCH /api/admin/members/${id}`, {
            permission: P.UsersManageRoles,
          })
        ) ?? serverError("Failed to authorize")
      );
    }

    const prevStatus = membership.status;
    const prevRolePreset = membership.rolePreset;
    let rolePreset = nextRole ?? membership.rolePreset;
    let status = nextStatus ?? membership.status;
    // Tailor studio requires an active membership for JWT preset resolution.
    if (rolePreset === "tailor" && status === "invited") {
      status = "active";
    }
    if (prevStatus === "active" && status === "invited") {
      return badRequest(
        "Cannot move an active member to invited. Suspend or revoke instead."
      );
    }

    if (prevStatus === "invited" && status === "active") {
      const { assertMembershipInviteNotExpired } = await import(
        "@/lib/membershipInvites"
      );
      await assertMembershipInviteNotExpired(membership);
    }

    const { assertWithinPlanLimit, assertNewTailorSeat } = await import(
      "@/lib/planLimits"
    );
    const wasLive =
      prevStatus === "active" || prevStatus === "invited";
    const willBeLive = status === "active" || status === "invited";
    if (willBeLive && !wasLive) {
      await assertWithinPlanLimit(orgId, "members");
    }
    // Any newly live tailor seat — including reactivating a revoked/suspended tailor.
    // Skip when this user already burns a seat via a live studio profile.
    if (willBeLive && rolePreset === "tailor") {
      const alreadyLiveTailor = wasLive && prevRolePreset === "tailor";
      if (!alreadyLiveTailor) {
        await assertNewTailorSeat(orgId, membership.userId);
      }
    }

    const permissionsOverride = hasOverride
      ? nextOverride
      : membership.permissionsOverride;

    if (
      hasCompanyWideView &&
      nextCompanyWideView === true &&
      !actorHasCompanyWideView(actor) &&
      membership.companyWideView !== true &&
      membership.rolePreset !== "platform_admin"
    ) {
      return (
        authErrorToResponse(
          new ForbiddenError("Cannot grant company-wide view"),
          authAudit(request, `PATCH /api/admin/members/${id}`, {
            permission: P.UsersManageRoles,
          })
        ) ?? serverError("Failed to authorize")
      );
    }

    let templatePermissions: string[] | null = null;
    let resolvedRoleTemplateId: string | null | undefined = undefined;

    if (hasRoleTemplate) {
      if (nextRoleTemplateRaw) {
        const template = await loadOrgRoleTemplate(orgId, nextRoleTemplateRaw);
        if (!template) {
          return badRequest("Role template not found");
        }
        templatePermissions = parsePermissionList(template.permissions);
        resolvedRoleTemplateId = String(template._id);
        rolePreset = "custom";
      } else {
        resolvedRoleTemplateId = null;
        templatePermissions = null;
      }
    } else if (membership.roleTemplateId) {
      const template = await loadOrgRoleTemplate(
        orgId,
        String(membership.roleTemplateId)
      );
      templatePermissions = template
        ? parsePermissionList(template.permissions)
        : null;
    }

    const roleOrOverrideChanging =
      nextRole !== undefined || hasOverride || hasRoleTemplate;

    // Franchise managers may only stamp park-ops custom seats (never ops_manager
    // / finance / platform_admin via crafted PATCH). Status-only edits skip this.
    // Peer franchiseParkManager seats: status/revoke only (no role demotion via pack).
    let franchiseStaffOverride: string[] | null = null;
    if (franchisePatch && roleOrOverrideChanging) {
      const targetIsFpm =
        (membership as { franchiseParkManager?: boolean }).franchiseParkManager ===
          true && membership.rolePreset !== "platform_admin";
      if (targetIsFpm) {
        return (
          authErrorToResponse(
            new ForbiddenError(
              "Franchise park managers cannot change roles on other franchise park managers"
            ),
            authAudit(request, `PATCH /api/admin/members/${id}`, {
              permission: P.UsersManageRoles,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      const stamped = resolveFranchiseStaffSeatGrants(
        hasOverride ? nextOverride : []
      );
      rolePreset = stamped.rolePreset;
      franchiseStaffOverride = stamped.permissionsOverride;
      resolvedRoleTemplateId = null;
      templatePermissions = null;
    }

    if (!franchisePatch || !roleOrOverrideChanging) {
      assertMembershipMutationGrants(
        {
          sub: actor.sub,
          orgId: actor.orgId,
          storefrontOrgId:
            (actor as { storefrontOrgId?: string | null }).storefrontOrgId ??
            (await (await import("@/lib/org")).getStorefrontOrgId()),
          permissions: actor.permissions,
          preset: actor.preset,
          membershipRole: actor.membershipRole,
        },
        rolePreset,
        permissionsOverride,
        {
          status,
          roleOrOverrideChanging,
          templatePermissions,
        }
      );
    }

    // Reactivating / keeping a live seat must not create dual live orgs.
    if (status === "active" || status === "invited") {
      const otherLive = await findLiveOtherOrgMembership(
        membership.userId,
        orgId
      );
      if (otherLive) {
        return badRequest(ORG_DUAL_SEAT_LIVE_MESSAGE);
      }
    }

    const audit = await stampUpdate(actor.sub);
    const companyWideView = franchisePatch
      ? false
      : rolePreset === "tailor"
        ? false
        : hasCompanyWideView && nextCompanyWideView !== undefined
          ? resolveCompanyWideView({
              companyWideView: nextCompanyWideView,
              rolePreset,
            })
          : rolePreset === "platform_admin"
            ? true
            : membership.companyWideView;

    let franchiseParkManagerValue =
      typeof (membership as { franchiseParkManager?: boolean })
        .franchiseParkManager === "boolean"
        ? (membership as { franchiseParkManager: boolean }).franchiseParkManager
        : false;
    if (!franchisePatch && nextFranchiseParkManager !== undefined) {
      franchiseParkManagerValue = nextFranchiseParkManager;
    }
    if (rolePreset === "platform_admin") {
      franchiseParkManagerValue = false;
    }
    if (franchiseParkManagerValue) {
      const assignedLocationIds = await loadMembershipAssignedLocationIds(
        membership.id,
        orgId
      );
      assertFranchiseManagerSeatInvariants({
        rolePreset,
        franchiseParkManager: true,
        assignedLocationIds,
      });
    }

    // Hardening: FPM seats get durable invite + park_assign + manage_roles +
    // park Connect perms (ops_manager preset alone does not include them).
    // Franchise-manager edits of park staff use allowlisted staff pack only.
    const baseOverrideForWrite = franchiseStaffOverride
      ? franchiseStaffOverride
      : hasOverride
        ? nextOverride ?? []
        : Array.isArray(membership.permissionsOverride)
          ? (membership.permissionsOverride as string[])
          : [];
    const permissionsOverrideForWrite = franchiseParkManagerValue
      ? ensureFranchiseManagerCapabilityPermissions(baseOverrideForWrite)
      : franchiseStaffOverride
        ? franchiseStaffOverride
        : hasOverride
          ? nextOverride ?? []
          : undefined;

    // Leaving tailor OR soft-revoking/suspending a tailor: suspend studio BEFORE
    // membership write so failure never leaves revoked/suspended seat + still-public
    // approved Find-a-Tailor profile.
    const becomingRevoked =
      status === "revoked" && prevStatus !== "revoked";
    const becomingSuspended =
      status === "suspended" &&
      prevStatus !== "suspended" &&
      prevRolePreset === "tailor";
    const shouldSuspendStudio =
      (prevRolePreset === "tailor" && rolePreset !== "tailor") ||
      (becomingRevoked && prevRolePreset === "tailor") ||
      becomingSuspended;
    let studioSnapshot: Array<{ id: string; status: string }> = [];
    if (shouldSuspendStudio) {
      studioSnapshot = await snapshotTailorProfileStatuses(membership.userId);
      await suspendTailorProfilesForUser(membership.userId, audit);
    }

    let updated;
    try {
      updated = await updateMembershipGuardingLastAdmin({
        membership: {
          id: membership.id,
          orgId: String(membership.orgId),
          rolePreset: membership.rolePreset,
          status: membership.status,
        },
        next: { rolePreset, status },
        data: {
          rolePreset,
          status,
          ...(status === "invited"
            ? {
                inviteExpiresAt: (
                  await import("@/lib/membershipInvites")
                ).membershipInviteExpiresAt(),
              }
            : status === "active" || status === "revoked" || status === "suspended"
              ? { inviteExpiresAt: null }
              : {}),
          // Soft-revoke via Edit Save must match DELETE: drop sticky template so
          // Part 9 template-delete isn’t blocked and invite reactivation cannot
          // revive orphan template grants.
          ...(status === "revoked" || franchiseStaffOverride
            ? { roleTemplateId: null }
            : hasRoleTemplate
              ? { roleTemplateId: resolvedRoleTemplateId ?? null }
              : nextRole !== undefined && nextRole !== "custom"
                ? { roleTemplateId: null }
                : {}),
          ...(permissionsOverrideForWrite !== undefined
            ? { permissionsOverride: permissionsOverrideForWrite }
            : {}),
          companyWideView,
          franchiseParkManager: franchiseParkManagerValue,
          ...auditUpdateToPrisma(audit),
        },
      });
    } catch (writeErr) {
      if (shouldSuspendStudio && studioSnapshot.length > 0) {
        try {
          await restoreTailorProfileStatuses(studioSnapshot, audit);
        } catch (restoreErr) {
          console.error(
            "[members PATCH] membership write failed; studio restore failed:",
            writeErr,
            restoreErr
          );
        }
      }
      throw writeErr;
    }

    // Sync User.role before session invalidate (same as soft-revoke) so
    // bootstrap heal cannot see admin+revoked during the race window.
    await syncUserRoleFromMemberships(updated.userId);
    await invalidateUserSessions(updated.userId);
    const prevFranchiseParkManager =
      (membership as { franchiseParkManager?: boolean }).franchiseParkManager ===
      true;
    // Bust park-scope cache when franchise manager authority or platform_admin
    // changes — JWT invalidate alone does not clear staffGateCache (≤20s TTL).
    if (
      rolePreset === "platform_admin" ||
      prevFranchiseParkManager !== franchiseParkManagerValue
    ) {
      const { clearCachedLocationScopesForOrg } = await import(
        "@/lib/ticketing/staffGateCache"
      );
      clearCachedLocationScopesForOrg(orgId);
    }
    // Soft-revoke/suspend already suspended studio above; skip tailor ensure/suspend AFTER.
    if (
      rolePreset === "tailor" &&
      status !== "revoked" &&
      status !== "suspended"
    ) {
      const createAudit = await stampCreate(actor.sub);
      const hadStudioBefore = await prisma.tailorProfile.findFirst({
        where: { userId: updated.userId },
        select: { id: true },
      });
      try {
        // Active: ensure live studio. Invited: no profile (reserved seat).
        if (status === "active") {
          await ensurePendingTailorProfile(orgId, updated.userId, createAudit);
        }
      } catch (ensureErr) {
        try {
          // Only purge a brand-new studio from this promote. Never destroy a
          // pre-existing suspended profile when plan re-fit fails — membership
          // rollback is enough. prevRolePreset may already be "tailor" with no
          // profile yet — still purge the orphan we just created.
          if (!hadStudioBefore) {
            await deleteTailorDomainForUser(updated.userId);
          }
          await prisma.membership.update({
            where: { id: updated.id },
            data: {
              rolePreset: prevRolePreset,
              status: prevStatus,
              roleTemplateId: membership.roleTemplateId,
              permissionsOverride: membership.permissionsOverride ?? [],
              companyWideView: membership.companyWideView,
              ...auditUpdateToPrisma(audit),
            },
          });
          await syncUserRoleFromMemberships(updated.userId);
          await invalidateUserSessions(updated.userId);
        } catch (rollbackErr) {
          console.error(
            "[members PATCH] tailor profile ensure failed; compensate failed:",
            ensureErr,
            rollbackErr
          );
          throw new Error(
            "Tailor profile setup failed and membership rollback failed. Manual cleanup may be required.",
            { cause: rollbackErr }
          );
        }
        throw ensureErr;
      }
    }

    const user = await prisma.user.findFirst({
      where: idWhere(updated.userId),
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        lastLoginAt: true,
        lastLogoutAt: true,
        lastLoginIp: true,
      },
    });

    await logMembershipActivity({
      actorSub: actor.sub,
      orgId: String(orgId),
      action: "Updated Membership",
      membershipId: updated.id,
      targetUserId: updated.userId,
      description: `Updated membership ${id} → ${rolePreset} (${status})`,
      request,
      metadata: {
        rolePreset,
        roleTemplateId: updated.roleTemplateId,
        status,
        permissionsOverride: hasOverride
          ? nextOverride ?? []
          : updated.permissionsOverride ?? [],
        orgId: String(orgId),
      },
    });

    if (status === "invited" && prevStatus !== "invited" && user?.email) {
      await notifyMembershipInvite({
        to: user.email,
        rolePreset,
        orgId,
        invitedBySub: actor.sub,
        inviteExpiresAt: updated.inviteExpiresAt ?? null,
      });
    }

    const templateMeta = updated.roleTemplateId
      ? await loadOrgRoleTemplate(orgId, String(updated.roleTemplateId))
      : null;

    const assignedLocationIds = await loadMembershipAssignedLocationIds(
      String(updated.id),
      orgId
    );

    return ok({
      member: serializeMembership(
        updated,
        user,
        templateMeta
          ? {
              _id: templateMeta._id,
              name: templateMeta.name,
              permissions: templateMeta.permissions,
            }
          : null,
        { assignedLocationIds }
      ),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "PATCH /api/admin/members/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
        metadata: { domain: "membership", membershipId: id },
      })
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "";
    if (
      message.includes("Invalid") ||
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature") ||
      message.includes("live membership")
    ) {
      return badRequest(message);
    }
    return routeErrorResponse(err, "Failed to update membership");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const hard =
    request.nextUrl.searchParams.get("hard") === "1" ||
    request.nextUrl.searchParams.get("hard") === "true";
  const requiredPermission = hard ? P.UsersDelete : P.UsersManageRoles;

  let actor;
  try {
    actor = await requirePermissionFresh(request, requiredPermission);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/members/[id]", {
          permission: requiredPermission,
          metadata: { domain: "membership", hard },
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(MEMBER_NOT_FOUND_MESSAGE);
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const membership = await loadOrgMembership(orgId, id);
    if (!membership) {
      return notFound(MEMBER_NOT_FOUND_MESSAGE);
    }

    const { assertCanManageStaffUserTarget } = await import(
      "@/lib/resolvePlatformSoftwareOwner"
    );
    try {
      await assertCanManageStaffUserTarget(actor, membership.userId);
    } catch (ownerErr) {
      if (ownerErr instanceof ForbiddenError) {
        return notFound(MEMBER_NOT_FOUND_MESSAGE);
      }
      throw ownerErr;
    }

    if (
      !hard &&
      !actorHasCompanyWideView(actor) &&
      membership.userId !== actor.sub
    ) {
      return (
        authErrorToResponse(
          new ForbiddenError("Forbidden"),
          authAudit(request, "DELETE /api/admin/members/[id]", {
            permission: requiredPermission,
            metadata: { domain: "membership", hard },
          })
        ) ?? serverError("Failed to authorize")
      );
    }

    if (hard) {
      if (!isPlatformAdminActor(actor)) {
        return forbidden(
          "Only a platform admin can permanently delete user accounts"
        );
      }

      const { userId, blacklisted } = await hardDeleteOrgMemberUser({
        membership,
        actorSub: actor.sub,
      });

      await logMembershipActivity({
        actorSub: actor.sub,
        orgId: String(orgId),
        action: "Deleted User Account",
        membershipId: id,
        targetUserId: userId,
        description: `Permanently deleted user ${userId} (membership ${id})`,
        request,
        metadata: {
          orgId: String(orgId),
          hard: true,
          blacklisted,
        },
      });

      return ok({
        deleted: true,
        purgedUser: true,
        userId,
        membershipId: id,
        blacklisted,
      });
    }

    const audit = await stampUpdate(actor.sub);
    const wasTailor = membership.rolePreset === "tailor";
    // Same grant ⊆ actor rule as PATCH demote — cannot revoke elevated members
    // you could not assign.
    if (!isMembershipRolePreset(membership.rolePreset)) {
      return badRequest("Invalid membership rolePreset");
    }
    let revokeTemplatePerms: string[] | null = null;
    if (membership.roleTemplateId) {
      const tpl = await loadOrgRoleTemplate(
        orgId,
        String(membership.roleTemplateId)
      );
      revokeTemplatePerms = tpl
        ? parsePermissionList(tpl.permissions)
        : null;
    }
    assertMembershipMutationGrants(
      {
        sub: actor.sub,
        orgId: actor.orgId,
        storefrontOrgId:
          (actor as { storefrontOrgId?: string | null }).storefrontOrgId ??
          (await (await import("@/lib/org")).getStorefrontOrgId()),
        permissions: actor.permissions,
        preset: actor.preset,
        membershipRole: actor.membershipRole,
      },
      membership.rolePreset,
      membership.permissionsOverride,
      {
        status: "revoked",
        roleOrOverrideChanging: true,
        templatePermissions: revokeTemplatePerms,
      }
    );
    // Suspend studio before revoke so a suspend failure does not leave
    // revoked membership + still-public approved tailor profile.
    let studioSnapshot: Array<{ id: string; status: string }> = [];
    if (wasTailor) {
      studioSnapshot = await snapshotTailorProfileStatuses(membership.userId);
      await suspendTailorProfilesForUser(membership.userId, audit);
    }
    let updated;
    try {
      updated = await updateMembershipGuardingLastAdmin({
        membership: {
          id: membership.id,
          orgId: String(membership.orgId),
          rolePreset: membership.rolePreset,
          status: membership.status,
        },
        next: { status: "revoked" },
        data: {
          status: "revoked",
          // Drop sticky template so soft-revoke does not block template delete
          // (Part 9) or leave orphan grants on invite-only reactivation.
          roleTemplateId: null,
          ...auditUpdateToPrisma(audit),
        },
      });
    } catch (writeErr) {
      if (wasTailor && studioSnapshot.length > 0) {
        try {
          await restoreTailorProfileStatuses(studioSnapshot, audit);
        } catch (restoreErr) {
          console.error(
            "[members DELETE] revoke failed; studio restore failed:",
            writeErr,
            restoreErr
          );
        }
      }
      throw writeErr;
    }

    // Sync User.role before session invalidate so bootstrap heal cannot see
    // admin+revoked and re-elevate during the race window.
    await syncUserRoleFromMemberships(updated.userId);
    await invalidateUserSessions(updated.userId);

    await logMembershipActivity({
      actorSub: actor.sub,
      orgId: String(orgId),
      action: "Revoked Membership",
      membershipId: updated.id,
      targetUserId: updated.userId,
      description: `Revoked membership ${id}`,
      request,
      metadata: { orgId: String(orgId) },
    });

    return ok({
      revoked: true,
      member: await serializeMembershipWithTemplate(updated),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "DELETE /api/admin/members/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: requiredPermission,
        metadata: {
          domain: "membership",
          membershipId: id,
          hard,
        },
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(
      err,
      hard ? "Failed to delete user account" : "Failed to revoke membership"
    );
  }
}
