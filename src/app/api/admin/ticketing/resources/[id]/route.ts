export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { isValidId } from "@/lib/ids";
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
import { updateCapacityResource } from "@/lib/ticketing/resources";
import {
  RESOURCE_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";
import type { CapacityResourceType } from "@prisma/client";

/*
 * PATCH /api/admin/ticketing/resources/[id]
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parsePatchResourceBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    name: typeof b.name === "string" ? b.name : undefined,
    type:
      typeof b.type === "string"
        ? (b.type as CapacityResourceType)
        : undefined,
    defaultCapacity:
      b.defaultCapacity !== undefined ? Number(b.defaultCapacity) : undefined,
    archive: b.archive === true ? true : undefined,
    unarchive: b.unarchive === true ? true : undefined,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/ticketing/resources/[id]", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(RESOURCE_NOT_FOUND);
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
    const patch = parsePatchResourceBody(body);
    const resource = await updateCapacityResource(actor, id, patch);
    return ok({ resource });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update capacity resource",
      authAudit(request, "PATCH /api/admin/ticketing/resources/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
