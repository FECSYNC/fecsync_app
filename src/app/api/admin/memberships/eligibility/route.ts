export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  badRequest,
  conflict,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listMembershipEligibility,
  putMembershipEligibility,
} from "@/lib/memberships/eligibility";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    if (err.message.startsWith("Eligibility update conflict")) {
      return conflict(err.message);
    }
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
        authAudit(request, "GET /api/admin/memberships/eligibility", {
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
    const planId = request.nextUrl.searchParams.get("planId") ?? undefined;
    const rows = await listMembershipEligibility(actor, { planId });
    return ok({ rows, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load eligibility",
      authAudit(request, "GET /api/admin/memberships/eligibility", {
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
        authAudit(request, "PUT /api/admin/memberships/eligibility", {
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
    const rows = await putMembershipEligibility(actor, body);
    return ok({ rows });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to save eligibility",
      authAudit(request, "PUT /api/admin/memberships/eligibility", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
