import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
} from "@/lib/response";
import { requireAnyPermissionFreshWorkspaceLifecycle } from "@/lib/middleware/requireAuth";
import {
  P,
  hasPermission,
  isPlatformAdminActor,
} from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { isValidId } from "@/lib/ids";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  MARKETPLACE_REFUND_NOT_FOUND,
  refundMarketplaceBooking,
} from "@/lib/marketplace/refunds";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/marketplace/bookings/[id]/refund
 * marketplace:refunds OR (settings:manage + platform_admin).
 * Soft-hold / suspended: still allowed (reverse paid money); Demo locked;
 * new Checkout stays charge-ready fail-closed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try {
    actor = await requireAnyPermissionFreshWorkspaceLifecycle(req, [
      P.MarketplaceRefunds,
      P.SettingsManage,
      P.PayoutsManage,
    ]);
    const canRefund =
      hasPermission(actor.permissions, P.MarketplaceRefunds) ||
      (hasPermission(actor.permissions, P.PayoutsManage) &&
        isPlatformAdminActor(actor)) ||
      (hasPermission(actor.permissions, P.SettingsManage) &&
        isPlatformAdminActor(actor));
    if (!canRefund) {
      throw new ForbiddenError("Missing required permission");
    }
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/marketplace/bookings/[id]/refund", {
          permission: P.MarketplaceRefunds,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return notFound(MARKETPLACE_REFUND_NOT_FOUND);
  }

  let body: unknown = {};
  const contentLength = req.headers.get("content-length");
  if (contentLength && contentLength !== "0") {
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }
  }

  try {
    const orgId = requireActorOrgId(actor);
    await assertNotDemoPlanLocked(orgId);
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    if ("orgId" in body || "organizationId" in body) {
      return badRequest("Unsupported marketplace fields in request body");
    }

    let amountMinor: number | null | undefined = undefined;
    if ("amountMinor" in body) {
      if (body.amountMinor === null) {
        amountMinor = null;
      } else if (
        typeof body.amountMinor === "number" &&
        Number.isFinite(body.amountMinor)
      ) {
        amountMinor = body.amountMinor;
      } else {
        return badRequest("amountMinor must be a number or null");
      }
    }
    const reason =
      typeof body.reason === "string" ? body.reason : undefined;

    const { resolveEffectiveParkScope, assertLocationInAssignedSet } =
      await import("@/lib/parkAdminScope");
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      const booking = await prisma.marketplaceBooking.findFirst({
        where: { id, orgId },
        select: { locationId: true },
      });
      if (!booking) {
        return notFound(MARKETPLACE_REFUND_NOT_FOUND);
      }
      assertLocationInAssignedSet(parkScope, booking.locationId);
    }

    const result = await refundMarketplaceBooking({
      actorOrgId: orgId,
      bookingId: id,
      actorUserId: actor.sub,
      amountMinor,
      reason,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (err.message === MARKETPLACE_REFUND_NOT_FOUND) {
        return notFound(MARKETPLACE_REFUND_NOT_FOUND);
      }
      if (isPlanLimitOrBillingGateMessage(err.message)) {
        return errorResponse(err.message, 403);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/marketplace/bookings/[id]/refund", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MarketplaceRefunds,
      })
    );
    if (authRes) return authRes;
    console.error("marketplace refund error:", err);
    return serverError("Failed to refund marketplace booking");
  }
}
