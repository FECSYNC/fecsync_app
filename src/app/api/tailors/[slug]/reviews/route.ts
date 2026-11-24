export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import {
  ok,
  created,
  badRequest,
  serverError,
  unauthorized,
  notFound,
  forbidden,
  authErrorToResponse,
} from "@/lib/response";
import { requireAuthActiveAccount } from "@/lib/middleware/requireAuth";
import { isPlainObject } from "@/lib/catalogWrite";
import {
  createTailorReview,
  listTailorReviewsBySlug,
} from "@/lib/tailorReviews";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/tailors/[slug]/reviews — public list */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    if (!slug?.trim()) return badRequest("Missing slug");
    await connectDB();
    const page = req.nextUrl.searchParams.get("page");
    const limit = req.nextUrl.searchParams.get("limit");
    const data = await listTailorReviewsBySlug(slug, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return ok(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Tailor not found") return notFound(message);
    console.error("[tailor reviews GET]", err);
    return serverError(message || "Failed to load reviews");
  }
}

/**
 * POST /api/tailors/[slug]/reviews
 * Body: { jobId, rating, comment? }
 * Authenticated customer; job must be completed; one review per job.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  let user;
  try {
    user = await requireAuthActiveAccount(req);
  } catch (err) {
    return authErrorToResponse(err) ?? unauthorized("Unauthorized");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  if (!isPlainObject(body)) return badRequest("Invalid JSON");

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const rating = typeof body.rating === "number" ? body.rating : Number(body.rating);
  const comment =
    typeof body.comment === "string" ? body.comment : undefined;

  if (!jobId) return badRequest("jobId is required");
  if (!Number.isFinite(rating)) return badRequest("rating is required");

  try {
    const { slug } = await ctx.params;
    if (!slug?.trim()) return badRequest("Missing slug");
    await connectDB();
    const review = await createTailorReview({
      slug,
      customerId: user.sub,
      jobId,
      rating,
      comment,
    });
    return created({ review }, "Review submitted");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Tailor not found" || message === "Job not found") {
      return notFound(message);
    }
    if (message === "Forbidden") return forbidden(message);
    if (
      message.includes("completed") ||
      message.includes("already reviewed") ||
      message.includes("Rating") ||
      message.includes("belong")
    ) {
      return badRequest(message);
    }
    console.error("[tailor reviews POST]", err);
    return serverError(message || "Failed to create review");
  }
}
