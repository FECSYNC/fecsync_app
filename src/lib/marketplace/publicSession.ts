/**
 * Public read-only marketplace checkout session reconcile.
 * Webhook remains SSOT for paid — this never mutates booking status.
 */

import prisma from "@/lib/prisma";
import { ForbiddenError } from "@/lib/auth/http-error";

export const MARKETPLACE_SESSION_NOT_FOUND =
  "Checkout session not found or not available";

function normalizeSessionId(raw: string): string {
  const s = raw.trim();
  if (!s || s.length < 8 || s.length > 256 || !s.startsWith("cs_")) {
    throw new ForbiddenError(MARKETPLACE_SESSION_NOT_FOUND);
  }
  return s;
}

/**
 * Resolve a marketplace booking by Stripe Checkout Session id (success page).
 * Returns redacted fields only — no Connect account / PI / transfer ids.
 */
export async function getMarketplaceBookingPublicByCheckoutSession(
  sessionIdRaw: string
): Promise<{
  status: string;
  packageTitle: string;
  packageSlug: string;
  orgSlug: string;
  customerEmail: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
}> {
  const sessionId = normalizeSessionId(sessionIdRaw);
  const booking = await prisma.marketplaceBooking.findFirst({
    where: { stripeCheckoutSessionId: sessionId },
    include: {
      package: { select: { title: true, slug: true } },
      org: { select: { slug: true, isDefault: true, status: true } },
    },
  });
  if (!booking || booking.org.isDefault || booking.org.status !== "active") {
    throw new ForbiddenError(MARKETPLACE_SESSION_NOT_FOUND);
  }

  return {
    status: booking.status,
    packageTitle: booking.package.title,
    packageSlug: booking.package.slug,
    orgSlug: booking.org.slug,
    customerEmail: booking.customerEmail,
    amountMinor: booking.amountMinor,
    currency: booking.currency,
    paidAt: booking.paidAt?.toISOString() ?? null,
  };
}
