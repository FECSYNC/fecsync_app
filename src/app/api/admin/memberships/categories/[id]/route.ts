export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import {
  requirePermissionFresh,
  requireAnyPermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  getMembershipCategory,
  updateMembershipCategory,
  archiveMembershipCategory,
} from "@/lib/memberships/categories";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function rejectOrgSelectors(request: NextRequest) {
  if (
    request.nextUrl.searchParams.has("orgId") ||
    request.nextUrl.searchParams.has("organizationId")
  ) {
    return badRequest("Unsupported selector in query");
  }
  return null;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      ...MEMBERSHIPS_DESK_READ_PERMS,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/categories/[id]", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await getMembershipCategory(actor, id);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load membership category",
      authAudit(request, "GET /api/admin/memberships/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/memberships/categories/[id]", {
          permission: P.MembershipsWrite,
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

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await updateMembershipCategory(actor, id, body);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update membership category",
      authAudit(request, "PATCH /api/admin/memberships/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/memberships/categories/[id]", {
          permission: P.MembershipsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const rejected = rejectOrgSelectors(request);
    if (rejected) return rejected;
    const { id } = await ctx.params;
    const category = await archiveMembershipCategory(actor, id);
    return ok({ category });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to archive membership category",
      authAudit(request, "DELETE /api/admin/memberships/categories/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
