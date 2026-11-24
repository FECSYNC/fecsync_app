import Stripe from "stripe";

/**
 * ── Stripe worlds (same platform STRIPE_SECRET_KEY — separate object namespaces) ──
 *
 * World A — Company SaaS billing:
 *   Organization.stripeCustomerId / stripeSubscriptionId / subscription*
 *   Checkout metadata type: company_subscription
 *   Handlers: src/lib/companyBilling.ts (applyStripeSubscriptionToOrg, …)
 *   UI: /admin/billing
 *   NEVER mutate OrganizationMarketplaceAccount from these events.
 *
 * World B — Marketplace Connect payouts:
 *   OrganizationMarketplaceAccount.stripeConnectedAccountId
 *   VenueLocationMarketplaceAccount (franchise parks, Step 3)
 *   Checkout metadata type: marketplace_booking (destination + application_fee)
 *   Handlers: src/lib/marketplace/*
 *   UI: /admin/payouts
 *   NEVER mutate SaaS subscription columns from Connect / marketplace events.
 *
 * World C — Platform / destination guest commerce:
 *   venue_booking / order / tailoring default to the platform account.
 *   Franchise park (or org-fallback) destination charges pass optional
 *   connectedAccountId + applicationFeeMinor into createCheckoutSession after
 *   resolveGuestPayoutDestination — never trust client destination ids.
 *
 * Marketplace package destination charges also use
 * stripeConnectMarketplaceProvider.createDestinationCheckoutSession.
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY as string;
const stripe = new Stripe(STRIPE_SECRET_KEY || "sk_test_placeholder");

export class CompanyBillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyBillingConfigError";
  }
}

/** Shared Stripe client for commerce + company SaaS billing + Connect (platform key). */
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new CompanyBillingConfigError(
      "STRIPE_SECRET_KEY is not configured"
    );
  }
  return stripe;
}

export type CheckoutSessionMetadata = {
  type: string;
  amount: number;
  uuid: string;
  orderId?: string;
  jobId?: string;
  bookingId?: string;
  orgId?: string;
  locationId?: string;
  paymentId?: string;
  /** Manual accounting invoice Checkout (type: accounting_invoice). */
  invoiceId?: string;
};

/**
 * Hosted (default) returns `session.url`. Embedded returns `session.client_secret`
 * and is reserved for the company category booking path.
 */
export type CheckoutSessionReturn =
  | {
      uiMode?: "hosted";
      successUrl: string;
      cancelUrl: string;
      returnUrl?: never;
    }
  | {
      uiMode: "embedded";
      returnUrl: string;
      successUrl?: never;
      cancelUrl?: never;
    };

export type CreateCheckoutSessionInput = {
  amount: number;
  currency?: string;
  email: string;
  metadata: CheckoutSessionMetadata;
  productName?: string;
  productDescription?: string;
  /**
   * When set (server-resolved Connect account), create a destination charge
   * with application_fee_amount. Never pass a client-supplied account id.
   */
  connectedAccountId?: string | null;
  /** Platform fee in minor units; required when connectedAccountId is set. */
  applicationFeeMinor?: number | null;
} & CheckoutSessionReturn;

export function buildCheckoutSessionParams(
  input: CreateCheckoutSessionInput
): Stripe.Checkout.SessionCreateParams {
  const {
    amount,
    currency = "usd",
    email,
    metadata,
    productName,
    productDescription,
    connectedAccountId,
    applicationFeeMinor,
  } = input;
  const refId =
    metadata.orderId || metadata.jobId || metadata.bookingId || "";
  const dest = connectedAccountId?.trim() || "";
  const sessionMetadata: Record<string, string> = {
    ...(metadata.orderId ? { orderId: metadata.orderId } : {}),
    ...(metadata.jobId ? { jobId: metadata.jobId } : {}),
    ...(metadata.bookingId ? { bookingId: metadata.bookingId } : {}),
    ...(metadata.orgId ? { orgId: metadata.orgId } : {}),
    ...(metadata.locationId ? { locationId: metadata.locationId } : {}),
    ...(metadata.paymentId ? { paymentId: metadata.paymentId } : {}),
    ...(metadata.invoiceId ? { invoiceId: metadata.invoiceId } : {}),
    ...(dest ? { connectedAccountId: dest } : {}),
    uuid: metadata.uuid,
    amount: metadata.amount?.toString() || "0",
    type: metadata.type,
  };
  const returnParams: Pick<
    Stripe.Checkout.SessionCreateParams,
    "ui_mode" | "return_url" | "success_url" | "cancel_url"
  > =
    input.uiMode === "embedded"
      ? { ui_mode: "embedded", return_url: input.returnUrl }
      : { success_url: input.successUrl, cancel_url: input.cancelUrl };
  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData =
    {
      metadata: sessionMetadata,
    };
  if (dest) {
    const fee = Math.floor(Number(applicationFeeMinor ?? 0));
    if (!Number.isFinite(fee) || fee < 0) {
      throw new CompanyBillingConfigError(
        "applicationFeeMinor is required for Connect destination Checkout"
      );
    }
    paymentIntentData.application_fee_amount = fee;
    paymentIntentData.transfer_data = { destination: dest };
  }
  // Mirror onto the PaymentIntent so payment_intent.* webhooks can gate on type
  // (Checkout session metadata alone is not copied to the PI by Stripe).
  return {
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: (currency || "usd").toLowerCase(),
          product_data: {
            name: productName || metadata.type || "Purchase",
            description:
              productDescription ||
              (metadata.bookingId
                ? `Booking #${String(metadata.bookingId).slice(-8)}`
                : metadata.jobId
                  ? `Tailoring job #${String(metadata.jobId).slice(-8)}`
                  : `Order #${refId}`),
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    ...returnParams,
    metadata: sessionMetadata,
    payment_intent_data: paymentIntentData,
  };
}

/**
 * ✅ Create a Stripe Checkout Session
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create(buildCheckoutSessionParams(input));
}

/**
 * ✅ Verify and parse a Stripe webhook event.
 * Tries STRIPE_WEBHOOK_SECRET first, then optional STRIPE_CONNECT_WEBHOOK_SECRET
 * when Connect events are delivered on a second endpoint secret.
 */
export function verifyStripeWebhook(
  rawBody: string | Buffer,
  signature: string
): Stripe.Event {
  const primary = process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
  const connect = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim() || "";
  const secrets = [primary, connect].filter(
    (s, i, arr) => Boolean(s) && arr.indexOf(s) === i
  );
  if (secrets.length === 0) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET environment variable");
  }

  let lastMessage = "Invalid webhook signature";
  for (const webhookSecret of secrets) {
    try {
      return stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      ) as Stripe.Event;
    } catch (err: unknown) {
      lastMessage = (err as Error)?.message ?? String(err);
    }
  }
  console.error("⚠️ Stripe webhook verification failed:", lastMessage);
  throw new Error(`Invalid webhook signature: ${lastMessage}`);
}

/**
 * ✅ Retrieve a checkout session by ID
 */
export async function getCheckoutSession(
  sessionId: string
): Promise<Stripe.Checkout.Session> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  return session as Stripe.Checkout.Session;
}

/**
 * ✅ Retrieve a payment intent by ID
 */
export async function getPaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return pi as Stripe.PaymentIntent;
}

/**
 * ✅ Refund a payment
 * @param paymentIntentId - Payment intent ID to refund
 * @param amount - Optional partial refund amount (in dollars)
 * @param opts.refundApplicationFee - when the PI was a Connect destination charge
 *   (BookingPayment.connectedAccountId set), refund the platform fee too.
 * @param opts.idempotencyKey - Stripe idempotency key (safe retries after claim).
 */
export async function refundPayment(
  paymentIntentId: string,
  amount?: number,
  opts?: { refundApplicationFee?: boolean; idempotencyKey?: string }
): Promise<Stripe.Refund> {
  const params: Stripe.RefundCreateParams = {
    payment_intent: paymentIntentId,
  };

  if (typeof amount === "number") {
    params.amount = Math.round(amount * 100);
  }
  if (opts?.refundApplicationFee) {
    params.refund_application_fee = true;
  }

  return stripe.refunds.create(
    params,
    opts?.idempotencyKey
      ? { idempotencyKey: opts.idempotencyKey.slice(0, 255) }
      : undefined
  );
}
