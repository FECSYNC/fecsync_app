import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
} from "@/lib/response";
import { requirePermissionFresh, requireAnyPermissionFresh } from "@/lib/middleware/requireAuth";
import { P, isPlatformAdminActor } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE,
  createMarketplaceExpressLoginLink,
} from "@/lib/marketplace/account";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/marketplace/connect/login-link
 * Express Dashboard login link when onboarding is complete.
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.PayoutsManage);
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/marketplace/connect/login-link", {
          permission: P.PayoutsManage,
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
    if (!isPlatformAdminActor(actor)) {
      throw new ForbiddenError(MARKETPLACE_CONNECT_ADMIN_ONLY_MESSAGE);
    }

    const limited = apiRateLimited(
      req,
      "marketplace-connect-login-link",
      8,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        return badRequest("Invalid JSON");
      }
      if (isPlainObject(body) && ("orgId" in body || "organizationId" in body)) {
        return badRequest("Unsupported marketplace fields in request body");
      }
    }

    const result = await createMarketplaceExpressLoginLink({
      orgId,
      actorIsPlatformAdmin: true,
    });
    return ok(result);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (isPlanLimitOrBillingGateMessage(err.message)) {
        return errorResponse(err.message, 403);
      }
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/marketplace/connect/login-link", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.PayoutsManage,
      })
    );
    if (authRes) return authRes;
    console.error("marketplace connect login-link error:", err);
    return serverError("Failed to create Express login link");
  }
}
