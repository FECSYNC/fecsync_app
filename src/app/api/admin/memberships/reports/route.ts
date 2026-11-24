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
import { requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { getMembershipReports, getMembershipKpis } from "@/lib/memberships/reports";
import { requireActorVenueInScope } from "@/lib/memberships/common";

const ROUTE = "GET /api/admin/memberships/reports";

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
        authAudit(request, ROUTE, { permission: P.MembershipsRead })
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
    if (sp.get("kpis") === "1") {
      const kpis = await getMembershipKpis(actor);
      return ok({ kpis });
    }
    const locationId = sp.get("locationId")?.trim() || null;
    if (locationId) {
      await requireActorVenueInScope(actor, locationId, { allowArchived: true });
    }
    const report = await getMembershipReports(actor, {
      from: sp.get("from"),
      to: sp.get("to"),
      locationId,
      hqRollup: sp.get("hqRollup") === "1",
    });
    return ok({ report });
  } catch (err) {
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to load membership reports",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}
