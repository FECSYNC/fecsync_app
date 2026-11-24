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
  getVenueLocation,
  updateVenueLocation,
  archiveVenueLocation,
  reactivateVenueLocation,
  parseUpdateVenueLocationBody,
  VENUE_NAME_REQUIRED,
  VENUE_NAME_TOO_LONG,
  VENUE_SLUG_INVALID,
  VENUE_SLUG_TAKEN,
  VENUE_PRIVILEGED_FIELD,
  VENUE_NOT_FOUND,
  VENUE_UPDATE_EMPTY,
} from "@/lib/venueLocations";

/*
 * GET|PATCH|DELETE /api/admin/venue-locations/[id]
 * Registered company only. Actor.orgId only — never trust body.orgId.
 * PATCH: profile fields (no client status).
 * DELETE: soft-archive (frees venues quota).
 * PATCH ?action=reactivate or body { action: "reactivate" }: restore archived.
 */

const VALIDATION_MESSAGES = new Set([
  VENUE_NAME_REQUIRED,
  VENUE_NAME_TOO_LONG,
  VENUE_SLUG_INVALID,
  VENUE_SLUG_TAKEN,
  VENUE_PRIVILEGED_FIELD,
  VENUE_UPDATE_EMPTY,
  "Invalid JSON",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.VenuesRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/venue-locations/[id]", {
          permission: P.VenuesRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(VENUE_NOT_FOUND);
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
    const venue = await getVenueLocation(actor, id);
    return ok({ venue });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to load venue location",
      authAudit(request, "GET /api/admin/venue-locations/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.VenuesRead,
      })
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(VENUE_NOT_FOUND);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const action =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).action === "string"
      ? String((body as Record<string, unknown>).action).trim().toLowerCase()
      : request.nextUrl.searchParams.get("action")?.trim().toLowerCase() ||
        "";

  const needsArchive = action === "reactivate" || action === "archive";
  let actor;
  try {
    actor = await requirePermissionFresh(
      request,
      needsArchive ? P.VenuesArchive : P.VenuesWrite
    );
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/venue-locations/[id]", {
          permission: needsArchive ? P.VenuesArchive : P.VenuesWrite,
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

    if (action === "reactivate") {
      const venue = await reactivateVenueLocation(actor, id);
      logStaffActivityEntry(actor, {
        action: "Venue Location Reactivated",
        entityType: "Settings",
        entityId: venue.id,
        description: `Reactivated venue "${venue.name}" (${venue.slug})`,
        request,
      });
      return ok({ venue });
    }

    if (action === "archive") {
      const venue = await archiveVenueLocation(actor, id);
      logStaffActivityEntry(actor, {
        action: "Venue Location Archived",
        entityType: "Settings",
        entityId: venue.id,
        description: `Archived venue "${venue.name}" (${venue.slug})`,
        request,
      });
      return ok({ venue });
    }

    const input = parseUpdateVenueLocationBody(body);
    const venue = await updateVenueLocation(actor, id, input);

    logStaffActivityEntry(actor, {
      action: "Venue Location Updated",
      entityType: "Settings",
      entityId: venue.id,
      description: `Updated venue "${venue.name}" (${venue.slug})`,
      request,
    });

    return ok({ venue });
  } catch (err) {
    if (err instanceof Error && VALIDATION_MESSAGES.has(err.message)) {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to update venue location",
      authAudit(request, "PATCH /api/admin/venue-locations/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: needsArchive ? P.VenuesArchive : P.VenuesWrite,
      })
    );
  }
}

/** Soft-archive — does not hard-delete. Frees venues plan quota. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.VenuesArchive);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "DELETE /api/admin/venue-locations/[id]", {
          permission: P.VenuesArchive,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(VENUE_NOT_FOUND);
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
    const venue = await archiveVenueLocation(actor, id);

    logStaffActivityEntry(actor, {
      action: "Venue Location Archived",
      entityType: "Settings",
      entityId: venue.id,
      description: `Archived venue "${venue.name}" (${venue.slug})`,
      request,
    });

    return ok({ venue });
  } catch (err) {
    if (err instanceof Error && VALIDATION_MESSAGES.has(err.message)) {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to archive venue location",
      authAudit(request, "DELETE /api/admin/venue-locations/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.VenuesArchive,
      })
    );
  }
}
