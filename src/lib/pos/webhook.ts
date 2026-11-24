import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { money, num, roundMoney } from "@/lib/pos/money";
import { confirmBooking } from "@/lib/ticketing/bookingEngine";
import { fulfillCompletedPosSale } from "@/lib/pos/fulfillSale";
import { syncPartyMoney } from "@/lib/parties/deposits";
import {
  enqueueSource,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

/**
 * Idempotent settle for metadata.type = pos_sale.
 * Locks the payment row (FOR UPDATE) so concurrent webhook + client confirm
 * cannot double-flip status or double-fulfill. Sequential replay stays safe.
 * Payment-link Checkout rows may start as `cs:<sessionId>` until the PI attaches.
 */
export async function settlePosSalePayment(
  stripePaymentIntentId: string,
  opts?: { checkoutSessionId?: string; posSaleId?: string }
) {
  const txResult = await prisma.$transaction(
    async (tx) => {
      let payment =
        (await tx.posSalePayment.findFirst({
          where: { stripePaymentIntentId },
        })) ?? null;
      if (!payment && opts?.checkoutSessionId) {
        payment = await tx.posSalePayment.findFirst({
          where: { stripePaymentIntentId: `cs:${opts.checkoutSessionId}` },
        });
      }
      if (!payment && opts?.posSaleId) {
        payment = await tx.posSalePayment.findFirst({
          where: {
            saleId: opts.posSaleId,
            tender: "payment_link",
            status: "pending",
          },
          orderBy: { createdAt: "desc" },
        });
      }
      if (!payment) return { ok: false as const, reason: "unknown_payment" as const };

      await tx.$queryRaw`
        SELECT id FROM pos_sale_payments WHERE id = ${payment.id} LIMIT 1 FOR UPDATE
      `;
      payment = await tx.posSalePayment.findFirstOrThrow({ where: { id: payment.id } });

      if (payment.status === "completed") {
        return {
          ok: true as const,
          already: true as const,
          saleId: payment.saleId,
          shouldReconcile: true as const,
        };
      }

      const resolvedPi = stripePaymentIntentId.startsWith("pi_")
        ? stripePaymentIntentId
        : payment.stripePaymentIntentId?.startsWith("pi_")
          ? payment.stripePaymentIntentId
          : stripePaymentIntentId;

      await tx.$queryRaw`
        SELECT id FROM pos_sales WHERE id = ${payment.saleId} LIMIT 1 FOR UPDATE
      `;
      const sale = await tx.posSale.findFirstOrThrow({
        where: { id: payment.saleId },
        include: { payments: true, bookings: true },
      });

      // Money may still land after void/refund — record the payment, never fulfill.
      const saleTerminal =
        sale.status === "voided" || sale.status === "refunded";

      // Allow settle from pending/failed/authorized (e.g. retry after failed confirm).
      const flipped = await tx.posSalePayment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["pending", "failed", "authorized"] },
        },
        data: {
          status: "completed",
          ...(resolvedPi.startsWith("pi_") ? { stripePaymentIntentId: resolvedPi } : {}),
        },
      });
      if (flipped.count === 0) {
        const again = await tx.posSalePayment.findFirstOrThrow({ where: { id: payment.id } });
        if (again.status === "completed") {
          return {
            ok: true as const,
            already: true as const,
            saleId: payment.saleId,
            shouldReconcile: !saleTerminal,
          };
        }
        return { ok: false as const, reason: "unsettled_status" as const };
      }

      const paid = roundMoney(
        sale.payments.reduce((s, p) => {
          const status = p.id === payment!.id ? "completed" : p.status;
          return status === "completed" ? s + num(p.amount) : s;
        }, 0)
      );
      const due = roundMoney(Math.max(0, num(sale.total) - paid));
      const nextStatus = saleTerminal
        ? sale.status
        : due <= 0
          ? "completed"
          : "unpaid";
      await tx.posSale.update({
        where: { id: sale.id },
        data: {
          amountPaid: money(paid),
          amountDue: money(due),
          status: nextStatus,
        },
      });
      if (saleTerminal) {
        // Money landed after void/full refund — post as unapplied clearing, not sale revenue.
        await enqueueSource(tx, {
          orgId: sale.orgId,
          locationId: sale.locationId,
          sourceType: "pos_sale",
          sourceId: sale.id,
          sourceEvent: `late_settle:${payment.id}`,
          payload: { paymentId: payment.id },
        });
      } else {
        await enqueueSource(tx, {
          orgId: sale.orgId,
          locationId: sale.locationId,
          sourceType: "pos_sale",
          sourceId: sale.id,
          sourceEvent: nextStatus,
        });
      }

      if (saleTerminal || due > 0) {
        return {
          ok: true as const,
          already: false as const,
          saleId: sale.id,
          orgId: sale.orgId,
          shouldReconcile: false as const,
        };
      }

      // Apply booking money inside the lock. Confirm + fulfill run after commit.
      await applyBookingPaymentsForSettledSale(tx, {
        saleId: sale.id,
        orgId: sale.orgId,
        locationId: sale.locationId,
        bookingIds: sale.bookings.map((b) => b.bookingId),
        resolvedPi,
      });

      return {
        ok: true as const,
        already: false as const,
        saleId: sale.id,
        shouldReconcile: true as const,
        cashierUserId: sale.cashierUserId,
        orgId: sale.orgId,
        bookingIds: sale.bookings.map((b) => b.bookingId),
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  if (!txResult.ok) return txResult;
  if ("orgId" in txResult && txResult.orgId) {
    flushAccountingQueueSoon(txResult.orgId);
  }

  if ("shouldReconcile" in txResult && txResult.shouldReconcile) {
    await reconcileCompletedPosSaleSideEffects({
      saleId: txResult.saleId,
      orgId: "orgId" in txResult ? txResult.orgId : undefined,
      cashierUserId: "cashierUserId" in txResult ? txResult.cashierUserId : undefined,
      bookingIds: "bookingIds" in txResult ? txResult.bookingIds : undefined,
      resolvedPi: stripePaymentIntentId.startsWith("pi_") ? stripePaymentIntentId : undefined,
    });
  }

  return {
    ok: true as const,
    already: Boolean(txResult.already),
    saleId: txResult.saleId,
  };
}

async function applyBookingPaymentsForSettledSale(
  tx: Prisma.TransactionClient,
  opts: {
    saleId: string;
    orgId: string;
    locationId: string;
    bookingIds: string[];
    resolvedPi: string;
  }
) {
  for (const bookingId of opts.bookingIds) {
    const booking = await tx.booking.findFirst({ where: { id: bookingId } });
    if (!booking) continue;
    if (["cancelled", "expired", "refunded"].includes(booking.status)) continue;

    const existingPay = await tx.bookingPayment.findFirst({
      where: { bookingId: booking.id, posSaleId: opts.saleId },
    });
    if (!existingPay) {
      await tx.bookingPayment.create({
        data: {
          orgId: opts.orgId,
          locationId: opts.locationId,
          bookingId: booking.id,
          tender: "card",
          amount: booking.total,
          status: "completed",
          posSaleId: opts.saleId,
          stripePaymentIntentId: opts.resolvedPi.startsWith("pi_") ? opts.resolvedPi : null,
        },
      });
    }
    // Always clear dues when the POS sale is fully paid — including bookings
    // that were confirmBooking(allowUnpaid) during payment-link checkout.
    if (num(booking.amountDue) > 0 || num(booking.amountPaid) + 0.001 < num(booking.total)) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { amountPaid: booking.total, amountDue: money(0) },
      });
    }
    await syncPartyMoney(tx, booking.id);
  }
}

/**
 * After money commit: confirm bookings, fulfill gifts/memberships/kitchen, settle tabs.
 * Safe to call on replay (already) when a prior settle crashed mid-side-effect.
 */
async function reconcileCompletedPosSaleSideEffects(opts: {
  saleId: string;
  orgId?: string;
  cashierUserId?: string | null;
  bookingIds?: string[];
  resolvedPi?: string;
}) {
  const sale = await prisma.posSale.findFirst({
    where: { id: opts.saleId },
    include: { bookings: true },
  });
  if (!sale || sale.status !== "completed") return;

  const orgId = opts.orgId ?? sale.orgId;
  const cashierUserId = opts.cashierUserId ?? sale.cashierUserId;
  const bookingIds = opts.bookingIds ?? sale.bookings.map((b) => b.bookingId);
  const resolvedPi = opts.resolvedPi ?? "";

  // Recover booking payment rows if the first settle crashed after money flip.
  await prisma.$transaction(async (tx) => {
    await applyBookingPaymentsForSettledSale(tx, {
      saleId: sale.id,
      orgId,
      locationId: sale.locationId,
      bookingIds,
      resolvedPi:
        resolvedPi ||
        (
          await tx.posSalePayment.findFirst({
            where: {
              saleId: sale.id,
              status: "completed",
              stripePaymentIntentId: { startsWith: "pi_" },
            },
            orderBy: { createdAt: "desc" },
          })
        )?.stripePaymentIntentId ||
        "",
    });
  });

  for (const bookingId of bookingIds) {
    try {
      await confirmBooking(
        { orgId, sub: cashierUserId },
        bookingId,
        { allowUnpaid: false, autoReview: true, skipStaffGate: true }
      );
    } catch (err) {
      console.error(
        `[pos settle] confirmBooking failed sale=${sale.id} booking=${bookingId}`,
        err instanceof Error ? err.message : err
      );
    }
  }

  await fulfillCompletedPosSale({
    saleId: sale.id,
    actorUserId: cashierUserId,
  });

  await prisma.guestTab.updateMany({
    where: {
      saleId: sale.id,
      status: { in: ["open", "authorized"] },
    },
    data: { status: "settled" },
  });
}

export async function failPosSalePayment(
  stripePaymentIntentId: string,
  opts?: { posSaleId?: string }
) {
  return prisma.$transaction(async (tx) => {
    let payment =
      (await tx.posSalePayment.findFirst({
        where: { stripePaymentIntentId },
      })) ?? null;
    // Checkout Session rows may still hold `cs:…` when the PI fails.
    // Only fall back to payment_link placeholders — never fail an unrelated card row.
    if (!payment && opts?.posSaleId) {
      payment = await tx.posSalePayment.findFirst({
        where: {
          saleId: opts.posSaleId,
          tender: "payment_link",
          status: "pending",
          stripePaymentIntentId: { startsWith: "cs:" },
        },
        orderBy: { createdAt: "desc" },
      });
    }
    if (
      !payment ||
      payment.status === "completed" ||
      payment.status === "cancelled"
    ) {
      return { ok: true as const, skipped: true as const };
    }
    await tx.$queryRaw`
      SELECT id FROM pos_sale_payments WHERE id = ${payment.id} LIMIT 1 FOR UPDATE
    `;
    const locked = await tx.posSalePayment.findFirstOrThrow({ where: { id: payment.id } });
    if (locked.status === "completed" || locked.status === "cancelled") {
      return { ok: true as const, skipped: true as const };
    }
    await tx.posSalePayment.update({
      where: { id: locked.id },
      data: {
        status: "failed",
        ...(stripePaymentIntentId.startsWith("pi_")
          ? { stripePaymentIntentId }
          : {}),
      },
    });
    return { ok: true as const, skipped: false as const };
  });
}
