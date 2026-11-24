import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  forbidden,
  serverError,
  authErrorToResponse,
  authAudit,
  routeErrorResponse,
} from "@/lib/response";
import { requireAnyPermissionFreshWorkspaceLifecycle } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { listMarketplaceBookingsForOrg } from "@/lib/marketplace/bookingCheckout";
import { MARKETPLACE_STOREFRONT_MESSAGE } from "@/lib/marketplace/assertChargeReady";
import { getStorefrontOrgId } from "@/lib/org";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { ForbiddenError } from "@/lib/auth/http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/marketplace/bookings
 * List recent marketplace bookings for actor.orgId (refund UI + ops).
 * Soft-hold / suspended: still readable (paid history remains); Demo locked.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFreshWorkspaceLifecycle(req, [
      P.MarketplaceRefunds,
      P.SettingsManage,
      P.PayoutsRead,
      P.PayoutsManage,
      P.BookingPackagesManage,
      P.BookingPackagesRead,
      P.AnalyticsRead,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/marketplace/bookings", {
          permission: P.MarketplaceRefunds,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    await assertNotDemoPlanLocked(orgId);
    if (
      req.nextUrl.searchParams.has("orgId") ||
      req.nextUrl.searchParams.has("organizationId")
    ) {
      return badRequest("Unsupported selector in query");
    }
    if (orgId === (await getStorefrontOrgId())) {
      throw new ForbiddenError(MARKETPLACE_STOREFRONT_MESSAGE);
    }
    const takeRaw = req.nextUrl.searchParams.get("take");
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : 50;
    const locationIdParam = req.nextUrl.searchParams.get("locationId")?.trim();
    const { resolveEffectiveParkScope } = await import("@/lib/parkAdminScope");
    const { isValidId } = await import("@/lib/ids");
    const parkScope = await resolveEffectiveParkScope(actor);

    let locationId: string | null | undefined = parkScope.locationId;
    let locationIds = parkScope.assignedLocationIds;
    if (locationIdParam) {
      if (!isValidId(locationIdParam)) {
        return badRequest("Invalid locationId");
      }
      if (parkScope.parkLocked) {
        const { assertLocationInAssignedSet } = await import(
          "@/lib/parkAdminScope"
        );
        assertLocationInAssignedSet(parkScope, locationIdParam);
      }
      locationId = locationIdParam;
      locationIds = [locationIdParam];
    }

    const bookings = await listMarketplaceBookingsForOrg(orgId, {
      take: Number.isFinite(take) ? take : 50,
      parkLocked: parkScope.parkLocked,
      locationId,
      locationIds,
    });
    return ok({ bookings });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return forbidden(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to list marketplace bookings",
      authAudit(req, "GET /api/admin/marketplace/bookings", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.MarketplaceRefunds,
      })
    );
  }
}
