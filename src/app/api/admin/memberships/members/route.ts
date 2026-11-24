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
import {
  requireAnyPermissionFresh,
} from "@/lib/middleware/requireAuth";
import { P, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { rejectClientOrgFields, requireActorVenueInScope, assertLocationInMembershipScope } from "@/lib/memberships/common";
import { sellMembership } from "@/lib/memberships/billingEngine";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import {
  listGuestMemberships,
  publicGuestMembershipPayload,
} from "@/lib/memberships/members";
import type { MembershipSellChannel } from "@prisma/client";
import prisma from "@/lib/prisma";

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

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
        authAudit(request, "GET /api/admin/memberships/members", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    if (
      request.nextUrl.searchParams.has("orgId") ||
      request.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    const sp = request.nextUrl.searchParams;
    const result = await listGuestMemberships(actor, {
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      planId: sp.get("planId") ?? undefined,
      locationId: sp.get("locationId") ?? undefined,
      take: sp.get("take") ? Number(sp.get("take")) : undefined,
      cursor: sp.get("cursor") ?? undefined,
    });
    return ok({ ...result, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to list members",
      authAudit(request, "GET /api/admin/memberships/members", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}

const SELL_PERMS = [P.MembershipsSell, P.MembershipsBilling, P.MembershipsAdmin] as const;

/** POST sell new membership */
export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "memberships-sell", 30, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...SELL_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/memberships/members", {
          permission: P.MembershipsSell,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return badRequest("Invalid JSON body");
    }
    rejectClientOrgFields(body);

    const locationId = String(body.locationId || "").trim();
    const homeLocationId = String(
      body.homeLocationId || body.locationId || ""
    ).trim();
    const guestProfileId = String(body.guestProfileId || "").trim();
    const planId = String(body.planId || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const paymentMethod = String(body.paymentMethod || "collected").trim() as
      | "stripe"
      | "collected"
      | "pending"
      | "credit";

    if (!locationId || !guestProfileId || !planId || !idempotencyKey) {
      return badRequest(
        "locationId, guestProfileId, planId, and idempotencyKey are required"
      );
    }

    await requireActorVenueInScope(actor, locationId);
    if (homeLocationId !== locationId) {
      await requireActorVenueInScope(actor, homeLocationId);
    }

    // Park-locked desks cannot sell against guests stamped outside their parks.
    const sellGuests = await prisma.guestProfile.findMany({
      where: {
        orgId,
        id: {
          in: [
            guestProfileId,
            ...(Array.isArray(body.familyMemberIds)
              ? body.familyMemberIds.map((x) => String(x))
              : []),
          ],
        },
      },
      select: { id: true, locationId: true },
    });
    for (const g of sellGuests) {
      if (g.locationId) {
        await assertLocationInMembershipScope(actor, g.locationId);
      }
    }

    const familyMemberIds = Array.isArray(body.familyMemberIds)
      ? body.familyMemberIds.map((x) => String(x))
      : undefined;

    const result = await sellMembership({
      orgId,
      locationId,
      homeLocationId,
      guestProfileId,
      planId,
      familyMemberIds,
      paymentMethod,
      collectedAmount:
        typeof body.collectedAmount === "number"
          ? body.collectedAmount
          : body.collectedAmount != null
            ? Number(body.collectedAmount)
            : undefined,
      actorUserId: String(actor.sub),
      idempotencyKey,
      source: "admin" as MembershipSellChannel,
      allowPendingWithoutStripe: Boolean(body.allowPendingWithoutStripe),
    });

    return ok({
      membership: publicGuestMembershipPayload(result.membership),
      paymentAttemptId: result.paymentAttemptId,
      stripeConfigured: result.stripeConfigured,
      note: result.note,
    });
  } catch (err) {
    const billed = membershipBillingErrorResponse(err);
    if (billed) return billed;
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to sell membership",
      authAudit(request, "POST /api/admin/memberships/members", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsSell,
      })
    );
  }
}
