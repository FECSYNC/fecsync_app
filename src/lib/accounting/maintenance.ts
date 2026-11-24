/**
 * Accounting background maintenance (hourly sibling + `yarn accounting:maintenance`).
 * Each org is isolated; one failure never stops the others. Parts are idempotent.
 */
import prisma from "@/lib/prisma";
import { D, toApiString } from "@/lib/accounting/money";
import { processPostingQueue, enqueueAccountingEventSafe } from "@/lib/accounting/postingQueue";
import { ensurePeriodsCover, fiscalYearBounds, fiscalYearForDate } from "@/lib/accounting/periods";
import { markOverdueInvoices } from "@/lib/accounting/receivables/manualInvoices";
import { getSystemAccount } from "@/lib/accounting/accounts";
import { voidGiftCard } from "@/lib/ticketing/giftCards";
import { enqueueAcct, flushAccountingQueueSoon } from "@/lib/accounting/enqueueHooks";
import {
  notifyBillsDueDigest,
  notifyBankUnreconciled,
  notifyPeriodReadyToClose,
  notifyPostingExceptionsDigest,
  sendInvoiceReminderForOffset,
} from "@/lib/accounting/notifications";
import { addLocalDays, toLocalYmd } from "@/lib/accounting/dates";

const BATCH = 100;

function asNumberArray(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw)) return fallback;
  const out = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  return out.length ? out : fallback;
}

function dayStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function recognizeBookingRevenueForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled || settings.bookingRevenueRecognition !== "on_visit") {
    return { enqueued: 0 };
  }
  const bookings = await prisma.booking.findMany({
    where: {
      orgId,
      status: "confirmed",
      visitEndsAt: { lt: now, gte: settings.goLiveDate },
    },
    select: { id: true, locationId: true },
    take: BATCH,
  });
  let enqueued = 0;
  for (const b of bookings) {
    await enqueueAccountingEventSafe(prisma, {
      orgId,
      locationId: b.locationId,
      sourceType: "booking",
      sourceId: b.id,
      sourceEvent: `rev:${now.getTime()}`,
      eventAt: now,
    });
    enqueued += 1;
  }
  return { enqueued };
}

async function recognizeMembershipRevenueForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled || settings.membershipRecognition !== "over_term") {
    return { enqueued: 0 };
  }
  const memberships = await prisma.guestMembership.findMany({
    where: {
      orgId,
      status: { in: ["active", "past_due", "cancelled"] },
      createdAt: { gte: settings.goLiveDate },
    },
    select: { id: true, locationId: true },
    take: BATCH,
  });
  let enqueued = 0;
  for (const m of memberships) {
    await enqueueAcct(prisma, {
      orgId,
      locationId: m.locationId,
      sourceType: "revenue_recognition",
      sourceId: m.id,
      sourceEvent: `membership:${toLocalYmd(now, settings.timezone)}`,
      eventAt: now,
      payload: { kind: "membership" },
    });
    enqueued += 1;
  }
  return { enqueued };
}

async function giftCardBreakageForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled || !settings.giftCardBreakageOnExpiry) return { voided: 0 };
  const cards = await prisma.giftCard.findMany({
    where: {
      orgId,
      status: "active",
      expiresAt: { lte: now },
      remainingBalance: { gt: 0 },
    },
    select: { id: true, locationId: true },
    take: BATCH,
  });
  let voided = 0;
  for (const c of cards) {
    await prisma.$transaction(async (tx) => {
      const result = await voidGiftCard({
        giftCardId: c.id,
        orgId,
        db: tx,
        idempotencyKey: `breakage:${c.id}`,
      });
      const ledger = await tx.giftCardLedger.findFirst({
        where: { orgId, idempotencyKey: `breakage:${c.id}` },
        select: { id: true },
      });
      if (ledger) {
        await enqueueAccountingEventSafe(tx, {
          orgId,
          locationId: c.locationId,
          sourceType: "gift_card",
          sourceId: ledger.id,
          sourceEvent: "void",
          eventAt: now,
        });
      }
      void result;
    });
    voided += 1;
  }
  if (voided) flushAccountingQueueSoon(orgId);
  return { voided };
}

async function invoiceRemindersForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled) return { overdue: 0, reminded: 0 };
  const overdue = await markOverdueInvoices(orgId, now);
  const offsets = asNumberArray(settings.invoiceReminderOffsets, [-3, 0, 7, 14, 30]).sort(
    (a, b) => a - b
  );
  const invoices = await prisma.bookingInvoice.findMany({
    where: {
      orgId,
      kind: "manual",
      status: { in: ["sent", "overdue"] },
      amountDue: { gt: 0 },
      writtenOffAt: null,
      dueAt: { not: null },
    },
    select: {
      id: true,
      dueAt: true,
      lastReminderAt: true,
      reminderCount: true,
    },
    take: 500,
  });
  let reminded = 0;
  for (const inv of invoices) {
    if (!inv.dueAt) continue;
    const daysPastDue = Math.floor((now.getTime() - inv.dueAt.getTime()) / 86_400_000);
    // Pick the highest offset that is due and not yet counted via reminderCount.
    let targetIdx = -1;
    for (let i = 0; i < offsets.length; i++) {
      if (daysPastDue >= offsets[i]!) targetIdx = i;
    }
    if (targetIdx < 0) continue;
    if (inv.reminderCount > targetIdx) continue;
    // Claim watermark before send so concurrent runs do not double-send.
    const claim = await prisma.bookingInvoice.updateMany({
      where: {
        id: inv.id,
        reminderCount: inv.reminderCount,
        status: { in: ["sent", "overdue"] },
        amountDue: { gt: 0 },
      },
      data: { lastReminderAt: now, reminderCount: targetIdx + 1 },
    });
    if (claim.count !== 1) continue;
    const result = await sendInvoiceReminderForOffset({
      orgId,
      invoiceId: inv.id,
      offsetDays: offsets[targetIdx]!,
    });
    if (result.sent) reminded += 1;
  }
  return { overdue, reminded };
}

async function billDueDigestForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled) return { bills: 0 };
  const daysBefore = asNumberArray(settings.billReminderDaysBefore, [3, 1]);
  const dueWindows: Date[] = [];
  for (const d of daysBefore) {
    dueWindows.push(addLocalDays(now, d, settings.timezone));
  }
  const ymds = [...new Set(dueWindows.map((d) => toLocalYmd(d, settings.timezone)))];
  const bills = await prisma.supplierBill.findMany({
    where: {
      orgId,
      status: { in: ["approved", "posted", "partially_paid"] },
      amountDue: { gt: 0 },
      voidedAt: null,
    },
    include: { supplier: { select: { name: true } } },
    take: 200,
  });
  const due = bills.filter((b) => ymds.includes(toLocalYmd(b.dueDate, settings.timezone)));
  if (due.length) {
    await notifyBillsDueDigest(
      orgId,
      due.map((b) => ({
        id: b.id,
        number: b.number,
        dueDate: b.dueDate,
        amountDue: b.amountDue,
        supplierName: b.supplier.name,
      }))
    );
  }
  return { bills: due.length };
}

async function digestsF8ForOrg(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled) return { skipped: true as const };
  const last = settings.lastDigestAt ? dayStartUtc(settings.lastDigestAt).getTime() : 0;
  if (last === dayStartUtc(now).getTime()) return { skipped: true as const, reason: "already_today" };

  const claim = await prisma.accountingSettings.updateMany({
    where: {
      orgId,
      OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: dayStartUtc(now) } }],
    },
    data: { lastDigestAt: now },
  });
  if (claim.count !== 1) return { skipped: true as const, reason: "race" };

  const failed = await prisma.accountingPostingQueue.count({
    where: { orgId, status: "failed" },
  });
  let suspense = "0.00";
  try {
    const sus = await getSystemAccount(prisma, orgId, "suspense");
    const agg = await prisma.journalLine.aggregate({
      where: {
        orgId,
        ledgerAccountId: sus.id,
        entry: { status: { in: ["posted", "reversed"] } },
      },
      _sum: { debit: true, credit: true },
    });
    suspense = toApiString(D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0)).abs());
  } catch {
    suspense = "0.00";
  }
  await notifyPostingExceptionsDigest(orgId, { failed, suspense });

  const readyCutoff = new Date(now.getTime() - 5 * 86_400_000);
  const readyPeriods = await prisma.accountingPeriod.findMany({
    where: { orgId, status: "open", endsOn: { lt: readyCutoff } },
    select: { id: true, fiscalYear: true, periodNumber: true },
    take: 24,
  });
  await notifyPeriodReadyToClose(orgId, readyPeriods);

  const banks = await prisma.bankAccount.findMany({
    where: { orgId, isActive: true, archivedAt: null },
    select: { id: true, name: true, lastReconciledAt: true, createdAt: true },
    take: 100,
  });
  const unreconciled = banks
    .map((b) => {
      const anchor = b.lastReconciledAt ?? b.createdAt;
      const days = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
      return { id: b.id, name: b.name, days };
    })
    .filter((b) => b.days >= 35);
  await notifyBankUnreconciled(orgId, unreconciled);

  return {
    skipped: false as const,
    failed,
    suspense,
    readyPeriods: readyPeriods.length,
    unreconciled: unreconciled.length,
  };
}

async function ensureNextFyPeriods(orgId: string, now: Date) {
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId } });
  if (!settings?.enabled) return { ensured: false };
  const fy = fiscalYearForDate(now, settings);
  const { end } = fiscalYearBounds(fy, settings);
  const daysToEnd = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
  if (daysToEnd <= 60) {
    await ensurePeriodsCover(prisma, settings, new Date(end.getTime() + 86_400_000));
    return { ensured: true, fiscalYear: fy + 1 };
  }
  await ensurePeriodsCover(prisma, settings, now);
  return { ensured: false };
}

async function expireStatementTokens(orgId: string, now: Date) {
  const res = await prisma.accountingStatementToken.deleteMany({
    where: { orgId, expiresAt: { lt: now } },
  });
  return { deleted: res.count };
}

async function runForOrg(orgId: string, now: Date) {
  const queue = await processPostingQueue({ orgId, limit: 200 });
  const bookingRev = await recognizeBookingRevenueForOrg(orgId, now);
  const membershipRev = await recognizeMembershipRevenueForOrg(orgId, now);
  const breakage = await giftCardBreakageForOrg(orgId, now);
  const invoices = await invoiceRemindersForOrg(orgId, now);
  const bills = await billDueDigestForOrg(orgId, now);
  const digests = await digestsF8ForOrg(orgId, now);
  const periods = await ensureNextFyPeriods(orgId, now);
  const tokens = await expireStatementTokens(orgId, now);
  // Flush any recognition enqueues from this pass.
  flushAccountingQueueSoon(orgId);
  return {
    queue,
    bookingRev,
    membershipRev,
    breakage,
    invoices,
    bills,
    digests,
    periods,
    tokens,
  };
}

export async function runAccountingMaintenance(now = new Date()) {
  const orgs = await prisma.accountingSettings.findMany({
    where: { enabled: true },
    select: { orgId: true },
  });
  const results: Array<{ orgId: string; ok: boolean; summary?: unknown; error?: string }> = [];
  for (const { orgId } of orgs) {
    try {
      const summary = await runForOrg(orgId, now);
      results.push({ orgId, ok: true, summary });
    } catch (err) {
      console.error(`[accounting:maintenance] org ${orgId}:`, err);
      results.push({
        orgId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    orgs: orgs.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Never throws — for billing cron siblings. */
export async function runAccountingMaintenanceSafe(now = new Date()) {
  try {
    return await runAccountingMaintenance(now);
  } catch (err) {
    console.error("[accounting:maintenance] fatal:", err);
    return {
      orgs: 0,
      ok: 0,
      failed: 1,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
