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
import { getHqOverview } from "@/lib/hqOverview";

/*
 * GET /api/admin/hq/overview
 * Enterprise HQ only — cross-venue rollup for actor.orgId.
 * Real VenueLocation counts + billing usage meters. No fake ticket/POS data.
 * Never trust ?orgId= / ?organizationId= / ?locationId= as authority.
 */

export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(request, P.HqRead);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/hq/overview", {
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
      request.nextUrl.searchParams.has("locationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const overview = await getHqOverview(actor);
    return ok({ overview });
  } catch (err) {
    return routeErrorResponse(
      err,
      "Failed to load Enterprise HQ overview",
      authAudit(request, "GET /api/admin/hq/overview", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.HqRead,
      })
    );
  }
}
