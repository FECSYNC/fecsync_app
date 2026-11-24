export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import connectDB from "@/lib/db";
import { failVenueBookingStripePayment } from "@/lib/ticketing/payments";

/**
 * Guest landing when Stripe Checkout is cancelled for a venue booking.
 * Releases the pending card reserve only when viewToken or pay-link token proves possession.
 */
export default async function BookingPaymentCancelPage({
  searchParams,
}: {
  searchParams?:
    | Promise<{
        bookingId?: string;
        token?: string;
        viewToken?: string;
        paymentId?: string;
      }>
    | {
        bookingId?: string;
        token?: string;
        viewToken?: string;
        paymentId?: string;
      };
}) {
  const sp = await Promise.resolve(searchParams ?? {});
  const bookingId = sp.bookingId?.trim() || "";
  const paymentId = sp.paymentId?.trim() || "";
  const viewToken = sp.viewToken?.trim() || "";
  const paymentLinkToken = sp.token?.trim() || "";

  let released = false;
  if ((bookingId || paymentId) && (viewToken || paymentLinkToken)) {
    try {
      await connectDB();
      const result = await failVenueBookingStripePayment({
        paymentId: paymentId || null,
        bookingId: bookingId || null,
        viewToken: viewToken || null,
        paymentLinkToken: paymentLinkToken || null,
        reason: "checkout_cancelled",
      });
      released = Boolean(result.ok);
    } catch {
      /* page still informs the guest */
    }
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      <p style={{ color: "#D4AF37", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em" }}>
        BOOKING
      </p>
      <h1 style={{ fontSize: 28, margin: "8px 0 12px" }}>Payment cancelled</h1>
      <p style={{ color: "#444", lineHeight: 1.5 }}>
        {released
          ? "Checkout was cancelled. Any in-progress card reserve for this attempt was released — you can try paying again from your confirmation or payment link."
          : "Checkout was cancelled. If a card reserve is still held, reopen your confirmation or payment link and try again — or wait for the hold to expire."}
      </p>
      {paymentLinkToken ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
          Reopen your payment link when ready to pay.
        </p>
      ) : null}
    </main>
  );
}
