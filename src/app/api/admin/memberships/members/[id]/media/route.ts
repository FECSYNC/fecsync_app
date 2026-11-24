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
import {
  updateMemberPhoto,
  updateCustomMembershipId,
} from "@/lib/memberships/memberMedia";
import { setFamilyLinks } from "@/lib/memberships/family";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";

type Ctx = { params: Promise<{ id: string }> };

const WRITE_PERMS = [
  P.MembershipsWrite,
  P.MembershipsSell,
  P.MembershipsAdmin,
] as const;

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

/**
 * PATCH /api/admin/memberships/members/[id]/media
 * Body: { photoUrl } | { customMembershipId } | { familyGuestProfileIds }
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "memberships-member-media", 40, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...WRITE_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "PATCH /api/admin/memberships/members/[id]/media", {
          permission: P.MembershipsWrite,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }
  rejectClientOrgFields(body);

  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;

    if ("photoUrl" in body) {
      const member = await updateMemberPhoto(actor, id, body);
      return ok({ member, orgId: String(actor.orgId) });
    }
    if ("customMembershipId" in body) {
      const member = await updateCustomMembershipId(actor, id, body);
      return ok({ member, orgId: String(actor.orgId) });
    }
    if ("familyGuestProfileIds" in body || "guestProfileIds" in body) {
      const links = await setFamilyLinks(actor, id, {
        guestProfileIds:
          body.familyGuestProfileIds ?? body.guestProfileIds ?? [],
      });
      return ok({ familyLinks: links, orgId: String(actor.orgId), beta: true });
    }

    return badRequest(
      "Provide photoUrl, customMembershipId, or familyGuestProfileIds"
    );
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to update member media",
      authAudit(request, "PATCH /api/admin/memberships/members/[id]/media", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsWrite,
      })
    );
  }
}
