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
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  getHqLocationContext,
  setHqLocationContext,
  parseHqLocationContextBody,
} from "@/lib/hqLocationContext";

/*
 * GET|PUT /api/admin/hq/location-context
 * Enterprise HQ only. Persists selected VenueLocation on Membership
 * (null = All locations). Never trust body.orgId / body.userId / body.membershipId.
 */

const VALIDATION_MESSAGES = new Set([
  "Invalid JSON",
  "locationId must be a string or null",
]);

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.HqRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/hq/location-context", {
          permission: P.HqRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("userId") ||
      request.nextUrl.searchParams.has("membershipId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const context = await getHqLocationContext(actor);
    return ok({ context });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to load HQ location context",
      authAudit(request, "GET /api/admin/hq/location-context", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.HqRead,
      })
    );
  }
}

export async function PUT(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.HqRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PUT /api/admin/hq/location-context", {
          permission: P.HqRead,
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
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId") ||
      request.nextUrl.searchParams.has("userId") ||
      request.nextUrl.searchParams.has("membershipId") ||
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const { locationId } = parseHqLocationContextBody(body);
    const context = await setHqLocationContext(actor, locationId);
    return ok({ context });
  } catch (err) {
    if (err instanceof Error && VALIDATION_MESSAGES.has(err.message)) {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to set HQ location context",
      authAudit(request, "PUT /api/admin/hq/location-context", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.HqRead,
      })
    );
  }
}
