/**
 * Expire hold/reserved/pending_payment (and stuck draft) bookings past TTL and release capacity.
 * Wired from the hourly company-subscription reconcile cron; also callable for smoke + ops.
 *
 * Never TTL-expire bookings that already captured payment — that would free seats while
 * Stripe/cash remains settled without tickets.
 */
import prisma from "@/lib/prisma";
import { releaseHoldsForBooking } from "@/lib/ticketing/holds";
import { releaseSessionCapacity } from "@/lib/ticketing/capacity";
import {
  cancelPendingStripeForBooking,
  voidPendingBookingPayments,
} from "@/lib/ticketing/pendingStripe";
import { syncPartyOpsFromBooking } from "@/lib/parties/bookingHooks";
import {
  enqueueBookingRev,
  flushAccountingQueueSoon,
} from "@/lib/accounting/enqueueHooks";

function toNum(d: { toString(): string } | number | null | undefined): number {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  return Number(d.toString());
}

export async function expireBookingHolds(opts?: {
  orgId?: string;
  /** Prefer this booking when confirming an expired hold (avoids backlog miss). */
  bookingId?: string;
  now?: Date;
  limit?: number;
}): Promise<{ expired: number }> {
  const now = opts?.now ?? new Date();
  const limit = opts?.bookingId ? 1 : opts?.limit ?? 200;

  const due = await prisma.booking.findMany({
    where: {
      ...(opts?.bookingId ? { id: opts.bookingId } : {}),
      ...(opts?.orgId ? { orgId: opts.orgId } : {}),
      // Include draft: public checkout can attach holds before status flips to hold.
      status: { in: ["draft", "hold", "reserved", "pending_payment"] },
      OR: [
        { holdExpiresAt: { lte: now } },
        { reservedUntil: { lte: now } },
      ],
    },
    select: {
      id: true,
      orgId: true,
      locationId: true,
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  let expired = 0;
  for (const booking of due) {
    try {
      await cancelPendingStripeForBooking(booking.id);
      let didExpire = false;
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM bookings WHERE id = ${booking.id} FOR UPDATE
          `;
          const fresh = await tx.booking.findFirst({
            where: { id: booking.id },
            select: {
              status: true,
              amountPaid: true,
              total: true,
            },
          });
          if (
            !fresh ||
            !["draft", "hold", "reserved", "pending_payment"].includes(
              fresh.status
            )
          ) {
            return;
          }

          const paid = toNum(fresh.amountPaid);
          const completedPayments = await tx.bookingPayment.count({
            where: { bookingId: booking.id, status: "completed" },
          });
          const pendingCapture = await tx.bookingPayment.count({
            where: {
              bookingId: booking.id,
              status: "pending",
              tender: { in: ["card", "stored_card"] },
            },
          });
          // Protect in-flight pay only (pending_payment or open card Checkout).
          // Reactivated hold/reserved with historical amountPaid must still TTL-expire.
          const protectPaidInFlight =
            fresh.status === "pending_payment" || pendingCapture > 0;
          if ((paid > 0 || completedPayments > 0) && protectPaidInFlight) {
            const extendMs = 24 * 3600_000;
            await tx.booking.update({
              where: { id: booking.id },
              data: {
                holdExpiresAt: new Date(now.getTime() + extendMs),
                reservedUntil:
                  fresh.status === "reserved"
                    ? new Date(now.getTime() + extendMs)
                    : undefined,
              },
            });
            await tx.bookingActivity.create({
              data: {
                orgId: booking.orgId,
                locationId: booking.locationId,
                bookingId: booking.id,
                kind: "status",
                payload: {
                  event: "ttl_skipped_paid",
                  amountPaid: paid,
                  completedPayments,
                  pendingCapture,
                  total: toNum(fresh.total),
                },
              },
            });
            return;
          }

          const holds = await tx.bookingHold.findMany({
            where: { bookingId: booking.id },
          });
          // Draft with no holds and no TTL capacity — nothing to expire.
          if (fresh.status === "draft" && holds.length === 0) {
            return;
          }

          if (holds.length) {
            await releaseHoldsForBooking(booking.id, tx);
          } else if (fresh.status !== "draft") {
            // Holds missing (ops/bug/bad move) — still free seats from lines.
            const lines = await tx.bookingLine.findMany({
              where: { bookingId: booking.id },
              select: { sessionId: true, qty: true },
            });
            const { restorableCapacityQty } = await import(
              "@/lib/ticketing/credentials"
            );
            const heldQty = lines
              .filter((l) => l.sessionId)
              .reduce((s, l) => s + l.qty, 0);
            if (heldQty > 0) {
              const restore = await restorableCapacityQty(
                booking.id,
                heldQty,
                tx
              );
              let remainingRestore = restore;
              for (const line of lines) {
                if (!line.sessionId || remainingRestore <= 0) continue;
                const qty = Math.min(line.qty, remainingRestore);
                await releaseSessionCapacity(line.sessionId, qty, tx);
                remainingRestore -= qty;
              }
            }
          }

          const stockLines = await tx.bookingLine.findMany({
            where: { bookingId: booking.id },
            select: {
              productId: true,
              productType: true,
              qty: true,
              visitDate: true,
              sessionId: true,
            },
          });
          if (
            stockLines.some((l) => l.productType === "add_on") &&
            fresh.status !== "draft"
          ) {
            const { restoreAddOnStockForLines } = await import(
              "@/lib/ticketing/stockPeriods"
            );
            await restoreAddOnStockForLines(
              {
                bookingId: booking.id,
                orgId: booking.orgId,
                locationId: booking.locationId,
                lines: stockLines,
              },
              tx
            );
          }

          await voidPendingBookingPayments(booking.id, tx);

          await tx.bookingPaymentLink.deleteMany({
            where: { bookingId: booking.id },
          });

          const expiredRow = await tx.booking.update({
            where: { id: booking.id },
            data: {
              status: "expired",
              holdExpiresAt: null,
              reservedUntil: null,
            },
          });
          // Party room is freed by the status change; mirror it on the ops overlay.
          await syncPartyOpsFromBooking(tx, booking.id);
          await enqueueBookingRev(tx, expiredRow, expiredRow.updatedAt.getTime());

          await tx.bookingActivity.create({
            data: {
              orgId: booking.orgId,
              locationId: booking.locationId,
              bookingId: booking.id,
              kind: "status",
              payload: { to: "expired", reason: "ttl" },
            },
          });
          didExpire = true;
        },
        { maxWait: 15_000, timeout: 60_000 }
      );
      if (didExpire) {
        flushAccountingQueueSoon(booking.orgId);
        expired += 1;
      }
    } catch (err) {
      // One poison row must not abort the whole TTL batch / subscription cron sibling.
      console.error("[expireBookingHolds] booking failed:", booking.id, err);
    }
  }

  const orphanHolds = await prisma.bookingHold.findMany({
    where: {
      ...(opts?.orgId ? { orgId: opts.orgId } : {}),
      bookingId: null,
      expiresAt: { lte: now },
    },
    take: limit,
  });
  for (const hold of orphanHolds) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const deleted = await tx.bookingHold.deleteMany({
            where: { id: hold.id, bookingId: null },
          });
          if (deleted.count === 1 && hold.sessionId) {
            await releaseSessionCapacity(hold.sessionId, hold.qty, tx);
          }
        },
        { maxWait: 15_000, timeout: 30_000 }
      );
    } catch (err) {
      console.error("[expireBookingHolds] orphan hold failed:", hold.id, err);
    }
  }

  return { expired };
}

/**
 * Drop expired guest payment-link tokens (consume already rejects by expiresAt;
 * cron keeps the table from growing and frees abandoned reserves indirectly).
 */
export async function expireBookingPaymentLinks(opts?: {
  orgId?: string;
  now?: Date;
  limit?: number;
}): Promise<{ expired: number }> {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 500;
  const due = await prisma.bookingPaymentLink.findMany({
    where: {
      ...(opts?.orgId ? { orgId: opts.orgId } : {}),
      expiresAt: { lte: now },
    },
    select: { id: true },
    take: limit,
    orderBy: { expiresAt: "asc" },
  });
  if (!due.length) return { expired: 0 };
  const result = await prisma.bookingPaymentLink.deleteMany({
    where: { id: { in: due.map((d) => d.id) } },
  });
  return { expired: result.count };
}

/**
 * Sibling maintenance for the hourly company-subscription cron (HTTP + CLI).
 * Isolates hold vs payment-link failures so one path cannot skip the other.
 */
export async function runBookingExpiryMaintenance(opts?: {
  holdLimit?: number;
  linkLimit?: number;
  orgId?: string;
}): Promise<{
  bookingHolds: { expired: number } | { error: string };
  paymentLinks: { expired: number } | { error: string };
}> {
  let bookingHolds: { expired: number } | { error: string } = { expired: 0 };
  let paymentLinks: { expired: number } | { error: string } = { expired: 0 };
  try {
    bookingHolds = await expireBookingHolds({
      limit: opts?.holdLimit ?? 200,
      orgId: opts?.orgId,
    });
  } catch (holdErr) {
    console.error("[cron] expireBookingHolds:", holdErr);
    bookingHolds = {
      error: holdErr instanceof Error ? holdErr.message : "hold_expiry_failed",
    };
  }
  try {
    paymentLinks = await expireBookingPaymentLinks({
      limit: opts?.linkLimit ?? 500,
      orgId: opts?.orgId,
    });
  } catch (linkErr) {
    console.error("[cron] expireBookingPaymentLinks:", linkErr);
    paymentLinks = {
      error: linkErr instanceof Error ? linkErr.message : "link_expiry_failed",
    };
  }
  return { bookingHolds, paymentLinks };
}

export { expireBookingHolds as expireHolds };
