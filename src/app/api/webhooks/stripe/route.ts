import { serverError, ok, badRequest } from "@/lib/response";
import {
  verifyStripeWebhook,
  getCheckoutSession,
  getStripe,
  CompanyBillingConfigError,
} from "@/lib/stripe";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { getUserFromUuid } from "@/lib/utils";
import { settleOrderGatewayPayment } from "@/lib/orderPaymentSettle";
import { settleTailoringJobGatewayPayment } from "@/lib/tailoringJobPaymentSettle";
import {
  applyStripeSubscriptionToOrg,
  bestEffortCancelStripeSubscription,
  expireIfBoundStripeSubscription,
  findOrgIdByStripeCustomerId,
  findOrgIdByStripeSubscriptionId,
  isApplicableStripeSubscriptionStatus,
  isCompanyBillingWebhookSkipError,
  markOrganizationPastDue,
  retrieveStripeSubscriptionForApply,
  type StripeSubscriptionLike,
} from "@/lib/companyBilling";
import { ForbiddenError, isAuthHttpError } from "@/lib/auth/http-error";
import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import { isVenueBookingPaymentType } from "@/lib/ticketing/bookingPayable";

function settleUserFromDoc(user: {
  id: string;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  username?: unknown;
}) {
  return {
    _id: String(user.id),
    email: String(user.email ?? ""),
    firstName:
      typeof user.firstName === "string" ? user.firstName : undefined,
    lastName: typeof user.lastName === "string" ? user.lastName : undefined,
    username: typeof user.username === "string" ? user.username : undefined,
  };
}

function customerIdFrom(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value) return String(value.id);
  return null;
}

/** Stripe API 2025+ nests subscription on invoice.parent; keep legacy fallback. */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const nested = (
    invoice as Stripe.Invoice & {
      parent?: {
        subscription_details?: {
          subscription?: string | Stripe.Subscription | null;
        } | null;
      } | null;
    }
  ).parent?.subscription_details?.subscription;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (nested && typeof nested === "object" && "id" in nested) {
    return String(nested.id);
  }
  const legacy = (
    invoice as { subscription?: string | Stripe.Subscription | null }
  ).subscription;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    return String(legacy.id);
  }
  return null;
}

async function handleCompanySubscriptionCheckout(
  session: Stripe.Checkout.Session,
  eventId: string,
  eventCreatedUnix?: number | null
) {
  const metadata = (session.metadata || {}) as Record<string, string | undefined>;
  const claimedOrgId =
    metadata.orgId?.trim() ||
    (typeof session.client_reference_id === "string"
      ? session.client_reference_id.trim()
      : "");

  const customerId = customerIdFrom(session.customer);
  // Resolve tenant from our DB binding first — never trust metadata alone.
  const boundByCustomer = await findOrgIdByStripeCustomerId(customerId);
  const orgId = boundByCustomer || claimedOrgId;
  if (!orgId) {
    console.warn("[stripe webhook] company_subscription missing orgId");
    return { skipped: "missing_org" as const };
  }
  if (claimedOrgId && boundByCustomer && claimedOrgId !== boundByCustomer) {
    console.warn(
      "[stripe webhook] customer/org mismatch",
      customerId,
      claimedOrgId,
      boundByCustomer
    );
    return { skipped: "customer_mismatch" as const };
  }
  if (!boundByCustomer) {
    // Checkout must have created the Stripe customer on the org first.
    console.warn(
      "[stripe webhook] no org bound to Stripe customer",
      customerId,
      claimedOrgId
    );
    return { skipped: "unbound_customer" as const };
  }

  const subscriptionRef = session.subscription;
  const subscriptionId =
    typeof subscriptionRef === "string"
      ? subscriptionRef
      : subscriptionRef && typeof subscriptionRef === "object"
        ? String(subscriptionRef.id)
        : null;
  if (!subscriptionId) {
    return { skipped: "missing_subscription" as const };
  }

  const stripe = getStripe();
  const sub = await retrieveStripeSubscriptionForApply(subscriptionId);
  await applyStripeSubscriptionToOrg(
    orgId,
    sub,
    eventId,
    eventCreatedUnix ?? null
  );
  return { applied: true as const, orgId };
}

async function resolveOrgIdForSubscription(
  sub: StripeSubscriptionLike
): Promise<string | null> {
  // Prefer durable DB bindings over attacker-editable Stripe metadata.
  const bySub = await findOrgIdByStripeSubscriptionId(sub.id);
  if (bySub) return bySub;
  const byCustomer = await findOrgIdByStripeCustomerId(
    customerIdFrom(sub.customer)
  );
  if (byCustomer) return byCustomer;
  // Metadata alone is insufficient — refuse unresolved orgs.
  const fromMeta = sub.metadata?.orgId?.trim();
  if (fromMeta) {
    console.warn(
      "[stripe webhook] ignoring unbound subscription metadata orgId",
      fromMeta,
      sub.id
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  // ACCEPTED OPEN (Step 7.1): Stripe-Signature via verifyStripeWebhook — not JWT.
  const body = await req.text();
  const reqHeaders = await headers();
  const sig = reqHeaders.get("stripe-signature");

  if (!sig) {
    return badRequest("Missing stripe signature");
  }

  try {
    const event = verifyStripeWebhook(body, sig);

    if (event.type === "checkout.session.completed") {
      const sessionObj = event.data.object as { id?: string };
      const sessionId = sessionObj?.id;
      if (!sessionId) {
        return badRequest("Missing checkout session id");
      }

      await connectDB();
      const session = await getCheckoutSession(sessionId);
      const metadata = (session.metadata || {}) as Record<
        string,
        string | undefined
      >;

      // Company SaaS only — never swallow order/tailoring mode:payment settle.
      // Require explicit metadata.type (Checkout always sets company_subscription).
      // World A — never mutates OrganizationMarketplaceAccount.
      if (metadata.type === "company_subscription") {
        // Same gate as commerce: only activate when Checkout payment succeeded.
        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          return ok({
            received: true,
            companyBilling: { skipped: "not_paid" as const },
          });
        }
        const result = await handleCompanySubscriptionCheckout(
          session,
          event.id,
          event.created
        );
        return ok({ received: true, companyBilling: result });
      }

      if (session.payment_status !== "paid") {
        return ok({ received: true, skipped: "not_paid" });
      }

      // World B — marketplace Connect destination charge (never mutates SaaS cols).
      if (metadata.type === "marketplace_booking") {
        const { processMarketplaceCheckoutCompleted } = await import(
          "@/lib/marketplace/webhook"
        );
        const result = await processMarketplaceCheckoutCompleted(event, session);
        return ok({ received: true, marketplace: result });
      }

      // Venue booking Checkout — settle BookingPayment; never create shop Order.
      // Reload payment/booking from DB; do not trust metadata.orgId for auth.
      if (metadata.type === "pos_sale") {
        const rawPi = session.payment_intent;
        const pi =
          typeof rawPi === "string"
            ? rawPi
            : rawPi && typeof rawPi === "object" && "id" in rawPi
              ? String((rawPi as { id: string }).id)
              : null;
        if (!pi) {
          // Still try settle by Checkout session placeholder / posSaleId.
          const { settlePosSalePayment } = await import("@/lib/pos/webhook");
          const result = await settlePosSalePayment(`cs:${sessionId}`, {
            checkoutSessionId: sessionId,
            posSaleId: metadata.posSaleId,
          });
          return ok({ received: true, kind: "pos_sale", ...result });
        }
        const { settlePosSalePayment } = await import("@/lib/pos/webhook");
        const result = await settlePosSalePayment(pi, {
          checkoutSessionId: sessionId,
          posSaleId: metadata.posSaleId,
        });
        return ok({ received: true, kind: "pos_sale", ...result });
      }

      if (metadata.type === "pos_membership_subscription") {
        const { handleGuestMembershipStripeEvent } = await import(
          "@/lib/memberships/webhookGuest"
        );
        const guest = await handleGuestMembershipStripeEvent(event);
        return ok({
          received: true,
          kind: "pos_membership_subscription",
          guestMembership: guest,
        });
      }

      if (metadata.type === "accounting_invoice") {
        const invoiceId = metadata.invoiceId?.trim();
        const orgId = metadata.orgId?.trim();
        const rawPi = session.payment_intent;
        const pi =
          typeof rawPi === "string"
            ? rawPi
            : rawPi && typeof rawPi === "object" && "id" in rawPi
              ? String((rawPi as { id: string }).id)
              : null;
        if (!invoiceId || !orgId || !pi) {
          return badRequest("Missing accounting invoice payment metadata");
        }
        const amountMinor =
          typeof session.amount_total === "number" ? session.amount_total : 0;
        const connectedAccountId =
          metadata.connectedAccountId?.trim() ||
          (typeof session.transfer_data?.destination === "string"
            ? session.transfer_data.destination
            : null);
        await prisma.$transaction(async (tx) => {
          const { createReceiptFromStripe } = await import(
            "@/lib/accounting/receivables/customerReceipts"
          );
          await createReceiptFromStripe(tx, {
            orgId,
            invoiceId,
            paymentIntentId: pi,
            amountMinor,
            connectedAccountId,
          });
        });
        // Processor fee when charge is available on the PI.
        try {
          const stripe = getStripe();
          const intent = await stripe.paymentIntents.retrieve(pi, {
            expand: ["latest_charge.balance_transaction"],
          });
          const charge =
            intent.latest_charge && typeof intent.latest_charge === "object"
              ? intent.latest_charge
              : null;
          const bal =
            charge &&
            typeof charge.balance_transaction === "object" &&
            charge.balance_transaction
              ? charge.balance_transaction
              : null;
          if (bal && typeof bal === "object" && "id" in bal && "fee" in bal) {
            const feeMinor = Number((bal as { fee?: number }).fee ?? 0);
            if (feeMinor > 0) {
              const { queueAccountingSync } = await import(
                "@/lib/accounting/postingQueue"
              );
              await queueAccountingSync({
                orgId,
                locationId: metadata.locationId?.trim() || null,
                sourceType: "processor_fee",
                sourceId: String((bal as { id: string }).id),
                sourceEvent: "fee",
                payload: {
                  feeMinor,
                  connectedAccountId,
                  locationId: metadata.locationId?.trim() || null,
                  description: `Invoice ${invoiceId}`,
                },
              });
            }
          }
        } catch (feeErr) {
          console.warn("[stripe webhook] accounting_invoice fee capture skipped", feeErr);
        }
        return ok({ received: true, kind: "accounting_invoice", settled: true });
      }

      if (isVenueBookingPaymentType(metadata.type)) {
        const paymentId = metadata.paymentId?.trim();
        const bookingId = metadata.bookingId?.trim();
        if (!paymentId || !bookingId) {
          return badRequest("Missing booking payment metadata");
        }
        const { settleVenueBookingStripePayment } = await import(
          "@/lib/ticketing/payments"
        );
        const pi =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null;
        const result = await settleVenueBookingStripePayment({
          paymentId,
          bookingId,
          stripePaymentIntentId: pi,
          expectedOrgId: metadata.orgId ?? null,
        });
        return ok({
          received: true,
          settled: result.ok,
          kind: "venue_booking",
          idempotent: "idempotent" in result ? result.idempotent : false,
        });
      }

      const { type, uuid, orderId, jobId, reference } = metadata;
      if (!uuid) {
        return badRequest("Missing user from payment metadata");
      }

      const user = await getUserFromUuid(uuid);
      if (!user?.id) {
        return badRequest("Missing user from payment metadata");
      }

      const chargedAmount = (session.amount_total || 0) / 100;
      const paymentReference = String(reference || session.id);
      const settleUser = settleUserFromDoc(user);

      if (type === "tailoring") {
        if (!jobId) {
          return badRequest("Missing jobId in payment metadata");
        }
        const settled = await settleTailoringJobGatewayPayment({
          jobId: String(jobId),
          user: settleUser,
          chargedAmount,
          paymentReference,
          provider: "stripe",
        });

        if (!settled.ok) {
          console.error(
            "[stripe webhook] tailor settle failed:",
            settled.code,
            settled.message
          );
          if (
            settled.code === "wallet_error" ||
            settled.code === "not_found" ||
            settled.code === "amount_mismatch" ||
            settled.code === "invalid_status"
          ) {
            return serverError(settled.message);
          }
          return ok({
            received: true,
            settle: settled.code,
            message: settled.message,
          });
        }

        return ok({
          received: true,
          settled: true,
          kind: "tailoring",
          alreadyProcessed: settled.alreadyProcessed,
        });
      }

      if (type !== "order" || !orderId) {
        return ok({ received: true, skipped: "non_order" });
      }

      const settled = await settleOrderGatewayPayment({
        orderId: String(orderId),
        user: settleUser,
        chargedAmount,
        paymentReference,
        provider: "stripe",
      });

      if (!settled.ok) {
        console.error(
          "[stripe webhook] settle failed:",
          settled.code,
          settled.message
        );
        if (
          settled.code === "wallet_error" ||
          settled.code === "not_found"
        ) {
          return serverError(settled.message);
        }
        return ok({
          received: true,
          settle: settled.code,
          message: settled.message,
        });
      }

      return ok({
        received: true,
        settled: true,
        alreadyProcessed: settled.alreadyProcessed,
        fulfillmentError: settled.fulfillmentError,
      });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await connectDB();
      // World D — guest park memberships (never mutates Organization SaaS cols).
      {
        const { handleGuestMembershipStripeEvent } = await import(
          "@/lib/memberships/webhookGuest"
        );
        const guest = await handleGuestMembershipStripeEvent(event);
        if (guest.handled) {
          return ok({ received: true, guestMembership: guest.result });
        }
      }
      const sub = event.data.object as unknown as StripeSubscriptionLike;
      const orgId = await resolveOrgIdForSubscription(sub);
      if (!orgId) {
        return ok({ received: true, skipped: "unknown_customer" });
      }

      if (event.type === "customer.subscription.deleted") {
        // Only expire when this is the org's bound live subscription.
        const result = await expireIfBoundStripeSubscription(
          orgId,
          sub.id,
          `stripe_subscription_deleted:${event.id}`
        );
        return ok({
          received: true,
          companyBilling: result.expired ? "deleted" : "skipped_unbound",
        });
      }

      // canceled (before or without deleted) must suspend — not leave active+canceled.
      if (sub.status === "canceled") {
        const result = await expireIfBoundStripeSubscription(
          orgId,
          sub.id,
          `stripe_subscription_canceled:${event.id}`
        );
        return ok({
          received: true,
          companyBilling: result.expired ? "canceled" : "skipped_unbound",
        });
      }

      // Retrieve full subscription (event payloads can omit item period ends).
      const full = await retrieveStripeSubscriptionForApply(sub.id);
      await applyStripeSubscriptionToOrg(
        orgId,
        full,
        event.id,
        event.created
      );
      return ok({
        received: true,
        companyBilling:
          event.type === "customer.subscription.created" ? "created" : "updated",
      });
    }

    if (event.type === "invoice.payment_failed") {
      await connectDB();
      {
        const { handleGuestMembershipStripeEvent } = await import(
          "@/lib/memberships/webhookGuest"
        );
        const guest = await handleGuestMembershipStripeEvent(event);
        if (guest.handled) {
          return ok({ received: true, guestMembership: guest.result });
        }
      }
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) {
        return ok({ received: true, skipped: "no_subscription_on_invoice" });
      }
      // Resolve like invoice.paid (sub binding, then customer) so grace still
      // applies when binding lags first payment_failed. Reject sibling subs.
      const stripe = getStripe();
      const sub = await retrieveStripeSubscriptionForApply(subscriptionId);
      const orgId = await resolveOrgIdForSubscription(sub);
      if (!orgId) {
        return ok({ received: true, skipped: "unknown_customer" });
      }
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeSubscriptionId: true },
      });
      const bound = org?.stripeSubscriptionId?.trim() || "";
      if (bound && bound !== subscriptionId) {
        // Best-effort cancel orphan sibling (same rule as apply sibling skip).
        await bestEffortCancelStripeSubscription(subscriptionId);
        return ok({ received: true, skipped: "sibling_subscription" });
      }
      // Never adopt incomplete Checkout — that locks re-checkout and later
      // incomplete_expired would wrongfully suspend an otherwise-active org.
      if (
        !bound &&
        !isApplicableStripeSubscriptionStatus(String(sub.status || ""))
      ) {
        return ok({
          received: true,
          skipped: "non_applicable_subscription",
          status: sub.status,
        });
      }
      // Grace: past_due only — adopt binding when checkout apply lagged on a live sub.
      await markOrganizationPastDue(orgId, {
        adoptSubscriptionId: bound ? undefined : subscriptionId,
        stripeStatus: String(sub.status || ""),
      });
      return ok({ received: true, companyBilling: "past_due" });
    }

    // World B — Connect account flags (never touches SaaS subscription columns).
    if (event.type === "account.updated") {
      await connectDB();
      const { processMarketplaceAccountUpdated } = await import(
        "@/lib/marketplace/webhook"
      );
      const result = await processMarketplaceAccountUpdated(event);
      return ok({ received: true, marketplace: result });
    }

    if (event.type === "payment_intent.succeeded") {
      await connectDB();
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.type === "accounting_invoice") {
        const invoiceId = pi.metadata.invoiceId?.trim();
        const orgId = pi.metadata.orgId?.trim();
        if (!invoiceId || !orgId) {
          return badRequest("Missing accounting invoice metadata");
        }
        const prismaClient = (await import("@/lib/prisma")).default;
        const connectedAccountId =
          typeof pi.transfer_data?.destination === "string"
            ? pi.transfer_data.destination
            : null;
        await prismaClient.$transaction(async (tx) => {
          const { createReceiptFromStripe } = await import(
            "@/lib/accounting/receivables/customerReceipts"
          );
          await createReceiptFromStripe(tx, {
            orgId,
            invoiceId,
            paymentIntentId: pi.id,
            amountMinor: pi.amount_received || pi.amount || 0,
            connectedAccountId,
          });
        });
        return ok({ received: true, kind: "accounting_invoice", settled: true });
      }
      if (pi.metadata?.type === "pos_sale") {
        const { settlePosSalePayment } = await import("@/lib/pos/webhook");
        const result = await settlePosSalePayment(pi.id, {
          posSaleId: pi.metadata.posSaleId,
        });
        return ok({ received: true, kind: "pos_sale", ...result });
      }
      if (pi.metadata?.type === "pos_tab_preauth") {
        return ok({ received: true, kind: "pos_tab_preauth", authorized: true });
      }
      if (pi.metadata?.type === "pos_membership_subscription") {
        const { handleGuestMembershipStripeEvent } = await import(
          "@/lib/memberships/webhookGuest"
        );
        const guest = await handleGuestMembershipStripeEvent(event);
        return ok({
          received: true,
          kind: "pos_membership_subscription",
          guestMembership: guest,
        });
      }
    }

    if (
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.canceled"
    ) {
      await connectDB();
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.type === "marketplace_booking") {
        const { processMarketplacePaymentFailed } = await import(
          "@/lib/marketplace/webhook"
        );
        const result = await processMarketplacePaymentFailed(event, pi);
        return ok({ received: true, marketplace: result });
      }
      if (pi.metadata?.type === "pos_sale") {
        const { failPosSalePayment } = await import("@/lib/pos/webhook");
        const result = await failPosSalePayment(pi.id, {
          posSaleId: pi.metadata.posSaleId,
        });
        return ok({ received: true, kind: "pos_sale", failed: result });
      }
      if (isVenueBookingPaymentType(pi.metadata?.type)) {
        const { failVenueBookingStripePayment } = await import(
          "@/lib/ticketing/payments"
        );
        const result = await failVenueBookingStripePayment({
          paymentId: pi.metadata.paymentId,
          bookingId: pi.metadata.bookingId,
          stripePaymentIntentId: pi.id,
          reason: event.type,
          trustedSource: true,
        });
        return ok({
          received: true,
          kind: "venue_booking",
          failed: result.ok,
        });
      }
    }

    if (event.type === "checkout.session.expired") {
      await connectDB();
      const sessionObj = event.data.object as Stripe.Checkout.Session;
      if (sessionObj.metadata?.type === "marketplace_booking") {
        const { processMarketplaceCheckoutExpired } = await import(
          "@/lib/marketplace/webhook"
        );
        const result = await processMarketplaceCheckoutExpired(
          event,
          sessionObj
        );
        return ok({ received: true, marketplace: result });
      }
      if (sessionObj.metadata && isVenueBookingPaymentType(sessionObj.metadata.type)) {
        const { failVenueBookingStripePayment } = await import(
          "@/lib/ticketing/payments"
        );
        const pi =
          typeof sessionObj.payment_intent === "string"
            ? sessionObj.payment_intent
            : sessionObj.payment_intent &&
                typeof sessionObj.payment_intent === "object"
              ? sessionObj.payment_intent.id
              : null;
        const result = await failVenueBookingStripePayment({
          paymentId: sessionObj.metadata.paymentId,
          bookingId: sessionObj.metadata.bookingId,
          stripePaymentIntentId: pi,
          reason: "checkout.session.expired",
          trustedSource: true,
        });
        return ok({
          received: true,
          kind: "venue_booking",
          expired: result.ok,
        });
      }
      // POS payment-link Checkout Session expired — mark pending cs: row failed
      // (same fail helper as payment_intent.canceled; skips completed/cancelled).
      if (sessionObj.metadata?.type === "pos_sale") {
        const { failPosSalePayment } = await import("@/lib/pos/webhook");
        const result = await failPosSalePayment(`cs:${sessionObj.id}`, {
          posSaleId: sessionObj.metadata.posSaleId,
        });
        return ok({ received: true, kind: "pos_sale", expired: result });
      }
    }

    if (event.type === "charge.dispute.created") {
      await connectDB();
      const dispute = event.data.object as Stripe.Dispute;
      const { processMarketplaceDisputeCreated } = await import(
        "@/lib/marketplace/webhook"
      );
      const result = await processMarketplaceDisputeCreated(event, dispute);
      // Only short-circuit when this dispute belongs to a marketplace booking.
      // Ignored results fall through so venue/order disputes stay ACK'd the same
      // way they were before marketplace (and remain available for future handlers).
      if (!String(result.result || "").startsWith("ignored:")) {
        return ok({ received: true, marketplace: result });
      }
    }

    if (
      event.type === "charge.refunded" ||
      event.type === "charge.refund.updated"
    ) {
      await connectDB();
      const charge = event.data.object as Stripe.Charge;
      const prevAttrs = (
        event.data as {
          previous_attributes?: { amount_refunded?: number };
        }
      ).previous_attributes;
      const meta = (charge.metadata || {}) as Record<
        string,
        string | undefined
      >;
      const pi =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent && typeof charge.payment_intent === "object"
            ? charge.payment_intent.id
            : null;
      const prismaClient = (await import("@/lib/prisma")).default;

      // Marketplace refund ledger first when booking exists for this PI.
      if (pi) {
        const mktBooking = await prismaClient.marketplaceBooking.findFirst({
          where: { stripePaymentIntentId: pi },
          select: { id: true },
        });
        if (mktBooking) {
          const { processMarketplaceChargeRefunded } = await import(
            "@/lib/marketplace/webhook"
          );
          const result = await processMarketplaceChargeRefunded(event, charge);
          return ok({ received: true, marketplace: result });
        }

        const acctReceipt = await prismaClient.customerReceipt.findUnique({
          where: { stripePaymentIntentId: pi },
          select: { id: true, orgId: true },
        });
        if (acctReceipt) {
          const currCents = charge.amount_refunded ?? 0;
          const fullyRefunded = Boolean(charge.refunded);
          await prismaClient.$transaction(async (tx) => {
            const { applyStripeInvoiceRefund } = await import(
              "@/lib/accounting/receivables/customerReceipts"
            );
            await applyStripeInvoiceRefund(tx, {
              orgId: acctReceipt.orgId,
              paymentIntentId: pi,
              amountRefundedMinor: currCents,
              fullyRefunded,
            });
          });
          return ok({
            received: true,
            kind: "accounting_invoice",
            refunded: true,
          });
        }
      }

      if (meta.type === "accounting_invoice" && pi) {
        const orgId = meta.orgId?.trim();
        if (orgId) {
          const currCents = charge.amount_refunded ?? 0;
          const fully = currCents >= (charge.amount ?? 0) && (charge.amount ?? 0) > 0;
          await prisma.$transaction(async (tx) => {
            const { applyStripeInvoiceRefund } = await import(
              "@/lib/accounting/receivables/customerReceipts"
            );
            await applyStripeInvoiceRefund(tx, {
              orgId,
              paymentIntentId: pi,
              amountRefundedMinor: currCents,
              fullyRefunded: fully,
            });
          });
          return ok({
            received: true,
            kind: "accounting_invoice",
            refunded: true,
            fully,
          });
        }
      }

      const linkedPayment =
        isVenueBookingPaymentType(meta.type)
          ? true
          : pi
            ? await prismaClient.bookingPayment.findFirst({
                where: { stripePaymentIntentId: pi },
                select: { id: true },
              })
            : null;
      // Never treat bare metadata.paymentId as venue — shop/order charges may use that key.
      if (linkedPayment) {
        const { applyVenueBookingStripeRefundEvent } = await import(
          "@/lib/ticketing/refunds"
        );
        // amount_refunded is cumulative — only apply the delta vs previous_attributes.
        const currCents = charge.amount_refunded ?? 0;
        const prevCents = prevAttrs?.amount_refunded ?? 0;
        const deltaCents = Math.max(0, currCents - prevCents);
        const result = await applyVenueBookingStripeRefundEvent({
          paymentId: meta.paymentId,
          bookingId: meta.bookingId,
          stripePaymentIntentId: pi,
          stripeChargeId: charge.id,
          amount: deltaCents > 0 ? deltaCents / 100 : null,
          cumulativeRefunded: currCents / 100,
          reason: event.type,
        });
        return ok({
          received: true,
          kind: "venue_booking",
          refunded: result.ok,
          idempotent: "idempotent" in result ? result.idempotent : false,
        });
      }
    }

    if (event.type === "invoice.paid") {
      await connectDB();
      {
        const { handleGuestMembershipStripeEvent } = await import(
          "@/lib/memberships/webhookGuest"
        );
        const guest = await handleGuestMembershipStripeEvent(event);
        if (guest.handled) {
          return ok({ received: true, guestMembership: guest.result });
        }
      }
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) {
        return ok({ received: true, skipped: "no_subscription_on_invoice" });
      }
      const sub = await retrieveStripeSubscriptionForApply(subscriptionId);
      const orgId = await resolveOrgIdForSubscription(sub);
      if (!orgId) {
        return ok({ received: true, skipped: "unknown_customer" });
      }
      await applyStripeSubscriptionToOrg(orgId, sub, event.id, event.created);
      return ok({ received: true, companyBilling: "invoice_paid" });
    }

    if (event.type === "setup_intent.succeeded") {
      await connectDB();
      const { handleGuestMembershipStripeEvent } = await import(
        "@/lib/memberships/webhookGuest"
      );
      const guest = await handleGuestMembershipStripeEvent(event);
      if (guest.handled) {
        return ok({ received: true, guestMembership: guest.result });
      }
    }

    return ok({ received: true });
  } catch (err) {
    // Signature / poison payload → 400 (no retry). Transient Stripe/DB → 5xx (retry).
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Invalid webhook signature") ||
      message.includes("Missing STRIPE_WEBHOOK_SECRET")
    ) {
      return badRequest(`Webhook Error: ${message}`);
    }
    if (isAuthHttpError(err) || err instanceof ForbiddenError) {
      // ACK only known company-billing business skips — never regex-match
      // generic words like "customer"/"checkout" that commerce settle might use.
      if (isCompanyBillingWebhookSkipError(err)) {
        console.warn("[stripe webhook] skipped authz:", message);
        return ok({ received: true, skipped: "forbidden", message });
      }
      console.error("[stripe webhook] unexpected authz:", message);
      return serverError(`Webhook processing failed: ${message}`);
    }
    if (
      err instanceof CompanyBillingConfigError ||
      (typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "CompanyBillingConfigError")
    ) {
      console.error("[stripe webhook] billing config:", message);
      return serverError(message);
    }
    console.error("[stripe webhook] processing failure:", err);
    return serverError(`Webhook processing failed: ${message}`);
  }
}
