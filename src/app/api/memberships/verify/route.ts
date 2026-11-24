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

/**
 * Online checkout / booking verify hook (Feature 08 Phase 3+).
 * Requires Memberships desk permissions — not bare bookings:read/create
 * (those would leak entitlement PII without a Memberships seat).
 *
 * Honesty: public booking Checkout does **not** auto-apply membership
 * discounts. Call this endpoint (or `applyMembershipDiscount`) from a desk /
 * future booking UI when verifying a guest membership at pay time.
 *
 * POST /api/memberships/verify
 * Body: { guestMembershipId? | customMembershipId?, locationId, amountMajor? }
 */
const ONLINE_VERIFY_PERMS = [
  ...MEMBERSHIPS_DESK_READ_PERMS,
  P.MembershipsRedeem,
] as const;

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "memberships-online-verify", 60, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...ONLINE_VERIFY_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/memberships/verify", {
          permission: P.MembershipsRead,
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
      const query = String(
        body.customMembershipId || body.query || body.code || ""
      ).trim();
      if (!query) {
        return badRequest("guestMembershipId or customMembershipId is required");
      }
      const found = await findMembershipForRedeem(orgId, query);
      if (!found) {
        return badRequest("MEMBER_NOT_FOUND: No membership matched");
      }
      guestMembershipId = found.id;
    }

    await requireVisibleGuestMembership(actor, guestMembershipId);

    const verify = await verifyBenefits(guestMembershipId, locationId, {
      orgId,
    });

    let discount = null;
    if (body.amountMajor != null && Number.isFinite(Number(body.amountMajor))) {
      discount = await applyMembershipDiscount({
        guestMembershipId,
        locationId,
        amountMajor: Number(body.amountMajor),
        orgId,
      });
    }

    return ok({
      channel: "online",
      verify: {
        guestMembershipId: verify.guestMembershipId,
        visitStatus: verify.visitStatus,
        eligible: verify.eligible,
        blocked: verify.blocked,
        blockReason: verify.blockReason,
        visitsExhausted: verify.visitsExhausted,
        warnings: verify.warnings,
        remainingEntries: verify.remainingEntries,
        discountPercent: verify.discountPercent,
        perks: verify.perks,
        status: verify.status,
        customMembershipId: verify.member.customMembershipId,
      },
      discount: discount
        ? {
            allowed: discount.allowed,
            discountPercent: discount.discountPercent,
            discountAmount: discount.discountAmount,
            payable: discount.payable,
            blockReason: discount.blockReason,
          }
        : null,
      orgId,
    });
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Online membership verify failed",
      authAudit(request, "POST /api/memberships/verify", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}
