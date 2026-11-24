export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { created, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { publicCheckout } from "@/lib/services/publicBooking";
import { requireAuthFresh } from "@/lib/middleware/requireAuth";
export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "public-booking-checkout", 20, 60_000);
  if (limited) return limited;
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    let userId: string | null = null;
    try {
      const payload = await requireAuthFresh(request);
      userId = payload?.sub ? String(payload.sub) : null;
    } catch { /* guest ok */ }
    const booking = await publicCheckout({
      orgSlug: String(body.orgSlug ?? ""),
      venueSlug: String(body.venueSlug ?? ""),
      holdId: body.holdId ? String(body.holdId) : undefined,
      holdToken: body.holdToken ? String(body.holdToken) : undefined,
      priceBandCode: body.priceBandCode ? String(body.priceBandCode) : undefined,
      lines: Array.isArray(body.lines) ? body.lines : undefined,
      primaryContactName: body.primaryContactName ? String(body.primaryContactName) : undefined,
      primaryContactEmail: body.primaryContactEmail ? String(body.primaryContactEmail) : undefined,
      primaryContactPhone: body.primaryContactPhone ? String(body.primaryContactPhone) : undefined,
      payLater: Boolean(body.payLater),
      userId,
    });
    return created({ booking });
  } catch (err) { return bookingRouteCatch(err, request, "POST public checkout", null, "Failed"); }
}
