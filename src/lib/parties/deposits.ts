/**
 * Party deposits. Booking.amountDue (= total − amountPaid) is the only balance;
 * PartyBookingDetail stores the deposit requirement and a paid-toward-deposit
 * mirror (`min(amountPaid, depositRequired)`), never a second balance.
 *
 * Must not import bookingEngine — the engine calls `syncPartyMoney` and
 * `assertPartyDepositGate`.
 */
import moment from "moment-timezone";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logActivityEntry } from "@/lib/audit/activityLog";
import { resolveVisitTimezone } from "@/lib/ticketing/visitDayBounds";
import { TicketingError, PARTY_DEPOSIT_REQUIRED, PARTY_REASON_REQUIRED } from "@/lib/parties/errors";
import type { PartySettingsValues } from "@/lib/parties/settings";

type Db = Prisma.TransactionClient | typeof prisma;

export function toCents(amount: { toString(): string } | number | null | undefined): number {
  if (amount == null) return 0;
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Package override → venue/org PartySettings → 0. Clamped to [0, total]. */
export function computeDepositRequiredCents(
  totalCents: number,
  config: {
    depositFixedCentsOverride?: number | null;
    depositPercentOverride?: { toString(): string } | number | null;
  } | null,
  settings: Pick<PartySettingsValues, "defaultDepositFixedCents" | "defaultDepositPercent">
): number {
  const total = Math.max(0, Math.round(totalCents));
  let raw = 0;
  const pct = (p: { toString(): string } | number) => Math.round((total * Number(p.toString())) / 100);
  if (config?.depositFixedCentsOverride != null) raw = config.depositFixedCentsOverride;
  else if (config?.depositPercentOverride != null) raw = pct(config.depositPercentOverride);
  else if (settings.defaultDepositFixedCents != null) raw = settings.defaultDepositFixedCents;
  else if (settings.defaultDepositPercent != null) raw = pct(settings.defaultDepositPercent);
  return Math.min(total, Math.max(0, Math.round(raw)));
}

function dueAt(
  mode: "at_booking" | "days_before_event" | "on_arrival",
  daysBefore: number,
  visitStartsAt: Date | null,
  timezone: string | null | undefined,
  now: Date
): Date | null {
  if (mode === "at_booking") return now;
  if (!visitStartsAt) return null;
  if (mode === "on_arrival") return visitStartsAt;
  // Local midnight N calendar days before the visit day (DST-safe via moment-timezone).
  const zone = resolveVisitTimezone(timezone);
  const due = moment
    .tz(visitStartsAt, zone)
    .startOf("day")
    .subtract(Math.max(0, daysBefore), "days")
    .toDate();
  return due.getTime() < now.getTime() ? now : due;
}

export function computePartyDueDates(opts: {
  visitStartsAt: Date | null;
  timezone: string | null | undefined;
  settings: Pick<
    PartySettingsValues,
    "depositDueMode" | "depositDaysBefore" | "balanceDueMode" | "balanceDaysBefore"
  >;
  depositRequiredCents: number;
  now?: Date;
}): { depositDueAt: Date | null; balanceDueAt: Date | null } {
  const now = opts.now ?? new Date();
  return {
    depositDueAt:
      opts.depositRequiredCents > 0
        ? dueAt(
            opts.settings.depositDueMode,
            opts.settings.depositDaysBefore,
            opts.visitStartsAt,
            opts.timezone,
            now
          )
        : null,
    balanceDueAt: dueAt(
      opts.settings.balanceDueMode,
      opts.settings.balanceDaysBefore,
      opts.visitStartsAt,
      opts.timezone,
      now
    ),
  };
}

/**
 * Confirm gate. When requireDepositToConfirm is on, confirm fails until
 * amountPaid ≥ depositRequired. The only bypass is the venue setting
 * allowConfirmWithoutDeposit plus a reason (the parties:write check happens in
 * partyEngine before the reason is passed down).
 */
export function assertPartyDepositGate(opts: {
  depositRequiredCents: number;
  amountPaidCents: number;
  settings: Pick<PartySettingsValues, "requireDepositToConfirm" | "allowConfirmWithoutDeposit">;
  overrideReason?: string | null;
}): { overridden: boolean } {
  if (!opts.settings.requireDepositToConfirm) return { overridden: false };
  if (opts.depositRequiredCents <= 0) return { overridden: false };
  if (opts.amountPaidCents >= opts.depositRequiredCents) return { overridden: false };
  const reason = opts.overrideReason?.trim() ?? "";
  if (opts.settings.allowConfirmWithoutDeposit && reason) {
    return { overridden: true };
  }
  if (opts.settings.allowConfirmWithoutDeposit && opts.overrideReason !== undefined && !reason) {
    throw new TicketingError(PARTY_REASON_REQUIRED, 400);
  }
  throw new TicketingError(PARTY_DEPOSIT_REQUIRED, 400);
}

/**
 * Recompute depositPaidCents from Booking.amountPaid and mark unsent reminders
 * skippable. Called inside every payment / refund / webhook / payment-link /
 * invoice / POS settle path (via updateBookingAmountsAfterPayment and the
 * refund + POS writers). No-op for non-party bookings.
 */
export async function syncPartyMoney(db: Db, bookingId: string): Promise<void> {
  const detail = await db.partyBookingDetail.findUnique({
    where: { bookingId },
    select: {
      id: true,
      orgId: true,
      locationId: true,
      depositRequiredCents: true,
      depositPaidCents: true,
      booking: { select: { amountPaid: true, amountDue: true } },
    },
  });
  if (!detail) return;
  const paidCents = toCents(detail.booking.amountPaid);
  const dueCents = toCents(detail.booking.amountDue);
  const depositPaidCents = Math.min(paidCents, detail.depositRequiredCents);
  if (depositPaidCents !== detail.depositPaidCents) {
    await db.partyBookingDetail.update({
      where: { id: detail.id },
      data: { depositPaidCents },
    });
  }
  logActivityEntry({
    actorSub: null,
    orgId: detail.orgId,
    action: "parties.money_synced",
    entityType: "PartyBooking",
    entityId: bookingId,
    description: "Party payments updated",
    metadata: {
      bookingId,
      locationId: detail.locationId,
      amountPaidCents: paidCents,
      amountDueCents: dueCents,
      depositRequiredCents: detail.depositRequiredCents,
      depositPaidCents,
    },
  });
  if (dueCents <= 0) {
    await db.partyBalanceReminder.updateMany({
      where: { partyDetailId: detail.id, sentAt: null, skippedReason: null },
      data: { skippedReason: "paid" },
    });
  } else if (depositPaidCents >= detail.depositRequiredCents) {
    await db.partyBalanceReminder.updateMany({
      where: { partyDetailId: detail.id, kind: "deposit", sentAt: null, skippedReason: null },
      data: { skippedReason: "deposit_paid" },
    });
  }
}
