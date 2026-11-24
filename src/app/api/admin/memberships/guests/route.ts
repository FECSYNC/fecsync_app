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
  searchGuestProfiles,
  createGuestProfile,
} from "@/lib/memberships/guests";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

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
        authAudit(request, "GET /api/admin/memberships/guests", {
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
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const locationId =
      request.nextUrl.searchParams.get("locationId") ?? undefined;
    const guests = await searchGuestProfiles(actor, { q, locationId });
    return ok({ guests, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to search guests",
      authAudit(request, "GET /api/admin/memberships/guests", {
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
        authAudit(request, "POST /api/admin/memberships/guests", {
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
    const guest = await createGuestProfile(actor, body);
    return created(guest);
  } catch (err) {
    const billed = membershipBillingErrorResponse(err);
    if (billed) return billed;
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create guest",
      authAudit(request, "POST /api/admin/memberships/guests", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
