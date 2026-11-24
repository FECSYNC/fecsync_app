export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { beginPublicCardPayment } from "@/lib/services/publicBooking";

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(request, "public-booking-pay-now", 20, 60_000);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  try {
    await connectDB();
    const result = await beginPublicCardPayment({
      bookingPublicId: String(body.bookingPublicId ?? ""),
      viewToken: String(body.viewToken ?? ""),
    });
    return ok(result);
  } catch (err) {
    return bookingRouteCatch(err, request, "POST public pay-now", null, "Failed");
  }
}
