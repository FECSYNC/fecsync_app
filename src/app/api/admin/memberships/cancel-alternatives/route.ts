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
  forbidden,
} from "@/lib/response";
import prisma from "@/lib/prisma";
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  listCancelAlternativesAdmin,
  upsertCancelAlternative,
} from "@/lib/memberships/cancelAlternatives";
import {
  rejectClientOrgFields,
  requireActorVenueInScope,
} from "@/lib/memberships/common";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

const GET_ROUTE = "GET /api/admin/memberships/cancel-alternatives";
const POST_ROUTE = "POST /api/admin/memberships/cancel-alternatives";

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
        authAudit(request, GET_ROUTE, { permission: P.MembershipsRead })
      ) ?? serverError("Failed to authorize")
    );
  }
  try {
    await connectDB();
    requireActorOrgId(actor);
    const sp = request.nextUrl.searchParams;
    if (sp.has("orgId") || sp.has("organizationId")) {
      return badRequest("Unsupported selector in query");
    }
    const locationId = sp.get("locationId")?.trim() || null;
    const alternatives = await listCancelAlternativesAdmin(actor, locationId);
    return ok({ alternatives, beta: true });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load cancel alternatives",
      authAudit(request, GET_ROUTE, {
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
    actor = await requireAnyPermissionFresh(request, [
      P.MembershipsWrite,
      P.MembershipsAdmin,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, POST_ROUTE, { permission: P.MembershipsWrite })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    rejectClientOrgFields(body);
    const rec =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    // upsertCancelAlternative updates by id before its org check — verify first.
    if (typeof rec.id === "string" && rec.id) {
      const owned = await prisma.membershipCancelAlternative.findFirst({
        where: { id: rec.id, orgId },
        select: { id: true },
      });
      if (!owned) return forbidden("Cancel alternative not found");
    }
    if (typeof rec.locationId === "string" && rec.locationId) {
      await requireActorVenueInScope(actor, rec.locationId);
    }
    const alternative = await upsertCancelAlternative(actor, body);
    return ok({ alternative, beta: true });
  } catch (err) {
    const billed = membershipBillingErrorResponse(err);
    if (billed) return billed;
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to save cancel alternative",
      authAudit(request, POST_ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
