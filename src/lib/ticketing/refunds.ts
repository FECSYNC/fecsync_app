/**
 * Booking refunds — full/partial; original tender or gift_card credit.
 *
 * Original-tender path claims `amountRefunded` under booking FOR UPDATE *before*
 * Stripe/gift external calls so concurrent refunds cannot double-spend the same
 * tender. Booking `amountPaid` is always recomputed from the payment ledger
 * (absolute) so staff finalize stays idempotent with webhook absolute sync.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireId } from "@/lib/ids";
import { refundPayment } from "@/lib/stripe";
import {
  assertTicketingStaffMutate,
  assertLocationInHqScope,
  type TicketingActor,
} from "@/lib/ticketing/common";
import {
  TicketingError,
  BOOKING_NOT_FOUND,
} from "@/lib/ticketing/errors";
import { issueGiftCard } from "@/lib/ticketing/giftCards";
import { logBookingActivity } from "@/lib/ticketing/activity";
import {
  voidUnusedCredentials,
  restorableCapacityQty,
} from "@/lib/ticketing/credentials";
import { releaseSessionCapacity } from "@/lib/ticketing/capacity";
import { restoreAddOnStockForLines } from "@/lib/ticketing/stockPeriods";
import { syncPartyAfterBookingWrite } from "@/lib/parties/bookingHooks";
import {
  bookingInclude,
  toBookingDto,
  toNum,
  money,
} from "@/lib/ticketing/bookingEngine";
import {
  enqueueBookingRefund,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

type Tx = Prisma.TransactionClient;

async function restoreCapacityAndAddOnStockOnFullRefund(
  tx: Tx,
  booking: {
    id: string;
    orgId: string;
    locationId: string;
    lines: Array<{
      sessionId: string | null;
      qty: number;
      productId: string | null;
      productType: string;
      visitDate: Date | null;
    }>;
  },
  lockedStatus: string
) {
  if (lockedStatus === "confirmed") {
    const heldQty = booking.lines
      .filter((l) => l.sessionId)
      .reduce((s, l) => s + l.qty, 0);
    const restore = await restorableCapacityQty(booking.id, heldQty, tx);
    let remainingRestore = restore;
    for (const line of booking.lines) {
      if (!line.sessionId || remainingRestore <= 0) continue;
      const qty = Math.min(line.qty, remainingRestore);
      await releaseSessionCapacity(line.sessionId, qty, tx);
      remainingRestore -= qty;
    }
    await voidUnusedCredentials(booking.id, tx);
  } else if (
    ["hold", "reserved", "pending_payment"].includes(lockedStatus)
  ) {
    const { releaseHoldsForBooking } = await import("@/lib/ticketing/holds");
    await releaseHoldsForBooking(booking.id, tx);
    await voidUnusedCredentials(booking.id, tx);
  }
  if (
    ["confirmed", "hold", "reserved", "pending_payment"].includes(lockedStatus)
  ) {
    await restoreAddOnStockForLines(
      {
        bookingId: booking.id,
        orgId: booking.orgId,
        locationId: booking.locationId,
        lines: booking.lines,
      },
      tx
    );
  }
  await tx.bookingPaymentLink.deleteMany({
    where: { bookingId: booking.id },
  });
}

type TenderClaim = {
  id: string;
  slice: number;
  payAmt: number;
  prevRefunded: number;
  nextRefunded: number;
  tender: string;
  stripePaymentIntentId?: string | null;
  giftCardId?: string | null;
  /** When set, refund must also refund_application_fee (Connect destination). */
  connectedAccountId?: string | null;
};

function refundableRemaining(p: {
  amount: unknown;
  amountRefunded?: unknown;
  status: string;
}) {
  if (!["completed", "partial_refund"].includes(p.status)) return 0;
  const payAmt = toNum(p.amount as never);
  const already = toNum(p.amountRefunded as never);
  return Math.max(0, Math.round((payAmt - already) * 100) / 100);
}

async function stampPaymentClaim(
  tx: Tx,
  claim: Pick<TenderClaim, "id" | "nextRefunded" | "payAmt">
) {
  await tx.bookingPayment.update({
    where: { id: claim.id },
    data: {
      amountRefunded: money(claim.nextRefunded),
      status:
        claim.nextRefunded + 1e-9 >= claim.payAmt
          ? "refunded"
          : "partial_refund",
    },
  });
}

async function reversePaymentClaim(claim: TenderClaim) {
  try {
    await prisma.bookingPayment.update({
      where: { id: claim.id },
      data: {
        amountRefunded: money(claim.prevRefunded),
        status:
          claim.prevRefunded <= 1e-9
            ? "completed"
            : claim.prevRefunded + 1e-9 >= claim.payAmt
              ? "refunded"
              : "partial_refund",
      },
    });
  } catch (err) {
    console.error(
      "[booking refund] failed to reverse payment claim",
      claim.id,
      err
    );
    throw err;
  }
}

/**
 * Absolute amountPaid from live payment rows (completed / partial / refunded).
 * Pending/failed/cancelled tenders do not count.
 */
async function amountPaidFromLedger(
  tx: Tx,
  bookingId: string
): Promise<number> {
  const pays = await tx.bookingPayment.findMany({
    where: {
      bookingId,
      status: { in: ["completed", "partial_refund", "refunded"] },
    },
    select: { amount: true, amountRefunded: true, status: true },
  });
  return (
    Math.round(
      pays.reduce((s, p) => {
        const rem = Math.max(
          0,
          Math.round(
            (toNum(p.amount) - toNum(p.amountRefunded as never)) * 100
          ) / 100
        );
        return s + rem;
      }, 0) * 100
    ) / 100
  );
}

export async function refundBooking(
  actor: TicketingActor,
  bookingId: string,
  opts: {
    amount: number;
    method: "original" | "gift_card";
    reason?: string;
  }
) {
  const orgId = await assertTicketingStaffMutate(actor);
  const booking = await prisma.booking.findFirst({
    where: { id: requireId(bookingId, "bookingId"), orgId },
    include: { ...bookingInclude, lines: true, payments: true },
  });
  if (!booking) throw new TicketingError(BOOKING_NOT_FOUND, 404);
  await assertLocationInHqScope(actor, booking.locationId);
  if (booking.status === "refunded") {
    throw new Error("Booking is already fully refunded");
  }

  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error("Refund amount must be > 0");
  const paid = toNum(booking.amountPaid);
  if (amount > paid + 1e-9) {
    throw new Error("Refund exceeds amount paid");
  }

  let giftCode: string | null = null;
  let refundedAmount = 0;
  const claims: TenderClaim[] = [];

  if (opts.method === "gift_card") {
    // Single TX: issue store credit + ledger (no external Stripe).
    // Gift-credit refunds reduce amountPaid by the issued credit; original
    // tenders are stamped fully only on a full booking refund (webhook-safe).
    refundedAmount = amount;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
      `;
      const locked = await tx.booking.findFirst({
        where: { id: booking.id },
        select: { status: true, amountPaid: true, total: true },
      });
      if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
      if (locked.status === "refunded") return;

      const livePaid = toNum(locked.amountPaid);
      if (amount > livePaid + 1e-9) {
        throw new Error("Refund exceeds amount paid");
      }

      const issued = await issueGiftCard({
        orgId,
        amount: refundedAmount,
        issuedFromRefundBookingId: booking.id,
        db: tx,
      });
      giftCode = issued.code;

      const liveNewPaid =
        Math.round((livePaid - refundedAmount) * 100) / 100;
      const liveFull = liveNewPaid <= 1e-9;
      if (liveFull) {
        const pays = await tx.bookingPayment.findMany({
          where: {
            bookingId: booking.id,
            status: { in: ["completed", "partial_refund"] },
          },
          select: { id: true, amount: true },
        });
        for (const p of pays) {
          await tx.bookingPayment.update({
            where: { id: p.id },
            data: {
              status: "refunded",
              amountRefunded: money(toNum(p.amount)),
            },
          });
        }
      }

      const liveNewDue = Math.max(
        0,
        Math.round((toNum(locked.total) - liveNewPaid) * 100) / 100
      );

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          amountPaid: money(liveFull ? 0 : liveNewPaid),
          amountDue: money(liveNewDue),
          status: liveFull ? "refunded" : locked.status,
          updatedById: actor.sub ?? null,
        },
      });

      if (liveNewDue > 0) {
        await tx.bookingInvoice.updateMany({
          where: {
            bookingId: booking.id,
            status: { in: ["draft", "sent", "overdue", "paid"] },
          },
          data: {
            status: "sent",
            amount: money(liveNewDue),
            amountDue: money(liveNewDue),
          },
        });
      }

      if (liveFull) {
        await restoreCapacityAndAddOnStockOnFullRefund(
          tx,
          booking,
          locked.status
        );
      }
      await syncPartyAfterBookingWrite(tx, booking.id);
      await enqueueBookingRefund(
        tx,
        booking,
        `refund:gc:${issued.giftCard.id}:${Math.round(refundedAmount * 100)}`
      );

      await logBookingActivity(
        {
          orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "payment",
          payload: {
            event: "refund",
            amount: refundedAmount,
            method: opts.method,
            reason: opts.reason ?? null,
            giftCodeIssued: Boolean(giftCode),
            full: liveFull,
          },
          actorUserId: actor.sub ?? null,
        },
        tx
      );
    });
    flushAccountingQueueSoon(orgId);

    const freshGc = await prisma.booking.findFirstOrThrow({
      where: { id: booking.id },
      include: bookingInclude,
    });
    return { booking: toBookingDto(freshGc), giftCardCode: giftCode };
  }

  // --- original tender: claim under lock, then Stripe/gift external, then finalize ---
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const locked = await tx.booking.findFirst({
      where: { id: booking.id },
      include: { payments: true },
    });
    if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    if (locked.status === "refunded") {
      throw new Error("Booking is already fully refunded");
    }
    const livePaid = toNum(locked.amountPaid);
    if (amount > livePaid + 1e-9) {
      throw new Error("Refund exceeds amount paid");
    }

    let remaining = amount;
    const payments = locked.payments ?? [];

    const cardPays = payments
      .filter(
        (p) =>
          refundableRemaining(p) > 0 &&
          (p.tender === "card" || p.tender === "stored_card") &&
          p.stripePaymentIntentId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    for (const pay of cardPays) {
      if (remaining <= 0) break;
      const payAmt = toNum(pay.amount);
      const already = toNum(pay.amountRefunded);
      const left = refundableRemaining(pay);
      const slice = Math.min(left, remaining);
      const nextRefunded = Math.round((already + slice) * 100) / 100;
      const claim: TenderClaim = {
        id: pay.id,
        slice,
        payAmt,
        prevRefunded: already,
        nextRefunded,
        tender: pay.tender,
        stripePaymentIntentId: pay.stripePaymentIntentId,
        connectedAccountId:
          (pay as { connectedAccountId?: string | null }).connectedAccountId ??
          null,
      };
      await stampPaymentClaim(tx, claim);
      claims.push(claim);
      remaining = Math.round((remaining - slice) * 100) / 100;
    }

    const giftPays = payments.filter(
      (p) =>
        refundableRemaining(p) > 0 &&
        p.tender === "gift_card" &&
        p.giftCardId
    );
    for (const pay of giftPays) {
      if (remaining <= 0) break;
      const payAmt = toNum(pay.amount);
      const already = toNum(pay.amountRefunded);
      const left = refundableRemaining(pay);
      const slice = Math.min(left, remaining);
      const nextRefunded = Math.round((already + slice) * 100) / 100;
      const claim: TenderClaim = {
        id: pay.id,
        slice,
        payAmt,
        prevRefunded: already,
        nextRefunded,
        tender: pay.tender,
        giftCardId: pay.giftCardId,
      };
      await stampPaymentClaim(tx, claim);
      claims.push(claim);
      remaining = Math.round((remaining - slice) * 100) / 100;
    }

    const cashPays = payments.filter(
      (p) =>
        refundableRemaining(p) > 0 &&
        (p.tender === "cash" || p.tender === "split_component")
    );
    for (const pay of cashPays) {
      if (remaining <= 0) break;
      const payAmt = toNum(pay.amount);
      const already = toNum(pay.amountRefunded);
      const left = refundableRemaining(pay);
      const slice = Math.min(left, remaining);
      const nextRefunded = Math.round((already + slice) * 100) / 100;
      const claim: TenderClaim = {
        id: pay.id,
        slice,
        payAmt,
        prevRefunded: already,
        nextRefunded,
        tender: pay.tender,
      };
      await stampPaymentClaim(tx, claim);
      claims.push(claim);
      remaining = Math.round((remaining - slice) * 100) / 100;
    }

    if (!claims.length) {
      throw new Error("Refund could not be processed");
    }
    if (remaining > 1e-9) {
      throw new Error(
        "Refund could not be fully allocated across payment tenders"
      );
    }
  });

  // External movers — reverse claim on failure so concurrent refunds can retry.
  const succeeded: TenderClaim[] = [];
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i]!;
    try {
      if (
        (claim.tender === "card" || claim.tender === "stored_card") &&
        claim.stripePaymentIntentId
      ) {
        await refundPayment(claim.stripePaymentIntentId, claim.slice, {
          refundApplicationFee: Boolean(claim.connectedAccountId?.trim()),
        });
      } else if (claim.tender === "gift_card" && claim.giftCardId) {
        const { creditGiftCard } = await import("@/lib/ticketing/giftCards");
        await creditGiftCard(claim.giftCardId, claim.slice);
      }
      // cash / split_component: ledger-only
      succeeded.push(claim);
      refundedAmount = Math.round((refundedAmount + claim.slice) * 100) / 100;
    } catch (err) {
      console.warn("[booking refund] external refund failed", err);
      const toReverse = [claim, ...claims.slice(i + 1)].filter(
        (c) => !succeeded.includes(c)
      );
      for (const rest of toReverse) {
        try {
          await reversePaymentClaim(rest);
        } catch (revErr) {
          console.error(
            "[booking refund] claim reverse failed after external error",
            rest.id,
            revErr
          );
        }
      }
      break;
    }
  }

  if (refundedAmount <= 0) {
    throw new Error("Refund could not be processed");
  }
  if (refundedAmount + 1e-9 < amount) {
    console.warn("[booking refund] partial tender success", {
      requested: amount,
      refundedAmount,
      bookingId: booking.id,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
    `;
    const locked = await tx.booking.findFirst({
      where: { id: booking.id },
      select: { status: true, total: true },
    });
    if (!locked) throw new TicketingError(BOOKING_NOT_FOUND, 404);
    if (locked.status === "refunded") {
      return;
    }

    const liveNewPaid = await amountPaidFromLedger(tx, booking.id);
    const liveFull = liveNewPaid <= 1e-9;
    const liveNewDue = Math.max(
      0,
      Math.round((toNum(locked.total) - liveNewPaid) * 100) / 100
    );

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        amountPaid: money(liveNewPaid),
        amountDue: money(liveNewDue),
        status: liveFull ? "refunded" : locked.status,
        updatedById: actor.sub ?? null,
      },
    });

    if (liveNewDue > 0) {
      await tx.bookingInvoice.updateMany({
        where: {
          bookingId: booking.id,
          status: { in: ["draft", "sent", "overdue", "paid"] },
        },
        data: {
          status: "sent",
          amount: money(liveNewDue),
          amountDue: money(liveNewDue),
        },
      });
    }

    if (liveFull) {
      await restoreCapacityAndAddOnStockOnFullRefund(
        tx,
        booking,
        locked.status
      );
    }
    await syncPartyAfterBookingWrite(tx, booking.id);
    const claimKey = succeeded
      .map((c) => `${c.id}:${Math.round(c.slice * 100)}`)
      .sort()
      .join("|");
    await enqueueBookingRefund(
      tx,
      booking,
      `refund:orig:${claimKey || Math.round(refundedAmount * 100)}`
    );

    await logBookingActivity(
      {
        orgId,
        locationId: booking.locationId,
        bookingId: booking.id,
        kind: "payment",
        payload: {
          event: "refund",
          amount: refundedAmount,
          method: opts.method,
          reason: opts.reason ?? null,
          giftCodeIssued: false,
          full: liveFull,
        },
        actorUserId: actor.sub ?? null,
      },
      tx
    );
  });
  flushAccountingQueueSoon(orgId);

  const fresh = await prisma.booking.findFirstOrThrow({
    where: { id: booking.id },
    include: bookingInclude,
  });
  return { booking: toBookingDto(fresh), giftCardCode: giftCode };
}

/**
 * Stripe charge.refunded / refund.updated — idempotent ledger + capacity sync for venue_booking.
 * Full refund mirrors staff refund (restore seats / void unused tickets when still held or confirmed).
 *
 * Payment status + booking ledger update in one transaction so a mid-flight failure cannot
 * mark the payment refunded while leaving amountPaid stale (retries would no-op).
 */
export async function applyVenueBookingStripeRefundEvent(opts: {
  paymentId?: string | null;
  bookingId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  /**
   * Delta to subtract from booking.amountPaid (this event only).
   * Prefer Stripe previous_attributes delta — never pass cumulative amount_refunded here.
   */
  amount?: number | null;
  /** Cumulative charge.amount_refunded (dollars) — drives payment row status + absolute sync. */
  cumulativeRefunded?: number | null;
  reason?: string;
}) {
  const paymentId = opts.paymentId?.trim() || null;
  const bookingId = opts.bookingId?.trim() || null;

  let payment = paymentId
    ? await prisma.bookingPayment.findFirst({
        where: {
          id: paymentId,
          ...(bookingId ? { bookingId } : {}),
        },
      })
    : null;
  // Stale/wrong metadata.paymentId must not drop a real PI/charge match.
  if (!payment && opts.stripePaymentIntentId) {
    payment = await prisma.bookingPayment.findFirst({
      where: { stripePaymentIntentId: opts.stripePaymentIntentId },
    });
  }
  if (!payment && opts.stripeChargeId) {
    payment = await prisma.bookingPayment.findFirst({
      where: { stripeChargeId: opts.stripeChargeId },
    });
  }
  if (!payment) return { ok: false as const, reason: "payment_not_found" };

  const paymentAmt = toNum(payment.amount);
  // amount = delta for this event. Null + cumulativeRefunded = status/absolute sync only.
  // Null alone (smoke / legacy) = full payment refund.
  let delta: number;
  if (opts.amount != null) {
    delta = Math.round(Number(opts.amount) * 100) / 100;
  } else if (opts.cumulativeRefunded != null) {
    delta = 0;
  } else {
    delta = paymentAmt;
  }

  const cumulative =
    opts.cumulativeRefunded != null && opts.cumulativeRefunded >= 0
      ? Math.round(Number(opts.cumulativeRefunded) * 100) / 100
      : delta > 0
        ? delta
        : paymentAmt;
  const paymentFullyRefunded = cumulative + 1e-9 >= paymentAmt;

  // Fast path: already fully refunded and no absolute sync requested.
  if (
    payment.status === "refunded" &&
    opts.cumulativeRefunded == null &&
    !(delta > 0)
  ) {
    return { ok: true as const, idempotent: true };
  }

  let idempotent = false;
  let applied = false;

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM bookings WHERE id = ${payment!.bookingId} FOR UPDATE
      `;
      const livePay = await tx.bookingPayment.findFirst({
        where: { id: payment!.id },
      });
      if (!livePay) return;
      if (
        !["completed", "partial_refund", "refunded"].includes(livePay.status)
      ) {
        return;
      }

      const booking = await tx.booking.findFirst({
        where: { id: livePay.bookingId },
        include: { lines: true },
      });
      if (!booking) return;

      const targetPayStatus = paymentFullyRefunded
        ? ("refunded" as const)
        : ("partial_refund" as const);

      let newPaid: number;
      let refundAmtForLog = Math.max(0, delta);
      if (opts.cumulativeRefunded != null) {
        // Absolute sync from Stripe cumulative — safe under staff+webhook races and retries.
        const cum = Math.min(
          paymentAmt,
          Math.max(0, Math.round(Number(opts.cumulativeRefunded) * 100) / 100)
        );
        const thisCounts = Math.max(
          0,
          Math.round((paymentAmt - cum) * 100) / 100
        );
        const siblings = await tx.bookingPayment.findMany({
          where: {
            bookingId: livePay.bookingId,
            id: { not: livePay.id },
            status: { in: ["completed", "partial_refund"] },
          },
          select: { amount: true, amountRefunded: true },
        });
        const otherPaid = siblings.reduce((s, p) => {
          const rem = Math.max(
            0,
            Math.round((toNum(p.amount) - toNum(p.amountRefunded)) * 100) / 100
          );
          return s + rem;
        }, 0);
        newPaid = Math.min(
          toNum(booking.total),
          Math.round((otherPaid + thisCounts) * 100) / 100
        );
        refundAmtForLog = Math.max(
          0,
          Math.round((toNum(booking.amountPaid) - newPaid) * 100) / 100
        );
      } else if (delta > 0) {
        if (livePay.status === "refunded") {
          idempotent = true;
          return;
        }
        newPaid = Math.max(
          0,
          Math.round((toNum(booking.amountPaid) - delta) * 100) / 100
        );
      } else {
        // Status-only (no ledger delta).
        if (livePay.status === targetPayStatus || livePay.status === "refunded") {
          idempotent = true;
          return;
        }
        await tx.bookingPayment.updateMany({
          where: {
            id: livePay.id,
            status: { in: ["completed", "partial_refund"] },
          },
          data: {
            status: targetPayStatus,
            ...(opts.stripeChargeId
              ? { stripeChargeId: opts.stripeChargeId }
              : {}),
          },
        });
        applied = true;
        return;
      }

      const paidUnchanged =
        Math.abs(toNum(booking.amountPaid) - newPaid) < 1e-9;
      const statusUnchanged =
        livePay.status === targetPayStatus ||
        (livePay.status === "refunded" && targetPayStatus === "refunded");

      if (booking.status === "refunded") {
        // Never revive amountPaid on an already-refunded booking (e.g. gift_card
        // method left original tenders completed until stamped).
        const payClaim = await tx.bookingPayment.updateMany({
          where: {
            id: livePay.id,
            status: { in: ["completed", "partial_refund"] },
          },
          data: {
            status: targetPayStatus,
            amountRefunded: money(
              opts.cumulativeRefunded != null
                ? Math.min(
                    paymentAmt,
                    Math.max(
                      0,
                      Math.round(Number(opts.cumulativeRefunded) * 100) / 100
                    )
                  )
                : paymentFullyRefunded
                  ? paymentAmt
                  : Math.min(
                      paymentAmt,
                      Math.round(
                        (toNum(livePay.amountRefunded) + Math.max(0, delta)) *
                          100
                      ) / 100
                    )
            ),
            ...(opts.stripeChargeId
              ? { stripeChargeId: opts.stripeChargeId }
              : {}),
          },
        });
        if (payClaim.count === 0 && statusUnchanged) {
          idempotent = true;
        } else {
          applied = true;
        }
        return;
      }

      if (paidUnchanged && statusUnchanged && opts.cumulativeRefunded == null) {
        idempotent = true;
        return;
      }

      const stampedRefunded =
        opts.cumulativeRefunded != null
          ? Math.min(
              paymentAmt,
              Math.max(
                0,
                Math.round(Number(opts.cumulativeRefunded) * 100) / 100
              )
            )
          : Math.min(
              paymentAmt,
              Math.round(
                (toNum(livePay.amountRefunded) + Math.max(0, delta)) * 100
              ) / 100
            );

      // When staff already claimed amountRefunded ahead of Stripe, do not lower
      // the stamp below the staff claim (max of live vs Stripe cumulative).
      const effectiveRefunded = Math.max(
        toNum(livePay.amountRefunded),
        stampedRefunded
      );

      await tx.bookingPayment.update({
        where: { id: livePay.id },
        data: {
          status:
            effectiveRefunded + 1e-9 >= paymentAmt
              ? "refunded"
              : "partial_refund",
          amountRefunded: money(effectiveRefunded),
          ...(opts.stripeChargeId
            ? { stripeChargeId: opts.stripeChargeId }
            : {}),
        },
      });

      // Prefer absolute ledger when cumulative known; else use computed newPaid.
      let finalPaid = newPaid;
      if (opts.cumulativeRefunded != null) {
        finalPaid = await amountPaidFromLedger(tx, livePay.bookingId);
      }

      const newDue = Math.max(
        0,
        Math.round((toNum(booking.total) - finalPaid) * 100) / 100
      );
      const full = finalPaid <= 1e-9;

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          amountPaid: money(finalPaid),
          amountDue: money(newDue),
          status: full ? "refunded" : booking.status,
        },
      });

      if (newDue > 0) {
        await tx.bookingInvoice.updateMany({
          where: {
            bookingId: booking.id,
            status: { in: ["draft", "sent", "overdue", "paid"] },
          },
          data: {
            status: "sent",
            amount: money(newDue),
            amountDue: money(newDue),
          },
        });
      }

      if (full) {
        await restoreCapacityAndAddOnStockOnFullRefund(
          tx,
          {
            id: booking.id,
            orgId: booking.orgId,
            locationId: booking.locationId,
            lines: booking.lines,
          },
          booking.status
        );
      }
      await syncPartyAfterBookingWrite(tx, booking.id);
      const payAfter = await tx.bookingPayment.findFirstOrThrow({
        where: { id: livePay.id },
        select: { amountRefunded: true },
      });
      await enqueueBookingRefund(
        tx,
        booking,
        `refund:${livePay.id}:${Math.round(toNum(payAfter.amountRefunded) * 100)}`
      );

      await logBookingActivity(
        {
          orgId: booking.orgId,
          locationId: booking.locationId,
          bookingId: booking.id,
          kind: "payment",
          payload: {
            event: "stripe_refund",
            amount: refundAmtForLog,
            cumulativeRefunded: opts.cumulativeRefunded ?? null,
            reason: opts.reason ?? null,
            full,
          },
          actorUserId: null,
        },
        tx
      );
      applied = true;
    },
    { maxWait: 15_000, timeout: 30_000 }
  );
  if (applied) flushAccountingQueueSoon(payment.orgId);

  return { ok: true as const, idempotent, applied };
}
