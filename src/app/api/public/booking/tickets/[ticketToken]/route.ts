export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { getPublicTicketByToken } from "@/lib/services/publicBooking";
type Ctx = { params: Promise<{ ticketToken: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-ticket", 60, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { ticketToken } = await ctx.params;
    const bookingHint = request.nextUrl.searchParams.get("booking") ?? undefined;
    return ok(await getPublicTicketByToken(ticketToken, bookingHint));
  } catch (err) {
    return bookingRouteCatch(err, request, "GET ticket token", null, "Failed");
  }
}
