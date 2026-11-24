import { NextRequest } from "next/server";
import { ok, notFound, badRequest, routeErrorResponse } from "@/lib/response";
import { withDbRetry } from "@/lib/db";
import { getPublicTailorBySlug } from "@/lib/tailors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tailors/[slug] — public approved tailor detail.
 * Draft / pending / suspended → 404. No PII.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    void req.nextUrl.searchParams;
    const { slug } = await params;
    const cleaned = String(slug ?? "").trim();
    if (!cleaned) return badRequest("Slug is required");

    const tailor = await withDbRetry(() => getPublicTailorBySlug(cleaned));
    if (!tailor) return notFound("Tailor not found");
    return ok({ tailor });
  } catch (err) {
    return routeErrorResponse(err, "Failed to fetch tailor");
  }
}
