import { ok, routeErrorResponse } from "@/lib/response";
import { withDbRetry } from "@/lib/db";
import { getPublicHomepageContent } from "@/lib/homepageContent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public homepage marketing content for the storefront org.
 * Returns published sections only (hero, whatWeOffer, newArrivals, fashionJourney).
 */
export async function GET() {
  try {
    const payload = await withDbRetry(() => getPublicHomepageContent());
    return ok({
      sections: payload.sections,
      byKey: payload.byKey,
    });
  } catch (err) {
    console.error("Error fetching public homepage content:", err);
    return routeErrorResponse(err, "Failed to fetch homepage content");
  }
}
