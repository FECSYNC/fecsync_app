export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { created, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { createPublicHold } from "@/lib/services/publicBooking";
export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "public-booking-hold", 30, 60_000);
  if (limited) return limited;
  let body: any; try { body = await request.json(); } catch { return badRequest("Invalid JSON"); }
  try {
    await connectDB();
    const hold = await createPublicHold({
      orgSlug: String(body.orgSlug ?? ""),
      venueSlug: String(body.venueSlug ?? ""),
      productId: String(body.productId ?? ""),
      sessionId: String(body.sessionId ?? ""),
      qty: Number(body.qty ?? 1),
    });
    return created({ hold });
  } catch (err) { return bookingRouteCatch(err, request, "POST public hold", null, "Failed"); }
}
