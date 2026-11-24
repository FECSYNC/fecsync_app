export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requirePermissionFresh, requireAnyPermission } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  listTicketSessions,
  createTicketSession,
  createTicketSessionSeries,
  createTicketSessionsBulk,
  parseCreateSessionBody,
} from "@/lib/ticketing/sessions";

/*
 * GET|POST /api/admin/ticketing/sessions
 * POST: body.slots[] → bulk create; body.series → series; else single.
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
    // Calendar needs session capacity without requiring full Ticketing catalog access.
    actor = requireAnyPermission(request, [
      P.TicketingRead,
      P.BookingsRead,
      P.BookingsCalendarRead,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/sessions", {
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
    const sessions = await listTicketSessions(actor, {
      productId: sp.get("productId") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      includeClosed: sp.get("includeClosed") === "true",
    });
    return ok({
      sessions,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list ticket sessions",
      authAudit(request, "GET /api/admin/ticketing/sessions", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingRead,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/ticketing/sessions", {
          permission: P.TicketingWrite,
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

    const input = parseCreateSessionBody(body);

    if (input.slots && input.slots.length > 0) {
      const result = await createTicketSessionsBulk(actor, {
        productId: input.productId,
        resourceId: input.resourceId,
        capacity: input.capacity,
        priceOverride: input.priceOverride,
        slots: input.slots,
      });
      if (result.count > 0) {
        logStaffActivityEntry(actor, {
          action: "Ticket Session Bulk Created",
          entityType: "TicketSession",
          entityId: input.productId,
          description: `Created ${result.count} ticket session(s) for product ${input.productId}`,
          request,
        });
      }
      return created({ count: result.count, sessions: [] });
    }

    if (input.series) {
      if (!Array.isArray(input.weekdays) || !input.weekdays.length) {
        return badRequest("weekdays required for series create");
      }
      if (!input.untilDate) {
        return badRequest("untilDate required for series create");
      }
      const sessions = await createTicketSessionSeries(actor, {
        productId: input.productId,
        resourceId: input.resourceId,
        label: input.label,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        capacity: input.capacity,
        priceOverride: input.priceOverride,
        weekdays: input.weekdays,
        untilDate: input.untilDate,
      });

      const first = sessions[0];
      if (first) {
        logStaffActivityEntry(actor, {
          action: "Ticket Session Series Created",
          entityType: "TicketSession",
          entityId: first.id,
          description: `Created ${sessions.length} ticket session(s) for product ${input.productId}`,
          request,
        });
      }

      return created({ sessions });
    }

    const session = await createTicketSession(actor, {
      productId: input.productId,
      resourceId: input.resourceId,
      label: input.label,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      priceOverride: input.priceOverride,
    });

    logStaffActivityEntry(actor, {
      action: "Ticket Session Created",
      entityType: "TicketSession",
      entityId: session.id,
      description: `Created ticket session ${session.id}`,
      request,
    });

    return created({ session });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to create ticket session",
      authAudit(request, "POST /api/admin/ticketing/sessions", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingWrite,
      })
    );
  }
}
