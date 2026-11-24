/**
 * Booking → party sync hooks called by the booking engine (never by routes).
 * Booking.status is authoritative; opsStatus is the operations overlay.
 *
 * Must not import bookingEngine.
 */
import type { BookingStatus, PartyOpsStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { syncPartyMoney } from "@/lib/parties/deposits";

type Db = Prisma.TransactionClient | typeof prisma;

const CONFIRMED_OVERLAYS: PartyOpsStatus[] = ["checked_in", "in_progress", "completed", "no_show"];
const STARTED_OVERLAYS: PartyOpsStatus[] = ["checked_in", "in_progress", "completed"];

/**
 * S1-F1 mapping: draft → inquiry; hold / reserved / pending_payment → held;
 * confirmed → confirmed (keeps checked_in / in_progress / completed / no_show);
 * cancelled / expired → cancelled; refunded → cancelled unless the party had
 * already started (then the overlay stays so the room is not freed).
 */
export function opsStatusForBooking(
  status: BookingStatus,
  current: PartyOpsStatus
): PartyOpsStatus {
  switch (status) {
    case "draft":
      return "inquiry";
    case "hold":
    case "reserved":
    case "pending_payment":
      return "held";
    case "confirmed":
      return CONFIRMED_OVERLAYS.includes(current) ? current : "confirmed";
    case "refunded":
      return STARTED_OVERLAYS.includes(current) ? current : "cancelled";
    case "cancelled":
    case "expired":
    default:
      return "cancelled";
  }
}

export async function syncPartyOpsFromBooking(db: Db, bookingId: string): Promise<void> {
  const detail = await db.partyBookingDetail.findUnique({
    where: { bookingId },
    select: { id: true, opsStatus: true, booking: { select: { status: true } } },
  });
  if (!detail) return;
  const next = opsStatusForBooking(detail.booking.status, detail.opsStatus);
  if (next !== detail.opsStatus) {
    await db.partyBookingDetail.update({ where: { id: detail.id }, data: { opsStatus: next } });
  }
  if (next === "cancelled") {
    await closePartyAfterCancel(db, detail.id);
  }
}

/**
 * Cancelled / expired / refunded-before-start party: cancel open invitations,
 * open food orders (and their queued kitchen tickets), and unsent reminders.
 * Never refunds.
 */
async function closePartyAfterCancel(db: Db, partyDetailId: string) {
  await db.partyInvitation.updateMany({
    where: { partyDetailId, status: { in: ["pending", "sent"] } },
    data: { status: "cancelled" },
  });
  const openFood = await db.partyFoodOrder.findMany({
    where: { partyDetailId, status: { in: ["draft", "submitted", "sent_to_kitchen"] } },
    select: { id: true, kitchenTicketId: true },
  });
  if (openFood.length) {
    const ticketIds = openFood
      .map((f) => f.kitchenTicketId)
      .filter((id): id is string => Boolean(id));
    if (ticketIds.length) {
      await db.kitchenTicket.updateMany({
        where: { id: { in: ticketIds }, status: { in: ["queued", "sent", "accepted"] } },
        data: { status: "void" },
      });
    }
    await db.partyFoodOrder.updateMany({
      where: { id: { in: openFood.map((f) => f.id) } },
      data: { status: "cancelled" },
    });
  }
  await db.partyBalanceReminder.updateMany({
    where: { partyDetailId, sentAt: null, skippedReason: null },
    data: { skippedReason: "cancelled" },
  });
}

/** Combined hook for money + status writers (refunds, POS settle). */
export async function syncPartyAfterBookingWrite(db: Db, bookingId: string): Promise<void> {
  await syncPartyMoney(db, bookingId);
  await syncPartyOpsFromBooking(db, bookingId);
}
