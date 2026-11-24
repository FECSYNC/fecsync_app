export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { created, badRequest } from "@/lib/response";
import { apiRateLimited } from "@/lib/rateLimit";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { submitPublicSpecialRequest } from "@/lib/services/publicBooking";

export async function POST(request: NextRequest) {
  const limited = apiRateLimited(
    request,
    "public-booking-special-request",
    12,
    60_000
  );
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();
    const result = await submitPublicSpecialRequest({
      orgSlug: String(body.orgSlug ?? ""),
      venueSlug: String(body.venueSlug ?? ""),
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      phone: body.phone != null ? String(body.phone) : undefined,
      message: String(body.message ?? ""),
      productId: body.productId != null ? String(body.productId) : undefined,
      preferredDate:
        body.preferredDate != null ? String(body.preferredDate) : undefined,
      qty: body.qty != null ? Number(body.qty) : undefined,
    });
    return created(result);
  } catch (err) {
    return bookingRouteCatch(
      err,
      request,
      "POST public special-request",
      null,
      "Failed"
    );
  }
}
