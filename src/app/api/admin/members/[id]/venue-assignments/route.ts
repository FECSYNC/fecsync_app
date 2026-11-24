export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { isValidId } from "@/lib/ids";
import {
  invalidateUserSessions,
  loadOrgMembership,
  MEMBER_NOT_FOUND_MESSAGE,
} from "@/lib/memberAdmin";
import {
  assertCanManageVenueAssignments,
  replaceMembershipVenueAssignments,
} from "@/lib/parkAdminScope";

/*
 * PUT /api/admin/members/[id]/venue-assignments
 * Body: { locationIds: string[] } — replace-set park assignments.
 * Requires users:park_assign (+ expand from users:manage_roles) +
 * company-wide / platform_admin / software owner.
 */

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.UsersParkAssign);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PUT /api/admin/members/[id]/venue-assignments", {
          permission: P.UsersParkAssign,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const orgId = requireActorOrgId(actor);
  const limited = apiRateLimited(
    request,
    "member-venue-assignments",
    20,
    15 * 60 * 1000,
    `${orgId}:${actor.sub}`
  );
  if (limited) return limited;

  const { id: membershipId } = await context.params;
  if (!isValidId(membershipId)) {
    return notFound(MEMBER_NOT_FOUND_MESSAGE);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    const assignScope = await assertCanManageVenueAssignments(actor);

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("locationIds" in body)
    ) {
      return badRequest("locationIds array is required");
    }
    const rawIds = (body as { locationIds: unknown }).locationIds;
    if (!Array.isArray(rawIds)) {
      return badRequest("locationIds must be an array");
    }
    if (rawIds.some((id) => typeof id !== "string")) {
      return badRequest("locationIds must be an array of strings");
    }
    let locationIds = rawIds as string[];

    const membership = await loadOrgMembership(orgId, membershipId);
    if (!membership) {
      return notFound(MEMBER_NOT_FOUND_MESSAGE);
    }

    const {
      assertCanManageStaffUserTarget,
    } = await import("@/lib/resolvePlatformSoftwareOwner");
    const { ForbiddenError } = await import("@/lib/auth/http-error");
    try {
      await assertCanManageStaffUserTarget(actor, membership.userId);
    } catch (ownerErr) {
      if (ownerErr instanceof ForbiddenError) {
        return notFound(MEMBER_NOT_FOUND_MESSAGE);
      }
      throw ownerErr;
    }

    // Franchise managers: only roster seats, only parks inside their assignment,
    // never clear park-lock (empty set unlocks company-wide authority).
    if (assignScope.parkLocked && assignScope.franchiseParkManager) {
      const {
        assertMembershipInFranchiseRoster,
        normalizeFranchiseInviteLocationIds,
        FRANCHISE_INVITE_PARK_REQUIRED,
      } = await import("@/lib/franchisePark");
      await assertMembershipInFranchiseRoster(
        orgId,
        membership.id,
        assignScope.assignedLocationIds
      );
      // Empty replace-set would unlock company-wide authority — reject explicitly
      // (do not let normalizeFranchiseInviteLocationIds expand [] → all parks).
      if (locationIds.length === 0) {
        throw new ForbiddenError(FRANCHISE_INVITE_PARK_REQUIRED);
      }
      locationIds = normalizeFranchiseInviteLocationIds(
        assignScope,
        locationIds
      );
      if (
        membership.rolePreset === "platform_admin" ||
        membership.companyWideView === true
      ) {
        throw new ForbiddenError(
          "Franchise park managers cannot reassign company-wide seats"
        );
      }
    }

    const assignedLocations = await replaceMembershipVenueAssignments({
      membershipId: membership.id,
      orgId,
      locationIds,
    });

    try {
      await invalidateUserSessions(membership.userId);
    } catch (invalidateErr) {
      console.error(
        "[venue-assignments] session invalidate failed after assign:",
        invalidateErr
      );
    }

    return ok({
      membershipId: membership.id,
      assignedLocationIds: assignedLocations.map((l) => l.id),
      assignedLocations,
    });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to update venue assignments",
      authAudit(request, "PUT /api/admin/members/[id]/venue-assignments", {
        actorSub: actor.sub,
        orgId,
        permission: P.UsersParkAssign,
      })
    );
  }
}
