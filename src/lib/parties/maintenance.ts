/**
 * Party maintenance (hourly cron sibling + `yarn parties:maintenance`).
 * Every part is idempotent and safe to re-run:
 * - expirePartyHolds: booking hold expiry + party ops resync (rooms / sessions released by the engine)
 * - pending / sent invitations past expiresAt → cancelled
 * - due PartyBalanceReminder rows: sent once (sentAt claimed before sending) or skipped with a reason
 * - no_show overlay for confirmed parties whose visit ended with no check-in and no redeemed credential,
 *   at venues that record check-ins
 */
import prisma from "@/lib/prisma";
import { expirePartyHolds } from "@/lib/parties/partyEngine";
import { resolvePartySettings } from "@/lib/parties/settings";
import { toCents } from "@/lib/parties/deposits";
import { logPartyActivity } from "@/lib/parties/activity";
import { sendPartyBalanceReminderEmail } from "@/lib/parties/notifications";

const BATCH = 200;
const CLOSED_BOOKING = ["cancelled", "expired", "refunded"];

export async function expirePartyInvitations(now: Date) {
  const res = await prisma.partyInvitation.updateMany({
    where: { status: { in: ["pending", "sent"] }, expiresAt: { lte: now } },
    data: { status: "cancelled" },
  });
  return { cancelled: res.count };
}

export async function sendDuePartyReminders(now: Date) {
  const due = await prisma.partyBalanceReminder.findMany({
    where: { sentAt: null, skippedReason: null, scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: BATCH,
    include: {
      partyDetail: {
        select: {
          bookingId: true,
          orgId: true,
          locationId: true,
          depositRequiredCents: true,
          depositPaidCents: true,
          booking: { select: { status: true, amountDue: true } },
        },
      },
    },
  });
  let sent = 0;
  let skipped = 0;
  for (const r of due) {
    const d = r.partyDetail;
    const settings = await resolvePartySettings(d.orgId, d.locationId);
    let skip: string | null = null;
    if (CLOSED_BOOKING.includes(d.booking.status)) skip = "booking_closed";
    else if (!settings.sendBalanceReminder) skip = "reminders_off";
    else if (toCents(d.booking.amountDue) <= 0) skip = "paid";
    else if (r.kind === "deposit" && d.depositPaidCents >= d.depositRequiredCents) skip = "deposit_paid";
    if (skip) {
      const res = await prisma.partyBalanceReminder.updateMany({
        where: { id: r.id, sentAt: null, skippedReason: null },
        data: { skippedReason: skip },
      });
      skipped += res.count;
      continue;
    }
    // Claim first so a concurrent run can never send the same reminder twice.
    const claim = await prisma.partyBalanceReminder.updateMany({
      where: { id: r.id, sentAt: null, skippedReason: null },
      data: { sentAt: now },
    });
    if (claim.count !== 1) continue;
    const result = await sendPartyBalanceReminderEmail({ bookingId: d.bookingId, kind: r.kind }).catch(() => ({
      sent: false,
      reason: "email_failed",
    }));
    if (!result.sent) {
      await prisma.partyBalanceReminder.update({
        where: { id: r.id },
        data: { skippedReason: result.reason ?? "email_failed" },
      });
      skipped += 1;
    } else {
      sent += 1;
    }
  }
  return { due: due.length, sent, skipped };
}

export async function markPartyNoShows(now: Date) {
  const candidates = await prisma.partyBookingDetail.findMany({
    where: {
      opsStatus: "confirmed",
      booking: {
        status: "confirmed",
        visitEndsAt: { lt: now },
        credentials: { none: { status: "redeemed" } },
      },
    },
    select: { id: true, bookingId: true, orgId: true, locationId: true },
    take: BATCH,
  });
  // Only venues that actually record check-ins (a redeemed ticket in the last
  // 30 days) — elsewhere "no redeemed ticket" says nothing about attendance.
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const venueIds = [...new Set(candidates.map((c) => c.locationId))];
  const checkInVenues = new Set(
    venueIds.length
      ? (
          await prisma.ticketCredential.groupBy({
            by: ["locationId"],
            where: { locationId: { in: venueIds }, status: "redeemed", redeemedAt: { gte: since } },
          })
        ).map((r) => r.locationId)
      : []
  );
  let marked = 0;
  for (const c of candidates) {
    if (!checkInVenues.has(c.locationId)) continue;
    const res = await prisma.partyBookingDetail.updateMany({
      where: { id: c.id, opsStatus: "confirmed" },
      data: { opsStatus: "no_show" },
    });
    if (res.count !== 1) continue;
    marked += 1;
    await logPartyActivity({
      orgId: c.orgId,
      locationId: c.locationId,
      bookingId: c.bookingId,
      kind: "status",
      event: "ops_status",
      payload: { from: "confirmed", to: "no_show", source: "maintenance" },
    }).catch(() => undefined);
  }
  return { marked };
}

export type PartyMaintenanceSummary = {
  holds: { expired: number; partiesResynced: number } | { error: string };
  invitations: { cancelled: number } | { error: string };
  reminders: { due: number; sent: number; skipped: number } | { error: string };
  noShows: { marked: number } | { error: string };
};

async function part<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    console.error("[party maintenance]", err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runPartyMaintenance(now: Date = new Date()): Promise<PartyMaintenanceSummary> {
  return {
    holds: await part(() => expirePartyHolds({ now })),
    invitations: await part(() => expirePartyInvitations(now)),
    reminders: await part(() => sendDuePartyReminders(now)),
    noShows: await part(() => markPartyNoShows(now)),
  };
}
