export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import connectDB from "@/lib/db";
import prisma from "@/lib/prisma";
import { getCheckoutSession } from "@/lib/stripe";
import { settleVenueBookingStripePayment } from "@/lib/services/bookings";
import { isVenueBookingPaymentType } from "@/lib/ticketing/bookingPayable";

/**
 * Stripe Checkout success — settle BookingPayment idempotently (same as webhook).
 * Guests land here when NEXT_PUBLIC_APP_URL success_url is used.
 *
 * IMPORTANT: do not call redirect() inside try/catch — Next.js redirect throws
 * NEXT_REDIRECT and a catch would swallow a successful settle.
 */
export default async function BookingPaymentSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ session_id?: string }> | { session_id?: string };
}) {
  const sp = await Promise.resolve(searchParams ?? {});
  const sessionId = sp.session_id?.trim() || "";
  let status: "ok" | "pending" | "error" | "missing" | "needs_refund" =
    "missing";
  let detail = "";
  let confirmationHref: string | null = null;

  if (sessionId) {
    try {
      await connectDB();
      const session = await getCheckoutSession(sessionId);
      const md = (session.metadata || {}) as Record<string, string | undefined>;
      if (!isVenueBookingPaymentType(md.type)) {
        status = "error";
        detail = "Not a venue booking payment.";
      } else if (session.payment_status !== "paid") {
        status = "pending";
        detail = "Payment is still processing. Refresh in a moment.";
      } else if (!md.paymentId || !md.bookingId) {
        status = "error";
        detail = "Missing booking payment metadata.";
      } else {
        const result = await settleVenueBookingStripePayment({
          paymentId: md.paymentId,
          bookingId: md.bookingId,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : null,
          expectedOrgId: md.orgId ?? null,
        });
        if (result.ok && "needsRefund" in result && result.needsRefund) {
          status = "needs_refund";
          detail =
            "Payment was received, but this booking is no longer active. The venue will refund or contact you — do not treat this as a confirmed ticket.";
        } else if (result.ok && "confirmFailed" in result && result.confirmFailed) {
          status = "pending";
          detail =
            "Payment was received, but tickets are still being confirmed. Refresh in a moment or check your email — do not assume seats are finalized yet.";
        } else if (result.ok) {
          status = "ok";
          detail = "Booking payment confirmed.";
          // Load secrets from DB — never trust viewToken from Stripe metadata.
          const booking = await prisma.booking.findFirst({
            where: { id: md.bookingId },
            select: { publicId: true, viewToken: true, status: true, partyDetail: { select: { id: true } } },
          });
          // Only redirect when seats are actually confirmed (not pending_payment).
          // Party deposits keep the slot held with a balance due — the party
          // confirmation shows deposit paid + amount due.
          if (
            booking?.publicId &&
            booking.viewToken &&
            (booking.status === "confirmed" ||
              (booking.partyDetail && ["hold", "reserved", "pending_payment"].includes(booking.status)))
          ) {
            confirmationHref = `/booking/confirmation/${encodeURIComponent(booking.publicId)}?viewToken=${encodeURIComponent(booking.viewToken)}`;
          } else if (booking && booking.status !== "confirmed") {
            status = "pending";
            detail =
              "Payment was received. Confirmation is still processing — refresh shortly or use your email magic link.";
          }
        } else {
          status = "error";
          detail = "Could not settle payment.";
        }
      }
    } catch (err) {
      status = "error";
      detail = err instanceof Error ? err.message : "Settlement failed.";
    }
  }

  if (confirmationHref) {
    redirect(confirmationHref);
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
      <h1 style={{ fontSize: 28, margin: "8px 0 12px" }}>
        {status === "ok"
          ? "Payment received"
          : status === "needs_refund"
            ? "Payment received — booking inactive"
            : status === "pending"
              ? "Payment pending"
              : status === "missing"
                ? "Booking payment"
                : "Payment issue"}
      </h1>
      <p style={{ color: "#444", lineHeight: 1.5 }}>
        {detail ||
          "If you completed Checkout, open this page with the session_id Stripe returns, or wait for email confirmation."}
      </p>
      {status === "ok" ? (
        <p style={{ marginTop: 16, color: "#444", lineHeight: 1.5 }}>
          Check your email for confirmation and tickets, or open the magic link from your confirmation message.
        </p>
      ) : null}
      {status === "needs_refund" ? (
        <p style={{ marginTop: 16, color: "#444", lineHeight: 1.5 }}>
          Your card was charged, but seats were not confirmed. Keep this page or your bank statement and contact the venue for a refund.
        </p>
      ) : null}
      {sessionId ? (
        <p style={{ marginTop: 16, fontSize: 12, color: "#888" }}>
          Session {sessionId.slice(0, 20)}…
        </p>
      ) : null}
    </main>
  );
}
