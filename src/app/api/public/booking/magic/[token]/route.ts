export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { validateMagicToken } from "@/lib/services/publicBooking";
type Ctx = { params: Promise<{ token: string }> };
export async function GET(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-magic", 30, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const { token } = await ctx.params;
    return ok(await validateMagicToken(token));
  } catch (err) { return bookingRouteCatch(err, request, "GET magic", null, "Failed"); }
}
