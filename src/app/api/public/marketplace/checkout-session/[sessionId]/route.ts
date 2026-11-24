import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { ForbiddenError, isAuthHttpError } from "@/lib/auth/http-error";
import {
  getMarketplaceBookingPublicByCheckoutSession,
  MARKETPLACE_SESSION_NOT_FOUND,
} from "@/lib/marketplace/publicSession";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/public/marketplace/checkout-session/[sessionId]
 * Read-only reconcile for success page. Never marks paid (webhook is SSOT).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const limited = apiRateLimited(
    req,
    "public-marketplace-checkout-session",
    30,
    15 * 60 * 1000
  );
  if (limited) return limited;

  const { sessionId } = await params;
  try {
    const booking = await getMarketplaceBookingPublicByCheckoutSession(sessionId);
    return ok({ booking });
  } catch (err) {
    if (err instanceof ForbiddenError || (isAuthHttpError(err) && err.status === 403)) {
      const message = err instanceof Error ? err.message : "Forbidden";
      if (message === MARKETPLACE_SESSION_NOT_FOUND) {
        return notFound(MARKETPLACE_SESSION_NOT_FOUND);
      }
      return forbidden(message);
    }
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("public marketplace session reconcile error:", err);
    return serverError("Failed to load checkout session");
  }
}
