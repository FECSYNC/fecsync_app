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
import { P, hasAnyPermission, MEMBERSHIPS_DESK_READ_PERMS } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { rejectClientOrgFields } from "@/lib/memberships/common";
import {
  getGuestMembershipDetail,
  assertGuestMembershipMutableByActor,
  publicGuestMembershipPayload,
} from "@/lib/memberships/members";
import {
  renewMembership,
  upgradeMembership,
  downgradeMembership,
  pauseMembership,
  resumeMembership,
  cancelMembership,
  reactivateMembership,
  updatePaymentMethod,
  applyCredit,
} from "@/lib/memberships/billingEngine";
import { membershipBillingErrorResponse } from "@/lib/memberships/http";
import { sendGuestMembershipCancelEmail } from "@/lib/memberships/mail";
import prisma from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

function validationBadRequest(err: unknown) {
  if (err instanceof Error && err.name === "Error") {
    return badRequest(err.message);
  }
  return null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [
      ...MEMBERSHIPS_DESK_READ_PERMS,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "GET /api/admin/memberships/members/[id]", {
          permission: P.MembershipsRead,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    requireActorOrgId(actor);
    const { id } = await ctx.params;
    const detail = await getGuestMembershipDetail(actor, id);
    return ok({ member: detail, orgId: String(actor.orgId) });
  } catch (err) {
    const validation = validationBadRequest(err);
    if (validation) return validation;
    return routeErrorResponse(
      err,
      "Failed to load member",
      authAudit(request, "GET /api/admin/memberships/members/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsRead,
      })
    );
  }
}

const BILLING_PERMS = [
  P.MembershipsBilling,
  P.MembershipsAdmin,
] as const;
const CANCEL_PERMS = [
  P.MembershipsCancel,
  P.MembershipsBilling,
  P.MembershipsAdmin,
] as const;
const SELL_PERMS = [
  P.MembershipsSell,
  P.MembershipsBilling,
  P.MembershipsAdmin,
] as const;

/**
 * POST lifecycle actions: renew | upgrade | downgrade | pause | resume |
 * cancel | reactivate | payment-method | credit
 * Body: { action, ... }
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "memberships-billing", 40, 60_000);
  if (limited) return limited;

  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body");
  }
  rejectClientOrgFields(body);
  const action = String(body.action || "").trim();

  const needCancel = action === "cancel";
  const needSell = action === "renew" || action === "reactivate";
  const perms = needCancel
    ? CANCEL_PERMS
    : needSell
      ? SELL_PERMS
      : BILLING_PERMS;

  let actor;
  try {
    actor = await requireAnyPermissionFresh(request, [...perms]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(request, "POST /api/admin/memberships/members/[id]", {
          permission: needCancel
            ? P.MembershipsCancel
            : needSell
              ? P.MembershipsSell
              : P.MembershipsBilling,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    await connectDB();
    const orgId = requireActorOrgId(actor);
    const { id } = await ctx.params;
    // Park-locked / HQ-scoped desks: money mutations require sell+home in scope
    // (stricter than GET detail visibility, which also allows eligible parks).
    await assertGuestMembershipMutableByActor(actor, id);
    const actorUserId = String(actor.sub);
    const moneyActions = new Set([
      "renew",
      "upgrade",
      "downgrade",
      "reactivate",
      "credit",
    ]);
    const rawIdem =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (moneyActions.has(action) && (!rawIdem || rawIdem.length > 120)) {
      return badRequest("idempotencyKey is required (max 120 chars)");
    }
    // Never invent Date.now() keys — double-submit would bypass billingEngine replay.
    const idempotencyKey = rawIdem.slice(0, 120);

    const paymentMethod = String(body.paymentMethod || "collected").trim() as
      | "stripe"
      | "collected"
      | "pending"
      | "credit";
    const collectedAmount =
      typeof body.collectedAmount === "number"
        ? body.collectedAmount
        : body.collectedAmount != null
          ? Number(body.collectedAmount)
          : undefined;

    let result;
    switch (action) {
      case "renew":
        result = await renewMembership({
          orgId,
          membershipId: id,
          actorUserId,
          paymentMethod,
          collectedAmount,
          idempotencyKey,
        });
        break;
      case "upgrade":
        result = await upgradeMembership({
          orgId,
          membershipId: id,
          newPlanId: String(body.newPlanId || ""),
          actorUserId,
          paymentMethod,
          collectedAmount,
          idempotencyKey,
          allowGroupOverride:
            Boolean(body.allowGroupOverride) &&
            hasAnyPermission(actor.permissions, [P.MembershipsAdmin]),
        });
        break;
      case "downgrade":
        result = await downgradeMembership({
          orgId,
          membershipId: id,
          newPlanId: String(body.newPlanId || ""),
          actorUserId,
          idempotencyKey,
          allowGroupOverride:
            Boolean(body.allowGroupOverride) &&
            hasAnyPermission(actor.permissions, [P.MembershipsAdmin]),
        });
        break;
      case "pause":
        result = await pauseMembership({
          orgId,
          membershipId: id,
          actorUserId,
          reason:
            typeof body.reason === "string" ? body.reason : undefined,
        });
        break;
      case "resume":
        result = await resumeMembership({
          orgId,
          membershipId: id,
          actorUserId,
        });
        break;
      case "cancel": {
        const when =
          body.when === "immediate" ? "immediate" : "end_of_period";
        result = await cancelMembership({
          orgId,
          membershipId: id,
          actorUserId,
          when,
          reason:
            typeof body.reason === "string" ? body.reason : undefined,
        });
        if (body.notifyGuest === true) {
          const guest = await prisma.guestProfile.findFirst({
            where: { id: result.membership.guestProfileId, orgId },
            select: { email: true, firstName: true },
          });
          const plan = await prisma.membershipPlan.findFirst({
            where: { id: result.membership.planId, orgId },
            select: { name: true, cancellationTerms: true },
          });
          if (guest?.email) {
            void sendGuestMembershipCancelEmail({
              to: guest.email,
              guestName: guest.firstName,
              planName: plan?.name ?? "membership",
              when,
              accessEndsAt:
                when === "end_of_period"
                  ? result.membership.currentPeriodEnd
                  : new Date(),
              cancellationTerms: plan?.cancellationTerms,
            }).catch((err) =>
              console.warn("[memberships] staff cancel email failed", err)
            );
          }
        }
        break;
      }
      case "reactivate":
        result = await reactivateMembership({
          orgId,
          membershipId: id,
          actorUserId,
          paymentMethod,
          collectedAmount,
          idempotencyKey,
        });
        break;
      case "payment-method": {
        const pm = await updatePaymentMethod({
          orgId,
          membershipId: id,
          actorUserId,
        });
        return ok({
          paymentMethod: {
            clientSecret: pm.clientSecret,
            setupIntentId: pm.setupIntentId,
          },
          note:
            "Staff-initiated SetupIntent created. Confirm the card with Stripe using clientSecret (Elements / Dashboard). No raw PAN is accepted by this API.",
        });
      }
      case "credit":
        result = await applyCredit({
          orgId,
          membershipId: id,
          actorUserId,
          amountMajor: Number(body.amountMajor),
          reason:
            typeof body.reason === "string" ? body.reason : undefined,
          idempotencyKey,
        });
        break;
      default:
        return badRequest(
          "Unknown action. Use renew|upgrade|downgrade|pause|resume|cancel|reactivate|payment-method|credit"
        );
    }

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
      "Failed membership action",
      authAudit(request, "POST /api/admin/memberships/members/[id]", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MembershipsBilling,
      })
    );
  }
}
