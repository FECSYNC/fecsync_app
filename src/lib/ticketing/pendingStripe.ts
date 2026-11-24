/**
 * Cancel in-flight Stripe Checkout / PaymentIntents for a booking.
 * Used on cancel and TTL expire so late webhooks cannot settle dead bookings.
 *
 * Only touches card rows with a PaymentIntent. Invoice / gift-card pending
 * tenders stay intact unless the caller marks the booking cancelled/expired
 * and voids leftover pending rows itself — otherwise a confirm race would
 * wipe a still-valid invoice tender.
 */
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export async function cancelPendingStripeForBooking(bookingId: string) {
  const pending = await prisma.bookingPayment.findMany({
    where: {
      bookingId,
      status: "pending",
      stripePaymentIntentId: { not: null },
    },
    select: { id: true, stripePaymentIntentId: true },
  });
  if (!pending.length) return;
  try {
    const { getStripe } = await import("@/lib/stripe");
    const stripe = getStripe();
    for (const p of pending) {
      if (!p.stripePaymentIntentId) continue;
      try {
        await stripe.paymentIntents.cancel(p.stripePaymentIntentId);
      } catch {
        // Already cancelled/succeeded — ignore.
      }
    }
  } catch {
    // Stripe not configured — skip.
  }
  const ids = pending.map((p) => p.id);
  await prisma.bookingPayment.updateMany({
    where: {
      id: { in: ids },
      status: "pending",
    },
    data: { status: "cancelled" },
  });
}

/** Void leftover pending tenders after a booking is cancelled or expired. */
export async function voidPendingBookingPayments(
  bookingId: string,
  db: Db = prisma
) {
  await db.bookingPayment.updateMany({
    where: { bookingId, status: "pending" },
    data: { status: "cancelled" },
  });
}

/** Void only in-flight card Checkouts (keeps invoice payment markers intact). */
export async function voidPendingCardPayments(
  bookingId: string,
  db: Db = prisma
) {
  await db.bookingPayment.updateMany({
    where: {
      bookingId,
      status: "pending",
      tender: { in: ["card", "stored_card"] },
    },
    data: { status: "cancelled" },
  });
}
