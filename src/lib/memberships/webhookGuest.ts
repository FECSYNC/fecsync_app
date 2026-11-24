/**
 * Stripe webhook handlers for guest memberships (World D).
 * NEVER settle fashion shop Order.
 * NEVER mutate Organization.stripeSubscriptionId / company SaaS columns.
 */
import type Stripe from "stripe";
import type { GuestMembershipStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { GUEST_MEMBERSHIP_META_TYPE } from "@/lib/memberships/stripeGuest";
import {
  markMembershipPastDue,
  recoverMembershipFromPastDue,
} from "@/lib/memberships/dunning";
import { assertMembershipTransition } from "@/lib/memberships/statusMachine";
import { setGuestDefaultPaymentMethod } from "@/lib/memberships/stripeGuest";

function metaType(
  meta: Stripe.Metadata | null | undefined
): string | undefined {
  const t = meta?.type;
  return typeof t === "string" ? t.trim() : undefined;
}

export function isGuestMembershipStripeEvent(meta: {
  type?: string | null;
}): boolean {
  return meta.type === GUEST_MEMBERSHIP_META_TYPE;
}

async function findGuestMembershipBySubscription(
  subscriptionId: string
): Promise<{ id: string; orgId: string } | null> {
  const row = await prisma.guestMembership.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true, orgId: true },
  });
  return row;
}

function stripeCustomerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (typeof customer === "string" && customer.trim()) return customer.trim();
  if (customer && typeof customer === "object" && "id" in customer) {
    return String(customer.id);
  }
  return null;
}

/**
 * Resolve GuestMembership for a Stripe Subscription.
 * Prefer DB stripeSubscriptionId binding. Metadata fallback is only for the
 * brief race before billingEngine persists the sub id — never takeover a row
 * already bound to a different subscription, and require customer match when
 * the guest already has stripeCustomerId.
 */
async function resolveGuestMembershipForSubscription(
  sub: Stripe.Subscription
): Promise<
  | { id: string; orgId: string; bindSubscription: boolean }
  | null
  | "bind_conflict"
> {
  const byDb = await findGuestMembershipBySubscription(sub.id);
  if (byDb) {
    return { ...byDb, bindSubscription: false };
  }

  if (metaType(sub.metadata) !== GUEST_MEMBERSHIP_META_TYPE) {
    return null;
  }
  const membershipId = String(sub.metadata?.guestMembershipId || "").trim();
  const orgId = String(sub.metadata?.orgId || "").trim();
  if (!membershipId || !orgId) return null;

  const row = await prisma.guestMembership.findFirst({
    where: { id: membershipId, orgId },
    select: {
      id: true,
      orgId: true,
      stripeSubscriptionId: true,
      guestProfile: { select: { stripeCustomerId: true } },
    },
  });
  if (!row) return null;

  if (row.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id) {
    return "bind_conflict";
  }

  const subCustomer = stripeCustomerIdOf(sub.customer);
  const guestCustomer = row.guestProfile.stripeCustomerId;
  if (guestCustomer && subCustomer && guestCustomer !== subCustomer) {
    return "bind_conflict";
  }

  return {
    id: row.id,
    orgId: row.orgId,
    bindSubscription: !row.stripeSubscriptionId,
  };
}

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

/**
 * Returns handled=true when this is a guest membership event (caller must not
 * run company SaaS billing for it).
 */
export async function handleGuestMembershipStripeEvent(
  event: Stripe.Event
): Promise<{ handled: boolean; result?: string }> {
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const type = metaType(sub.metadata);
    const byMeta = type === GUEST_MEMBERSHIP_META_TYPE;
    const resolved = await resolveGuestMembershipForSubscription(sub);
    if (resolved === "bind_conflict") {
      return { handled: true, result: "guest_sub_bind_conflict" };
    }
    if (!resolved) {
      if (byMeta) return { handled: true, result: "guest_sub_unknown_member" };
      return { handled: false };
    }
    const memberRef = resolved;

    const current = await prisma.guestMembership.findUnique({
      where: { id: memberRef.id },
    });
    if (!current) return { handled: true, result: "guest_sub_unknown_member" };

    if (event.type === "customer.subscription.deleted" || sub.status === "canceled") {
      if (current.status !== "cancelled" && current.status !== "expired") {
        assertMembershipTransition(current.status, "cancelled");
        await prisma.guestMembership.update({
          where: { id: current.id },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelAtPeriodEnd: false,
            dunningNextAt: null,
            stripeSubscriptionId: null,
            stripePriceId: null,
          },
        });
      } else if (current.stripeSubscriptionId) {
        // Already terminal — still drop dead binding so reactivate can bind.
        await prisma.guestMembership.update({
          where: { id: current.id },
          data: { stripeSubscriptionId: null, stripePriceId: null },
        });
      }
      return { handled: true, result: "guest_sub_cancelled" };
    }

    // Sync period bounds when Stripe reports them (API 2025+: often on items).
    const item = sub.items?.data?.[0] as
      | { current_period_start?: number; current_period_end?: number }
      | undefined;
    const subPeriod = sub as unknown as {
      current_period_start?: number;
      current_period_end?: number;
    };
    const periodStartUnix =
      item?.current_period_start ?? subPeriod.current_period_start;
    const periodEndUnix =
      item?.current_period_end ?? subPeriod.current_period_end;
    const periodStart = periodStartUnix
      ? new Date(periodStartUnix * 1000)
      : null;
    const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;

    const mappedStatus =
      sub.status === "active" || sub.status === "trialing"
        ? ("active" as const)
        : sub.status === "past_due" || sub.status === "unpaid"
          ? ("past_due" as const)
          : sub.status === "paused"
            ? ("paused" as const)
            : null;

    let nextStatus = current.status;
    if (mappedStatus && mappedStatus !== current.status) {
      let target: GuestMembershipStatus = mappedStatus;
      // Do not activate while membership agreement is still required/unsigned.
      if (target === "active") {
        const { membershipAgreementBlocksActivation } = await import(
          "@/lib/memberships/activationGates"
        );
        if (await membershipAgreementBlocksActivation(current)) {
          target = "pending";
        }
      }
      try {
        assertMembershipTransition(current.status, target);
        nextStatus = target;
      } catch {
        // Keep DB status when Stripe reports an illegal jump (e.g. cancelled→past_due).
        nextStatus = current.status;
      }
    }

    const leavingPastDue =
      current.status === "past_due" && nextStatus !== "past_due";

    // Entering past_due via subscription.updated: observe status only
    // (countFailure:false). invoice.payment_failed owns fail count + schedule
    // so the two events do not double-count. If the invoice event is missing,
    // staff still see past_due on Members / Reports.
    if (nextStatus === "past_due") {
      const plan = await prisma.membershipPlan.findFirst({
        where: { id: current.planId },
        select: { currency: true },
      });
      await markMembershipPastDue({
        guestMembershipId: current.id,
        orgId: current.orgId,
        amountMajor: 0,
        currency: plan?.currency || "USD",
        eventId: `sub_updated_past_due:${event.id}`,
        errorMessage: `Stripe subscription status=${sub.status}`,
        skipPaymentAttempt: true,
        // Observe only — invoice.payment_failed owns fail count / schedule.
        countFailure: false,
      });
    }

    await prisma.guestMembership.update({
      where: { id: current.id },
      data: {
        // Only persist subscription id on first bind (race before billingEngine
        // write). Never overwrite an existing different binding — that path
        // returns bind_conflict above.
        ...(memberRef.bindSubscription || !current.stripeSubscriptionId
          ? { stripeSubscriptionId: sub.id }
          : current.stripeSubscriptionId === sub.id
            ? {}
            : {}),
        ...(periodStart ? { currentPeriodStart: periodStart } : {}),
        ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
        // past_due status + dunning fields owned by markMembershipPastDue above.
        ...(nextStatus !== current.status && nextStatus !== "past_due"
          ? {
              status: nextStatus,
              // Clear terminal cancel markers when Stripe restores active/pending.
              ...(nextStatus === "active" || nextStatus === "pending"
                ? {
                    cancelledAt: null,
                    cancelReason: null,
                    dunningFailCount: 0,
                    dunningNextAt: null,
                  }
                : {}),
            }
          : {}),
        // While still past_due: OR local dunning-exhaust cancel with Stripe.
        // When leaving past_due (payment recovery): mirror recoverMembershipFromPastDue —
        // clear DB-only dunning cancel; keep only Stripe-scheduled cancel_at_period_end.
        cancelAtPeriodEnd: leavingPastDue
          ? Boolean(sub.cancel_at_period_end)
          : Boolean(sub.cancel_at_period_end) || current.cancelAtPeriodEnd,
        ...(leavingPastDue
          ? {
              dunningFailCount: 0,
              dunningNextAt: null,
              ...(!sub.cancel_at_period_end ? { cancelReason: null } : {}),
            }
          : {}),
      },
    });
    return { handled: true, result: "guest_sub_synced" };
  }

  if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const invMeta = metaType(invoice.metadata);
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    let member: { id: string; orgId: string } | null = null;
    // Prefer Stripe subscription binding over client-controllable metadata.
    if (subscriptionId) {
      member = await findGuestMembershipBySubscription(subscriptionId);
    }
    // Metadata fallback only when invoice is typed guest AND membership is
    // unbound or already tied to this subscription — never hijack another sub.
    if (
      !member &&
      invMeta === GUEST_MEMBERSHIP_META_TYPE &&
      invoice.metadata?.guestMembershipId &&
      invoice.metadata?.orgId
    ) {
      const row = await prisma.guestMembership.findFirst({
        where: {
          id: String(invoice.metadata.guestMembershipId),
          orgId: String(invoice.metadata.orgId),
        },
        select: {
          id: true,
          orgId: true,
          status: true,
          stripeSubscriptionId: true,
          guestProfile: { select: { stripeCustomerId: true } },
        },
      });
      if (row) {
        // Never re-bind a terminal membership after cancel cleared the sub id.
        if (row.status === "cancelled" || row.status === "expired") {
          /* leave member null — fall through */
        } else {
        const conflict =
          row.stripeSubscriptionId &&
          subscriptionId &&
          row.stripeSubscriptionId !== subscriptionId;
        const invCustomer = stripeCustomerIdOf(
          invoice.customer as
            | string
            | Stripe.Customer
            | Stripe.DeletedCustomer
            | null
            | undefined
        );
        const customerConflict =
          Boolean(row.guestProfile.stripeCustomerId) &&
          Boolean(invCustomer) &&
          row.guestProfile.stripeCustomerId !== invCustomer;
        if (!conflict && !customerConflict) {
          // Require an existing DB sub bind OR an invoice subscription id that
          // we can safely attach — refuse pure metadata-only takeover.
          if (
            row.stripeSubscriptionId ||
            (subscriptionId && !row.stripeSubscriptionId)
          ) {
            member = { id: row.id, orgId: row.orgId };
            if (subscriptionId && !row.stripeSubscriptionId) {
              await prisma.guestMembership.update({
                where: { id: row.id },
                data: { stripeSubscriptionId: subscriptionId },
              });
            }
          }
        }
        }
      }
    }
    // Only claim as guest when metadata says so OR we found a GuestMembership.
    if (!member) {
      if (invMeta === GUEST_MEMBERSHIP_META_TYPE) {
        return { handled: true, result: "guest_invoice_unknown_member" };
      }
      return { handled: false };
    }
    // Found via DB subscription binding — treat as guest even without meta.
    // Company SaaS uses Organization.stripeSubscriptionId — never equal to guest sub.

    const currency = (invoice.currency || "usd").toUpperCase();

    if (event.type === "invoice.payment_failed") {
      const amountMajor = (invoice.amount_due ?? 0) / 100;
      await markMembershipPastDue({
        guestMembershipId: member.id,
        orgId: member.orgId,
        amountMajor,
        currency,
        stripeInvoiceId: invoice.id,
        errorMessage: "Stripe invoice.payment_failed",
        eventId: event.id,
      });
      return { handled: true, result: "guest_past_due" };
    }

    const paidMajor = (invoice.amount_paid ?? 0) / 100;
    // Only advance membership period on true subscription renewals.
    // subscription_update / manual / proration invoices can carry short
    // period windows that would incorrectly shrink entitlement bounds.
    const reason = invoice.billing_reason;
    const advancePeriod =
      reason === "subscription_cycle" || reason === "subscription_create";
    const periodStart =
      advancePeriod && typeof invoice.period_start === "number"
        ? new Date(invoice.period_start * 1000)
        : null;
    const periodEnd =
      advancePeriod && typeof invoice.period_end === "number"
        ? new Date(invoice.period_end * 1000)
        : null;
    await recoverMembershipFromPastDue({
      guestMembershipId: member.id,
      orgId: member.orgId,
      amountMajor: paidMajor,
      currency,
      stripeInvoiceId: invoice.id,
      eventId: event.id,
      periodStart,
      periodEnd,
    });
    return { handled: true, result: "guest_recovered" };
  }

  if (event.type === "setup_intent.succeeded") {
    const si = event.data.object as Stripe.SetupIntent;
    if (metaType(si.metadata) !== GUEST_MEMBERSHIP_META_TYPE) {
      return { handled: false };
    }
    const customerId =
      typeof si.customer === "string"
        ? si.customer
        : si.customer && typeof si.customer === "object" && "id" in si.customer
          ? String(si.customer.id)
          : null;
    const pm =
      typeof si.payment_method === "string"
        ? si.payment_method
        : si.payment_method &&
            typeof si.payment_method === "object" &&
            "id" in si.payment_method
          ? String(si.payment_method.id)
          : null;
    if (!customerId || !pm) {
      return { handled: true, result: "guest_setup_missing_pm" };
    }
    // Confirm customer is a GuestProfile binding — never Organization SaaS.
    const guest = await prisma.guestProfile.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (!guest) {
      return { handled: true, result: "guest_setup_unknown_customer" };
    }
    const membershipId = si.metadata?.guestMembershipId?.trim();
    const membership = membershipId
      ? await prisma.guestMembership.findFirst({
          where: { id: membershipId, guestProfileId: guest.id },
          select: { stripeSubscriptionId: true },
        })
      : await prisma.guestMembership.findFirst({
          where: { guestProfileId: guest.id, stripeSubscriptionId: { not: null } },
          orderBy: { updatedAt: "desc" },
          select: { stripeSubscriptionId: true },
        });
    await setGuestDefaultPaymentMethod({
      customerId,
      paymentMethodId: pm,
      stripeSubscriptionId: membership?.stripeSubscriptionId,
    });
    return { handled: true, result: "guest_default_pm_set" };
  }

  return { handled: false };
}
