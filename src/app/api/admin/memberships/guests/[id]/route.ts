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
import { getGuestProfileDetail } from "@/lib/memberships/guests";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "GET /api/admin/memberships/guests/[id]";

export async function GET(request: NextRequest, ctx: Ctx) {
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
    const { id } = await ctx.params;
    const detail = await getGuestProfileDetail(actor, id);
    return ok(detail);
  } catch (err) {
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to load guest",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}
