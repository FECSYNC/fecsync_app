export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ok, badRequest, unauthorized } from "@/lib/response";
import connectDB from "@/lib/db";
import { failVenueBookingStripePayment } from "@/lib/ticketing/payments";

/**
 * Optional client ping on Checkout cancel — voids the pending card reserve.
 * Requires viewToken or payment-link token (not bare bookingId/paymentId).
 */
export async function POST(request: NextRequest) {
  let body: {
    bookingId?: string;
    paymentId?: string;
    viewToken?: string;
    token?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    /* optional */
  }
  const bookingId = body.bookingId?.trim() || "";
  const paymentId = body.paymentId?.trim() || "";
  const viewToken = body.viewToken?.trim() || "";
  const paymentLinkToken = body.token?.trim() || "";
  if (!bookingId && !paymentId) {
    return badRequest("bookingId or paymentId required");
  }
  if (!viewToken && !paymentLinkToken) {
    return unauthorized("viewToken or payment link token required");
  }
  await connectDB();
  const result = await failVenueBookingStripePayment({
    paymentId: paymentId || null,
    bookingId: bookingId || null,
    viewToken: viewToken || null,
    paymentLinkToken: paymentLinkToken || null,
    reason: "checkout_cancelled",
  });
  if (!result.ok && result.reason === "unauthorized") {
    return unauthorized("Not allowed to cancel this payment");
  }
  return ok({
    cancelled: true,
    bookingId: bookingId || null,
    paymentId: paymentId || null,
    released: result.ok,
  });
}
