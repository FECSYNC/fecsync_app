/**
 * Marketplace Stripe webhook processors (World B).
 *
 * SEPARATION RULES:
 * - account.updated / marketplace_booking events MUST NOT mutate
 *   Organization.stripeCustomerId, stripeSubscriptionId, or subscription* fields.
 * - company_subscription / invoice / customer.subscription.* handlers MUST NOT
 *   mutate OrganizationMarketplaceAccount.
 */

import type Stripe from "stripe";
import prisma from "@/lib/prisma";
import {
  findOrgIdByConnectedAccountId,
  syncMarketplaceAccountFromStripe,
} from "@/lib/marketplace/account";
import {
  findParkLocationByConnectedAccountId,
  syncParkMarketplaceAccountFromStripe,
} from "@/lib/marketplace/parkAccount";
import { getStripe } from "@/lib/stripe";
import { createNotification } from "@/services/notificationService";
import { resolveBrandForOrg } from "@/lib/companyProfile";
import { getStorefrontOrgId } from "@/lib/org";
import {
  notificationTransporter,
  wrapEmailHtml,
  brandSmtpReplyTo,
} from "@/lib/mailer";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

type ProcessResult = {
  result: string;
  orgId?: string;
  bookingId?: string;
  locationId?: string;
  duplicate?: boolean;
};

/**
 * Resolve Connect account → org (company) or park location.
 * Prefer durable DB binding. Metadata is only a race fallback.
 */
async function resolveConnectAccountBinding(
  account: Stripe.Account
): Promise<
  | { kind: "org"; orgId: string }
  | { kind: "park"; orgId: string; locationId: string }
  | null
> {
  const parkByAcct = await findParkLocationByConnectedAccountId(account.id);
  if (parkByAcct) {
    return {
      kind: "park",
      orgId: parkByAcct.orgId,
      locationId: parkByAcct.locationId,
    };
  }

  const byAcct = await findOrgIdByConnectedAccountId(account.id);
  if (byAcct) return { kind: "org", orgId: byAcct };

  const metaType = account.metadata?.type?.trim() || "";
  const metaOrg = account.metadata?.orgId?.trim() || "";
  const metaLoc = account.metadata?.locationId?.trim() || "";
  if (!metaOrg) return null;

  const storefrontId = await getStorefrontOrgId();
  if (metaOrg === storefrontId) {
    console.warn(
      "[marketplace webhook] refusing Connect metadata on storefront org"
    );
    return null;
  }

  const org = await prisma.organization.findUnique({
    where: { id: metaOrg },
    select: { id: true, isDefault: true },
  });
  if (!org || org.isDefault) return null;

  if (metaType === "park_marketplace_connect" && metaLoc) {
    const venue = await prisma.venueLocation.findFirst({
      where: { id: metaLoc, orgId: metaOrg, isFranchise: true },
      select: { id: true },
    });
    if (!venue) return null;
    const existingPark = await prisma.venueLocationMarketplaceAccount.findUnique(
      {
        where: { locationId: metaLoc },
        select: { stripeConnectedAccountId: true },
      }
    );
    const boundPark = existingPark?.stripeConnectedAccountId?.trim() || "";
    if (boundPark && boundPark !== account.id) {
      console.warn(
        "[marketplace webhook] park Connect metadata mismatches bound account",
        { metaLoc, accountId: account.id }
      );
      return null;
    }
    return { kind: "park", orgId: metaOrg, locationId: metaLoc };
  }

  const existing = await prisma.organizationMarketplaceAccount.findUnique({
    where: { orgId: metaOrg },
    select: { stripeConnectedAccountId: true },
  });
  const bound = existing?.stripeConnectedAccountId?.trim() || "";
  if (bound && bound !== account.id) {
    console.warn(
      "[marketplace webhook] Connect metadata orgId mismatches bound account",
      { metaOrg, accountId: account.id }
    );
    return null;
  }
  return { kind: "org", orgId: metaOrg };
}

function redactStripeObject(obj: unknown): unknown {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(redactStripeObject);
  if (typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (
      key.includes("number") ||
      key.includes("cvc") ||
      key.includes("secret") ||
      key.includes("account_number") ||
      key.includes("routing")
    ) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = redactStripeObject(v);
  }
  return out;
}

/**
 * Insert MarketplacePaymentEvent by unique providerEventId.
 * Returns null when already successfully processed (or intentionally ignored).
 * Reclaims stuck `processing` / `error:*` rows so Stripe retries can settle.
 */
async function beginMarketplaceEvent(opts: {
  providerEventId: string;
  type: string;
  orgId: string;
  bookingId?: string | null;
  payload: unknown;
}): Promise<{ id: string } | null> {
  try {
    const row = await prisma.marketplacePaymentEvent.create({
      data: {
        providerEventId: opts.providerEventId,
        type: opts.type,
        orgId: opts.orgId,
        bookingId: opts.bookingId ?? null,
        payloadRedacted: redactStripeObject(opts.payload) as object,
        processingResult: "processing",
      },
      select: { id: true },
    });
    return row;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.marketplacePaymentEvent.findUnique({
        where: { providerEventId: opts.providerEventId },
        select: { id: true, processingResult: true },
      });
      if (!existing) return null;
      const result = existing.processingResult || "";
      if (result.startsWith("ok")) {
        return null;
      }
      // Do not replay intentional ignores — only crash/error mid-flight.
      if (result !== "processing" && !result.startsWith("error:")) {
        return null;
      }
      const claimed = await prisma.marketplacePaymentEvent.updateMany({
        where: {
          id: existing.id,
          OR: [
            { processingResult: "processing" },
            { processingResult: { startsWith: "error:" } },
          ],
        },
        data: {
          processingResult: "processing",
          payloadRedacted: redactStripeObject(opts.payload) as object,
          bookingId: opts.bookingId ?? undefined,
        },
      });
      if (claimed.count === 0) return null;
      return { id: existing.id };
    }
    throw err;
  }
}

async function finishMarketplaceEvent(
  eventRowId: string,
  processingResult: string,
  meta?: { orgId?: string; bookingId?: string; eventId?: string; type?: string }
) {
  await prisma.marketplacePaymentEvent.update({
    where: { id: eventRowId },
    data: { processingResult },
  });
  console.info("[marketplace webhook]", {
    eventId: meta?.eventId ?? null,
    type: meta?.type ?? null,
    orgId: meta?.orgId ?? null,
    bookingId: meta?.bookingId ?? null,
    result: processingResult,
  });
}

async function notifyOrgAdmins(opts: {
  orgId: string;
  title: string;
  message: string;
  kind: "marketplace_payouts" | "marketplace_booking";
  bookingId?: string;
}) {
  const href =
    opts.kind === "marketplace_payouts"
      ? "/admin/payouts"
      : "/admin/booking-packages";
  const admins = await prisma.membership.findMany({
    where: {
      orgId: opts.orgId,
      status: "active",
      rolePreset: "platform_admin",
    },
    select: { userId: true },
  });
  await Promise.all(
    admins.map((m) =>
      createNotification(m.userId, opts.title, opts.message, "alert", {
        kind: opts.kind,
        bookingId: opts.bookingId,
        orgId: opts.orgId,
        href,
      }).catch(() => undefined)
    )
  );
}

async function emailCompanySupport(opts: {
  orgId: string;
  subject: string;
  htmlBody: string;
}) {
  const profile = await prisma.companyProfile.findUnique({
    where: { orgId: opts.orgId },
    select: { billingEmail: true, supportEmail: true },
  });
  const to =
    profile?.billingEmail?.trim() ||
    profile?.supportEmail?.trim() ||
    process.env.COMPANY_OPS_ALERT_EMAIL?.trim() ||
    "";
  if (!to) return;
  const brand = await resolveBrandForOrg(opts.orgId);
  const fromUser = process.env.NOTIFICATION_EMAIL_USER?.trim();
  if (!fromUser) return;
  const replyTo = brandSmtpReplyTo(brand);
  try {
    await notificationTransporter.sendMail({
      from: `"${brand.displayName}" <${fromUser}>`,
      to,
      subject: opts.subject,
      html: wrapEmailHtml(opts.htmlBody, opts.subject, brand),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    console.warn(
      "[marketplace webhook] email failed",
      opts.orgId,
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function sendMarketplaceBookingReceipt(bookingId: string) {
  const booking = await prisma.marketplaceBooking.findUnique({
    where: { id: bookingId },
    include: { package: true },
  });
  if (!booking || booking.status !== "paid") return;
  const brand = await resolveBrandForOrg(booking.orgId);
  const fromUser = process.env.NOTIFICATION_EMAIL_USER?.trim();
  if (!fromUser) return;
  const amount = (booking.amountMinor / 100).toFixed(2);
  const html = `
    <p>Hi${booking.customerName ? ` ${booking.customerName}` : ""},</p>
    <p>Your booking for <strong>${booking.package.title}</strong> is confirmed.</p>
    <p>Amount: ${amount} ${booking.currency.toUpperCase()}</p>
    <p>Reference: ${booking.id.slice(-8).toUpperCase()}</p>
    ${brand.receiptFooterNote ? `<p>${brand.receiptFooterNote}</p>` : ""}
  `;
  const replyTo = brandSmtpReplyTo(brand);
  try {
    await notificationTransporter.sendMail({
      from: `"${brand.displayName}" <${fromUser}>`,
      to: booking.customerEmail,
      subject: `Booking confirmed — ${booking.package.title}`,
      html: wrapEmailHtml(
        html,
        `Booking confirmed — ${booking.package.title}`,
        brand
      ),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    console.warn(
      "[marketplace] receipt email failed",
      booking.id,
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function processMarketplaceAccountUpdated(
  event: Stripe.Event
): Promise<ProcessResult> {
  const account = event.data.object as Stripe.Account;
  const binding = await resolveConnectAccountBinding(account);
  if (!binding) {
    return { result: "ignored:no_org" };
  }

  const orgId = binding.orgId;
  // Never touch SaaS subscription columns.
  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId,
    payload: {
      id: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements: account.requirements,
      kind: binding.kind,
      ...(binding.kind === "park" ? { locationId: binding.locationId } : {}),
    },
  });
  if (!eventRow) {
    return {
      result: "ignored:duplicate",
      duplicate: true,
      orgId,
      ...(binding.kind === "park" ? { locationId: binding.locationId } : {}),
    };
  }

  try {
    const stripe = getStripe();
    const full = await stripe.accounts.retrieve(account.id, {
      expand: ["external_accounts"],
    });

    if (binding.kind === "park") {
      const synced = await syncParkMarketplaceAccountFromStripe(
        binding.locationId,
        full
      );
      if (synced.onboardingStatus === "complete") {
        await notifyOrgAdmins({
          orgId,
          title: "Park payouts ready",
          message:
            "Franchise park Stripe Connect onboarding is complete. Guests can pay that park online.",
          kind: "marketplace_payouts",
        });
      } else if (synced.onboardingStatus === "restricted") {
        await notifyOrgAdmins({
          orgId,
          title: "Park payouts restricted",
          message:
            "Stripe reported additional requirements for a franchise park payouts account. Open /admin/payouts.",
          kind: "marketplace_payouts",
        });
      }
      await finishMarketplaceEvent(eventRow.id, "ok", {
        orgId,
        eventId: event.id,
        type: event.type,
      });
      return { result: "ok", orgId, locationId: binding.locationId };
    }

    const synced = await syncMarketplaceAccountFromStripe(orgId, full);
    if (synced.onboardingStatus === "complete") {
      await notifyOrgAdmins({
        orgId,
        title: "Payouts ready",
        message:
          "Stripe Connect onboarding is complete. You can accept online booking package payments.",
        kind: "marketplace_payouts",
      });
    } else if (synced.onboardingStatus === "restricted") {
      await notifyOrgAdmins({
        orgId,
        title: "Payouts restricted",
        message:
          "Stripe reported additional requirements for your payouts account. Open /admin/payouts to continue.",
        kind: "marketplace_payouts",
      });
    }
    await finishMarketplaceEvent(eventRow.id, "ok", {
      orgId,
      eventId: event.id,
      type: event.type,
    });
    return { result: "ok", orgId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishMarketplaceEvent(eventRow.id, `error:${msg.slice(0, 200)}`, {
      orgId,
      eventId: event.id,
      type: event.type,
    });
    throw err;
  }
}

async function loadBookingFromMetadata(meta: Record<string, string | undefined>) {
  const bookingId = meta.bookingId?.trim();
  if (!bookingId) return null;
  return prisma.marketplaceBooking.findUnique({ where: { id: bookingId } });
}

export async function processMarketplaceCheckoutCompleted(
  event: Stripe.Event,
  session: Stripe.Checkout.Session
): Promise<ProcessResult> {
  const meta = (session.metadata || {}) as Record<string, string | undefined>;
  if (meta.type !== "marketplace_booking") {
    return { result: "ignored:not_marketplace" };
  }
  const booking = await loadBookingFromMetadata(meta);
  if (!booking) {
    return { result: "ignored:missing_booking" };
  }

  // Never trust client-editable Stripe metadata alone for tenancy / amount.
  if (meta.orgId?.trim() && meta.orgId.trim() !== booking.orgId) {
    return { result: "ignored:org_mismatch" };
  }
  if (meta.packageId?.trim() && meta.packageId.trim() !== booking.packageId) {
    return { result: "ignored:package_mismatch" };
  }
  if (
    booking.stripeCheckoutSessionId &&
    booking.stripeCheckoutSessionId !== session.id
  ) {
    // Replacement race: new session may complete before we persist its id.
    // Only allow rematch while still awaiting payment; expire() blocks the
    // prior session from paying, so a paid mismatch here is the successor.
    const awaiting =
      booking.status === "pending_payment" || booking.status === "failed";
    const paidOk =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";
    if (!awaiting || !paidOk) {
      return { result: "ignored:session_mismatch" };
    }
  }
  if (
    session.amount_total != null &&
    session.amount_total !== booking.amountMinor
  ) {
    console.warn("[marketplace webhook] amount mismatch", {
      bookingId: booking.id,
      expected: booking.amountMinor,
      got: session.amount_total,
    });
    return { result: "ignored:amount_mismatch" };
  }
  const sessionCurrency = session.currency?.toLowerCase();
  if (
    sessionCurrency &&
    sessionCurrency !== booking.currency.toLowerCase()
  ) {
    return { result: "ignored:currency_mismatch" };
  }

  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId: booking.orgId,
    bookingId: booking.id,
    payload: {
      id: session.id,
      payment_status: session.payment_status,
      payment_intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null,
      amount_total: session.amount_total,
    },
  });
  if (!eventRow) {
    return {
      result: "ignored:duplicate",
      duplicate: true,
      orgId: booking.orgId,
      bookingId: booking.id,
    };
  }

  try {
    if (booking.status === "paid") {
      await finishMarketplaceEvent(eventRow.id, "ok:already_paid");
      return {
        result: "ok:already_paid",
        orgId: booking.orgId,
        bookingId: booking.id,
      };
    }
    // cancelled: allow settle when this session is the one that paid (expire
    // raced ahead of completed for the same session).
    if (
      booking.status !== "pending_payment" &&
      booking.status !== "failed" &&
      booking.status !== "cancelled"
    ) {
      await finishMarketplaceEvent(
        eventRow.id,
        `ignored:status_${booking.status}`
      );
      return {
        result: `ignored:status_${booking.status}`,
        orgId: booking.orgId,
        bookingId: booking.id,
      };
    }

    const pi =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : null;
    let chargeId: string | null = null;
    let transferId: string | null = null;
    if (pi) {
      const stripe = getStripe();
      const intent = await stripe.paymentIntents.retrieve(pi, {
        expand: ["latest_charge", "transfer_data"],
      });
      const latest = intent.latest_charge;
      if (typeof latest === "string") chargeId = latest;
      else if (latest && typeof latest === "object") {
        chargeId = latest.id;
        const transfer = (latest as Stripe.Charge).transfer;
        if (typeof transfer === "string") transferId = transfer;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.marketplaceBooking.update({
        where: { id: booking.id },
        data: {
          status: "paid",
          paidAt: new Date(),
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: pi || booking.stripePaymentIntentId,
          stripeChargeId: chargeId || undefined,
          stripeTransferId: transferId || undefined,
        },
      });
      await enqueueSource(tx, {
        orgId: booking.orgId,
        locationId: booking.locationId,
        sourceType: "marketplace_booking",
        sourceId: booking.id,
        sourceEvent: "paid",
      });
    });
    flushAccountingQueueSoon(booking.orgId);

    await finishMarketplaceEvent(eventRow.id, "ok", {
      orgId: booking.orgId,
      bookingId: booking.id,
      eventId: event.id,
      type: event.type,
    });
    await sendMarketplaceBookingReceipt(booking.id).catch(() => undefined);
    await notifyOrgAdmins({
      orgId: booking.orgId,
      title: "Marketplace booking paid",
      message: `Guest ${booking.customerEmail} paid for a booking package.`,
      kind: "marketplace_booking",
      bookingId: booking.id,
    });
    return { result: "ok", orgId: booking.orgId, bookingId: booking.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishMarketplaceEvent(eventRow.id, `error:${msg.slice(0, 200)}`);
    throw err;
  }
}

export async function processMarketplacePaymentFailed(
  event: Stripe.Event,
  pi: Stripe.PaymentIntent
): Promise<ProcessResult> {
  const meta = (pi.metadata || {}) as Record<string, string | undefined>;
  if (meta.type !== "marketplace_booking") {
    return { result: "ignored:not_marketplace" };
  }
  const booking = await loadBookingFromMetadata(meta);
  if (!booking) return { result: "ignored:missing_booking" };

  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId: booking.orgId,
    bookingId: booking.id,
    payload: { id: pi.id, status: pi.status },
  });
  if (!eventRow) {
    return { result: "ignored:duplicate", duplicate: true, orgId: booking.orgId };
  }

  // Only fail the booking when this PI is still the bound payment for the row.
  // A delayed fail for an abandoned attempt must not clobber a live retry.
  if (
    booking.status === "pending_payment" &&
    booking.stripePaymentIntentId &&
    booking.stripePaymentIntentId === pi.id
  ) {
    await prisma.marketplaceBooking.update({
      where: { id: booking.id },
      data: { status: "failed" },
    });
  } else if (
    booking.status === "pending_payment" &&
    (!booking.stripePaymentIntentId ||
      booking.stripePaymentIntentId !== pi.id)
  ) {
    await finishMarketplaceEvent(eventRow.id, "ignored:stale_payment_intent");
    return {
      result: "ignored:stale_payment_intent",
      orgId: booking.orgId,
      bookingId: booking.id,
    };
  }
  await finishMarketplaceEvent(eventRow.id, "ok");
  return { result: "ok", orgId: booking.orgId, bookingId: booking.id };
}

export async function processMarketplaceCheckoutExpired(
  event: Stripe.Event,
  session: Stripe.Checkout.Session
): Promise<ProcessResult> {
  const meta = (session.metadata || {}) as Record<string, string | undefined>;
  if (meta.type !== "marketplace_booking") {
    return { result: "ignored:not_marketplace" };
  }
  const booking = await loadBookingFromMetadata(meta);
  if (!booking) return { result: "ignored:missing_booking" };

  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId: booking.orgId,
    bookingId: booking.id,
    payload: { id: session.id, status: session.status },
  });
  if (!eventRow) {
    return { result: "ignored:duplicate", duplicate: true, orgId: booking.orgId };
  }

  // Only cancel when this session is still the live Checkout binding.
  // A delayed expire for session A must not cancel a retry that bound session B.
  if (
    booking.status === "pending_payment" &&
    booking.stripeCheckoutSessionId &&
    booking.stripeCheckoutSessionId === session.id
  ) {
    await prisma.marketplaceBooking.update({
      where: { id: booking.id },
      data: { status: "cancelled" },
    });
  } else if (
    booking.status === "pending_payment" &&
    (!booking.stripeCheckoutSessionId ||
      booking.stripeCheckoutSessionId !== session.id)
  ) {
    await finishMarketplaceEvent(eventRow.id, "ignored:stale_checkout_session");
    return {
      result: "ignored:stale_checkout_session",
      orgId: booking.orgId,
      bookingId: booking.id,
    };
  }
  await finishMarketplaceEvent(eventRow.id, "ok");
  return { result: "ok", orgId: booking.orgId, bookingId: booking.id };
}

export async function processMarketplaceChargeRefunded(
  event: Stripe.Event,
  charge: Stripe.Charge
): Promise<ProcessResult> {
  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent && typeof charge.payment_intent === "object"
        ? charge.payment_intent.id
        : null;

  const booking = piId
    ? await prisma.marketplaceBooking.findFirst({
        where: { stripePaymentIntentId: piId },
      })
    : null;
  if (!booking) {
    // May be venue_booking / order — ignore for marketplace ledger.
    return { result: "ignored:not_marketplace_booking" };
  }

  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId: booking.orgId,
    bookingId: booking.id,
    payload: {
      id: charge.id,
      amount_refunded: charge.amount_refunded,
      amount: charge.amount,
    },
  });
  if (!eventRow) {
    return { result: "ignored:duplicate", duplicate: true, orgId: booking.orgId };
  }

  // Sync MarketplaceRefund rows from Stripe (Dashboard / API / our refund path).
  // Unique stripeRefundId keeps admin-written rows from double-counting.
  let stripeRefunds: Stripe.Refund[] = [];
  const embedded = charge.refunds?.data;
  if (Array.isArray(embedded) && embedded.length > 0) {
    stripeRefunds = embedded;
  } else {
    try {
      const stripe = getStripe();
      const listed = await stripe.refunds.list({
        charge: charge.id,
        limit: 100,
      });
      stripeRefunds = listed.data;
    } catch (err) {
      console.warn(
        "[marketplace webhook] refund list failed",
        err instanceof Error ? err.message : err
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const r of stripeRefunds) {
      if (!r?.id || !r.amount || r.amount <= 0) continue;
      if (r.status === "failed" || r.status === "canceled") continue;
      try {
        await tx.marketplaceRefund.create({
          data: {
            orgId: booking.orgId,
            bookingId: booking.id,
            amountMinor: r.amount,
            currency: (r.currency || booking.currency).toLowerCase(),
            stripeRefundId: r.id,
            reason:
              (typeof r.reason === "string" && r.reason) ||
              (typeof r.metadata?.reason === "string"
                ? r.metadata.reason
                : null),
            actorUserId: null,
            refundApplicationFee: Boolean(
              (r as Stripe.Refund & { refund_application_fee?: boolean })
                .refund_application_fee
            ),
          },
        });
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code?: string }).code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }

    const sum = await tx.marketplaceRefund.aggregate({
      where: { bookingId: booking.id },
      _sum: { amountMinor: true },
    });
    const refundedMinor = sum._sum.amountMinor ?? 0;
    const effective =
      refundedMinor > 0
        ? refundedMinor
        : Math.max(0, charge.amount_refunded ?? 0);

    let nextStatus: "refunded" | "partially_refunded" | null = null;
    if (effective >= booking.amountMinor && booking.amountMinor > 0) {
      nextStatus = "refunded";
    } else if (effective > 0) {
      nextStatus = "partially_refunded";
    }

    // Do not clobber disputed with refunded unless fully refunded — keep dispute
    // visible until ops resolves; still allow full refund status.
    if (nextStatus) {
      const shouldUpdate =
        booking.status !== nextStatus &&
        (booking.status !== "disputed" || nextStatus === "refunded");
      if (shouldUpdate) {
        await tx.marketplaceBooking.update({
          where: { id: booking.id },
          data: { status: nextStatus },
        });
      }
    }
    await enqueueSource(tx, {
      orgId: booking.orgId,
      locationId: booking.locationId,
      sourceType: "marketplace_refund",
      sourceId: booking.id,
      sourceEvent: `refund:${charge.amount_refunded ?? 0}`,
    });
  });
  flushAccountingQueueSoon(booking.orgId);

  await finishMarketplaceEvent(eventRow.id, "ok");
  return { result: "ok", orgId: booking.orgId, bookingId: booking.id };
}

export async function processMarketplaceDisputeCreated(
  event: Stripe.Event,
  dispute: Stripe.Dispute
): Promise<ProcessResult> {
  const chargeId =
    typeof dispute.charge === "string"
      ? dispute.charge
      : dispute.charge && typeof dispute.charge === "object"
        ? dispute.charge.id
        : null;

  const booking = chargeId
    ? await prisma.marketplaceBooking.findFirst({
        where: { stripeChargeId: chargeId },
      })
    : null;

  // Fallback via PI metadata if charge id not stored yet
  let resolved = booking;
  if (!resolved && chargeId) {
    try {
      const stripe = getStripe();
      const charge = await stripe.charges.retrieve(chargeId);
      const piId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : null;
      if (piId) {
        resolved = await prisma.marketplaceBooking.findFirst({
          where: { stripePaymentIntentId: piId },
        });
      }
    } catch (err) {
      console.warn(
        "[marketplace webhook] dispute charge lookup failed (non-marketplace ok)",
        err instanceof Error ? err.message : err
      );
      return { result: "ignored:charge_lookup_failed" };
    }
  }
  if (!resolved) return { result: "ignored:not_marketplace_booking" };

  const eventRow = await beginMarketplaceEvent({
    providerEventId: event.id,
    type: event.type,
    orgId: resolved.orgId,
    bookingId: resolved.id,
    payload: {
      id: dispute.id,
      amount: dispute.amount,
      reason: dispute.reason,
      status: dispute.status,
    },
  });
  if (!eventRow) {
    return {
      result: "ignored:duplicate",
      duplicate: true,
      orgId: resolved.orgId,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.marketplaceBooking.update({
      where: { id: resolved.id },
      data: { status: "disputed" },
    });
    await enqueueSource(tx, {
      orgId: resolved.orgId,
      locationId: resolved.locationId,
      sourceType: "marketplace_dispute",
      sourceId: resolved.id,
      sourceEvent: "dispute",
    });
  });
  flushAccountingQueueSoon(resolved.orgId);

  await notifyOrgAdmins({
    orgId: resolved.orgId,
    title: "Marketplace booking dispute",
    message: `A dispute was opened for booking ${resolved.id.slice(-8)}. Review in Stripe and contact FECSYNC if needed.`,
    kind: "marketplace_booking",
    bookingId: resolved.id,
  });

  await emailCompanySupport({
    orgId: resolved.orgId,
    subject: `Dispute opened — booking ${resolved.id.slice(-8)}`,
    htmlBody: `<p>A charge dispute was opened for marketplace booking <code>${resolved.id}</code>.</p><p>Reason: ${dispute.reason || "n/a"}</p>`,
  });

  const ops = process.env.COMPANY_OPS_ALERT_EMAIL?.trim();
  if (ops) {
    try {
      const fromUser = process.env.NOTIFICATION_EMAIL_USER?.trim();
      if (fromUser) {
        await notificationTransporter.sendMail({
          from: fromUser,
          to: ops,
          subject: `[FECSYNC] Marketplace dispute ${dispute.id}`,
          text: `orgId=${resolved.orgId} bookingId=${resolved.id} dispute=${dispute.id}`,
        });
      }
    } catch {
      /* best-effort */
    }
  }

  await finishMarketplaceEvent(eventRow.id, "ok");
  return { result: "ok", orgId: resolved.orgId, bookingId: resolved.id };
}
