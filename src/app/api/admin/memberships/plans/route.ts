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
  created,
} from "@/lib/response";
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listMembershipPlans,
  createMembershipPlan,
} from "@/lib/memberships/plans";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      ...MEMBERSHIPS_DESK_READ_PERMS,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/plans", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const includeArchived =
      request.nextUrl.searchParams.get("includeArchived") === "1" ||
      request.nextUrl.searchParams.get("includeArchived") === "true";
    const locationIdParam = request.nextUrl.searchParams.get("locationId");
    const plans = await listMembershipPlans(actor, {
      includeArchived,
      locationId:
        locationIdParam && locationIdParam.trim()
          ? locationIdParam.trim()
          : undefined,
    });
    return ok({ plans, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list membership plans",
      authAudit(request, "GET /api/admin/memberships/plans", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/memberships/plans", {
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
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const plan = await createMembershipPlan(actor, body);
    return created({ plan });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create membership plan",
      authAudit(request, "POST /api/admin/memberships/plans", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
