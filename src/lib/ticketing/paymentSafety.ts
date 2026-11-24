/**
 * Ticketing payment safety helpers — stub gate + guest proof for cancel.
 */
import { createHash, timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";

/** Stub settlement only outside production (smoke/local). */
export function allowTicketingPaymentStub(): boolean {
  return (
    process.env.TICKETING_PAYMENT_LINK_STUB === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Guest may void a pending card reserve only with viewToken or payment-link token.
 * Webhooks use stripePaymentIntentId / trustedSource instead.
 */
export async function assertGuestMayCancelPendingPayment(opts: {
  bookingId: string;
  viewToken?: string | null;
  paymentLinkToken?: string | null;
}): Promise<boolean> {
  const viewToken = opts.viewToken?.trim() || "";
  const linkToken = opts.paymentLinkToken?.trim() || "";
  if (!viewToken && !linkToken) return false;

  const booking = await prisma.booking.findFirst({
    where: { id: opts.bookingId },
    select: { id: true, viewToken: true },
  });
  if (!booking) return false;

  if (viewToken && secretsEqual(booking.viewToken, viewToken)) {
    return true;
  }
  if (linkToken) {
    const link = await prisma.bookingPaymentLink.findFirst({
      where: { token: linkToken, bookingId: booking.id },
      select: { id: true },
    });
    if (link) return true;
  }
  return false;
}
