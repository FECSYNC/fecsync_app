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
import { getMembershipCardPrintData } from "@/lib/memberships/cardPrint";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      ...MEMBERSHIPS_DESK_READ_PERMS,
      P.MembershipsRedeem,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/members/[id]/card", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const card = await getMembershipCardPrintData(actor, id);
    return ok({ card, orgId: String(actor.orgId) });
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to load membership card",
      authAudit(request, "GET /api/admin/memberships/members/[id]/card", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}
