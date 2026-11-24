/**
 * Booking payments (cash / card / gift / stored / split / invoice marker).
 * Never creates shop Order rows.
 */
import { randomBytes } from "crypto";
import { Decimal } from "@prisma/client/runtime/library";
import type { BookingPaymentTender, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { ForbiddenError } from "@/lib/auth/http-error";
import {
  createCheckoutSession,
  getStripe,
  CompanyBillingConfigError,
} from "@/lib/stripe";
import {
  assertTicketingStaffMutate,
  assertLocationInHqScope,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  TicketingError,
  BOOKING_NOT_FOUND,
  PAYMENT_INCOMPLETE,
  PAYMENT_EXCEEDS_DUE,
  GIFT_CARD_INSUFFICIENT,
  INVALID_STATUS_TRANSITION,
} from "@/lib/ticketing/errors";
import { redeemGiftCard } from "@/lib/ticketing/giftCards";
import { logBookingActivity } from "@/lib/ticketing/activity";
import { allowTicketingPaymentStub } from "@/lib/ticketing/paymentSafety";
import {
  confirmBooking,
  updateBookingAmountsAfterPayment,
  toNum,
  money,
  bookingInclude,
  toBookingDto,
} from "@/lib/ticketing/bookingEngine";
import { sendBookingPaymentReceipt } from "@/lib/ticketing/confirmations";
import { syncPartyOpsFromBooking } from "@/lib/parties/bookingHooks";
import { resolveBookingSettings } from "@/lib/ticketing/settings";
import { publicAppBaseUrl } from "@/lib/publicAppBaseUrl";
import {
  enqueueBookingPayment,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

export type TenderInput = {
  type: BookingPaymentTender | "split";
  amount: number;
  giftCardCode?: string;
  storedPaymentMethodId?: string;
};

import { isBookingStatusPayable } from "@/lib/ticketing/bookingPayable";

function splitGroupId(): string {
  return `sg_${randomBytes(6).toString("hex")}`;
}

/** Statuses that may accept a new card/cash tender. */
export { isBookingStatusPayable } from "@/lib/ticketing/bookingPayable";

function pendingCardReservedFromPayments(
  payments: Array<{ status: string; tender: string; amount: unknown }>
): number {
  return payments
    .filter(
      (p) =>
        p.status === "pending" &&
        (p.tender === "card" || p.tender === "stored_card")
    )
    .reduce((s, p) => s + toNum(p.amount as never), 0);
}

/**
 * Atomically reserve due with a pending card/stored_card row (blocks double-click Checkout).
 */
export async function createPendingCardPaymentLocked(opts: {
  bookingId: string;
  orgId: string;
  locationId: string;
  amount: number;
  tender: "card" | "stored_card";
  splitGroupId?: string | null;
  receivedByStaffId?: string | null;
  connectedAccountId?: string | null;
  platformFeeMinor?: number | null;
}): Promise<{ id: string }> {
  return prisma.$transaction(
    async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${opts.bookingId} FOR UPDATE
    `;
    const locked = await tx.booking.findFirst({
      where: { id: opts.bookingId },
      include: { payments: true },
    });
    if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    if (!isBookingStatusPayable(locked.status)) {
      throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
    }
    const reserved = pendingCardReservedFromPayments(locked.payments ?? []);
    const due =
      Math.round((toNum(locked.amountDue) - reserved) * 100) / 100;
    if (opts.amount > due + 1e-9) {
      throw new TicketingError(PAYMENT_EXCEEDS_DUE, 400);
    }
    const payment = await tx.bookingPayment.create({
      data: {
        orgId: opts.orgId,
        locationId: opts.locationId,
        bookingId: opts.bookingId,
        tender: opts.tender,
        amount: money(opts.amount),
        status: "pending",
        splitGroupId: opts.splitGroupId ?? null,
        receivedByStaffId: opts.receivedByStaffId ?? null,
        connectedAccountId: opts.connectedAccountId?.trim() || null,
        platformFeeMinor:
          typeof opts.platformFeeMinor === "number"
            ? Math.floor(opts.platformFeeMinor)
            : null,
      },
    });
    return { id: payment.id };
  },
    { maxWait: 15_000, timeout: 30_000 }
  );
}

async function loadBooking(orgId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: requireId(bookingId, "bookingId"), orgId },
    include: bookingInclude,
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  return booking;
}

export async function takeBookingPayments(
  actor: TicketingActor,
  bookingId: string,
  tenders: TenderInput[],
  opts?: { confirmIfPaid?: boolean }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const booking = await loadBooking(orgId, bookingId);
  await assertLocationInHqScope(actor, booking.locationId);

  if (["cancelled", "expired", "refunded"].includes(booking.status)) {
    throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
  }

  if (!tenders.length) throw new Error("At least one tender is required");
  const groupId = tenders.length > 1 ? splitGroupId() : null;
  const createdPaymentIds: string[] = [];
  let cardCheckoutUrl: string | null = null;
  let cardPaymentId: string | null = null;
  // In-flight card Checkouts already reserve due — block double-click overpay.
  // Invoice tenders are accounting markers only (not card holds) — do not reserve due.
  const pendingCardReserved = (booking.payments ?? [])
    .filter(
      (p) =>
        p.status === "pending" &&
        (p.tender === "card" || p.tender === "stored_card")
    )
    .reduce((s, p) => s + toNum(p.amount), 0);
  let remainingDue = Math.round(
    (toNum(booking.amountDue) - pendingCardReserved) * 100
  ) / 100;

  async function applyImmediateCompletedTender(
    tenderType: BookingPaymentTender,
    amount: number,
    extra?: { giftCardId?: string | null }
  ) {
    let paymentId = "";
    await prisma.$transaction(
      async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
      `;
      const locked = await tx.booking.findFirst({
        where: { id: booking.id },
        include: { payments: true },
      });
      if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
      if (["cancelled", "expired", "refunded"].includes(locked.status)) {
        throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
      }
      const reserved = (locked.payments ?? [])
        .filter(
          (p) =>
            p.status === "pending" &&
            (p.tender === "card" || p.tender === "stored_card")
        )
        .reduce((s, p) => s + toNum(p.amount), 0);
      const due =
        Math.round((toNum(locked.amountDue) - reserved) * 100) / 100;
      if (amount > due + 1e-9) {
        throw new TicketingError(PAYMENT_EXCEEDS_DUE, 400);
      }
      const payment = await tx.bookingPayment.create({
        data: {
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          tender: tenderType,
          amount: money(amount),
          status: "completed",
          receivedByStaffId: actor.sub ?? null,
          splitGroupId: groupId,
          giftCardId: extra?.giftCardId ?? null,
        },
      });
      paymentId = payment.id;
      createdPaymentIds.push(payment.id);
      await updateBookingAmountsAfterPayment(booking.id, amount, tx);
      await enqueueBookingPayment(tx, payment);
      await logBookingActivity(
        {
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "payment",
          payload: {
            paymentId: payment.id,
            tender: payment.tender,
            amount,
            status: "completed",
          },
          actorUserId: actor.sub ?? null,
        },
        tx
      );
    },
      { maxWait: 15_000, timeout: 60_000 }
    );
    flushAccountingQueueSoon(orgId);
    return paymentId;
  }

  for (const tender of tenders) {
    const amount = Math.round(Number(tender.amount) * 100) / 100;
    if (!(amount > 0)) throw new Error("Payment amount must be > 0");
    if (amount > remainingDue + 1e-9) {
      throw new TicketingError(PAYMENT_EXCEEDS_DUE, 400);
    }

    if (tender.type === "cash" || tender.type === "split_component") {
      const paymentId = await applyImmediateCompletedTender(
        tender.type === "cash" ? "cash" : "split_component",
        amount
      );
      void sendBookingPaymentReceipt({
        bookingId: booking.id,
        paymentId,
      }).catch(() => undefined);
      remainingDue = Math.round((remainingDue - amount) * 100) / 100;
    } else if (tender.type === "gift_card") {
      if (!tender.giftCardCode) {
        throw new TicketingError(GIFT_CARD_INSUFFICIENT, 400);
      }
      // Redeem + ledger row in one TX so a failed apply never burns balance.
      let paymentId = "";
      await prisma.$transaction(
        async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
        `;
        const locked = await tx.booking.findFirst({
          where: { id: booking.id },
          include: { payments: true },
        });
        if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
        if (["cancelled", "expired", "refunded"].includes(locked.status)) {
          throw new TicketingError(INVALID_STATUS_TRANSITION, 400);
        }
        const reserved = pendingCardReservedFromPayments(locked.payments ?? []);
        const due =
          Math.round((toNum(locked.amountDue) - reserved) * 100) / 100;
        if (amount > due + 1e-9) {
          throw new TicketingError(PAYMENT_EXCEEDS_DUE, 400);
        }
        const redeemed = await redeemGiftCard({
          orgId,
          code: tender.giftCardCode!,
          amount,
          db: tx,
        });
        const payment = await tx.bookingPayment.create({
          data: {
            orgId,
            locationId: booking.locationId,
            bookingId: booking.id,
            tender: "gift_card",
            amount: money(amount),
            status: "completed",
            receivedByStaffId: actor.sub ?? null,
            splitGroupId: groupId,
            giftCardId: redeemed.giftCardId,
          },
        });
        paymentId = payment.id;
        await updateBookingAmountsAfterPayment(booking.id, amount, tx);
        await enqueueBookingPayment(tx, payment);
        await logBookingActivity(
          {
            orgId,
            locationId: booking.locationId,
            bookingId: booking.id,
            kind: "payment",
            payload: {
              paymentId: payment.id,
              tender: "gift_card",
              amount,
              status: "completed",
            },
            actorUserId: actor.sub ?? null,
          },
          tx
        );
      },
        { maxWait: 15_000, timeout: 60_000 }
      );
      flushAccountingQueueSoon(orgId);
      createdPaymentIds.push(paymentId);
      void sendBookingPaymentReceipt({
        bookingId: booking.id,
        paymentId,
      }).catch(() => undefined);
      remainingDue = Math.round((remainingDue - amount) * 100) / 100;
    } else if (tender.type === "invoice") {
      const payment = await prisma.bookingPayment.create({
        data: {
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          tender: "invoice",
          amount: money(amount),
          status: "pending",
          splitGroupId: groupId,
        },
      });
      createdPaymentIds.push(payment.id);
      await logBookingActivity({
        orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "payment",
        payload: {
          paymentId: payment.id,
          tender: "invoice",
          amount,
          status: "pending",
        },
        actorUserId: actor.sub ?? null,
      });
      remainingDue = Math.round((remainingDue - amount) * 100) / 100;
    } else if (tender.type === "card") {
      const allowStub = allowTicketingPaymentStub();
      const { resolveVenueBookingCheckoutDestination } = await import(
        "@/lib/marketplace/guestPayoutDestination"
      );
      const dest = await resolveVenueBookingCheckoutDestination({
        orgId,
        locationId: booking.locationId,
        amountMinor: Math.round(amount * 100),
      });
      const reserved = await createPendingCardPaymentLocked({
        bookingId: booking.id,
        orgId,
        locationId: booking.locationId,
        amount,
        tender: "card",
        splitGroupId: groupId,
        connectedAccountId: dest.connectedAccountId,
        platformFeeMinor: dest.applicationFeeMinor,
      });
      createdPaymentIds.push(reserved.id);
      cardPaymentId = reserved.id;

      const base = publicAppBaseUrl();
      try {
        if (!process.env.STRIPE_SECRET_KEY?.trim()) {
          throw new CompanyBillingConfigError(
            "STRIPE_SECRET_KEY is not configured"
          );
        }
        // Fail closed before Checkout when Stripe is missing (createCheckoutSession
        // uses a placeholder client and would otherwise leave an orphan pending row).
        getStripe();
        const session = await createCheckoutSession({
          amount,
          email: booking.primaryContactEmail || "guest@example.com",
          successUrl: `${base}/payment/booking/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/payment/booking/cancel?viewToken=${encodeURIComponent(booking.viewToken)}&bookingId=${booking.id}&paymentId=${reserved.id}`,
          productName: `Booking ${booking.publicId}`,
          productDescription: `Venue booking payment`,
          connectedAccountId: dest.connectedAccountId,
          applicationFeeMinor: dest.applicationFeeMinor,
          metadata: {
            type: booking.partyDetail ? "venue_party" : "venue_booking",
            amount,
            uuid: actor.sub || "staff",
            bookingId: booking.id,
            orgId,
            locationId: booking.locationId,
            paymentId: reserved.id,
          },
        });
        cardCheckoutUrl = session.url;
        // Soft-link PI id — never delete the pending row after Checkout exists.
        if (session.payment_intent && typeof session.payment_intent === "string") {
          await prisma.bookingPayment
            .update({
              where: { id: reserved.id },
              data: { stripePaymentIntentId: session.payment_intent },
            })
            .catch(() => undefined);
        }
      } catch (err) {
        // Checkout never created — drop the reserve so retry is possible.
        await prisma.bookingPayment
          .delete({ where: { id: reserved.id } })
          .catch(() => undefined);
        const idx = createdPaymentIds.indexOf(reserved.id);
        if (idx >= 0) createdPaymentIds.splice(idx, 1);
        cardPaymentId = null;
        if (err instanceof CompanyBillingConfigError && allowStub) {
          const stubPay = await createPendingCardPaymentLocked({
            bookingId: booking.id,
            orgId,
            locationId: booking.locationId,
            amount,
            tender: "card",
            splitGroupId: groupId,
            receivedByStaffId: actor.sub ?? null,
          });
          await prisma.bookingPayment.update({
            where: { id: stubPay.id },
            data: { status: "completed" },
          });
          createdPaymentIds.push(stubPay.id);
          cardPaymentId = stubPay.id;
          await updateBookingAmountsAfterPayment(booking.id, amount);
          cardCheckoutUrl = null;
        } else if (err instanceof CompanyBillingConfigError) {
          throw new Error(
            "Card payments are not configured for this workspace"
          );
        } else {
          throw err;
        }
      }

      await logBookingActivity({
        orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "payment",
        payload: {
          paymentId: cardPaymentId,
          tender: "card",
          amount,
          status: cardCheckoutUrl ? "pending" : "completed",
        },
        actorUserId: actor.sub ?? null,
      });
      remainingDue = Math.round((remainingDue - amount) * 100) / 100;
    } else if (tender.type === "stored_card") {
      if (!tender.storedPaymentMethodId) {
        throw new Error("storedPaymentMethodId required");
      }
      const method = await prisma.storedPaymentMethod.findFirst({
        where: {
          id: requireId(tender.storedPaymentMethodId, "storedPaymentMethodId"),
          orgId,
        },
      });
      if (!method) throw new ForbiddenError("Stored payment method not found");
      // Fail closed: PM must belong to this booking's guest and/or B2B account.
      const userOk =
        Boolean(booking.userId) && method.userId === booking.userId;
      const accountOk =
        Boolean(booking.accountId) && method.accountId === booking.accountId;
      if (!userOk && !accountOk) {
        throw new ForbiddenError(
          "Stored payment method is not linked to this booking's guest or company"
        );
      }

      const { resolveVenueBookingCheckoutDestination } = await import(
        "@/lib/marketplace/guestPayoutDestination"
      );
      const dest = await resolveVenueBookingCheckoutDestination({
        orgId,
        locationId: booking.locationId,
        amountMinor: Math.round(amount * 100),
      });
      const payment = await createPendingCardPaymentLocked({
        bookingId: booking.id,
        orgId,
        locationId: booking.locationId,
        amount,
        tender: "stored_card",
        splitGroupId: groupId,
        connectedAccountId: dest.connectedAccountId,
        platformFeeMinor: dest.applicationFeeMinor,
      });
      createdPaymentIds.push(payment.id);

      try {
        const stripe = getStripe();
        const piParams: import("stripe").Stripe.PaymentIntentCreateParams = {
          amount: Math.round(amount * 100),
          currency: "usd",
          customer: method.stripeCustomerId,
          payment_method: method.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            type: booking.partyDetail ? "venue_party" : "venue_booking",
            bookingId: booking.id,
            orgId,
            locationId: booking.locationId,
            paymentId: payment.id,
            ...(dest.connectedAccountId
              ? { connectedAccountId: dest.connectedAccountId }
              : {}),
          },
        };
        if (dest.connectedAccountId && dest.applicationFeeMinor != null) {
          piParams.application_fee_amount = dest.applicationFeeMinor;
          piParams.transfer_data = {
            destination: dest.connectedAccountId,
          };
        }
        const pi = await stripe.paymentIntents.create(piParams);
        if (pi.status === "succeeded") {
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
            `;
            const claimed = await tx.bookingPayment.updateMany({
              where: { id: payment.id, status: "pending" },
              data: {
                status: "completed",
                stripePaymentIntentId: pi.id,
              },
            });
            if (claimed.count === 1) {
              await updateBookingAmountsAfterPayment(booking.id, amount, tx);
              const completed = await tx.bookingPayment.findFirstOrThrow({
                where: { id: payment.id },
              });
              await enqueueBookingPayment(tx, completed);
            }
          });
          flushAccountingQueueSoon(orgId);
        } else {
          await prisma.bookingPayment.update({
            where: { id: payment.id },
            data: {
              status: "pending",
              stripePaymentIntentId: pi.id,
            },
          });
        }
      } catch (err) {
        if (err instanceof CompanyBillingConfigError) {
          if (!allowTicketingPaymentStub()) {
            await prisma.bookingPayment.update({
              where: { id: payment.id },
              data: { status: "failed" },
            });
            throw new Error(
              "Card payments are not configured for this workspace"
            );
          }
          // Explicit smoke stub only.
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
            `;
            const claimed = await tx.bookingPayment.updateMany({
              where: { id: payment.id, status: "pending" },
              data: { status: "completed" },
            });
            if (claimed.count === 1) {
              await updateBookingAmountsAfterPayment(booking.id, amount, tx);
              const completed = await tx.bookingPayment.findFirstOrThrow({
                where: { id: payment.id },
              });
              await enqueueBookingPayment(tx, completed);
            }
          });
          flushAccountingQueueSoon(orgId);
        } else {
          await prisma.bookingPayment.update({
            where: { id: payment.id },
            data: { status: "failed" },
          });
          await logBookingActivity({
            orgId,
            locationId: booking.locationId,
            bookingId: booking.id,
            kind: "payment",
            payload: {
              paymentId: payment.id,
              tender: "stored_card",
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            },
            actorUserId: actor.sub ?? null,
          });
          // Keep pending_payment
          await prisma.booking.update({
            where: { id: booking.id },
            data: { status: "pending_payment" },
          });
          throw err;
        }
      }
      remainingDue = Math.round((remainingDue - amount) * 100) / 100;
    } else {
      throw new Error(`Unsupported tender type: ${tender.type}`);
    }
  }

  const fresh = await loadBooking(orgId, booking.id);
  if (
    opts?.confirmIfPaid !== false &&
    toNum(fresh.amountDue) <= 0 &&
    !cardCheckoutUrl
  ) {
    const confirmed = await confirmBooking(actor, booking.id, {
      allowUnpaid: true,
      autoReview: true,
    });
    return {
      booking: confirmed,
      paymentIds: createdPaymentIds,
      checkoutUrl: cardCheckoutUrl,
      paymentId: cardPaymentId,
    };
  }

  if (toNum(fresh.amountDue) > 0 && fresh.status !== "confirmed") {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "pending_payment" },
    });
    await syncPartyOpsFromBooking(prisma, booking.id);
  }

  const out = await prisma.booking.findFirstOrThrow({
    where: { id: booking.id },
    include: bookingInclude,
  });
  return {
    booking: toBookingDto(out),
    paymentIds: createdPaymentIds,
    checkoutUrl: cardCheckoutUrl,
    paymentId: cardPaymentId,
  };
}

/**
 * Party deposit paid online (Checkout / payment link) → confirm with balance
 * still due. The engine re-checks the deposit gate and ticketsPerMonth.
 */
export async function confirmPartyWhenDepositPaid(bookingId: string) {
  const party = await prisma.partyBookingDetail.findUnique({
    where: { bookingId },
    select: {
      depositRequiredCents: true,
      depositPaidCents: true,
      booking: { select: { orgId: true, locationId: true, status: true } },
    },
  });
  if (
    !party ||
    party.depositRequiredCents <= 0 ||
    party.depositPaidCents < party.depositRequiredCents ||
    !["hold", "reserved", "pending_payment"].includes(party.booking.status)
  ) {
    return;
  }
  try {
    await confirmBooking({ orgId: party.booking.orgId, sub: "system" }, bookingId, {
      orgId: party.booking.orgId,
      skipStaffGate: true,
      allowUnpaid: true,
      autoReview: true,
    });
  } catch (err) {
    await logBookingActivity({
      orgId: party.booking.orgId,
      locationId: party.booking.locationId,
      bookingId,
      kind: "status",
      payload: {
        event: "party_confirm_after_deposit_failed",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Idempotent settle after Stripe Checkout success (webhook or confirm page).
 * Reloads booking from DB — never trusts metadata orgId for auth.
 */
export async function settleVenueBookingStripePayment(opts: {
  paymentId: string;
  bookingId: string;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  /** Staff search only — Stripe PM fingerprint; never exported. */
  cardFingerprint?: string | null;
  /** Stripe metadata orgId — consistency check only, never authorization. */
  expectedOrgId?: string | null;
}) {
  const payment = await prisma.bookingPayment.findFirst({
    where: { id: opts.paymentId, bookingId: opts.bookingId },
  });
  if (!payment) return { ok: false as const, reason: "payment_not_found" };
  const expectedOrgId = opts.expectedOrgId?.trim();
  if (expectedOrgId && expectedOrgId !== payment.orgId) {
    console.error("[stripe settle] metadata org mismatch", {
      paymentId: payment.id,
      bookingId: payment.bookingId,
    });
    return { ok: false as const, reason: "org_mismatch" };
  }
  if (payment.status === "completed") {
    await prisma.$transaction(async (tx) => {
      await enqueueBookingPayment(tx, payment);
    });
    flushAccountingQueueSoon(payment.orgId);
    return { ok: true as const, idempotent: true };
  }

  let applied = false;
  let needsRefund = false;
  let overpaidWithoutBump = false;
  await prisma.$transaction(
    async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${payment.bookingId} FOR UPDATE
    `;
    const live = await tx.booking.findFirst({
      where: { id: payment.bookingId },
      select: { status: true, amountPaid: true, amountDue: true, total: true },
    });
    const dead =
      !live ||
      ["cancelled", "expired", "refunded"].includes(live.status);

    // Live bookings: claim pending or failed (cancel/fail raced Stripe success).
    // Never reclaim cancelled (line-replace / intentional void). Dead bookings:
    // reclaim cancelled/failed so Stripe success is visible for refund ops.
    const claimStatuses = dead
      ? (["pending", "cancelled", "failed"] as const)
      : (["pending", "failed"] as const);

    if (
      payment.status !== "pending" &&
      payment.status !== "failed" &&
      !(dead && payment.status === "cancelled")
    ) {
      return;
    }

    const claimed = await tx.bookingPayment.updateMany({
      where: {
        id: payment.id,
        bookingId: opts.bookingId,
        status: { in: [...claimStatuses] },
      },
      data: {
        status: "completed",
        stripePaymentIntentId:
          opts.stripePaymentIntentId ?? payment.stripePaymentIntentId,
        stripeChargeId: opts.stripeChargeId ?? payment.stripeChargeId,
        ...(opts.cardFingerprint
          ? { cardFingerprint: opts.cardFingerprint }
          : {}),
      },
    });
    if (claimed.count !== 1) return;

    if (dead) {
      needsRefund = true;
      const completedDead = await tx.bookingPayment.findFirstOrThrow({
        where: { id: payment.id },
      });
      await enqueueBookingPayment(tx, completedDead);
      await logBookingActivity(
        {
          orgId: payment.orgId,
          locationId: payment.locationId,
          bookingId: payment.bookingId,
          kind: "payment",
          payload: {
            paymentId: payment.id,
            tender: "card",
            status: "completed",
            source: "stripe",
            needsRefund: true,
            bookingStatus: live?.status ?? "missing",
          },
        },
        tx
      );
      return;
    }

    // Already fully paid (parallel Checkout race) — complete row, do not bump.
    if (live && toNum(live.amountDue) <= 1e-9) {
      needsRefund = true;
      overpaidWithoutBump = true;
      const completedOverpaid = await tx.bookingPayment.findFirstOrThrow({
        where: { id: payment.id },
      });
      await enqueueBookingPayment(tx, completedOverpaid);
      await logBookingActivity(
        {
          orgId: payment.orgId,
          locationId: payment.locationId,
          bookingId: payment.bookingId,
          kind: "payment",
          payload: {
            paymentId: payment.id,
            tender: "card",
            status: "completed",
            source: "stripe",
            needsRefund: true,
            reason: "already_paid",
          },
        },
        tx
      );
      return;
    }

    applied = true;
    await updateBookingAmountsAfterPayment(
      payment.bookingId,
      toNum(payment.amount),
      tx
    );
    const completed = await tx.bookingPayment.findFirstOrThrow({
      where: { id: payment.id },
    });
    await enqueueBookingPayment(tx, completed);
    await logBookingActivity(
      {
        orgId: payment.orgId,
        locationId: payment.locationId,
        bookingId: payment.bookingId,
        kind: "payment",
        payload: {
          paymentId: payment.id,
          tender: "card",
          status: "completed",
          source: "stripe",
        },
      },
      tx
    );
  },
    { maxWait: 15_000, timeout: 60_000 }
  );
  if (applied || needsRefund) flushAccountingQueueSoon(payment.orgId);

  if (needsRefund) {
    return {
      ok: true as const,
      needsRefund: true as const,
      ...(overpaidWithoutBump ? { reason: "already_paid" as const } : {}),
    };
  }

  if (!applied) {
    const freshPay = await prisma.bookingPayment.findFirst({
      where: { id: payment.id, bookingId: opts.bookingId },
    });
    if (freshPay?.status === "completed") {
      await prisma.$transaction(async (tx) => {
        await enqueueBookingPayment(tx, freshPay);
      });
      flushAccountingQueueSoon(payment.orgId);
      return { ok: true as const, idempotent: true };
    }
    const live = await prisma.booking.findFirst({
      where: { id: opts.bookingId },
      select: { status: true },
    });
    if (
      !live ||
      ["cancelled", "expired", "refunded"].includes(live.status)
    ) {
      return { ok: false as const, reason: "booking_not_payable" };
    }
    return { ok: false as const, reason: "payment_not_pending" };
  }

  const booking = await prisma.booking.findFirst({
    where: { id: opts.bookingId },
  });
  // amountDue already reflects this payment — confirm only when fully paid.
  // Never downgrade an already-confirmed unpaid booking to pending_payment.
  let confirmFailed = false;
  if (booking && toNum(booking.amountDue) <= 0) {
    try {
      await confirmBooking(
        { orgId: booking.orgId, sub: "system" },
        booking.id,
        {
          orgId: booking.orgId,
          skipStaffGate: true,
          allowUnpaid: true,
          autoReview: true,
        }
      );
    } catch (err) {
      confirmFailed = true;
      // Keep seats: extend TTL so expireHolds will not free capacity on a paid booking.
      const extend = new Date(Date.now() + 24 * 3600_000);
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: ["hold", "reserved", "draft"].includes(booking.status)
            ? "pending_payment"
            : booking.status,
          holdExpiresAt: extend,
        },
      });
      await syncPartyOpsFromBooking(prisma, booking.id);
      await logBookingActivity({
        orgId: booking.orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "status",
        payload: {
          event: "confirm_after_settle_failed",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  } else if (
    booking &&
    ["hold", "reserved", "draft", "pending_payment"].includes(booking.status)
  ) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "pending_payment" },
    });
    await syncPartyOpsFromBooking(prisma, booking.id);
    await confirmPartyWhenDepositPaid(booking.id);
  }

  void sendBookingPaymentReceipt({
    bookingId: opts.bookingId,
    paymentId: payment.id,
  }).catch(() => undefined);

  return {
    ok: true as const,
    idempotent: false,
    ...(confirmFailed ? { confirmFailed: true as const } : {}),
  };
}

/**
 * Stripe incomplete / expired Checkout → failed payment row.
 * Booking stay pending_payment; hold TTL still applies.
 */
export async function failVenueBookingStripePayment(opts: {
  paymentId?: string | null;
  bookingId?: string | null;
  stripePaymentIntentId?: string | null;
  reason?: string;
  /** Guest proof (required unless webhook / trusted). */
  viewToken?: string | null;
  paymentLinkToken?: string | null;
  /** Stripe webhook / other verified server callers. */
  trustedSource?: boolean;
}) {
  // Public cancel must prove possession; webhook uses PI id / trustedSource.
  const trusted =
    Boolean(opts.trustedSource) || Boolean(opts.stripePaymentIntentId?.trim());
  if (!trusted) {
    const bookingId = opts.bookingId?.trim() || "";
    // Resolve bookingId from paymentId when only paymentId is sent.
    let resolveBookingId = bookingId;
    if (!resolveBookingId && opts.paymentId) {
      const pay = await prisma.bookingPayment.findFirst({
        where: { id: opts.paymentId },
        select: { bookingId: true },
      });
      resolveBookingId = pay?.bookingId ?? "";
    }
    if (!resolveBookingId) {
      return { ok: false as const, reason: "unauthorized" };
    }
    const { assertGuestMayCancelPendingPayment } = await import(
      "@/lib/ticketing/paymentSafety"
    );
    const allowed = await assertGuestMayCancelPendingPayment({
      bookingId: resolveBookingId,
      viewToken: opts.viewToken,
      paymentLinkToken: opts.paymentLinkToken,
    });
    if (!allowed) {
      return { ok: false as const, reason: "unauthorized" };
    }
    if (!opts.bookingId) opts = { ...opts, bookingId: resolveBookingId };
  }

  let payment = opts.paymentId
    ? await prisma.bookingPayment.findFirst({
        where: {
          id: opts.paymentId,
          ...(opts.bookingId ? { bookingId: opts.bookingId } : {}),
        },
      })
    : opts.stripePaymentIntentId
      ? await prisma.bookingPayment.findFirst({
          where: { stripePaymentIntentId: opts.stripePaymentIntentId },
        })
      : null;

  // Cancel page may only have bookingId — release newest pending card reserve.
  if (!payment && opts.bookingId) {
    payment = await prisma.bookingPayment.findFirst({
      where: {
        bookingId: opts.bookingId,
        status: "pending",
        tender: { in: ["card", "stored_card"] },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!payment) return { ok: false as const, reason: "payment_not_found" };
  if (payment.status === "completed" || payment.status === "refunded") {
    return { ok: true as const, idempotent: true };
  }

  // Atomic claim — never downgrade a concurrent settle completion.
  const claimed = await prisma.bookingPayment.updateMany({
    where: {
      id: payment.id,
      status: { in: ["pending", "cancelled"] },
    },
    data: { status: "failed" },
  });
  if (claimed.count !== 1) {
    const fresh = await prisma.bookingPayment.findFirst({
      where: { id: payment.id },
    });
    if (fresh?.status === "completed" || fresh?.status === "refunded") {
      return { ok: true as const, idempotent: true };
    }
    if (fresh?.status === "failed") {
      return { ok: true as const, idempotent: true };
    }
    return { ok: false as const, reason: "payment_not_pending" };
  }
  await logBookingActivity({
    orgId: payment.orgId,
    locationId: payment.locationId,
    bookingId: payment.bookingId,
    kind: "payment",
    payload: {
      paymentId: payment.id,
      status: "failed",
      source: "stripe",
      reason: opts.reason ?? "incomplete",
    },
  });
  const booking = await prisma.booking.findFirst({
    where: { id: payment.bookingId },
    select: { id: true, status: true },
  });
  if (
    booking &&
    ["hold", "reserved", "draft"].includes(booking.status)
  ) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "pending_payment" },
    });
  }
  return { ok: true as const, idempotent: false };
}

export async function chargeStoredPaymentMethod(
  actor: TicketingActor,
  bookingId: string,
  storedPaymentMethodId: string,
  amount?: number
) {
  const booking = await loadBooking(
    await assertTicketingStaffMutate(actor),
    bookingId
  );
  const payAmount =
    amount != null ? Number(amount) : toNum(booking.amountDue);
  if (!(payAmount > 0)) throw new TicketingError(PAYMENT_INCOMPLETE, 400);
  return takeBookingPayments(actor, bookingId, [
    {
      type: "stored_card",
      amount: payAmount,
      storedPaymentMethodId,
    },
  ]);
}

export async function listBookingPayments(
  actor: TicketingActor,
  filters: {
    q?: string;
    from?: string;
    to?: string;
    locationId?: string;
  } = {}
) {
  const { assertTicketingStaffRead, locationScopeFilter, applyTicketingLocationScope } =
    await import("@/lib/ticketing/common");
  await assertTicketingStaffRead(actor);
  const scope = await locationScopeFilter(actor);
  const where: Prisma.BookingPaymentWhereInput = { orgId: scope.orgId };
  applyTicketingLocationScope(scope, where);
  if (!scope.parkLocked && !scope.locationId && filters.locationId) {
    where.locationId = filters.locationId;
  }
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { stripePaymentIntentId: { contains: q } },
      { booking: { publicId: { contains: q, mode: "insensitive" } } },
      {
        booking: {
          primaryContactEmail: { contains: q, mode: "insensitive" },
        },
      },
    ];
  }

  const rows = await prisma.bookingPayment.findMany({
    where,
    include: {
      booking: {
        select: {
          publicId: true,
          primaryContactName: true,
          primaryContactEmail: true,
        },
      },
      location: { select: { id: true, name: true } },
      receivedByStaff: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return rows.map((r) => ({
    id: r.id,
    bookingId: r.bookingId,
    bookingPublicId: r.booking.publicId,
    guest: r.booking.primaryContactName,
    email: r.booking.primaryContactEmail,
    tender: r.tender,
    amount: toNum(r.amount),
    currency: r.currency,
    status: r.status,
    stripePaymentIntentId: r.stripePaymentIntentId,
    venue: r.location,
    staff: r.receivedByStaff,
    createdAt: r.createdAt.toISOString(),
  }));
}

export { Decimal };
