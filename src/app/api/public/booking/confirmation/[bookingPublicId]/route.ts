export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getPublicConfirmation } from "@/lib/services/publicBooking";
type Ctx = { params: Promise<{ bookingPublicId: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-confirmation", 60, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { bookingPublicId } = await ctx.params;
    const viewToken = request.nextUrl.searchParams.get("viewToken") || undefined;
    return ok({ booking: await getPublicConfirmation(bookingPublicId, viewToken) });
  } catch (err) { return bookingRouteCatch(err, request, "GET confirmation", null, "Failed"); }
}
