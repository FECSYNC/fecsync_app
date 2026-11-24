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
import { apiRateLimited } from "@/lib/rateLimit";
import {
  rejectClientOrgFields,
  requireActorVenueInScope,
  assertMembershipsStaff,
  requireVisibleGuestMembership,
} from "@/lib/memberships/common";
import {
  verifyBenefits,
  findMembershipForRedeem,
  applyMembershipDiscount,
} from "@/lib/memberships/entitlementEngine";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import { isValidId } from "@/lib/ids";

/** Verify is desk-readable; redeem/undo stay redeem|admin on the Redeem route. */
const VERIFY_PERMS = [
  ...MEMBERSHIPS_DESK_READ_PERMS,
  P.MembershipsRedeem,
] as const;

/**
 * POST /api/admin/memberships/verify
 * Body: { guestMembershipId? | query?, locationId, amountMajor? }
 */
export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "memberships-verify", 60, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...VERIFY_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/memberships/verify", {
          permission: P.MembershipsRedeem,
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
    const orgId = await assertMembershipsStaff(actor);
    const locationId = String(body.locationId || "").trim();
    if (!isValidId(locationId)) {
      return badRequest("locationId is required");
    }
    await requireActorVenueInScope(actor, locationId);

    let guestMembershipId = String(body.guestMembershipId || "").trim();
    if (!guestMembershipId) {
      const query = String(body.query || body.customMembershipId || "").trim();
      if (!query) {
        return badRequest("guestMembershipId or query is required");
      }
      const found = await findMembershipForRedeem(orgId, query);
      if (!found) {
        return badRequest("MEMBER_NOT_FOUND: No membership matched the search");
      }
      guestMembershipId = found.id;
    }

    await requireVisibleGuestMembership(actor, guestMembershipId);

    const verify = await verifyBenefits(guestMembershipId, locationId, {
      orgId,
    });

    let discount = null;
    if (
      body.amountMajor != null &&
      Number.isFinite(Number(body.amountMajor))
    ) {
      discount = await applyMembershipDiscount({
        guestMembershipId,
        locationId,
        amountMajor: Number(body.amountMajor),
        orgId,
      });
    }

    return ok({ verify, discount, orgId });
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to verify membership",
      authAudit(request, "POST /api/admin/memberships/verify", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRedeem,
      })
    );
  }
}
