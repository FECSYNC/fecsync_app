import { NextRequest } from "next/server";
import {
  ok,
  notFound,
  forbidden,
  serverError,
  authErrorToResponse,
} from "@/lib/response";
import { isAuthHttpError } from "@/lib/auth/http-error";
import {
  getPublishedBookingPackagePublic,
  MARKETPLACE_PACKAGE_NOT_FOUND,
} from "@/lib/marketplace/bookingCheckout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/public/booking-packages/[publicOrgKey]/[slug]
 * Published+active package only — no private Connect/ledger fields.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ publicOrgKey: string; slug: string }> }
) {
  const { publicOrgKey, slug } = await params;
  try {
    const data = await getPublishedBookingPackagePublic(publicOrgKey, slug);
    return ok(data);
  } catch (err) {
    if (isAuthHttpError(err) && err.status === 403) {
      if (err.message === MARKETPLACE_PACKAGE_NOT_FOUND) {
        return notFound(MARKETPLACE_PACKAGE_NOT_FOUND);
      }
      return forbidden(err.message);
    }
    const authRes = authErrorToResponse(err);
    if (authRes) return authRes;
    console.error("public booking package get error:", err);
    return serverError("Failed to load booking package");
  }
}
