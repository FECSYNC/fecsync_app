/**
 * Shared public party route wrapper: IP rate limit → handler → stable errors.
 * Never reads orgId from the client; org/venue come from published slugs.
 */
import type { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { apiRateLimited } from "@/lib/rateLimit";
import { partyRouteCatch } from "@/lib/parties/gate";
import { rejectQueryOrgId } from "@/lib/parties/scope";

export async function withPublicPartyRoute(
  request: NextRequest,
  opts: { route: string; bucket: string; limit: number; windowMs?: number },
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const limited = apiRateLimited(request, opts.bucket, opts.limit, opts.windowMs ?? 60_000);
  if (limited) return limited;
  try {
    rejectQueryOrgId(request.nextUrl.searchParams);
    await connectDB();
    return await handler();
  } catch (err) {
    return partyRouteCatch(err, request, opts.route, null);
  }
}
