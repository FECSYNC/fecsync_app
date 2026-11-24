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
import { isValidId } from "@/lib/ids";
import { listAvailableSessions } from "@/lib/ticketing/sessions";

/*
 * GET /api/admin/ticketing/availability
 * Staff preview of sessions with remaining >= requestedQty.
 * Query: productId, requestedQty, from, to. Rejects ?orgId=.
 */

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/availability", {
          permission: P.TicketingRead,
        })
      ) ?? serverError("Failed to authorize")
    );
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

    const sp = request.nextUrl.searchParams;
    const productId = sp.get("productId");
    if (!productId) {
      return badRequest("productId is required");
    }
    if (!isValidId(productId)) {
      return badRequest("Invalid productId");
    }

    const requestedQtyRaw = sp.get("requestedQty");
    const sessions = await listAvailableSessions(actor, {
      productId,
      requestedQty: requestedQtyRaw ? Number(requestedQtyRaw) : undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      date: sp.get("date") || undefined,
    });

    return ok({
      sessions,
      productId,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to preview session availability",
      authAudit(request, "GET /api/admin/ticketing/availability", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingRead,
      })
    );
  }
}
