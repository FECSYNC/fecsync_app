/**
 * Company category booking checkout. Same booking engine, holds, capacity, and
 * venue_booking settlement as /book — only Checkout is embedded and returns to
 * /{orgSlug}/{categorySlug}/payment/success. viewToken never leaves the server.
 */
import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  TicketingError,
  HOLD_EXPIRED,
  PUBLIC_VENUE_NOT_PUBLISHED,
} from "@/lib/ticketing/errors";
import {
  beginPublicCardPayment,
  publicCheckout,
} from "@/lib/ticketing/publicBooking";
import { settleVenueBookingStripePayment } from "@/lib/ticketing/payments";
import { isVenueBookingPaymentType } from "@/lib/ticketing/bookingPayable";
import {
  findCompanyBookingProduct,
  resolveCompanyCategory,
} from "@/lib/publicCategory/resolve";
import { companySiteBase } from "@/lib/publicCategory/sitePaths";
import {
  appOrigin,
  companyFrameOrigins,
  headerOrigin,
} from "@/lib/publicCategory/frameOrigins";
import { ForbiddenError } from "@/lib/auth/http-error";

export type CompanyCheckoutLine = {
  productId: string;
  sessionId?: string;
  qty: number;
  priceBandCode?: string;
  visitDate?: string;
};

export type CompanyCheckoutInput = {
  orgSlug: string;
  categorySlug: string;
  productId: string;
  holdId?: string;
  holdToken?: string;
  priceBandCode?: string;
  lines?: CompanyCheckoutLine[];
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  payLater?: boolean;
  userId?: string | null;
  /**
   * Set when checkout runs inside the iframe embed. parentOrigin is the framing
   * page (from the frame); requestOrigin is the request's Origin or Referer.
   */
  embed?: { parentOrigin: string | null; requestOrigin: string | null } | null;
};

export type CompanyBookingSummary = {
  publicId: string;
  status: string;
  total: number;
  amountDue: number;
  primaryContactEmail: string | null;
};

export type CompanyCheckoutResult = {
  booking: CompanyBookingSummary;
  payment: {
    clientSecret: string;
    publishableKey: string;
    cancel: { bookingId: string; paymentId: string; token: string };
  } | null;
};

function stripePublishableKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
    null
  );
}

function summary(b: {
  publicId: string;
  status: string;
  total: number;
  amountDue: number;
  primaryContactEmail: string | null;
}): CompanyBookingSummary {
  return {
    publicId: b.publicId,
    status: b.status,
    total: b.total,
    amountDue: b.amountDue,
    primaryContactEmail: b.primaryContactEmail,
  };
}

export const EMBED_ORIGIN_NOT_ALLOWED =
  "This booking frame is not allowed on this website.";

function appBase(): string {
  return publicAppBaseUrl().replace(/\/$/, "");
}

/** Success URL on this company's own path; keeps embed=1 inside the iframe. */
export function companyCheckoutReturnUrl(
  orgSlug: string,
  categorySlug: string,
  opts?: { embed?: boolean }
) {
  const success = `${appBase()}${companySiteBase(orgSlug, categorySlug)}/payment/success`;
  const embed = opts?.embed ? "embed=1&" : "";
  return `${success}?${embed}session_id={CHECKOUT_SESSION_ID}`;
}

/** Rejects any Checkout return URL outside /{orgSlug}/{categorySlug}/payment/. */
export function assertCompanyReturnUrl(
  url: string,
  orgSlug: string,
  categorySlug: string
): void {
  const prefix = `${appBase()}${companySiteBase(orgSlug, categorySlug)}/payment/`;
  if (!url.startsWith(prefix) || url.slice(prefix.length).includes("..")) {
    throw new ForbiddenError("Checkout return URL must stay on this company's page");
  }
}

/** Embed checkout: the framing page and the request must both be allowed origins. */
export async function assertEmbedCheckoutOrigin(
  orgId: string,
  embed: { parentOrigin: string | null; requestOrigin: string | null }
): Promise<void> {
  const allowed = new Set([appOrigin(), ...(await companyFrameOrigins(orgId))]);
  const parent = headerOrigin(embed.parentOrigin);
  const request = headerOrigin(embed.requestOrigin);
  if (!parent || !request || !allowed.has(parent) || !allowed.has(request)) {
    throw new ForbiddenError(EMBED_ORIGIN_NOT_ALLOWED);
  }
}

export async function companyCategoryCheckout(
  input: CompanyCheckoutInput
): Promise<CompanyCheckoutResult> {
  const site = await resolveCompanyCategory(input.orgSlug, input.categorySlug);
  if (!site || site.page.kind !== "booking") {
    throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  }
  const found = await findCompanyBookingProduct(site, input.productId);
  if (!found) throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
  const { product, venue } = found;
  if (input.embed) {
    if (!site.page.embedEnabled) throw new TicketingError(PUBLIC_VENUE_NOT_PUBLISHED, 404);
    await assertEmbedCheckoutOrigin(site.org.id, input.embed);
  }
  const returnUrl = companyCheckoutReturnUrl(site.org.slug, site.page.slug, {
    embed: Boolean(input.embed),
  });
  assertCompanyReturnUrl(returnUrl, site.org.slug, site.page.slug);

  const lines = (input.lines ?? []).filter((l) => l && l.productId);
  const addOnIds = new Set((product.addOns ?? []).map((a) => a.id));
  for (const line of lines) {
    if (line.productId !== product.id && !addOnIds.has(line.productId)) {
      throw new Error("Add-on is not available for this product");
    }
  }

  const holdToken = input.holdToken?.trim() || "";
  if (holdToken) {
    const hold = await prisma.bookingHold.findFirst({
      where: { token: holdToken, orgId: site.org.id, locationId: venue.id },
      select: { sessionId: true },
    });
    const session = hold?.sessionId
      ? await prisma.ticketSession.findFirst({
          where: { id: hold.sessionId, orgId: site.org.id },
          select: { productId: true },
        })
      : null;
    if (!session || session.productId !== product.id) {
      throw new TicketingError(HOLD_EXPIRED, 410);
    }
  } else if (lines[0]?.productId !== product.id) {
    throw new Error("Checkout requires hold or lines");
  }

  const payNow = !input.payLater;
  if (payNow && process.env.STRIPE_SECRET_KEY?.trim() && !stripePublishableKey()) {
    throw new Error("Card payments are not configured for this workspace");
  }

  const booking = await publicCheckout({
    orgSlug: site.org.slug,
    venueSlug: venue.slug,
    holdId: input.holdId,
    holdToken: holdToken || undefined,
    priceBandCode: input.priceBandCode,
    lines: lines.length ? lines : undefined,
    primaryContactName: input.primaryContactName,
    primaryContactEmail: input.primaryContactEmail,
    primaryContactPhone: input.primaryContactPhone,
    payLater: input.payLater,
    userId: input.userId ?? null,
  });

  if (!payNow || !(booking.amountDue > 0) || !booking.viewToken) {
    return { booking: summary(booking), payment: null };
  }

  const pay = await beginPublicCardPayment({
    bookingPublicId: booking.publicId,
    viewToken: booking.viewToken,
    embedded: { returnUrl },
  });

  if ("clientSecret" in pay && pay.clientSecret && pay.paymentLinkToken) {
    const publishableKey = stripePublishableKey();
    if (!publishableKey) {
      throw new Error("Card payments are not configured for this workspace");
    }
    return {
      booking: summary(pay.booking),
      payment: {
        clientSecret: pay.clientSecret,
        publishableKey,
        cancel: {
          bookingId: pay.booking.id,
          paymentId: pay.paymentId,
          token: pay.paymentLinkToken,
        },
      },
    };
  }
  // Stub settlement (non-production TICKETING_PAYMENT_LINK_STUB) returns the booking.
  const settled = "booking" in pay ? pay.booking : pay;
  return { booking: summary(settled), payment: null };
}

export type CompanyPaymentStatus =
  | "ok"
  | "pending"
  | "needs_refund"
  | "error"
  | "missing";

export type CompanyPaymentConfirmation = {
  status: CompanyPaymentStatus;
  booking: { publicId: string; status: string } | null;
};

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{8,250}$/;

/**
 * Success page settle. A Checkout session from another company (metadata orgId
 * mismatch) is ignored. Settlement is idempotent with the webhook.
 */
export async function confirmCompanyCheckoutSession(opts: {
  orgId: string;
  sessionId: string | null | undefined;
  retrieveSession?: (id: string) => Promise<Stripe.Checkout.Session>;
}): Promise<CompanyPaymentConfirmation> {
  const sessionId = opts.sessionId?.trim() || "";
  if (!SESSION_ID_RE.test(sessionId)) return { status: "missing", booking: null };

  let session: Stripe.Checkout.Session;
  try {
    const retrieve =
      opts.retrieveSession ??
      (async (id: string) => (await import("@/lib/stripe")).getCheckoutSession(id));
    session = await retrieve(sessionId);
  } catch (err) {
    // Unknown id → missing. Stripe unreachable → error (the webhook still settles).
    const e = err as { code?: string; statusCode?: number };
    const notFound = e?.code === "resource_missing" || e?.statusCode === 404;
    return { status: notFound ? "missing" : "error", booking: null };
  }
  const md = (session.metadata || {}) as Record<string, string | undefined>;
  if (
    !isVenueBookingPaymentType(md.type) ||
    !md.orgId ||
    md.orgId !== opts.orgId ||
    !md.bookingId ||
    !md.paymentId
  ) {
    return { status: "missing", booking: null };
  }
  const owned = await prisma.booking.findFirst({
    where: { id: md.bookingId, orgId: opts.orgId },
    select: { id: true },
  });
  if (!owned) return { status: "missing", booking: null };

  const loadBooking = () =>
    prisma.booking.findFirst({
      where: { id: owned.id },
      select: { publicId: true, status: true },
    });

  if (session.payment_status !== "paid") {
    return { status: "pending", booking: await loadBooking() };
  }

  let result: Awaited<ReturnType<typeof settleVenueBookingStripePayment>>;
  try {
    result = await settleVenueBookingStripePayment({
      paymentId: md.paymentId,
      bookingId: owned.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    });
  } catch (err) {
    console.error("[company checkout] success-page settle failed", err);
    return { status: "error", booking: await loadBooking().catch(() => null) };
  }
  const booking = await loadBooking();
  if (!result.ok) return { status: "error", booking };
  if ("needsRefund" in result && result.needsRefund) {
    return { status: "needs_refund", booking };
  }
  if ("confirmFailed" in result && result.confirmFailed) {
    return { status: "pending", booking };
  }
  return {
    status: booking?.status === "confirmed" ? "ok" : "pending",
    booking,
  };
}
