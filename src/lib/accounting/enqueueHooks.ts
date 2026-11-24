/**
 * Thin helpers for money-flow sites. Enqueue never throws into the source
 * operation; callers flush after their outer transaction commits.
 */
import type { AccountingSourceType } from "@prisma/client";
import {
  enqueueAccountingEventSafe,
  flushAccountingQueueSoon,
  type EnqueueInput,
} from "@/lib/accounting/postingQueue";
import type { Db } from "@/lib/accounting/types";

export { flushAccountingQueueSoon };

export async function enqueueAcct(
  db: Db,
  input: EnqueueInput
): Promise<void> {
  await enqueueAccountingEventSafe(db, input);
}

/** Booking revenue / status sync (confirm, cancel, expire, reprice, …). */
export async function enqueueBookingRev(
  db: Db,
  booking: { id: string; orgId: string; locationId: string },
  updatedAtMs: number = Date.now()
): Promise<void> {
  await enqueueAccountingEventSafe(db, {
    orgId: booking.orgId,
    locationId: booking.locationId,
    sourceType: "booking",
    sourceId: booking.id,
    sourceEvent: `rev:${updatedAtMs}`,
    eventAt: new Date(updatedAtMs),
  });
}

/** Completed BookingPayment — skip POS-owned rows (posSaleId). */
export async function enqueueBookingPayment(
  db: Db,
  payment: {
    id: string;
    orgId: string;
    locationId: string;
    bookingId: string;
    posSaleId?: string | null;
    createdAt?: Date;
  }
): Promise<void> {
  if (payment.posSaleId) return;
  await enqueueAccountingEventSafe(db, {
    orgId: payment.orgId,
    locationId: payment.locationId,
    sourceType: "booking_payment",
    sourceId: payment.id,
    sourceEvent: "completed",
    eventAt: payment.createdAt ?? new Date(),
    payload: { bookingId: payment.bookingId },
  });
}

/** Booking refund watermark sync. */
export async function enqueueBookingRefund(
  db: Db,
  booking: { id: string; orgId: string; locationId: string },
  watermarkKey: string,
  eventAt: Date = new Date()
): Promise<void> {
  await enqueueAccountingEventSafe(db, {
    orgId: booking.orgId,
    locationId: booking.locationId,
    sourceType: "booking_refund",
    sourceId: booking.id,
    sourceEvent: watermarkKey,
    eventAt,
  });
}

export async function enqueueSource(
  db: Db,
  opts: {
    orgId: string;
    locationId?: string | null;
    sourceType: AccountingSourceType;
    sourceId: string;
    sourceEvent?: string;
    eventAt?: Date;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  await enqueueAccountingEventSafe(db, opts);
}
