export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { listPublicAvailability } from "@/lib/services/publicBooking";
export async function GET(request: NextRequest) {
  const limited = apiRateLimited(request, "public-booking-availability", 60, 60_000);
  if (limited) return limited;
  try {
    await connectDB();
    const sp = request.nextUrl.searchParams;
    const productId = sp.get("productId");
    if (!productId) return badRequest("productId required");
    return ok({
      sessions: await listPublicAvailability({
        productId,
        date: sp.get("date") || undefined,
        from: sp.get("from") || undefined,
        to: sp.get("to") || undefined,
        qty: sp.get("qty") ? Number(sp.get("qty")) : undefined,
      }),
    });
  } catch (err) { return bookingRouteCatch(err, request, "GET public availability", null, "Failed"); }
}
