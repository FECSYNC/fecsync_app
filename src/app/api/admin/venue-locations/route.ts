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
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import {
  createVenueLocation,
  listVenueLocations,
  parseCreateVenueLocationBody,
  VENUE_NAME_REQUIRED,
  VENUE_NAME_TOO_LONG,
  VENUE_SLUG_INVALID,
  VENUE_SLUG_TAKEN,
  VENUE_PRIVILEGED_FIELD,
} from "@/lib/venueLocations";

/*
 * GET|POST /api/admin/venue-locations
 * Registered company only (not storefront/isDefault).
 * Actor.orgId only — never trust body.orgId / ?orgId=.
 * Plan limit: venues (assertWithinPlanLimit on create).
 * GET ?scope=all — skip HQ location preference filter (HQ switcher).
 * Default GET applies actorLocationScope when a park is selected.
 * GET also allows catalog/ticketing/bookings/memberships readers so park stamps/filters work
 * without settings:manage (POST create stays settings:manage).
 */

const VALIDATION_MESSAGES = new Set([
  VENUE_NAME_REQUIRED,
  VENUE_NAME_TOO_LONG,
  VENUE_SLUG_INVALID,
  VENUE_SLUG_TAKEN,
  VENUE_PRIVILEGED_FIELD,
  "Invalid JSON",
]);

const VENUE_LIST_PERMS = [
  P.SettingsManage,
  P.VenuesRead,
  P.VenuesWrite,
  P.VenuesArchive,
  P.ProductsRead,
  P.ProductsWrite,
  P.TicketingRead,
  P.TicketingWrite,
  P.TicketingProductsRead,
  P.BookingsRead,
  P.BookingsWrite,
  P.MembershipsRead,
  P.MembershipsWrite,
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsAdmin,
  P.AnalyticsRead,
  P.WaiversRead,
  P.WaiversWrite,
  P.WaiversVerify,
  P.WaiversAdmin,
] as const;

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...VENUE_LIST_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/venue-locations", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    // Never honor client org / location selectors — actor JWT orgId is SSOT;
    // park preference comes from Membership (or ?scope=all), not ?locationId=.
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const scopeParam = request.nextUrl.searchParams.get("scope");
    const applyLocationScope = scopeParam !== "all";
    const venues = await listVenueLocations(actor, { applyLocationScope });
    return ok({
      venues,
      orgId: String(actor.orgId),
      applyLocationScope,
    });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to list venue locations",
      authAudit(request, "GET /api/admin/venue-locations", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
  }
}

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.VenuesWrite);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/venue-locations", {
          permission: P.VenuesWrite,
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
    const input = parseCreateVenueLocationBody(body);
    const venue = await createVenueLocation(actor, input);

    logStaffActivityEntry(actor, {
      action: "Venue Location Created",
      entityType: "Settings",
      entityId: venue.id,
      description: `Created venue "${venue.name}" (${venue.slug})`,
      request,
    });

    return created({ venue });
  } catch (err) {
    if (err instanceof Error && VALIDATION_MESSAGES.has(err.message)) {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to create venue location",
      authAudit(request, "POST /api/admin/venue-locations", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.VenuesWrite,
      })
    );
  }
}
