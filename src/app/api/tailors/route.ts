import { NextRequest } from "next/server";
import { ok, routeErrorResponse } from "@/lib/response";
import { withDbRetry } from "@/lib/db";
import { listPublicTailors } from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tailors — public storefront discovery.
 * Only status=approved in DEFAULT_ORG_ID / default org.
 * Query: q, specialty, location, country, city, page, limit.
 * Never returns user email, phone, orgId, or non-approved rows.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    void searchParams.get("userId");
    void searchParams.get("orgId");
    void searchParams.get("status");
    void searchParams.get("email");

    const page = Math.max(
      1,
      parseInt(searchParams.get("page") || "1", 10) || 1
    );
    const limit = Math.min(
      48,
      Math.max(1, parseInt(searchParams.get("limit") || "12", 10) || 12)
    );

    const result = await withDbRetry(() =>
      listPublicTailors({
        q: searchParams.get("q") ?? undefined,
        specialty: searchParams.get("specialty") ?? undefined,
        location: searchParams.get("location") ?? undefined,
        country: searchParams.get("country") ?? undefined,
        city: searchParams.get("city") ?? undefined,
        page,
        limit,
      })
    );

    return ok({
      items: result.items,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch (err) {
    return routeErrorResponse(err, "Failed to list tailors");
  }
}
