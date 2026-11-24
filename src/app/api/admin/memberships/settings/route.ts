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
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  getMembershipSettings,
  upsertMembershipSettings,
} from "@/lib/memberships/settings";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/settings", {
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
    const locationIdParam = request.nextUrl.searchParams.get("locationId");
    const settings = await getMembershipSettings(
      actor,
      locationIdParam && locationIdParam.trim()
        ? locationIdParam.trim()
        : undefined
    );
    return ok({ settings, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load membership settings",
      authAudit(request, "GET /api/admin/memberships/settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}

export async function PUT(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.MembershipsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PUT /api/admin/memberships/settings", {
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
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const settings = await upsertMembershipSettings(actor, body);
    return ok({ settings });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to save membership settings",
      authAudit(request, "PUT /api/admin/memberships/settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
