export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { patchPartyGuestsForOwner } from "@/lib/parties/owner";

type Ctx = { params: Promise<{ token: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-magic-guests", 20, 60_000);
  if (limited) return limited;
  let body: { guests?: Array<{ name?: string; age?: number | null }> };
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    const { token } = await ctx.params;
    return ok(
      await patchPartyGuestsForOwner({
        viewToken: token,
        guests: Array.isArray(body.guests) ? body.guests : [],
      })
    );
  } catch (err) {
    return bookingRouteCatch(err, request, "PATCH magic guests", null, "Failed");
  }
}
