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
import { ForbiddenError } from "@/lib/auth/http-error";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";
import {
  assertCanManageParkConnect,
  createParkMarketplaceExpressLoginLink,
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
          "POST /api/admin/marketplace/park-accounts/[locationId]/connect/login-link",
          { permission: P.PayoutsManage }
        )
      ) ?? serverError("Failed to authorize")
    );
  }

  const { locationId } = await params;
  if (!isValidId(locationId)) return badRequest("Invalid locationId");

  try {
    const { orgId } = await assertCanManageParkConnect(actor, locationId);
    const result = await createParkMarketplaceExpressLoginLink({
      orgId,
      locationId,
    });
    return ok({ url: result.url });
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
        "POST /api/admin/marketplace/park-accounts/[locationId]/connect/login-link",
        {
          actorSub: actor.sub,
          orgId: actor.orgId ?? null,
          permission: P.PayoutsManage,
        }
      )
    );
    if (authRes) return authRes;
    console.error("park connect login-link error:", err);
    return serverError("Failed to create park Express login link");
  }
}
