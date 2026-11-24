export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { releasePublicHold } from "@/lib/services/publicBooking";
type Ctx = { params: Promise<{ holdId: string }> };
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-hold-release", 30, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { holdId } = await ctx.params;
    const token =
      request.nextUrl.searchParams.get("token") ||
      request.headers.get("x-hold-token");
    return ok(await releasePublicHold(holdId, token ?? undefined));
  } catch (err) { return bookingRouteCatch(err, request, "DELETE public hold", null, "Failed"); }
}
