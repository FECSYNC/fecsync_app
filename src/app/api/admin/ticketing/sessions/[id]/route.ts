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
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  updateTicketSession,
  deleteTicketSession,
} from "@/lib/ticketing/sessions";
import {
  SESSION_NOT_FOUND,
  rejectClientOrgFields,
} from "@/lib/ticketing/common";

/*
 * PATCH|DELETE /api/admin/ticketing/sessions/[id]
 * DELETE soft-closes (isClosed + remaining 0).
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

function parsePatchSessionBody(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Invalid JSON");
  const b = body as Record<string, unknown>;
  rejectClientOrgFields(b);
  return {
    startsAt: typeof b.startsAt === "string" ? b.startsAt : undefined,
    endsAt: typeof b.endsAt === "string" ? b.endsAt : undefined,
    capacity: b.capacity !== undefined ? Number(b.capacity) : undefined,
    remaining: b.remaining !== undefined ? Number(b.remaining) : undefined,
    isClosed: typeof b.isClosed === "boolean" ? b.isClosed : undefined,
    priceOverride:
      b.priceOverride === undefined
        ? undefined
        : b.priceOverride === null || b.priceOverride === ""
          ? null
          : Number(b.priceOverride),
    resourceId:
      b.resourceId === undefined
        ? undefined
        : b.resourceId === null || b.resourceId === ""
          ? null
          : String(b.resourceId),
    label:
      b.label === undefined
        ? undefined
        : b.label === null || b.label === ""
          ? null
          : String(b.label),
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
        authAudit(request, "PATCH /api/admin/ticketing/sessions/[id]", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(SESSION_NOT_FOUND);
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
    const patch = parsePatchSessionBody(body);
    const session = await updateTicketSession(actor, id, patch);
    return ok({ session });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update ticket session",
      authAudit(request, "PATCH /api/admin/ticketing/sessions/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}

export async function DELETE(
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
        authAudit(request, "DELETE /api/admin/ticketing/sessions/[id]", {
          permission: P.TicketingWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(SESSION_NOT_FOUND);
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
    const session = await deleteTicketSession(actor, id);

    logStaffActivityEntry(actor, {
      action: "Ticket Session Closed",
      entityType: "TicketSession",
      entityId: session.id,
      description: `Closed ticket session ${session.id}`,
      request,
    });

    return ok({ session });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to close ticket session",
      authAudit(request, "DELETE /api/admin/ticketing/sessions/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
