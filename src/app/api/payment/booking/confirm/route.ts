export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, badRequest } from "@/lib/response";
import { getCheckoutSession } from "@/lib/stripe";
import { settleVenueBookingStripePayment } from "@/lib/services/bookings";
import { bookingRouteCatch } from "@/lib/ticketing/bookingRoute";
import { isVenueBookingPaymentType } from "@/lib/ticketing/bookingPayable";
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const sessionId = request.nextUrl.searchParams.get("session_id");
    if (!sessionId) return badRequest("session_id required");
    const session = await getCheckoutSession(sessionId);
    const md = (session.metadata || {}) as Record<string, string>;
    if (!isVenueBookingPaymentType(md.type)) return badRequest("Not a venue booking session");
    if (session.payment_status !== "paid") return badRequest("Payment not completed");
    const result = await settleVenueBookingStripePayment({
      paymentId: md.paymentId,
      bookingId: md.bookingId,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      expectedOrgId: md.orgId ?? null,
    });
    return ok(result);
  } catch (err) { return bookingRouteCatch(err, request, "GET payment/booking/confirm", null, "Failed"); }
}
