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
import prisma from "@/lib/prisma";
import {
  getMarketplaceAccountForOrg,
  toMarketplaceAccountDto,
} from "@/lib/marketplace/account";
import {
  getMarketplaceChargeReadyState,
  MARKETPLACE_STOREFRONT_MESSAGE,
} from "@/lib/marketplace/assertChargeReady";
import { getStorefrontOrgId } from "@/lib/org";
import { assertNotDemoPlanLocked } from "@/lib/demoPlanAssert";
import { ForbiddenError } from "@/lib/auth/http-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/marketplace/account
 * Connect payouts status DTO for actor.orgId
 * (settings:manage | analytics:read | booking_packages:manage | marketplace:refunds).
 * Soft-hold: readable so /admin/payouts can show the lock banner; Demo locked.
 * Ignore ?orgId — never trust client org selectors.
 */
export async function GET(req: NextRequest) {
  let actor;
  try {
    actor = await requireAnyPermissionFreshWorkspaceLifecycle(req, [
      P.SettingsManage,
      P.AnalyticsRead,
      P.BookingPackagesManage,
      P.MarketplaceRefunds,
    ]);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "GET /api/admin/marketplace/account", {
          permission: P.SettingsManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const { assertNotParkLockedCompanyHq } = await import(
      "@/lib/assertNotParkLockedCompanyHq"
    );
    await assertNotParkLockedCompanyHq(actor);
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

    const [row, ready, publishedActivePackageCount, org] = await Promise.all([
      getMarketplaceAccountForOrg(orgId),
      getMarketplaceChargeReadyState(orgId),
      prisma.bookingPackage.count({
        where: { orgId, published: true, active: true },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { slug: true },
      }),
    ]);
    const account = toMarketplaceAccountDto(row, orgId, ready.chargeReady);
    return ok({
      account: {
        ...account,
        publishedActivePackageCount,
        orgSlug: org?.slug ?? null,
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return forbidden(err.message);
    }
    return routeErrorResponse(
      err,
      "Failed to load marketplace account",
      authAudit(req, "GET /api/admin/marketplace/account", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.SettingsManage,
      })
    );
  }
}
