export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { submitSurveyResponse } from "@/lib/marketing/surveys";
import { routeErrorResponse } from "@/lib/response";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const limited = apiRateLimited(request, "public-marketing-survey-submit", 10, 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    const { token } = await context.params;
    const response = await submitSurveyResponse({
      token,
      answers: (body.answers as Record<string, unknown>) ?? {},
      rating: body.rating == null ? null : Number(body.rating),
      comment: body.comment ? String(body.comment) : null,
    });
    return ok({ response });
  } catch (err) {
    const validation = err instanceof Error ? err.message : "Failed";
    if (
      validation.includes("not found") ||
      validation.includes("expired") ||
      validation.includes("already completed")
    ) {
      return badRequest(validation);
    }
    return routeErrorResponse(err, "Failed to submit survey", {});
  }
}
