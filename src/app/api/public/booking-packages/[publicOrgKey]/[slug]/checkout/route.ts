import { NextRequest } from "next/server";
import {
  ok,
  badRequest,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
  errorResponse,
} from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { isPlainObject } from "@/lib/catalogWrite";
import { ForbiddenError, isAuthHttpError } from "@/lib/auth/http-error";
import {
  createMarketplaceBookingCheckout,
  MARKETPLACE_PACKAGE_NOT_FOUND,
} from "@/lib/marketplace/bookingCheckout";
import { isPlanLimitOrBillingGateMessage } from "@/lib/planLimits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/public/booking-packages/[publicOrgKey]/[slug]/checkout
 * Body: email, name?, idempotencyKey only — never price/fee/org/account.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ publicOrgKey: string; slug: string }> }
) {
  const limited = apiRateLimited(
    req,
    "public-marketplace-booking-checkout",
    20,
    15 * 60 * 1000
  );
  if (limited) return limited;

  const { publicOrgKey, slug } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    if (!isPlainObject(body)) {
      return badRequest("Invalid body");
    }
    if (
      "orgId" in body ||
      "organizationId" in body ||
      "amountMinor" in body ||
      "amount" in body ||
      "price" in body ||
      "platformFeeMinor" in body ||
      "connectedAccountId" in body ||
      "applicationFeeMinor" in body
    ) {
      return badRequest("Unsupported checkout fields in request body");
    }

    const result = await createMarketplaceBookingCheckout({
      publicOrgKey,
      packageSlug: slug,
      email: body.email,
      name: body.name,
      idempotencyKey: body.idempotencyKey,
    });
    return ok({ url: result.url, bookingId: result.bookingId });
  } catch (err) {
    if (err instanceof ForbiddenError || (isAuthHttpError(err) && err.status === 403)) {
      const message = err instanceof Error ? err.message : "Forbidden";
      if (message === MARKETPLACE_PACKAGE_NOT_FOUND) {
        return notFound(MARKETPLACE_PACKAGE_NOT_FOUND);
      }
      if (isPlanLimitOrBillingGateMessage(message)) {
        return errorResponse(message, 403);
      }
      return forbidden(message);
    }
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("public marketplace checkout error:", err);
    return serverError("Failed to start checkout");
  }
}
