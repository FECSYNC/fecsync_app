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
import { apiRateLimited } from "@/lib/rateLimit";
import {
  rejectClientOrgFields,
  requireActorVenueInScope,
  assertGuestMembershipVisibleToActor,
  assertMembershipsStaff,
  requireVisibleGuestMembership,
} from "@/lib/memberships/common";
import {
  redeemVisit,
  undoConsumeBenefit,
  findMembershipForRedeem,
} from "@/lib/memberships/entitlementEngine";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import { isValidId } from "@/lib/ids";
import { logStaffActivityEntry } from "@/lib/audit/activityLog";
import prisma from "@/lib/prisma";

const REDEEM_PERMS = [
  P.MembershipsRedeem,
  P.MembershipsAdmin,
] as const;

/**
 * POST /api/admin/memberships/redeem
 * Body: { guestMembershipId? | query?, locationId, guestProfileIds?, qty?,
 *         kind?, perkFlag?, idempotencyKey?, action?: "redeem"|"undo",
 *         usageEventId? }
 */
export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "memberships-redeem", 40, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...REDEEM_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/memberships/redeem", {
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
    const action = String(body.action || "redeem").trim();

    if (action === "undo") {
      const usageEventId = String(body.usageEventId || "").trim();
      if (!isValidId(usageEventId)) {
        return badRequest("usageEventId is required for undo");
      }
      const usage = await prisma.membershipUsageEvent.findFirst({
        where: { id: usageEventId, orgId },
        include: {
          guestMembership: {
            select: {
              orgId: true,
              planId: true,
              locationId: true,
              homeLocationId: true,
            },
          },
        },
      });
      if (!usage) {
        return badRequest("USAGE_EVENT_NOT_FOUND: Usage event not found");
      }
      // Same park desk that could redeem — not company-wide undo by id alone.
      await requireActorVenueInScope(actor, usage.locationId);
      await assertGuestMembershipVisibleToActor(actor, usage.guestMembership);

      const result = await undoConsumeBenefit({
        orgId,
        usageEventId,
        actorUserId: actor.sub ?? null,
        source: "admin",
      });
      logStaffActivityEntry(actor, {
        action: "memberships.redeem.undo",
        entityType: "MembershipUsageEvent",
        entityId: result.undo.id,
        description: `Undid membership usage ${usageEventId}`,
      });
      return ok({ undo: result, orgId });
    }

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
      // Scope the acting venue only — home/sell park may differ for visiting redeem.
      guestMembershipId = found.id;
    }

    await requireVisibleGuestMembership(actor, guestMembershipId);

    const guestProfileIds = Array.isArray(body.guestProfileIds)
      ? body.guestProfileIds.filter(
          (x): x is string => typeof x === "string" && isValidId(x)
        )
      : undefined;

    const kindRaw = String(body.kind || "visit").trim();
    const kind =
      kindRaw === "redeem" ||
      kindRaw === "perk_consumed" ||
      kindRaw === "free_product"
        ? kindRaw
        : "visit";

    const idempotencyKey =
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey.trim()
        : "";
    if (!idempotencyKey) {
      return badRequest("idempotencyKey is required for redeem");
    }

    const result = await redeemVisit({
      orgId,
      guestMembershipId,
      locationId,
      guestProfileIds,
      kind,
      perkFlag:
        typeof body.perkFlag === "string" ? body.perkFlag.trim() : undefined,
      qty:
        body.qty != null && Number.isFinite(Number(body.qty))
          ? Number(body.qty)
          : undefined,
      actorUserId: actor.sub ?? null,
      source: "admin",
      idempotencyKey,
      meta: {
        ...(typeof body.freeProductRef === "string"
          ? { freeProductRef: body.freeProductRef.trim() }
          : {}),
        ...(body.meta &&
        typeof body.meta === "object" &&
        !Array.isArray(body.meta)
          ? (body.meta as Record<string, unknown>)
          : {}),
      },
    });

    logStaffActivityEntry(actor, {
      action: "memberships.redeem",
      entityType: "GuestMembership",
      entityId: guestMembershipId,
      description: `Redeemed membership at venue (${result.visitStatus}) — remaining ${result.remainingEntries ?? "unlimited"}`,
    });

    return ok({
      redeem: {
        events: result.events.map((e) => ({
          id: e.id,
          kind: e.kind,
          qty: e.qty,
          remainingAfter: e.remainingAfter,
          guestProfileId: e.guestProfileId,
          createdAt: e.createdAt.toISOString(),
        })),
        remainingEntries: result.remainingEntries,
        visitStatus: result.visitStatus,
        verify: result.verify,
      },
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
      "Failed to redeem membership",
      authAudit(request, "POST /api/admin/memberships/redeem", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRedeem,
      })
    );
  }
}
