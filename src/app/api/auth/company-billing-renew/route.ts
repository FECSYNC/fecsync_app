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
  createCompanyBillingPortal,
  createCompanySubscriptionCheckout,
  companyBillingPortalReturnUrl,
  COMPANY_BILLING_ADMIN_ONLY_MESSAGE,
  COMPANY_BILLING_NO_CUSTOMER_MESSAGE,
  COMPANY_BILLING_PENDING_MESSAGE,
} from "@/lib/companyBilling";
import { requireActorOrgId } from "@/lib/staffOrg";
import {
  isDemoPlanId,
  isPlanCheckoutAvailable,
  isSubscriptionPlanId,
  normalizeBillingDurationMonths,
} from "@/lib/subscriptionPlans";
import prisma from "@/lib/prisma";
import { apiRateLimited } from "@/lib/rateLimit";
import { isSoftBillingHoldRow } from "@/lib/billingSoftHold";
import { isPlainObject } from "@/lib/catalogWrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/company-billing-renew
 * Soft-hold with a live bound sub → Stripe Customer Portal.
 * Expired suspend (sub cleared) → Checkout for a new period (Portal alone
 * often cannot recreate a canceled subscription).
 */
export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAuthFresh(req, { allowSuspendedOrg: true });
  } catch (err) {
    return (
      authErrorToResponse(
        err,
        authAudit(req, "POST /api/auth/company-billing-renew")
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
      "company-billing-renew",
      10,
      15 * 60 * 1000,
      `${orgId}:${actor.sub}`
    );
    if (limited) return limited;

    let bodyPlan = "";
    let bodyDuration: unknown = undefined;
    try {
      const body = await req.json();
      if (isPlainObject(body)) {
        if (typeof body.plan === "string") {
          bodyPlan = body.plan.trim().toLowerCase();
        }
        if ("durationMonths" in body) {
          bodyDuration = body.durationMonths;
        }
      }
    } catch {
      /* empty body ok */
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        status: true,
        isDefault: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        requestedPlan: true,
        requestedDurationMonths: true,
      },
    });
    if (!org || org.isDefault) {
      throw new ForbiddenError(COMPANY_BILLING_PENDING_MESSAGE);
    }

    const softHold = isSoftBillingHoldRow({
      status: org.status,
      subscriptionStatus: org.subscriptionStatus,
      subscriptionEndsAt: org.subscriptionEndsAt,
      subscriptionPlan: org.subscriptionPlan,
    });
    const demoTrialExpired =
      org.status === "suspended" &&
      org.subscriptionStatus === "expired" &&
      isDemoPlanId(org.subscriptionPlan);
    if (demoTrialExpired) {
      throw new ForbiddenError(
        "Your Demo trial ended. Contact FECSYNC to reactivate Demo on Company workspaces, then upgrade from Billing."
      );
    }
    const expiredSuspend =
      org.status === "suspended" &&
      org.subscriptionStatus === "expired" &&
      !isDemoPlanId(org.subscriptionPlan);
    const locked = softHold || expiredSuspend;
    if (org.status === "pending") {
      throw new ForbiddenError(
        "Finish onboarding payment from the waiting room Checkout first."
      );
    }
    if (org.status === "suspended" && !expiredSuspend) {
      const { ACCOUNT_SUSPENDED_MESSAGE } = await import(
        "@/lib/accountSuspendMessages"
      );
      throw new ForbiddenError(ACCOUNT_SUSPENDED_MESSAGE);
    }

    const actorPayload = {
      sub: actor.sub,
      email: actor.email,
      preset: actor.preset,
      membershipRole: actor.membershipRole,
    };

    const hasBoundSub = Boolean(org.stripeSubscriptionId?.trim());
    // Expired suspend clears the sub id — need Checkout for a new period.
    // Soft-hold / active with a live binding can update PM via Portal.
    const preferPortal =
      Boolean(org.stripeCustomerId?.trim()) &&
      hasBoundSub &&
      !expiredSuspend;

    if (preferPortal) {
      try {
        const { url } = await createCompanyBillingPortal({
          orgId,
          actor: actorPayload,
          returnUrl: companyBillingPortalReturnUrl(),
          allowLockedRenew: locked,
        });
        return ok({ url, mode: "portal" as const });
      } catch (err) {
        if (
          !(err instanceof ForbiddenError) ||
          err.message !== COMPANY_BILLING_NO_CUSTOMER_MESSAGE
        ) {
          throw err;
        }
      }
    }

    const planRaw =
      (isSubscriptionPlanId(bodyPlan) ? bodyPlan : "") ||
      // After unpaid demotion, subscriptionPlan is demo — prefer stashed paid plan.
      (org.subscriptionPlan?.trim().toLowerCase() === "demo"
        ? ""
        : org.subscriptionPlan?.trim().toLowerCase() || "") ||
      org.requestedPlan?.trim().toLowerCase() ||
      org.subscriptionPlan?.trim().toLowerCase() ||
      "";
    const plan = isSubscriptionPlanId(planRaw) ? planRaw : null;
    if (!plan || !isPlanCheckoutAvailable(plan)) {
      return badRequest(
        "No package on file — choose starter, growth, or enterprise in Billing to restore full access (your records stay intact)."
      );
    }

    const durationMonths = normalizeBillingDurationMonths(
      bodyDuration ?? org.requestedDurationMonths
    );

    const { url } = await createCompanySubscriptionCheckout({
      orgId,
      plan,
      durationMonths,
      allowLockedRenew: locked || expiredSuspend,
      actor: actorPayload,
    });
    return ok({ url, mode: "checkout" as const, plan, durationMonths });
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
      authAudit(req, "POST /api/auth/company-billing-renew", {
        actorSub: actor.sub,
        orgId: actor.orgId ?? null,
      })
    );
    if (authRes) return authRes;
    return routeErrorResponse(err, "Failed to start renewal");
  }
}
