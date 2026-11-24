export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getPublicVenue } from "@/lib/services/publicBooking";
type Ctx = { params: Promise<{ orgSlug: string; venueSlug: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-venue", 60, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { orgSlug, venueSlug } = await ctx.params;
    return ok({ venue: await getPublicVenue(orgSlug, venueSlug) });
  } catch (err) { return bookingRouteCatch(err, request, "GET public venue", null, "Failed"); }
}
