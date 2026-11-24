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
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { rejectClientOrgFields } from "@/lib/memberships/common";
import { assertGuestMembershipMutableByActor } from "@/lib/memberships/members";
import { signAgreementAsStaff } from "@/lib/memberships/agreements";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST /api/admin/memberships/members/[id]/agreement";

/** Staff records in-person agreement acceptance. Body: { accepted: true } */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "memberships-agreement", 40, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      P.MembershipsSell,
      P.MembershipsBilling,
      P.MembershipsAdmin,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, ROUTE, { permission: P.MembershipsSell })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    rejectClientOrgFields(body);
    const { id } = await ctx.params;
    await assertGuestMembershipMutableByActor(actor, id);
    const result = await signAgreementAsStaff(actor, id, body);
    return ok(result);
  } catch (err) {
    const billed = membershipBillingErrorResponse(err);
    if (billed) return billed;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to record agreement",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsSell,
      })
    );
  }
}
