export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { created, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
import { companyCategoryCheckout } from "@/lib/publicCategory/companyCheckout";

/**
 * Company category booking checkout. Tenant comes from the URL slugs only.
 * embed=true (iframe) requires the framing page and the request Origin/Referer
 * to be on the company's allowed embed origins.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string; categorySlug: string }> }
) {
  const limited = apiRateLimited(request, "public-category-checkout", 20, 60_000);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Invalid JSON");
  }
  const { orgSlug, categorySlug } = await params;
  try {
    await connectDB();
    let userId: string | null = null;
    try {
      const payload = await requireAuthFresh(request);
      userId = payload?.sub ? String(payload.sub) : null;
    } catch {
      /* guest ok */
    }
    const str = (v: unknown) => (v == null || v === "" ? undefined : String(v));
    const result = await companyCategoryCheckout({
      orgSlug,
      categorySlug,
      productId: String(body.productId ?? ""),
      holdId: str(body.holdId),
      holdToken: str(body.holdToken),
      priceBandCode: str(body.priceBandCode),
      lines: Array.isArray(body.lines) ? body.lines : undefined,
      primaryContactName: str(body.primaryContactName),
      primaryContactEmail: str(body.primaryContactEmail),
      primaryContactPhone: str(body.primaryContactPhone),
      payLater: Boolean(body.payLater),
      userId,
      embed:
        body.embed === true
          ? {
              parentOrigin: str(body.embedOrigin) ?? null,
              requestOrigin:
                request.headers.get("origin") || request.headers.get("referer"),
            }
          : null,
    });
    return created(result);
  } catch (err) {
    return bookingRouteCatch(err, request, "POST public category checkout", null, "Failed");
  }
}
