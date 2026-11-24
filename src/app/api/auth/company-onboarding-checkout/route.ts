import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  authAudit,
  errorResponse,
  routeErrorResponse,
} from "@/lib/response";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { isPlatformAdminActor } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/auth/http-error";
import { CompanyBillingConfigError } from "@/lib/stripe";
import {
  createCompanySubscriptionCheckout,
  COMPANY_BILLING_ADMIN_ONLY_MESSAGE,
  COMPANY_BILLING_PENDING_MESSAGE,
  COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE,
} from "@/lib/companyBilling";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  isPlanCheckoutAvailable,
  isSubscriptionPlanId,
  normalizeBillingDurationMonths,
} from "@/lib/subscriptionPlans";
import prisma from "@/lib/prisma";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/company-onboarding-checkout
 * Resume Stripe Checkout for a still-pending company (self-serve pay to activate).
 * Uses allowSuspendedOrg so pending JWTs are not blocked by assertOrganizationActive.
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/auth/company-onboarding-checkout")
      ) ?? serverError("Failed to authorize")
    );
  }

  try {
    if (!isPlatformAdminActor(actor)) {
      throw new ForbiddenError(COMPANY_BILLING_ADMIN_ONLY_MESSAGE);
    }
    const orgId = requireActorOrgId(actor);
    const limited = apiRateLimited(
      req,
      "company-onboarding-checkout",
      8,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        isDefault: true,
        requestedPlan: true,
        requestedDurationMonths: true,
        subscriptionPlan: true,
      },
    });
    if (!org || org.isDefault) {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }
    if (org.status !== "pending") {
      return badRequest(
        org.status === "active"
          ? "Workspace is already active — open Billing to manage your package."
          : "Only pending workspaces can resume onboarding Checkout."
      );
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (body && !isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    const bodyObj = (body && isPlainObject(body) ? body : {}) as Record<
      string,
      unknown
    >;
    if (
      "orgId" in bodyObj ||
      "organizationId" in bodyObj ||
      "successUrl" in bodyObj ||
      "cancelUrl" in bodyObj
    ) {
      return badRequest("Unsupported billing fields in request body");
    }

    const planRaw =
      typeof bodyObj.plan === "string"
        ? bodyObj.plan.trim().toLowerCase()
        : "";
    const plan =
      (isSubscriptionPlanId(planRaw) ? planRaw : null) ||
      (org.requestedPlan?.trim().toLowerCase() &&
      isSubscriptionPlanId(org.requestedPlan.trim().toLowerCase())
        ? org.requestedPlan.trim().toLowerCase()
        : null) ||
      (org.subscriptionPlan?.trim().toLowerCase() &&
      isSubscriptionPlanId(org.subscriptionPlan.trim().toLowerCase())
        ? org.subscriptionPlan.trim().toLowerCase()
        : null);
    if (!plan) {
      return badRequest(
        "Choose a package interest (demo, starter, or growth) to continue to Checkout."
      );
    }
    if (!isPlanCheckoutAvailable(plan)) {
      return badRequest(
        plan === "enterprise"
          ? "Enterprise packages need FECSYNC sales — your waiting room stays open until Approve. Entitled Enterprise unlocks company-admin HQ (not Ticketing/POS)."
          : "Stripe price is not configured for this package yet."
      );
    }

    const durationMonths = normalizeBillingDurationMonths(
      bodyObj.durationMonths ?? org.requestedDurationMonths
    );

    const { url } = await createCompanySubscriptionCheckout({
      orgId,
      plan,
      durationMonths,
      allowPendingOnboarding: true,
      actor: {
        sub: actor.sub,
        email: actor.email,
        preset: actor.preset,
        membershipRole: actor.membershipRole,
      },
    });

    return ok({ url, plan, durationMonths });
  } catch (err) {
    if (
      err instanceof ForbiddenError &&
      err.message === COMPANY_BILLING_ONBOARDING_ALREADY_ACTIVE_MESSAGE
    ) {
      return ok({ alreadyActive: true });
    }
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
      authAudit(req, "POST /api/auth/company-onboarding-checkout", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to start onboarding checkout");
  }
}
