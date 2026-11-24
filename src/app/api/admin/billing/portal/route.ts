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
import { P } from "@/lib/auth/permissions";
import { requireActorOrgId } from "@/lib/staffOrg";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  companyBillingPortalReturnUrl,
  createCompanyBillingPortal,
} from "@/lib/companyBilling";
import { ForbiddenError } from "@/lib/auth/http-error";
import { CompanyBillingConfigError } from "@/lib/stripe";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import connectDB from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/billing/portal
 * → Stripe Customer Portal URL (platform_admin + settings:manage).
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BillingManage, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/billing/portal", {
          permission: P.BillingManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const limited = apiRateLimited(
      req,
      "company-billing-portal",
      12,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    await connectDB();
    const parkScope = await resolveEffectiveParkScope(actor);
    if (parkScope.parkLocked) {
      throw new ForbiddenError(
        "Park-locked admins cannot manage company billing"
      );
    }

    // Ignore body entirely for portal — org + return URL come from session/server.
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      let body: unknown = null;
      try {
        body = await req.json();
      } catch {
        body = null;
      }
      if (
        body &&
        typeof body === "object" &&
        ("orgId" in body ||
          "organizationId" in body ||
          "returnUrl" in body ||
          "return_url" in body)
      ) {
        return badRequest("Unsupported billing fields in request body");
      }
    }

    const { url } = await createCompanyBillingPortal({
      orgId,
      actor: {
        sub: actor.sub,
        preset: actor.preset,
        membershipRole: actor.membershipRole,
      },
      returnUrl: companyBillingPortalReturnUrl(),
    });

    return ok({ url });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return authErrorToResponse(err) ?? badRequest(err.message);
    }
    if (
      err instanceof CompanyBillingConfigError ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "CompanyBillingConfigError")
    ) {
      return errorResponse((err as Error).message, 503);
    }
    const authRes = authErrorToResponse(
      err,
      authAudit(req, "POST /api/admin/billing/portal", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BillingManage,
      })
    );
    if (authRes) return authRes;
    console.error("billing portal error:", err);
    return serverError("Failed to open billing portal");
  }
}
