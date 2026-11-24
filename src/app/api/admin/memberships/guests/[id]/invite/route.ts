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
import { inviteGuestToDashboard } from "@/lib/memberships/guestInvite";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

type Ctx = { params: Promise<{ id: string }> };
const ROUTE = "POST /api/admin/memberships/guests/[id]/invite";
const INVITE_PERMS = [
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsWrite,
  P.MembershipsAdmin,
] as const;

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

/** Invite guest to online membership dashboard (link existing or invite-only create). */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "memberships-guest-invite", 20, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...INVITE_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, ROUTE, { permission: P.MembershipsSell })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    rejectClientOrgFields(body);

    const result = await inviteGuestToDashboard(actor, {
      guestProfileId: id,
      createAccountIfMissing: body.createAccountIfMissing !== false,
      sendEmail: body.sendEmail !== false,
    });

    return ok(result);
  } catch (err) {
    const billed = membershipBillingErrorResponse(err);
    if (billed) return billed;
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to invite guest to dashboard",
      authAudit(request, ROUTE, {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsSell,
      })
    );
  }
}
