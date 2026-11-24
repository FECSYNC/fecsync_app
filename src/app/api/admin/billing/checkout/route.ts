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
import { isPlainObject } from "@/lib/catalogWrite";
import { apiRateLimited } from "@/lib/rateLimit";
import {
  companyBillingCancelUrl,
  companyBillingSuccessUrl,
  createCompanySubscriptionCheckout,
} from "@/lib/companyBilling";
import { ForbiddenError } from "@/lib/auth/http-error";
import { CompanyBillingConfigError } from "@/lib/stripe";
import { resolveEffectiveParkScope } from "@/lib/parkAdminScope";
import connectDB from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/billing/checkout
 * Body { plan, durationMonths? } → Stripe Checkout URL (platform_admin + settings:manage).
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requirePermissionFresh(req, P.BillingManage, { allowOnDemo: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/admin/billing/checkout", {
          permission: P.BillingManage,
        })
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    const orgId = requireActorOrgId(actor);
    const limited = apiRateLimited(
      req,
      "company-billing-checkout",
      8,
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    const plan = typeof body.plan === "string" ? body.plan.trim() : "";
    if (!plan) {
      return badRequest("plan is required");
    }
    const { isBillingDurationMonths, normalizeBillingDurationMonths } =
      await import("@/lib/subscriptionPlans");
    let durationMonths = normalizeBillingDurationMonths(undefined);
    if ("durationMonths" in body && body.durationMonths != null && body.durationMonths !== "") {
      if (!isBillingDurationMonths(body.durationMonths)) {
        return badRequest(
          "durationMonths must be one of: 1, 2, 3, 6, 12, 24, 60"
        );
      }
      durationMonths = normalizeBillingDurationMonths(body.durationMonths);
    }
    // Defense in depth: never honor client orgId or redirect URLs.
    if (
      "orgId" in body ||
      "organizationId" in body ||
      "successUrl" in body ||
      "cancelUrl" in body ||
      "success_url" in body ||
      "cancel_url" in body
    ) {
      return badRequest("Unsupported billing fields in request body");
    }

    const { url } = await createCompanySubscriptionCheckout({
      orgId,
      plan,
      durationMonths,
      actor: {
        sub: actor.sub,
        email: actor.email,
        preset: actor.preset,
        membershipRole: actor.membershipRole,
      },
      successUrl: companyBillingSuccessUrl(),
      cancelUrl: companyBillingCancelUrl(),
    });

    return ok({ url, durationMonths });
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
      authAudit(req, "POST /api/admin/billing/checkout", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
        permission: P.BillingManage,
      })
    );
    if (authRes) return authRes;
    console.error("billing checkout error:", err);
    return serverError("Failed to start checkout");
  }
}
