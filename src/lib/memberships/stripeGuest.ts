/**
 * Guest Stripe helpers (World D — guest memberships).
 * NEVER touch Organization.stripeCustomerId / stripeSubscriptionId.
 */
import type Stripe from "stripe";
import { getStripe, CompanyBillingConfigError } from "@/lib/stripe";
import {
  MembershipBillingError,
  MembershipErrorCodes,
} from "@/lib/memberships/errors";
import { stripeIntervalFromUnit } from "@/lib/memberships/cycles";
import type { MembershipIntervalUnit } from "@prisma/client";

export const GUEST_MEMBERSHIP_META_TYPE = "guest_membership_subscription";

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function requireStripeOrThrow(): Stripe {
  try {
    return getStripe();
  } catch (err) {
    if (err instanceof CompanyBillingConfigError) {
      throw new MembershipBillingError(
        MembershipErrorCodes.STRIPE_NOT_CONFIGURED,
        "STRIPE_SECRET_KEY is not configured — use collected/pending payment path"
      );
    }
    throw err;
  }
}

export async function ensureGuestStripeCustomer(input: {
  guestProfileId: string;
  email: string | null;
  name: string;
  existingCustomerId: string | null;
  orgId: string;
}): Promise<string> {
  const stripe = requireStripeOrThrow();
  if (input.existingCustomerId?.trim()) {
    return input.existingCustomerId.trim();
  }
  const customer = await stripe.customers.create({
    email: input.email ?? undefined,
    name: input.name,
    metadata: {
      type: GUEST_MEMBERSHIP_META_TYPE,
      orgId: input.orgId,
      guestProfileId: input.guestProfileId,
    },
  });
  return customer.id;
}

export async function createGuestStripeSubscription(input: {
  customerId: string;
  orgId: string;
  guestMembershipId: string;
  guestProfileId: string;
  planId: string;
  /** Park stamp from MembershipPlan.locationId (server). */
  locationId?: string | null;
  currency: string;
  /** Major units */
  priceMajor: number;
  intervalCount: number;
  intervalUnit: MembershipIntervalUnit;
  idempotencyKey: string;
}): Promise<{
  subscriptionId: string;
  priceId: string;
  status: string;
  connectedAccountId: string | null;
  platformFeeMinor: number | null;
}> {
  const stripe = requireStripeOrThrow();
  const unitAmount = Math.round(input.priceMajor * 100);
  if (unitAmount < 0) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PAYMENT_FAILED,
      "Invalid price for Stripe subscription"
    );
  }

  // Franchise park plans fail closed until park Connect is ready.
  // Non-franchise / null location: org Connect when ready, else platform.
  let connectedAccountId: string | null = null;
  let applicationFeePercent: number | undefined;
  let platformFeeMinor: number | null = null;
  let settlementLocationId: string | null = input.locationId?.trim() || null;
  {
    const { resolveGuestPayoutDestination } = await import(
      "@/lib/marketplace/guestPayoutDestination"
    );
    const { computePlatformFeeMinor, getDefaultPlatformFeeBps } = await import(
      "@/lib/marketplace/fees"
    );
    const prisma = (await import("@/lib/prisma")).default;
    if (!settlementLocationId && input.planId) {
      const plan = await prisma.membershipPlan.findFirst({
        where: { id: input.planId, orgId: input.orgId },
        select: { locationId: true },
      });
      settlementLocationId = plan?.locationId ?? null;
    }
    const venue = settlementLocationId
      ? await prisma.venueLocation.findFirst({
          where: { id: settlementLocationId, orgId: input.orgId },
          select: { isFranchise: true },
        })
      : null;

    const applyDest = (dest: {
      connectedAccountId: string;
      platformFeeBpsOverride: number | null;
    }) => {
      connectedAccountId = dest.connectedAccountId;
      const bps =
        dest.platformFeeBpsOverride != null
          ? dest.platformFeeBpsOverride
          : getDefaultPlatformFeeBps();
      applicationFeePercent = Math.min(99, Math.max(0, bps / 100));
      platformFeeMinor = computePlatformFeeMinor({
        amountMinor: unitAmount,
        platformFeeBpsOverride: dest.platformFeeBpsOverride,
      });
    };

    if (venue?.isFranchise) {
      try {
        applyDest(
          await resolveGuestPayoutDestination({
            orgId: input.orgId,
            locationId: settlementLocationId,
          })
        );
      } catch (err) {
        const { ForbiddenError } = await import("@/lib/auth/http-error");
        throw new MembershipBillingError(
          MembershipErrorCodes.PAYMENT_FAILED,
          err instanceof ForbiddenError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Park payouts onboarding is required"
        );
      }
    } else {
      try {
        applyDest(
          await resolveGuestPayoutDestination({
            orgId: input.orgId,
            locationId: settlementLocationId,
          })
        );
      } catch {
        // Platform subscription (legacy World C) when org Connect not ready.
      }
    }
  }

  const price = await stripe.prices.create(
    {
      currency: input.currency.toLowerCase(),
      unit_amount: unitAmount,
      recurring: {
        interval: stripeIntervalFromUnit(input.intervalUnit),
        interval_count: input.intervalCount,
      },
      product_data: {
        name: `Membership plan ${input.planId}`,
        metadata: {
          type: GUEST_MEMBERSHIP_META_TYPE,
          orgId: input.orgId,
          planId: input.planId,
          ...(settlementLocationId
            ? { locationId: settlementLocationId }
            : {}),
        },
      },
      metadata: {
        type: GUEST_MEMBERSHIP_META_TYPE,
        orgId: input.orgId,
        planId: input.planId,
        ...(settlementLocationId ? { locationId: settlementLocationId } : {}),
      },
    },
    { idempotencyKey: `${input.idempotencyKey}:price` }
  );

  const subParams: import("stripe").Stripe.SubscriptionCreateParams = {
    customer: input.customerId,
    items: [{ price: price.id }],
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      type: GUEST_MEMBERSHIP_META_TYPE,
      orgId: input.orgId,
      guestMembershipId: input.guestMembershipId,
      guestProfileId: input.guestProfileId,
      planId: input.planId,
      ...(settlementLocationId ? { locationId: settlementLocationId } : {}),
      ...(connectedAccountId ? { connectedAccountId } : {}),
    },
  };
  if (connectedAccountId && applicationFeePercent != null) {
    subParams.transfer_data = { destination: connectedAccountId };
    subParams.application_fee_percent = applicationFeePercent;
  }

  const sub = await stripe.subscriptions.create(subParams, {
    idempotencyKey: `${input.idempotencyKey}:sub`,
  });

  return {
    subscriptionId: sub.id,
    priceId: price.id,
    status: sub.status,
    connectedAccountId,
    platformFeeMinor,
  };
}

export async function pauseGuestStripeSubscription(
  subscriptionId: string
): Promise<void> {
  const stripe = requireStripeOrThrow();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: { behavior: "keep_as_draft" },
  });
}

export async function resumeGuestStripeSubscription(
  subscriptionId: string
): Promise<void> {
  const stripe = requireStripeOrThrow();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: null as unknown as Stripe.SubscriptionUpdateParams.PauseCollection,
  });
}

export async function cancelGuestStripeSubscription(input: {
  subscriptionId: string;
  when: "immediate" | "end_of_period";
}): Promise<void> {
  const stripe = requireStripeOrThrow();
  if (input.when === "end_of_period") {
    await stripe.subscriptions.update(input.subscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    await stripe.subscriptions.cancel(input.subscriptionId);
  }
}

/**
 * Retarget a live guest Stripe Subscription to a new plan price (upgrade/downgrade).
 * Creates a Price then swaps the subscription item. Proration is handled in-app
 * (one-time invoice / creditBalance) — Stripe proration is disabled here.
 */
export async function changeGuestStripeSubscriptionPrice(input: {
  subscriptionId: string;
  orgId: string;
  guestMembershipId: string;
  planId: string;
  currency: string;
  priceMajor: number;
  intervalCount: number;
  intervalUnit: MembershipIntervalUnit;
  idempotencyKey: string;
}): Promise<{ priceId: string }> {
  const stripe = requireStripeOrThrow();
  const unitAmount = Math.round(input.priceMajor * 100);
  if (unitAmount < 0) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PAYMENT_FAILED,
      "Invalid price for Stripe subscription"
    );
  }

  const price = await stripe.prices.create(
    {
      currency: input.currency.toLowerCase(),
      unit_amount: unitAmount,
      recurring: {
        interval: stripeIntervalFromUnit(input.intervalUnit),
        interval_count: input.intervalCount,
      },
      product_data: {
        name: `Membership plan ${input.planId}`,
        metadata: {
          type: GUEST_MEMBERSHIP_META_TYPE,
          orgId: input.orgId,
          planId: input.planId,
        },
      },
      metadata: {
        type: GUEST_MEMBERSHIP_META_TYPE,
        orgId: input.orgId,
        planId: input.planId,
      },
    },
    { idempotencyKey: `${input.idempotencyKey}:price` }
  );

  const sub = await stripe.subscriptions.retrieve(input.subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) {
    throw new MembershipBillingError(
      MembershipErrorCodes.PAYMENT_FAILED,
      "Stripe subscription has no items to retarget"
    );
  }

  await stripe.subscriptions.update(
    input.subscriptionId,
    {
      items: [{ id: itemId, price: price.id }],
      proration_behavior: "none",
      metadata: {
        type: GUEST_MEMBERSHIP_META_TYPE,
        orgId: input.orgId,
        guestMembershipId: input.guestMembershipId,
        planId: input.planId,
      },
    },
    { idempotencyKey: `${input.idempotencyKey}:sub_price` }
  );

  return { priceId: price.id };
}

export async function createGuestSetupIntent(input: {
  customerId: string;
  orgId: string;
  guestMembershipId: string;
}): Promise<{ clientSecret: string | null; setupIntentId: string }> {
  const stripe = requireStripeOrThrow();
  const si = await stripe.setupIntents.create({
    customer: input.customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      type: GUEST_MEMBERSHIP_META_TYPE,
      orgId: input.orgId,
      guestMembershipId: input.guestMembershipId,
    },
  });
  return { clientSecret: si.client_secret, setupIntentId: si.id };
}

export async function setGuestDefaultPaymentMethod(input: {
  customerId: string;
  paymentMethodId: string;
  /** When set, also stamp the live guest Stripe Subscription default PM. */
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  const stripe = requireStripeOrThrow();
  // Attach first, then set as default (Stripe rejects default of unattached PM).
  try {
    await stripe.paymentMethods.attach(input.paymentMethodId, {
      customer: input.customerId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already been attached|resource_already_exists/i.test(msg)) {
      throw err;
    }
  }
  await stripe.customers.update(input.customerId, {
    invoice_settings: {
      default_payment_method: input.paymentMethodId,
    },
  });
  const subId = input.stripeSubscriptionId?.trim();
  if (subId) {
    try {
      await stripe.subscriptions.update(subId, {
        default_payment_method: input.paymentMethodId,
      });
    } catch (err) {
      console.warn(
        "[memberships] subscription default_payment_method update failed",
        err
      );
    }
  }
}

export async function createGuestOneTimeInvoiceItem(input: {
  customerId: string;
  currency: string;
  amountMajor: number;
  description: string;
  orgId: string;
  guestMembershipId: string;
  /** Park stamp from MembershipPlan.locationId (server). */
  locationId?: string | null;
  planId?: string | null;
  /** Stable key — required for renew/upgrade/reactivate retries */
  idempotencyKey?: string;
}): Promise<{
  invoiceId: string;
  paid: boolean;
  connectedAccountId: string | null;
  platformFeeMinor: number | null;
  locationId: string | null;
}> {
  const stripe = requireStripeOrThrow();
  const amount = Math.round(input.amountMajor * 100);
  if (amount <= 0) {
    return {
      invoiceId: "",
      paid: true,
      connectedAccountId: null,
      platformFeeMinor: null,
      locationId: input.locationId?.trim() || null,
    };
  }

  // Same park/org Connect routing as recurring guest subs (fail closed for franchise).
  let connectedAccountId: string | null = null;
  let platformFeeMinor: number | null = null;
  let settlementLocationId: string | null = input.locationId?.trim() || null;
  {
    const { resolveGuestPayoutDestination } = await import(
      "@/lib/marketplace/guestPayoutDestination"
    );
    const { computePlatformFeeMinor } = await import("@/lib/marketplace/fees");
    const prisma = (await import("@/lib/prisma")).default;
    if (!settlementLocationId && input.planId) {
      const plan = await prisma.membershipPlan.findFirst({
        where: { id: input.planId, orgId: input.orgId },
        select: { locationId: true },
      });
      settlementLocationId = plan?.locationId ?? null;
    }
    if (!settlementLocationId && input.guestMembershipId) {
      const member = await prisma.guestMembership.findFirst({
        where: { id: input.guestMembershipId, orgId: input.orgId },
        select: { locationId: true, homeLocationId: true, planId: true },
      });
      if (member?.planId) {
        const plan = await prisma.membershipPlan.findFirst({
          where: { id: member.planId, orgId: input.orgId },
          select: { locationId: true },
        });
        settlementLocationId =
          plan?.locationId ?? member.homeLocationId ?? member.locationId ?? null;
      }
    }
    const venue = settlementLocationId
      ? await prisma.venueLocation.findFirst({
          where: { id: settlementLocationId, orgId: input.orgId },
          select: { isFranchise: true },
        })
      : null;

    try {
      const dest = await resolveGuestPayoutDestination({
        orgId: input.orgId,
        locationId: settlementLocationId,
      });
      connectedAccountId = dest.connectedAccountId;
      platformFeeMinor = computePlatformFeeMinor({
        amountMinor: amount,
        platformFeeBpsOverride: dest.platformFeeBpsOverride,
      });
    } catch (err) {
      if (venue?.isFranchise) {
        const { ForbiddenError } = await import("@/lib/auth/http-error");
        throw new MembershipBillingError(
          MembershipErrorCodes.PAYMENT_FAILED,
          err instanceof ForbiddenError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Park payouts onboarding is required"
        );
      }
      // Non-franchise: platform invoice when org Connect not ready.
    }
  }

  const idem = input.idempotencyKey?.trim().slice(0, 100);
  const meta: Record<string, string> = {
    type: GUEST_MEMBERSHIP_META_TYPE,
    orgId: input.orgId,
    guestMembershipId: input.guestMembershipId,
    ...(settlementLocationId ? { locationId: settlementLocationId } : {}),
    ...(connectedAccountId ? { connectedAccountId } : {}),
  };
  await stripe.invoiceItems.create(
    {
      customer: input.customerId,
      currency: input.currency.toLowerCase(),
      amount,
      description: input.description,
      metadata: meta,
    },
    idem ? { idempotencyKey: `${idem}:item` } : undefined
  );
  const invParams: import("stripe").Stripe.InvoiceCreateParams = {
    customer: input.customerId,
    auto_advance: true,
    collection_method: "charge_automatically",
    metadata: meta,
  };
  if (connectedAccountId && platformFeeMinor != null) {
    invParams.transfer_data = { destination: connectedAccountId };
    invParams.application_fee_amount = platformFeeMinor;
  }
  const invoice = await stripe.invoices.create(
    invParams,
    idem ? { idempotencyKey: `${idem}:inv` } : undefined
  );
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  let paid = finalized.status === "paid";
  if (!paid) {
    try {
      const paidInv = await stripe.invoices.pay(finalized.id);
      paid = paidInv.status === "paid";
    } catch {
      paid = false;
    }
  }
  return {
    invoiceId: finalized.id,
    paid,
    connectedAccountId,
    platformFeeMinor,
    locationId: settlementLocationId,
  };
}
