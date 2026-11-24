import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
} from "@/lib/response";
import { requirePermissionFresh } from "@/lib/middleware/requireAuth";
import { P } from "@/lib/auth/permissions";
import { isValidId } from "@/lib/ids";
import { apiRateLimited } from "@/lib/rateLimit";
import { ForbiddenError } from "@/lib/auth/http-error";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";
import {
  assertCanManageParkConnect,
  startParkMarketplaceConnectOnboarding,
} from "@/lib/marketplace/parkAccount";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.PayoutsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(
          req,
          "POST /api/admin/marketplace/park-accounts/[locationId]/connect/onboard",
          { permission: P.PayoutsManage }
        )
      ) ?? serverError("Failed to authorize")
    );
  }

  const { locationId } = await params;
  if (!isValidId(locationId)) return badRequest("Invalid locationId");

  try {
    const { orgId } = await assertCanManageParkConnect(actor, locationId);
    const limited = apiRateLimited(
      req,
      "park-marketplace-connect-onboard",
      8,
      15 * 60 * 1000,
      `${orgId}:${locationId}:${actor.sub}`
    );
    if (limited) return limited;

    const result = await startParkMarketplaceConnectOnboarding({
      orgId,
      locationId,
    });
    return ok({ url: result.url, accountId: result.accountId });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (isPlanLimitOrBillingGateMessage(err.message)) {
        return errorResponse(err.message, 403);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(
        req,
        "POST /api/admin/marketplace/park-accounts/[locationId]/connect/onboard",
        {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
          permission: P.PayoutsManage,
        }
      )
    );
    if (authRes) return authRes;
    console.error("park connect onboard error:", err);
    return serverError("Failed to start park Connect onboarding");
  }
}
