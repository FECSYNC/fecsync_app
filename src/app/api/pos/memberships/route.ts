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
import {
  P,
  MEMBERSHIPS_DESK_READ_PERMS,
  hasAnyPermission,
} from "@/lib/auth/permissions";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  rejectClientOrgFields,
  requireActorVenueInScope,
  assertGuestMembershipVisibleToActor,
  assertMembershipsStaff,
  requireVisibleGuestMembership,
  assertLocationInMembershipScope,
} from "@/lib/memberships/common";
import { assertGuestMembershipMutableByActor } from "@/lib/memberships/members";
import {
  posVerifyMembership,
  posRedeemMembership,
  posSellMembership,
  posUpgradeProductToMembership,
  posApplyMembershipDiscount,
  posUndoMembershipRedeem,
  posRenewMembership,
  posUpgradeMembership,
  posDowngradeMembership,
} from "@/lib/memberships/posAdapter";
import { findMembershipForRedeem } from "@/lib/memberships/entitlementEngine";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import { isValidId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import prisma from "@/lib/prisma";
import { assertPosEnabled } from "@/lib/pos/assertPosEnabled";

/**
 * Stable POS adapters (Feature 08 Phase 3).
 * POS till UI is not shipped — these routes are the integration surface.
 *
 * POST body.action: verify | redeem | sell | upgrade-product | discount | undo
 *   | renew | upgrade | downgrade
 */

const POS_PERMS = [
  ...MEMBERSHIPS_DESK_READ_PERMS,
  P.MembershipsRedeem,
  P.MembershipsSell,
] as const;

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "pos-memberships", 60, 60_000);
  if (limited) return limited;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...POS_PERMS]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/pos/memberships", {
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
    await assertPosEnabled(orgId);
    const action = String(body.action || "").trim();

    if (action === "verify" || action === "discount") {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsRead,
          P.MembershipsRedeem,
          P.MembershipsSell,
          P.MembershipsBilling,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:read or memberships:redeem required");
      }

      const locationId = String(body.locationId || "").trim();
      if (!isValidId(locationId)) return badRequest("locationId is required");
      await requireActorVenueInScope(actor, locationId);

      let guestMembershipId = String(body.guestMembershipId || "").trim();
      if (!guestMembershipId) {
        const query = String(body.query || body.customMembershipId || "").trim();
        const found = await findMembershipForRedeem(orgId, query);
        if (!found) return badRequest("MEMBER_NOT_FOUND");
        guestMembershipId = found.id;
      }

      await requireVisibleGuestMembership(actor, guestMembershipId);

      if (action === "discount") {
        const amountMajor = Number(body.amountMajor);
        if (!Number.isFinite(amountMajor)) {
          return badRequest("amountMajor is required");
        }
        const discount = await posApplyMembershipDiscount({
          guestMembershipId,
          locationId,
          amountMajor,
          orgId,
        });
        return ok({ discount, orgId });
      }

      const verify = await posVerifyMembership(
        guestMembershipId,
        locationId,
        orgId
      );
      return ok({ verify, orgId });
    }

    if (action === "redeem") {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsRedeem,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:redeem required");
      }

      const locationId = String(body.locationId || "").trim();
      if (!isValidId(locationId)) return badRequest("locationId is required");
      await requireActorVenueInScope(actor, locationId);

      let guestMembershipId = String(body.guestMembershipId || "").trim();
      if (!guestMembershipId) {
        const query = String(body.query || "").trim();
        const found = await findMembershipForRedeem(orgId, query);
        if (!found) return badRequest("MEMBER_NOT_FOUND");
        guestMembershipId = found.id;
      }

      await requireVisibleGuestMembership(actor, guestMembershipId);

      const guestProfileIds = Array.isArray(body.guestProfileIds)
        ? body.guestProfileIds.filter(
            (x): x is string => typeof x === "string" && isValidId(x)
          )
        : undefined;

      const idempotencyKey =
        typeof body.idempotencyKey === "string"
          ? body.idempotencyKey.trim()
          : "";
      if (!idempotencyKey) {
        return badRequest("idempotencyKey is required for redeem");
      }

      const result = await posRedeemMembership({
        orgId,
        guestMembershipId,
        locationId,
        guestProfileIds,
        qty:
          body.qty != null && Number.isFinite(Number(body.qty))
            ? Number(body.qty)
            : undefined,
        actorUserId: actor.sub ?? null,
        idempotencyKey,
      });
      return ok({
        redeem: {
          remainingEntries: result.remainingEntries,
          visitStatus: result.visitStatus,
          eventIds: result.events.map((e) => e.id),
          verify: result.verify,
        },
        orgId,
      });
    }

    if (action === "undo") {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsRedeem,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:redeem required");
      }
      const usageEventId = String(body.usageEventId || "").trim();
      if (!isValidId(usageEventId)) {
        return badRequest("usageEventId is required");
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
      if (!usage) return badRequest("USAGE_EVENT_NOT_FOUND");
      await requireActorVenueInScope(actor, usage.locationId);
      await assertGuestMembershipVisibleToActor(actor, usage.guestMembership);

      const result = await posUndoMembershipRedeem({
        orgId,
        usageEventId,
        actorUserId: actor.sub ?? null,
        source: "pos",
      });
      return ok({
        undo: {
          originalId: result.original.id,
          undoId: result.undo.id,
          remainingEntries: result.remainingEntries,
        },
        orgId,
      });
    }

    if (action === "sell") {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsSell,
          P.MembershipsBilling,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:sell required");
      }
      const locationId = String(body.locationId || "").trim();
      const homeLocationId = String(
        body.homeLocationId || body.locationId || ""
      ).trim();
      if (!isValidId(locationId) || !isValidId(homeLocationId)) {
        return badRequest("locationId and homeLocationId are required");
      }
      await requireActorVenueInScope(actor, locationId);
      await requireActorVenueInScope(actor, homeLocationId);

      const sellGuestIds = [
        String(body.guestProfileId || ""),
        ...(Array.isArray(body.familyMemberIds)
          ? body.familyMemberIds.map((x) => String(x))
          : []),
      ].filter((id) => isValidId(id));
      if (sellGuestIds.length > 0) {
        const sellGuests = await prisma.guestProfile.findMany({
          where: { orgId, id: { in: sellGuestIds } },
          select: { id: true, locationId: true },
        });
        for (const g of sellGuests) {
          if (g.locationId) {
            await assertLocationInMembershipScope(actor, g.locationId);
          }
        }
      }

      const result = await posSellMembership({
        orgId,
        guestProfileId: String(body.guestProfileId || ""),
        planId: String(body.planId || ""),
        locationId,
        homeLocationId,
        paymentMethod: String(body.paymentMethod || "collected") as
          | "collected"
          | "pending"
          | "stripe",
        collectedAmount:
          body.collectedAmount != null
            ? Number(body.collectedAmount)
            : undefined,
        actorUserId: String(actor.sub || ""),
        idempotencyKey: String(body.idempotencyKey || ""),
        posSaleLineId:
          typeof body.posSaleLineId === "string"
            ? body.posSaleLineId
            : undefined,
        familyMemberIds: Array.isArray(body.familyMemberIds)
          ? body.familyMemberIds.filter(
              (x): x is string => typeof x === "string"
            )
          : undefined,
        allowPendingWithoutStripe: body.allowPendingWithoutStripe === true,
      });
      return ok({
        membership: {
          id: result.membership.id,
          status: result.membership.status,
          customMembershipId: result.membership.customMembershipId,
        },
        note: result.note,
        orgId,
      });
    }

    if (action === "upgrade-product") {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsSell,
          P.MembershipsBilling,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:sell required");
      }
      const locationId = String(body.locationId || "").trim();
      if (!isValidId(locationId)) return badRequest("locationId is required");
      await requireActorVenueInScope(actor, locationId);

      const upgradeGuestIds = [
        String(body.guestProfileId || ""),
        ...(Array.isArray(body.familyMemberIds)
          ? body.familyMemberIds.map((x) => String(x))
          : []),
      ].filter((id) => isValidId(id));
      if (upgradeGuestIds.length > 0) {
        const sellGuests = await prisma.guestProfile.findMany({
          where: { orgId, id: { in: upgradeGuestIds } },
          select: { id: true, locationId: true },
        });
        for (const g of sellGuests) {
          if (g.locationId) {
            await assertLocationInMembershipScope(actor, g.locationId);
          }
        }
      }

      const result = await posUpgradeProductToMembership({
        orgId,
        actorUserId: String(actor.sub || ""),
        posSaleLineId: String(body.posSaleLineId || ""),
        guestProfileId: String(body.guestProfileId || ""),
        planId: String(body.planId || ""),
        locationId,
        homeLocationId:
          typeof body.homeLocationId === "string"
            ? body.homeLocationId
            : undefined,
        paymentMethod: String(body.paymentMethod || "collected") as
          | "collected"
          | "pending"
          | "stripe",
        collectedAmount:
          body.collectedAmount != null
            ? Number(body.collectedAmount)
            : undefined,
        allowPendingWithoutStripe: body.allowPendingWithoutStripe === true,
        originalProductRef:
          typeof body.originalProductRef === "string"
            ? body.originalProductRef
            : undefined,
        originalProductName:
          typeof body.originalProductName === "string"
            ? body.originalProductName
            : undefined,
        familyMemberIds: Array.isArray(body.familyMemberIds)
          ? body.familyMemberIds.filter(
              (x): x is string => typeof x === "string"
            )
          : undefined,
      });
      return ok({
        membership: {
          id: result.membership.id,
          status: result.membership.status,
          customMembershipId: result.membership.customMembershipId,
        },
        compensatingNote: result.compensatingNote,
        originalProductRef: result.originalProductRef,
        note: result.note,
        orgId,
      });
    }

    if (
      action === "renew" ||
      action === "upgrade" ||
      action === "downgrade"
    ) {
      if (
        !hasAnyPermission(actor.permissions, [
          P.MembershipsBilling,
          P.MembershipsSell,
          P.MembershipsAdmin,
        ])
      ) {
        throw new ForbiddenError("memberships:billing required");
      }
      const membershipId = String(
        body.guestMembershipId || body.membershipId || ""
      ).trim();
      if (!isValidId(membershipId)) {
        return badRequest("guestMembershipId is required");
      }
      await assertGuestMembershipMutableByActor(actor, membershipId);
      const idempotencyKey = String(body.idempotencyKey || "").trim();
      if (!idempotencyKey) return badRequest("idempotencyKey is required");
      const actorUserId = String(actor.sub || "");
      const allowGroupOverride =
        body.allowGroupOverride === true &&
        hasAnyPermission(actor.permissions, [P.MembershipsAdmin]);

      if (action === "renew") {
        const result = await posRenewMembership({
          orgId,
          membershipId,
          actorUserId,
          paymentMethod: String(body.paymentMethod || "collected") as
            | "collected"
            | "pending"
            | "stripe",
          collectedAmount:
            body.collectedAmount != null
              ? Number(body.collectedAmount)
              : undefined,
          idempotencyKey,
        });
        return ok({
          membership: {
            id: result.membership.id,
            status: result.membership.status,
            planId: result.membership.planId,
          },
          note: result.note,
          orgId,
        });
      }

      const newPlanId = String(body.newPlanId || "").trim();
      if (!isValidId(newPlanId)) return badRequest("newPlanId is required");

      if (action === "upgrade") {
        const result = await posUpgradeMembership({
          orgId,
          membershipId,
          newPlanId,
          actorUserId,
          paymentMethod: String(body.paymentMethod || "collected") as
            | "collected"
            | "stripe",
          collectedAmount:
            body.collectedAmount != null
              ? Number(body.collectedAmount)
              : undefined,
          idempotencyKey,
          allowGroupOverride,
        });
        return ok({
          membership: {
            id: result.membership.id,
            status: result.membership.status,
            planId: result.membership.planId,
          },
          note: result.note,
          orgId,
        });
      }

      const result = await posDowngradeMembership({
        orgId,
        membershipId,
        newPlanId,
        actorUserId,
        idempotencyKey,
        allowGroupOverride,
      });
      return ok({
        membership: {
          id: result.membership.id,
          status: result.membership.status,
          planId: result.membership.planId,
        },
        note: result.note,
        orgId,
      });
    }

    return badRequest(
      "action must be verify|redeem|sell|upgrade-product|discount|undo|renew|upgrade|downgrade"
    );
  } catch (err) {
    const mapped = membershipBillingErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof Error && err.name === "Error") {
      return badRequest(err.message);
    }
    return routeErrorResponse(
      err,
      "POS memberships action failed",
      authAudit(request, "POST /api/pos/memberships", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRedeem,
      })
    );
  }
}
