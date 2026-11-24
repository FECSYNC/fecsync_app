export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { idWhere, isValidId } from "@/lib/ids";
import { auditUpdateToPrisma } from "@/lib/catalogWrite";
import type { Prisma } from "@prisma/client";
import {
  ok,
  created,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import {
  requirePermissionFresh,
  requireAnyPermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P, hasPermission, parsePermissionList } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId, actorHasCompanyWideView } from "@/lib/staffOrg";
import { isMembershipRolePreset } from "@/lib/membership";
import { resolveCompanyWideView } from "@/lib/auth/permissions";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  assertAssignableGrants,
  assertInviteStatusAllowed,
  updateMembershipGuardingLastAdmin,
  invalidateUserSessions,
  logMembershipActivity,
  serializeMembership,
  syncUserRoleFromMemberships,
  notifyMembershipInvite,
  loadMembershipAssignedLocationIds,
  isMembershipStatus,
  findLiveOtherOrgMembership,
  ORG_DUAL_SEAT_LIVE_MESSAGE,
  type MembershipStatus,
} from "@/lib/memberAdmin";
import { loadOrgRoleTemplate } from "@/lib/roleTemplateAdmin";
import { assertNotBlacklisted } from "@/lib/userBlacklist";
import { stampCreate, stampUpdate } from "@/lib/audit/recordAudit";
import {
  ensurePendingTailorProfile,
  suspendTailorProfilesForUser,
  deleteTailorDomainForUser,
  snapshotTailorProfileStatuses,
  restoreTailorProfileStatuses,
} from "@/lib/tailors";

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/members", { permission: P.UsersRead })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { expireOverdueMembershipInvitesForOrg } = await import(
      "@/lib/membershipInvites"
    );
    await expireOverdueMembershipInvitesForOrg(orgId);
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    void searchParams.get("orgId");

    const where: Prisma.MembershipWhereInput = {
      orgId,
    };
    const {
      resolveFranchiseParkScope,
      isFranchiseParkManager,
      listFranchiseRosterMembershipIds,
    } = await import("@/lib/franchisePark");
    const franchiseScope = await resolveFranchiseParkScope(actor);
    if (isFranchiseParkManager(franchiseScope)) {
      // Park-local roster: seats with an active assignment intersecting manager parks.
      const rosterIds = await listFranchiseRosterMembershipIds(
        orgId,
        franchiseScope.assignedLocationIds
      );
      where.id = { in: rosterIds.length > 0 ? rosterIds : ["__none__"] };
    } else if (!actorHasCompanyWideView(actor)) {
      where.userId = actor.sub;
    }
    if (statusParam) {
      if (!isMembershipStatus(statusParam)) {
        return badRequest("Invalid status filter");
      }
      where.status = statusParam;
    }

    const rows = await prisma.membership.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // Hide FECSYNC software owners from every non-owner (storefront + tenants).
    const {
      filterHiddenPlatformOwnerUserIds,
      listStorefrontPlatformAdminUserIds,
      redactPlatformOwnerAuditLabel,
      resolveIsPlatformSoftwareOwner,
    } = await import("@/lib/resolvePlatformSoftwareOwner");
    const hideOwnerIds = await filterHiddenPlatformOwnerUserIds(
      actor,
      rows.map((r) => r.userId)
    );
    const visibleRows =
      hideOwnerIds.size > 0
        ? rows.filter((row) => !hideOwnerIds.has(row.userId))
        : rows;
    const viewerIsOwner = await resolveIsPlatformSoftwareOwner(actor);
    const allOwnerIds = await listStorefrontPlatformAdminUserIds();

    const userIds = [...new Set(visibleRows.map((row) => row.userId))].filter(isValidId);
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
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
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const templateIds = [
      ...new Set(
        visibleRows.filter((row) => row.roleTemplateId).map((row) => String(row.roleTemplateId))
      ),
    ].filter(isValidId);

    const templates =
      templateIds.length > 0
        ? await prisma.roleTemplate.findMany({
            where: { orgId, id: { in: templateIds } },
          })
        : [];
    const templateById = new Map(
      templates.map((t) => [
        t.id,
        { _id: t.id, name: t.name, permissions: t.permissions },
      ])
    );

    const membershipIds = visibleRows.map((r) => r.id);
    const assignmentRows =
      membershipIds.length > 0
        ? await prisma.membershipVenueAssignment.findMany({
            where: {
              membershipId: { in: membershipIds },
              orgId,
              location: { status: "active", orgId },
            },
            select: { membershipId: true, locationId: true },
          })
        : [];
    const assignmentsByMembership = new Map<string, string[]>();
    for (const a of assignmentRows) {
      const list = assignmentsByMembership.get(a.membershipId) ?? [];
      list.push(a.locationId);
      assignmentsByMembership.set(a.membershipId, list);
    }

    const members = visibleRows.map((row) => {
      const serialized = serializeMembership(
        row,
        byId.get(row.userId) ?? null,
        row.roleTemplateId
          ? templateById.get(String(row.roleTemplateId)) ?? null
          : null,
        {
          assignedLocationIds: assignmentsByMembership.get(row.id) ?? [],
        }
      );
      const updatedById =
        typeof serialized.updatedBy === "string" ? serialized.updatedBy : null;
      return {
        ...serialized,
        updatedByName: redactPlatformOwnerAuditLabel(
          viewerIsOwner,
          updatedById,
          serialized.updatedByName,
          allOwnerIds
        ),
        ...(viewerIsOwner
          ? { isPlatformSoftwareOwner: allOwnerIds.has(row.userId) }
          : {}),
      };
    });

    return ok({ members, orgId: String(orgId) });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "GET /api/admin/members", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersRead,
      })
    );
    if (authRes) return authRes;
    console.error("Failed to list members:", err);
    return serverError("Failed to list members");
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      P.UsersInvite,
      P.UsersManageRoles,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/members", {
          permission: `${P.UsersInvite}|${P.UsersManageRoles}`,
        })
      ) ?? serverError("Failed to authorize")
    );
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

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const userIdRaw =
    typeof body.userId === "string" ? body.userId.trim() : "";
  const rolePresetRaw =
    typeof body.rolePreset === "string" ? body.rolePreset.trim() : "";
  const roleTemplateIdRaw =
    typeof body.roleTemplateId === "string"
      ? body.roleTemplateId.trim()
      : body.roleTemplateId === null
        ? null
        : undefined;
  void body.orgId;
  // Step 3 invite TTL is server-stamped only — never honor client expiry.
  void body.inviteExpiresAt;

  if (!email && !userIdRaw) {
    return badRequest("Provide email or userId");
  }
  if (!isMembershipRolePreset(rolePresetRaw)) {
    return badRequest("Invalid rolePreset");
  }

  let status: MembershipStatus = "invited";
  if (typeof body.status === "string") {
    if (!isMembershipStatus(body.status) || body.status === "revoked") {
      return badRequest("Invalid status");
    }
    status = body.status;
  } else if (hasPermission(actor.permissions, P.UsersManageRoles)) {
    status = "active";
  }
  // Assert on the requested status before tailor auto-activate so invite-only
  // actors can still invite tailors (Part 9: do not break tailor auto-activate).
  try {
    assertInviteStatusAllowed(actor.permissions, status);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/members", {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
          permission: P.UsersInvite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }
  // Tailor studio needs an active membership for JWT preset resolution.
  // Invited-only tailor rows used to collapse to client claims on login.
  if (rolePresetRaw === "tailor" && status === "invited") {
    status = "active";
  }

  const overrideRaw = Array.isArray(body.permissionsOverride)
    ? body.permissionsOverride
    : undefined;
  if (
    overrideRaw !== undefined &&
    !hasPermission(actor.permissions, P.UsersManageRoles)
  ) {
    return (
      authErrorToResponse(
        new ForbiddenError("Missing required permission"),
        authAudit(request, "POST /api/admin/members", {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
          permission: P.UsersManageRoles,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const permissionsOverride =
    overrideRaw !== undefined ? parsePermissionList(overrideRaw) : undefined;

  const hasCompanyWideViewField = Object.prototype.hasOwnProperty.call(
    body,
    "companyWideView"
  );
  let companyWideView: boolean | undefined;
  if (hasCompanyWideViewField) {
    if (typeof body.companyWideView !== "boolean") {
      return badRequest("companyWideView must be a boolean");
    }
    if (body.companyWideView === true && !actorHasCompanyWideView(actor)) {
      return (
        authErrorToResponse(
          new ForbiddenError("Cannot grant company-wide view"),
          authAudit(request, "POST /api/admin/members", {
            actorSub: actor.sub,
            orgId: actor.orgId ?? null,
            permission: P.UsersManageRoles,
          })
        ) ?? serverError("Failed to authorize")
      );
    }
    companyWideView = resolveCompanyWideView({
      companyWideView: body.companyWideView,
      rolePreset: rolePresetRaw,
    });
  }
  // When omitted: CREATE defaults false below; UPDATE preserves existing CWV.

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { PARK_LOCKED_STAFF_ADMIN_MESSAGE } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    const {
      assertCompanyWideStaffAdminOrFranchiseManager,
      isFranchiseParkManager,
      normalizeFranchiseInviteLocationIds,
      resolveFranchiseStaffSeatGrants,
      FRANCHISE_INVITE_NO_CWV,
      FRANCHISE_INVITE_NO_PLATFORM_ADMIN,
    } = await import("@/lib/franchisePark");
    const inviteScope = await assertCompanyWideStaffAdminOrFranchiseManager(
      actor,
      PARK_LOCKED_STAFF_ADMIN_MESSAGE
    );
    const franchiseInvite = isFranchiseParkManager(inviteScope);
    let franchiseInviteLocationIds: string[] | null = null;
    let franchiseInviteOverride: string[] | null = null;
    if (franchiseInvite) {
      if (rolePresetRaw === "platform_admin") {
        return (
          authErrorToResponse(
            new ForbiddenError(FRANCHISE_INVITE_NO_PLATFORM_ADMIN),
            authAudit(request, "POST /api/admin/members", {
              actorSub: actor.sub,
              orgId: actor.orgId ?? null,
              permission: P.UsersInvite,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      if (hasCompanyWideViewField && body.companyWideView === true) {
        return (
          authErrorToResponse(
            new ForbiddenError(FRANCHISE_INVITE_NO_CWV),
            authAudit(request, "POST /api/admin/members", {
              actorSub: actor.sub,
              orgId: actor.orgId ?? null,
              permission: P.UsersInvite,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      companyWideView = false;
      franchiseInviteLocationIds = normalizeFranchiseInviteLocationIds(
        inviteScope,
        body.locationIds ?? body.assignedLocationIds
      );
      // Stamp useful park-ops pack; allowlist-capped (no full ops_manager matrix required).
      franchiseInviteOverride = resolveFranchiseStaffSeatGrants(
        permissionsOverride
      ).permissionsOverride;
    }
    const { expireOverdueMembershipInvitesForOrg } = await import(
      "@/lib/membershipInvites"
    );
    await expireOverdueMembershipInvitesForOrg(orgId);

    if (email) {
      await assertNotBlacklisted(orgId, { email });
    }

    let templatePermissions: string[] | null = null;
    /** undefined = omit on update (preserve); null = clear; string = set */
    let resolvedRoleTemplateId: string | null | undefined = undefined;
    if (roleTemplateIdRaw) {
      const template = await loadOrgRoleTemplate(orgId, roleTemplateIdRaw);
      if (!template) {
        return badRequest("Role template not found");
      }
      templatePermissions = parsePermissionList(template.permissions);
      resolvedRoleTemplateId = String(template._id);
      if (rolePresetRaw !== "custom") {
        return badRequest("rolePreset must be custom when using a role template");
      }
    } else if (roleTemplateIdRaw === null) {
      resolvedRoleTemplateId = null;
      templatePermissions = null;
    }

    let user = null;
    if (userIdRaw && isValidId(userIdRaw)) {
      user = await prisma.user.findFirst({
        where: idWhere(userIdRaw),
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          accountDeleted: true,
          phoneNumber: true,
          lastLoginAt: true,
          lastLogoutAt: true,
          lastLoginIp: true,
        },
      });
    }
    if (!user && email) {
      user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          accountDeleted: true,
          phoneNumber: true,
          lastLoginAt: true,
          lastLogoutAt: true,
          lastLoginIp: true,
        },
      });
    }
    if (!user || user.accountDeleted) {
      return notFound("User not found");
    }

    const { assertCanManageStaffUserTarget } = await import(
      "@/lib/resolvePlatformSoftwareOwner"
    );
    try {
      await assertCanManageStaffUserTarget(actor, user.id);
    } catch (ownerErr) {
      if (ownerErr instanceof ForbiddenError) {
        return notFound("User not found");
      }
      throw ownerErr;
    }

    if (
      !franchiseInvite &&
      !actorHasCompanyWideView(actor) &&
      user.id !== actor.sub
    ) {
      return (
        authErrorToResponse(
          new ForbiddenError(
            "Company-wide view is required to invite other members"
          ),
          authAudit(request, "POST /api/admin/members", {
            actorSub: actor.sub,
            orgId: actor.orgId ?? null,
            permission: P.UsersInvite,
          })
        ) ?? serverError("Failed to authorize")
      );
    }

    await assertNotBlacklisted(orgId, {
      email: user.email,
      phone: user.phoneNumber ?? null,
    });

    const existing = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId } },
    });

    // Franchise re-invite must not demote CWV/platform_admin or steal sister parks.
    if (franchiseInvite && existing) {
      const { assertFranchiseInviteExistingSeat } = await import(
        "@/lib/franchisePark"
      );
      try {
        await assertFranchiseInviteExistingSeat({
          orgId,
          membership: {
            id: existing.id,
            rolePreset: existing.rolePreset,
            companyWideView: existing.companyWideView === true,
          },
          managerAssignedLocationIds: inviteScope.assignedLocationIds,
        });
      } catch (existingErr) {
        return (
          authErrorToResponse(
            existingErr,
            authAudit(request, "POST /api/admin/members", {
              actorSub: actor.sub,
              orgId: actor.orgId ?? null,
              permission: P.UsersInvite,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
    }

    // No org switcher for *live* seats (active/invited). Revoked/suspended on
    // another org still allow invite here (ops move after soft-revoke). Dual
    // seats are blocked again if that other seat is later reactivated.
    if (
      !existing ||
      status === "active" ||
      status === "invited"
    ) {
      const otherLive = await findLiveOtherOrgMembership(user.id, orgId);
      if (otherLive) {
        return badRequest(ORG_DUAL_SEAT_LIVE_MESSAGE);
      }
    }

    const { assertWithinPlanLimit, assertNewTailorSeat } = await import(
      "@/lib/planLimits"
    );
    const seating = status === "active" || status === "invited";
    if (seating) {
      const addingMemberSeat =
        !existing ||
        (existing.status !== "active" && existing.status !== "invited");
      if (addingMemberSeat) {
        await assertWithinPlanLimit(orgId, "members");
      }
      const nextRolePreview =
        existing && !hasPermission(actor.permissions, P.UsersManageRoles)
          ? existing.rolePreset
          : rolePresetRaw;
      if (
        nextRolePreview === "tailor"
      ) {
        const alreadyLiveTailor =
          Boolean(existing) &&
          existing!.rolePreset === "tailor" &&
          (existing!.status === "active" || existing!.status === "invited");
        if (!alreadyLiveTailor) {
          await assertNewTailorSeat(orgId, user.id);
        }
      }
    }

    if (
      existing &&
      resolvedRoleTemplateId === undefined &&
      existing.roleTemplateId
    ) {
      const template = await loadOrgRoleTemplate(
        orgId,
        String(existing.roleTemplateId)
      );
      templatePermissions = template
        ? parsePermissionList(template.permissions)
        : null;
    }

    const canManageRoles = hasPermission(
      actor.permissions,
      P.UsersManageRoles
    );

    // Invite-only cannot assign templates (manage_roles only).
    if (!canManageRoles && roleTemplateIdRaw) {
      return (
        authErrorToResponse(
          new ForbiddenError(
            "Assigning a role template requires users:manage_roles"
          ),
          authAudit(request, "POST /api/admin/members", {
            actorSub: actor.sub,
            orgId: actor.orgId ?? null,
            permission: P.UsersManageRoles,
          })
        ) ?? serverError("Failed to authorize")
      );
    }

    // Invite-only cannot set CWV (same as UPDATE path). Ignore/reject field.
    if (hasCompanyWideViewField && !canManageRoles) {
      if (body.companyWideView === true) {
        return (
          authErrorToResponse(
            new ForbiddenError(
              "Company-wide view requires users:manage_roles"
            ),
            authAudit(request, "POST /api/admin/members", {
              actorSub: actor.sub,
              orgId: actor.orgId ?? null,
              permission: P.UsersManageRoles,
            })
          ) ?? serverError("Failed to authorize")
        );
      }
      companyWideView = undefined;
    }

    // Invite POST must not silently rewrite active members (use Edit / PATCH).
    if (existing?.status === "active") {
      return badRequest(
        "User is already an active member. Use Edit to change their role or permissions."
      );
    }

    if (existing?.status === "invited" && status === "active") {
      const { assertMembershipInviteNotExpired } = await import(
        "@/lib/membershipInvites"
      );
      await assertMembershipInviteNotExpired(existing);
    }

    // Franchise invites always land as custom + park staff pack (server-stamped).
    const effectiveRolePresetRaw = franchiseInvite
      ? resolveFranchiseStaffSeatGrants(franchiseInviteOverride).rolePreset
      : rolePresetRaw;
    const grantRolePreset =
      existing && !canManageRoles
        ? existing.rolePreset
        : effectiveRolePresetRaw;
    const grantOverride = franchiseInvite
      ? franchiseInviteOverride
      : canManageRoles && permissionsOverride !== undefined
        ? permissionsOverride
        : existing?.permissionsOverride;

    // Mirror PATCH: leaving custom clears roleTemplate (no sticky elevated grants).
    const nextRolePreview = existing
      ? canManageRoles
        ? effectiveRolePresetRaw
        : existing.rolePreset
      : effectiveRolePresetRaw;
    if (nextRolePreview !== "custom") {
      templatePermissions = null;
    }
    if (franchiseInvite) {
      templatePermissions = null;
      resolvedRoleTemplateId = null;
    }

    // Always enforce grant ⊆ actor on the grants that will be persisted
    // (including invite-only reactivation of an elevated revoked/suspended row).
    // Franchise invites use an allowlist-stamped park staff pack — managers do
    // not need the full company ops_manager matrix (resolveFranchiseInvite… already capped).
    if (!franchiseInvite) {
      const { getStorefrontOrgId } = await import("@/lib/org");
      assertAssignableGrants(
        {
          sub: actor.sub,
          orgId: actor.orgId,
          storefrontOrgId:
            (actor as { storefrontOrgId?: string | null }).storefrontOrgId ??
            (await getStorefrontOrgId()),
          permissions: actor.permissions,
          preset: actor.preset,
          membershipRole: actor.membershipRole,
        },
        grantRolePreset,
        grantOverride,
        templatePermissions
      );
    }

    const wasExisting = Boolean(existing);
    const prevRolePreset = existing?.rolePreset;
    const audit = await stampUpdate(actor.sub);
    let membership;

    // Leaving tailor on invite/reactivate: suspend studio before membership write
    // (same ordering as soft-revoke / PATCH demote).
    const nextRolePreviewForSuspend = existing
      ? canManageRoles
        ? effectiveRolePresetRaw
        : existing.rolePreset
      : effectiveRolePresetRaw;
    let studioSnapshot: Array<{ id: string; status: string }> = [];
    const shouldSuspendStudio =
      prevRolePreset === "tailor" && nextRolePreviewForSuspend !== "tailor";
    if (shouldSuspendStudio) {
      studioSnapshot = await snapshotTailorProfileStatuses(user.id);
      await suspendTailorProfilesForUser(user.id, audit);
    }

    if (existing) {
      // Invite-only reactivation: status (+ invite email) only.
      // Manage-roles may also change role / template / override / CWV.
      // (Active members are rejected above — use Edit / PATCH.)
      const nextRole = canManageRoles
        ? effectiveRolePresetRaw
        : existing.rolePreset;
      const nextTemplate =
        nextRole !== "custom"
          ? null
          : franchiseInvite
            ? null
            : canManageRoles
              ? resolvedRoleTemplateId !== undefined
                ? resolvedRoleTemplateId
                : existing.roleTemplateId
              : existing.roleTemplateId;
      const nextOverride = franchiseInvite
        ? franchiseInviteOverride
        : canManageRoles && permissionsOverride !== undefined
          ? permissionsOverride
          : existing.permissionsOverride;
      const nextCwv = franchiseInvite
        ? false
        : nextRole === "tailor"
          ? false
          : canManageRoles && companyWideView !== undefined
            ? companyWideView
            : nextRole === "platform_admin"
              ? true
              : undefined;
      try {
        membership = await updateMembershipGuardingLastAdmin({
          membership: {
            id: existing.id,
            orgId: String(existing.orgId),
            rolePreset: existing.rolePreset,
            status: existing.status,
          },
          next: { rolePreset: nextRole, status },
          data: {
            rolePreset: nextRole,
            roleTemplateId: nextTemplate,
            permissionsOverride: nextOverride,
            status,
            ...(nextCwv !== undefined ? { companyWideView: nextCwv } : {}),
            ...(franchiseInvite
              ? { franchiseParkManager: false, companyWideView: false }
              : {}),
            invitedById: existing.invitedById ?? actor.sub,
            ...(status === "invited"
              ? {
                  inviteExpiresAt: (
                    await import("@/lib/membershipInvites")
                  ).membershipInviteExpiresAt(),
                }
              : status === "active"
                ? { inviteExpiresAt: null }
                : {}),
            ...auditUpdateToPrisma(audit),
          },
        });
      } catch (writeErr) {
        if (shouldSuspendStudio && studioSnapshot.length > 0) {
          try {
            await restoreTailorProfileStatuses(studioSnapshot, audit);
          } catch (restoreErr) {
            console.error(
              "[members] invite write failed; studio restore failed:",
              writeErr,
              restoreErr
            );
          }
        }
        throw writeErr;
      }
    } else {
      // CREATE: CWV only when manage_roles supplied it; else default false
      // (platform_admin preset still forces true via resolveCompanyWideView).
      // Franchise invites always park-lock with CWV false.
      const createCwv = franchiseInvite
        ? false
        : rolePresetRaw === "tailor"
          ? false
          : canManageRoles && companyWideView !== undefined
            ? companyWideView
            : resolveCompanyWideView({
                companyWideView: false,
                rolePreset: rolePresetRaw,
              });
      membership = await prisma.membership.create({
        data: {
          userId: user.id,
          orgId,
          rolePreset: effectiveRolePresetRaw,
          roleTemplateId:
            !franchiseInvite &&
            effectiveRolePresetRaw === "custom" &&
            resolvedRoleTemplateId
              ? resolvedRoleTemplateId
              : null,
          permissionsOverride: franchiseInvite
            ? franchiseInviteOverride ?? []
            : permissionsOverride && permissionsOverride.length > 0
              ? permissionsOverride
              : [],
          companyWideView: createCwv,
          franchiseParkManager: false,
          status,
          invitedById: actor.sub,
          ...(status === "invited"
            ? {
                inviteExpiresAt: (
                  await import("@/lib/membershipInvites")
                ).membershipInviteExpiresAt(),
              }
            : { inviteExpiresAt: null }),
          ...auditUpdateToPrisma(audit),
        },
      });
    }

    // Franchise invite: stamp park assignments inside manager's parks only.
    if (franchiseInvite && franchiseInviteLocationIds?.length) {
      const { replaceMembershipVenueAssignments } = await import(
        "@/lib/parkAdminScope"
      );
      await replaceMembershipVenueAssignments({
        membershipId: membership.id,
        orgId,
        locationIds: franchiseInviteLocationIds,
        protectLastPlatformAdmin: true,
      });
    }

    await syncUserRoleFromMemberships(user.id);
    await invalidateUserSessions(user.id);
    const finalRolePreset = membership.rolePreset;
    if (finalRolePreset === "tailor") {
      const createAudit = await stampCreate(actor.sub);
      const hadStudioBefore = await prisma.tailorProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      try {
        // Active tailor: ensure a live (pending) studio. Invited: leave **no**
        // profile so the live membership burns a reserved tailorSeats slot
        // (create+suspend would free the seat while still inviting).
        if (status === "active") {
          await ensurePendingTailorProfile(orgId, user.id, createAudit);
        }
      } catch (ensureErr) {
        try {
          // Only purge a brand-new studio from this invite. Never destroy a
          // pre-existing suspended profile when plan re-fit fails.
          if (!hadStudioBefore) {
            await deleteTailorDomainForUser(user.id);
          }
          if (!wasExisting) {
            await prisma.membership.delete({ where: { id: membership.id } });
          } else if (existing) {
            await prisma.membership.update({
              where: { id: membership.id },
              data: {
                rolePreset: existing.rolePreset,
                status: existing.status,
                roleTemplateId: existing.roleTemplateId,
                permissionsOverride: existing.permissionsOverride ?? [],
                companyWideView: existing.companyWideView,
                invitedById: existing.invitedById,
                ...auditUpdateToPrisma(audit),
              },
            });
            await syncUserRoleFromMemberships(user.id);
            await invalidateUserSessions(user.id);
          }
        } catch (rollbackErr) {
          console.error(
            "[members] tailor profile ensure failed; compensate failed:",
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
    await logMembershipActivity({
      actorSub: actor.sub,
      orgId: String(orgId),
      action: wasExisting ? "Updated Membership" : "Invited Member",
      membershipId: membership.id,
      targetUserId: user.id,
      description: `${wasExisting ? "Updated" : "Invited"} ${user.email} as ${finalRolePreset} (${status})`,
      request,
      metadata: {
        rolePreset: finalRolePreset,
        roleTemplateId: membership.roleTemplateId,
        status,
        permissionsOverride: membership.permissionsOverride,
        orgId: String(orgId),
      },
    });

    if (status === "invited" && user.email) {
      await notifyMembershipInvite({
        to: user.email,
        rolePreset: finalRolePreset,
        orgId,
        invitedBySub: actor.sub,
        inviteExpiresAt: membership.inviteExpiresAt ?? null,
      });
    } else if (finalRolePreset === "tailor" && user.email) {
      try {
        const { sendTailorStudioInviteEmail } = await import("@/lib/mailer");
        const org = await prisma.organization.findFirst({
          where: { id: orgId },
          select: { name: true },
        });
        const displayName =
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
          user.email;
        await sendTailorStudioInviteEmail({
          to: user.email,
          displayName,
          orgName: org?.name ? String(org.name) : undefined,
          status: "pending",
          invitedByEmail: undefined,
          orgId,
        });
      } catch (mailErr) {
        console.error("[members] tailor studio invite email failed:", mailErr);
      }
    }

    const templateMeta = membership.roleTemplateId
      ? await loadOrgRoleTemplate(orgId, String(membership.roleTemplateId))
      : null;

    const assignedLocationIds = await loadMembershipAssignedLocationIds(
      String(membership.id),
      orgId
    );

    const payload = {
      member: serializeMembership(
        membership,
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
    };
    return wasExisting ? ok(payload) : created(payload);
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "POST /api/admin/members", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
        metadata: { domain: "membership", target: userIdRaw || email || null },
      })
    );
    if (authRes) return authRes;
    const prismaCode =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code;
    if (prismaCode === "P2002") {
      return badRequest("Membership already exists for this user and organization");
    }
    const message = err instanceof Error ? err.message : "";
    if (
      message.includes("Invalid") ||
      message.includes("Plan limit reached") ||
      message.includes("Subscribe to a plan before using this feature") ||
      message.includes("live membership")
    ) {
      return badRequest(message);
    }
    return routeErrorResponse(err, "Failed to invite member");
  }
}
