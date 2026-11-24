export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { partyRouteCatch } from "@/lib/parties/gate";
import { legacyPublicPartyRsvp } from "@/lib/parties/invitations";
type Ctx = { params: Promise<{ bookingPublicId: string }> };
export async function POST(request: NextRequest, ctx: Ctx) {
  const limited = apiRateLimited(request, "public-booking-rsvp", 20, 60_000);
  if (limited) return limited;
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    const { bookingPublicId } = await ctx.params;
    return ok(await legacyPublicPartyRsvp({ bookingPublicId, token: body.token ? String(body.token) : undefined, name: body.name ? String(body.name) : undefined, accept: body.accept !== false }));
  } catch (err) { return partyRouteCatch(err, request, "POST party rsvp", null); }
}
