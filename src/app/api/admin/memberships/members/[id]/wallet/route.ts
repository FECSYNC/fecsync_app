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
import { generateMembershipWalletPass } from "@/lib/memberships/walletPass";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import {
  assertGuestMembershipVisibleToActor,
  assertMembershipsStaff,
} from "@/lib/memberships/common";
import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isValidId } from "@/lib/ids";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/memberships/members/[id]/wallet
 * Always honest not_configured until .pkpass / Google JWT signing ships —
 * never fakes ready/download success. Digital QR remains on the card route.
 */
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
        authAudit(request, "GET /api/admin/memberships/members/[id]/wallet", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = await assertMembershipsStaff(actor);
    const { id } = await ctx.params;
    if (!isValidId(id)) return badRequest("Invalid membership id");

    const member = await prisma.guestMembership.findFirst({
      where: { id, orgId },
      select: {
        orgId: true,
        planId: true,
        locationId: true,
        homeLocationId: true,
      },
    });
    if (!member) throw new ForbiddenError("Guest membership not found");
    await assertGuestMembershipVisibleToActor(actor, member);

    const url = new URL(request.url);
    const platformRaw = url.searchParams.get("platform");
    const platform =
      platformRaw === "apple" || platformRaw === "google"
        ? platformRaw
        : "auto";
    const wallet = await generateMembershipWalletPass({
      orgId,
      guestMembershipId: id,
      platform,
    });
    return ok({ wallet, orgId });
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to load wallet pass",
      authAudit(request, "GET /api/admin/memberships/members/[id]/wallet", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}
