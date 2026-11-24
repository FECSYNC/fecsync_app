export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P, hasPermission } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import { requireActorOrgId } from "@/lib/staffOrg";
import { isMembershipRolePreset } from "@/lib/membership";
import { isPlainObject } from "@/lib/catalogWrite";
import { createStaffUserWithMembership } from "@/lib/adminUsers";
import {
  isMembershipStatus,
  type MembershipStatus,
} from "@/lib/memberAdmin";

/*
 * Step 8 — create user account + org membership from admin.
 * POST → users:manage_roles
 */

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersManageRoles);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/users", {
          permission: P.UsersManageRoles,
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

  const fullName =
    typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const rolePresetRaw =
    typeof body.rolePreset === "string" ? body.rolePreset.trim() : "";
  const roleTemplateIdRaw =
    typeof body.roleTemplateId === "string" ? body.roleTemplateId.trim() : "";
  void body.orgId;
  void body.role;
  // Step 3 invite TTL is server-stamped only — never honor client expiry.
  void body.inviteExpiresAt;

  if (!fullName || !email || !password) {
    return badRequest("fullName, email, and password are required");
  }
  if (!isMembershipRolePreset(rolePresetRaw)) {
    return badRequest("Invalid rolePreset");
  }

  let status: MembershipStatus = "active";
  if (typeof body.status === "string") {
    if (!isMembershipStatus(body.status) || body.status === "revoked") {
      return badRequest("Invalid status");
    }
    status = body.status;
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
        authAudit(request, "POST /api/admin/users", {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
          permission: P.UsersManageRoles,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const companyWideView =
    typeof body.companyWideView === "boolean"
      ? body.companyWideView
      : undefined;

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq, PARK_LOCKED_STAFF_ADMIN_MESSAGE } =
      await import("@/lib/assertNotParkLockedCompanyHq");
    await assertNotParkLockedCompanyHq(actor, PARK_LOCKED_STAFF_ADMIN_MESSAGE);
    const member = await createStaffUserWithMembership({
      fullName,
      email,
      password,
      rolePreset: rolePresetRaw,
      roleTemplateId: roleTemplateIdRaw || null,
      permissionsOverride: overrideRaw,
      companyWideView,
      status,
      actorSub: actor.sub,
      orgId,
      actorPermissions: actor.permissions,
      actorPreset: actor.preset,
      actorMembershipRole: actor.membershipRole,
      actorCompanyWideView: actor.companyWideView,
      request,
    });

    const locationIdsRaw = Array.isArray(body.locationIds)
      ? body.locationIds
      : [];
    if (
      Array.isArray(body.locationIds) &&
      body.locationIds.some((id) => typeof id !== "string")
    ) {
      return badRequest("locationIds must be an array of strings");
    }
    let assignedLocationIds: string[] = [];
    let parkAssignError: string | null = null;
    if (locationIdsRaw.length > 0) {
      try {
        const {
          assertCanManageVenueAssignments,
          replaceMembershipVenueAssignments,
        } = await import("@/lib/parkAdminScope");
        const { invalidateUserSessions } = await import("@/lib/memberAdmin");
        await assertCanManageVenueAssignments(actor);
        const membershipId = String(
          (member as { _id?: string; id?: string })._id ??
            (member as { id?: string }).id
        );
        const assigned = await replaceMembershipVenueAssignments({
          membershipId,
          orgId,
          locationIds: locationIdsRaw as string[],
        });
        assignedLocationIds = assigned.map((a) => a.id);
        try {
          await invalidateUserSessions(
            String((member as { userId?: string }).userId)
          );
        } catch (invalidateErr) {
          console.error(
            "[POST /api/admin/users] session invalidate failed after assign:",
            invalidateErr
          );
        }
      } catch (assignErr) {
        parkAssignError =
          assignErr instanceof Error
            ? assignErr.message
            : "Park assignment failed";
      }
    }

    return created({
      member: {
        ...member,
        assignedLocationIds,
        parkLocked:
          assignedLocationIds.length > 0 &&
          (member as { rolePreset?: string }).rolePreset !== "platform_admin",
      },
      ...(parkAssignError ? { parkAssignError } : {}),
    });
  } catch (err) {
    const authRes = authErrorToResponse(
      err,
      authAudit(request, "POST /api/admin/users", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.UsersManageRoles,
        metadata: { email },
      })
    );
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : "Failed to create user";
    if (
      message === "Email already registered" ||
      message === "Role template not found" ||
      message.includes("rolePreset must be custom")
    ) {
      return badRequest(message);
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "P2002") {
      return badRequest("Email already registered");
    }
    console.error("Failed to create staff user:", err);
    return serverError("Failed to create user");
  }
}
