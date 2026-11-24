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
} from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  getBookingSettings,
  upsertBookingSettings,
  parsePatchSettingsBody,
} from "@/lib/ticketing/settings";

/*
 * GET|PATCH /api/admin/ticketing/settings
 * GET: TicketingSettingsRead (TicketingRead/Manage imply via expansion).
 * Optional ?locationId= is a venue picker — validated to actor org (never trusted as tenancy).
 * PATCH: TicketingSettingsWrite (TicketingManage implies via expansion).
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
    actor = await requirePermissionFresh(request, P.TicketingSettingsRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/ticketing/settings", {
          permission: P.TicketingSettingsRead,
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
    const settings = await getBookingSettings(
      actor,
      locationIdParam && locationIdParam.trim()
        ? locationIdParam.trim()
        : undefined
    );
    return ok({
      settings,
      orgId: String(actor.orgId),
    });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load booking settings",
      authAudit(request, "GET /api/admin/ticketing/settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingSettingsRead,
      })
    );
  }
}

export async function PATCH(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.TicketingSettingsWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/ticketing/settings", {
          permission: P.TicketingSettingsWrite,
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
    const input = parsePatchSettingsBody(body);
    const settings = await upsertBookingSettings(actor, input);

    logStaffActivityEntry(actor, {
      action: "Booking Settings Updated",
      entityType: "Settings",
      entityId: settings.id,
      description: `Updated booking settings (${settings.defaultCreateMode})`,
      request,
    });

    return ok({ settings });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update booking settings",
      authAudit(request, "PATCH /api/admin/ticketing/settings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.TicketingSettingsWrite,
      })
    );
  }
}
