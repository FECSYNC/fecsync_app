/**
 * Schedule PartyBalanceReminder rows on create / edit / confirm / payment.
 * Sending is the maintenance job's job (Step 2). Rescheduling is idempotent:
 * unsent future rows are replaced, sent rows are never touched, and the
 * (partyDetailId, kind, scheduledFor) unique key absorbs duplicates.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { resolvePartySettings } from "@/lib/parties/settings";
import { toCents } from "@/lib/parties/deposits";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 86_400_000;

export async function schedulePartyReminders(
  db: Db,
  partyDetailId: string,
  now: Date = new Date()
): Promise<{ scheduled: number }> {
  const detail = await db.partyBookingDetail.findUnique({
    where: { id: partyDetailId },
    select: {
      id: true,
      orgId: true,
      locationId: true,
      depositRequiredCents: true,
      depositPaidCents: true,
      depositDueAt: true,
      balanceDueAt: true,
      opsStatus: true,
      booking: { select: { status: true, amountDue: true } },
    },
  });
  if (!detail) return { scheduled: 0 };

  await db.partyBalanceReminder.deleteMany({
    where: { partyDetailId, sentAt: null, skippedReason: null },
  });

  const settings = await resolvePartySettings(detail.orgId, detail.locationId);
  const live = !["cancelled", "expired", "refunded"].includes(detail.booking.status);
  if (!settings.sendBalanceReminder || !live || toCents(detail.booking.amountDue) <= 0) {
    return { scheduled: 0 };
  }

  const rows: Array<{ kind: "deposit" | "balance"; scheduledFor: Date }> = [];
  const plan = (kind: "deposit" | "balance", due: Date | null) => {
    if (!due) return;
    for (const days of settings.balanceReminderDaysBefore) {
      const at = new Date(due.getTime() - days * DAY_MS);
      if (at.getTime() > now.getTime()) rows.push({ kind, scheduledFor: at });
    }
  };
  if (detail.depositRequiredCents > detail.depositPaidCents) {
    plan("deposit", detail.depositDueAt);
  }
  plan("balance", detail.balanceDueAt);
  if (!rows.length) return { scheduled: 0 };

  const created = await db.partyBalanceReminder.createMany({
    data: rows.map((r) => ({
      orgId: detail.orgId,
      locationId: detail.locationId,
      partyDetailId,
      kind: r.kind,
      scheduledFor: r.scheduledFor,
    })),
    skipDuplicates: true,
  });
  return { scheduled: created.count };
}
