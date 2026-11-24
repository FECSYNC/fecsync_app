import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  serverError,
  authErrorToResponse,
  errorResponse,
  routeErrorResponse,
} from "@/lib/response";
import { ForbiddenError } from "@/lib/auth/http-error";
import { CompanyBillingConfigError } from "@/lib/stripe";
import {
  confirmCompanyOnboardingCheckoutSession,
  COMPANY_ONBOARDING_SESSION_MESSAGE,
  COMPANY_ONBOARDING_UNPAID_MESSAGE,
} from "@/lib/companyBilling";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/company-onboarding-confirm
 * Body: { sessionId } from Stripe success_url `{CHECKOUT_SESSION_ID}`.
 * Verifies payment with Stripe and auto-activates the pending company
 * (idempotent with the company_subscription webhook). No JWT required —
 * the Checkout session id is the proof of payment.
 */
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    if (
      "orgId" in body ||
      "organizationId" in body ||
      "successUrl" in body ||
      "cancelUrl" in body
    ) {
      return badRequest("Unsupported fields in request body");
    }

    const sessionId =
      typeof body.sessionId === "string"
        ? body.sessionId.trim()
        : typeof body.session_id === "string"
          ? body.session_id.trim()
          : "";
    if (!sessionId) {
      return badRequest("sessionId is required");
    }

    const limited = apiRateLimited(
      req,
      "company-onboarding-confirm",
      20,
      15 * 60 * 1000,
      sessionId
    );
    if (limited) return limited;

    const result = await confirmCompanyOnboardingCheckoutSession(sessionId);
    const org = result.orgId
      ? await prisma.organization.findUnique({
          where: { id: result.orgId },
          select: { slug: true, isDefault: true },
        })
      : null;
    return ok({
      orgId: result.orgId,
      orgStatus: result.orgStatus,
      plan: result.plan,
      billingEntitled: result.billingEntitled,
      activated: result.activated,
      email: result.email,
      // The new company signs in through its own link from now on.
      orgSlug: org && !org.isDefault ? org.slug : null,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      if (
        err.message === COMPANY_ONBOARDING_UNPAID_MESSAGE ||
        err.message === COMPANY_ONBOARDING_SESSION_MESSAGE
      ) {
        return errorResponse(err.message, 402);
      }
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
    console.error("company-onboarding-confirm error:", err);
    return routeErrorResponse(err, "Failed to confirm company Checkout");
  }
}
