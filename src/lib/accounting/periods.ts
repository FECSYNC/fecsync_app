/**
 * Fiscal periods: generation, lookup, late-posting rule, close/reopen, year-end.
 */
import type { AccountingPeriod, AccountingSettings } from "@prisma/client";
import moment from "moment-timezone";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { localMonthStart, resolveTz } from "@/lib/accounting/dates";
import { D, isZero, round2, type Dec } from "@/lib/accounting/money";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

type PeriodSettings = Pick<AccountingSettings, "orgId" | "fiscalYearStartMonth" | "timezone">;

export function fiscalYearForDate(date: Date, s: PeriodSettings): number {
  const m = moment(date).tz(resolveTz(s.timezone));
  const month = m.month() + 1;
  return month >= s.fiscalYearStartMonth ? m.year() : m.year() - 1;
}

export function fiscalYearBounds(fiscalYear: number, s: PeriodSettings): { start: Date; end: Date } {
  const start = localMonthStart(fiscalYear, s.fiscalYearStartMonth, s.timezone);
  const next = localMonthStart(fiscalYear + 1, s.fiscalYearStartMonth, s.timezone);
  return { start, end: new Date(next.getTime() - 1) };
}

export async function generateFiscalYear(
  db: Db,
  s: PeriodSettings,
  fiscalYear: number
): Promise<AccountingPeriod[]> {
  const out: AccountingPeriod[] = [];
  for (let n = 1; n <= 12; n++) {
    const monthIndex = s.fiscalYearStartMonth - 1 + (n - 1);
    const year = fiscalYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const startsOn = localMonthStart(year, month, s.timezone);
    const nextIndex = monthIndex + 1;
    const nextStart = localMonthStart(
      fiscalYear + Math.floor(nextIndex / 12),
      (nextIndex % 12) + 1,
      s.timezone
    );
    const row = await db.accountingPeriod.upsert({
      where: {
        orgId_fiscalYear_periodNumber: { orgId: s.orgId, fiscalYear, periodNumber: n },
      },
      create: {
        orgId: s.orgId,
        fiscalYear,
        periodNumber: n,
        startsOn,
        endsOn: new Date(nextStart.getTime() - 1),
      },
      update: {},
    });
    out.push(row);
  }
  return out;
}

export async function ensurePeriodsCover(db: Db, s: PeriodSettings, date: Date): Promise<void> {
  const fy = fiscalYearForDate(date, s);
  const count = await db.accountingPeriod.count({ where: { orgId: s.orgId, fiscalYear: fy } });
  if (count < 12) await generateFiscalYear(db, s, fy);
}

export async function getPeriodForDate(
  db: Db,
  s: PeriodSettings,
  date: Date
): Promise<AccountingPeriod> {
  const find = () =>
    db.accountingPeriod.findFirst({
      where: { orgId: s.orgId, startsOn: { lte: date }, endsOn: { gte: date } },
    });
  let period = await find();
  if (!period) {
    await ensurePeriodsCover(db, s, date);
    period = await find();
  }
  if (!period) throw acctError(ACCT.PERIOD_NOT_FOUND);
  return period;
}

export function assertPeriodOpenForManual(period: AccountingPeriod): void {
  if (period.status === "locked") throw acctError(ACCT.PERIOD_LOCKED);
  if (period.status === "closed") throw acctError(ACCT.PERIOD_CLOSED);
}

/**
 * System postings whose natural date is in a closed/locked period post on the
 * first day of the earliest open period after it (history stays closed).
 */
export async function resolvePostingDateForSystem(
  db: Db,
  s: PeriodSettings,
  naturalDate: Date
): Promise<{ entryDate: Date; period: AccountingPeriod; originalDate: Date | null; lateForPeriodId: string | null }> {
  const natural = await getPeriodForDate(db, s, naturalDate);
  if (natural.status === "open") {
    return { entryDate: naturalDate, period: natural, originalDate: null, lateForPeriodId: null };
  }
  for (let guard = 0; guard < 36; guard++) {
    const next = await db.accountingPeriod.findFirst({
      where: { orgId: s.orgId, status: "open", startsOn: { gt: natural.startsOn } },
      orderBy: { startsOn: "asc" },
    });
    if (next) {
      return { entryDate: next.startsOn, period: next, originalDate: naturalDate, lateForPeriodId: natural.id };
    }
    const lastFy = await db.accountingPeriod.findFirst({
      where: { orgId: s.orgId },
      orderBy: { fiscalYear: "desc" },
      select: { fiscalYear: true },
    });
    await generateFiscalYear(db, s, (lastFy?.fiscalYear ?? fiscalYearForDate(naturalDate, s)) + 1);
  }
  throw acctError(ACCT.PERIOD_NOT_FOUND);
}

export function toPeriodDto(p: AccountingPeriod) {
  return {
    id: p.id,
    fiscalYear: p.fiscalYear,
    periodNumber: p.periodNumber,
    startsOn: p.startsOn.toISOString(),
    endsOn: p.endsOn.toISOString(),
    status: p.status,
    closedAt: p.closedAt?.toISOString() ?? null,
    closedById: p.closedById,
    reopenedAt: p.reopenedAt?.toISOString() ?? null,
    reopenedById: p.reopenedById,
    reopenReason: p.reopenReason,
    lockedAt: p.lockedAt?.toISOString() ?? null,
  };
}

export async function listPeriods(ctx: AccountingCtx) {
  const rows = await prisma.accountingPeriod.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ fiscalYear: "desc" }, { periodNumber: "asc" }],
  });
  return rows.map(toPeriodDto);
}

export async function generatePeriodsForYear(ctx: AccountingCtx, fiscalYear: number) {
  const s = await prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId } });
  if (!s) throw acctError(ACCT.NOT_INITIALIZED);
  const goLiveFy = fiscalYearForDate(s.goLiveDate, s);
  const currentFy = fiscalYearForDate(new Date(), s);
  if (!Number.isInteger(fiscalYear) || fiscalYear < goLiveFy - 1 || fiscalYear > currentFy + 1) {
    throw acctError(ACCT.VALIDATION, {
      fields: { fiscalYear: `Must be between ${goLiveFy - 1} and ${currentFy + 1}` },
    });
  }
  const rows = await generateFiscalYear(prisma, s, fiscalYear);
  recordAccountingAudit(ctx, {
    action: "period.generate",
    entityType: "AccountingPeriod",
    entityId: null,
    description: `Fiscal year ${fiscalYear} periods generated`,
  });
  return rows.map(toPeriodDto);
}

async function loadPeriod(ctx: AccountingCtx, id: string): Promise<AccountingPeriod> {
  if (!isValidId(id)) throw acctError(ACCT.PERIOD_NOT_FOUND);
  const p = await prisma.accountingPeriod.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!p) throw acctError(ACCT.PERIOD_NOT_FOUND);
  return p;
}

export type CloseChecklistItem = {
  kind: "queue" | "journal" | "reconciliation" | "suspense" | "earlier_period";
  severity: "blocking" | "warning";
  id: string | null;
  label: string;
  href: string | null;
};

export async function closeChecklist(ctx: AccountingCtx, periodId: string) {
  const period = await loadPeriod(ctx, periodId);
  const items: CloseChecklistItem[] = [];
  const earlierOpen = await prisma.accountingPeriod.findMany({
    where: { orgId: ctx.orgId, startsOn: { lt: period.startsOn }, status: "open" },
    orderBy: { startsOn: "asc" },
    take: 12,
  });
  for (const p of earlierOpen) {
    items.push({
      kind: "earlier_period",
      severity: "blocking",
      id: p.id,
      label: `FY${p.fiscalYear} P${p.periodNumber} is still open`,
      href: "/admin/accounting/periods",
    });
  }
  const queue = await prisma.accountingPostingQueue.findMany({
    where: {
      orgId: ctx.orgId,
      status: { in: ["pending", "processing", "failed"] },
      eventAt: { gte: period.startsOn, lte: period.endsOn },
    },
    take: 50,
    select: { id: true, sourceType: true, sourceId: true, status: true },
  });
  for (const q of queue) {
    items.push({
      kind: "queue",
      severity: "blocking",
      id: q.id,
      label: `Posting ${q.status}: ${q.sourceType} ${q.sourceId}`,
      href: "/admin/accounting/posting-queue",
    });
  }
  const drafts = await prisma.journalEntry.findMany({
    where: {
      orgId: ctx.orgId,
      status: { in: ["draft", "pending_approval", "approved"] },
      entryDate: { gte: period.startsOn, lte: period.endsOn },
    },
    take: 50,
    select: { id: true, number: true, status: true },
  });
  for (const j of drafts) {
    items.push({
      kind: "journal",
      severity: "blocking",
      id: j.id,
      label: `Journal ${j.number} is ${j.status}`,
      href: `/admin/accounting/journals/${j.id}`,
    });
  }
  const banks = await prisma.bankAccount.findMany({
    where: { orgId: ctx.orgId, archivedAt: null, kind: { in: ["bank", "credit_card"] } },
    select: { id: true, name: true, lastReconciledAt: true },
  });
  for (const b of banks) {
    if (!b.lastReconciledAt || b.lastReconciledAt < period.endsOn) {
      items.push({
        kind: "reconciliation",
        severity: "warning",
        id: b.id,
        label: `${b.name} not reconciled through period end`,
        href: `/admin/accounting/banking/${b.id}`,
      });
    }
  }
  const suspense = await prisma.ledgerAccount.findUnique({
    where: { orgId_systemKey: { orgId: ctx.orgId, systemKey: "suspense" } },
  });
  if (suspense) {
    const agg = await prisma.journalLine.aggregate({
      where: {
        orgId: ctx.orgId,
        ledgerAccountId: suspense.id,
        entryDate: { lte: period.endsOn },
        entry: { status: { in: ["posted", "reversed"] } },
      },
      _sum: { debit: true, credit: true },
    });
    const bal = D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0));
    if (!isZero(bal)) {
      items.push({
        kind: "suspense",
        severity: "warning",
        id: suspense.id,
        label: `Suspense balance ${round2(bal).toFixed(2)} needs review`,
        href: `/admin/accounting/ledger?accountId=${suspense.id}`,
      });
    }
  }
  return { period: toPeriodDto(period), items, canClose: !items.some((i) => i.severity === "blocking") };
}

export async function closePeriod(ctx: AccountingCtx, periodId: string) {
  const period = await loadPeriod(ctx, periodId);
  if (period.status !== "open") throw acctError(ACCT.PERIOD_CLOSED);
  const checklist = await closeChecklist(ctx, periodId);
  const earlier = checklist.items.filter((i) => i.kind === "earlier_period");
  if (earlier.length) throw acctError(ACCT.PERIOD_ORDER, { details: earlier });
  const blocking = checklist.items.filter((i) => i.severity === "blocking");
  if (blocking.length) throw acctError(ACCT.PERIOD_HAS_PENDING, { details: blocking });
  const res = await prisma.accountingPeriod.updateMany({
    where: { id: period.id, status: "open" },
    data: { status: "closed", closedAt: new Date(), closedById: ctx.actorId },
  });
  if (res.count === 0) throw acctError(ACCT.PERIOD_CLOSED);
  recordAccountingAudit(ctx, {
    action: "period.close",
    entityType: "AccountingPeriod",
    entityId: period.id,
    description: `Closed FY${period.fiscalYear} P${period.periodNumber}`,
  });
  return toPeriodDto((await loadPeriod(ctx, periodId)));
}

export async function reopenPeriod(ctx: AccountingCtx, periodId: string, reason: string) {
  const period = await loadPeriod(ctx, periodId);
  if (period.status === "locked") throw acctError(ACCT.PERIOD_LOCKED);
  if (period.status === "open") return toPeriodDto(period);
  const laterClosed = await prisma.accountingPeriod.count({
    where: { orgId: ctx.orgId, startsOn: { gt: period.startsOn }, status: { in: ["closed", "locked"] } },
  });
  if (laterClosed > 0) throw acctError(ACCT.PERIOD_LOCKED, { message: "A later period is closed" });
  const updated = await prisma.accountingPeriod.update({
    where: { id: period.id },
    data: {
      status: "open",
      reopenedAt: new Date(),
      reopenedById: ctx.actorId,
      reopenReason: reason,
    },
  });
  recordAccountingAudit(ctx, {
    action: "period.reopen",
    entityType: "AccountingPeriod",
    entityId: period.id,
    description: `Reopened FY${period.fiscalYear} P${period.periodNumber}`,
    reason,
  });
  return toPeriodDto(updated);
}

/**
 * Year-end: zero revenue and expense into retained earnings (per location),
 * then lock the 12 periods. Idempotent via period_close:{fiscalYear}.
 */
export async function yearEndClose(ctx: AccountingCtx, fiscalYear: number) {
  const s = await prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId } });
  if (!s) throw acctError(ACCT.NOT_INITIALIZED);
  const periods = await prisma.accountingPeriod.findMany({
    where: { orgId: ctx.orgId, fiscalYear },
    orderBy: { periodNumber: "asc" },
  });
  if (periods.length !== 12) throw acctError(ACCT.PERIOD_NOT_FOUND);
  if (periods.some((p) => p.status === "open")) {
    throw acctError(ACCT.PERIOD_HAS_PENDING, { message: "All 12 periods must be closed" });
  }
  const { start, end } = fiscalYearBounds(fiscalYear, s);
  const grouped = await prisma.journalLine.groupBy({
    by: ["ledgerAccountId", "locationId"],
    where: {
      orgId: ctx.orgId,
      entryDate: { gte: start, lte: end },
      account: { type: { in: ["revenue", "expense"] } },
      entry: { status: { in: ["posted", "reversed"] }, kind: { not: "closing" } },
    },
    _sum: { debit: true, credit: true },
  });
  const { postJournal } = await import("@/lib/accounting/journalEngine");
  const { getSystemAccount } = await import("@/lib/accounting/accounts");
  const entry = await prisma.$transaction(
    async (tx) => {
      const re = await getSystemAccount(tx, ctx.orgId, "retained_earnings");
      const lines: Array<{ accountId: string; amount: Dec; locationId: string | null; description: string }> = [];
      const reByLoc = new Map<string, Dec>();
      for (const g of grouped) {
        const bal = D(g._sum.debit ?? 0).sub(D(g._sum.credit ?? 0));
        if (isZero(bal)) continue;
        lines.push({ accountId: g.ledgerAccountId, amount: bal.neg(), locationId: g.locationId, description: `FY${fiscalYear} close` });
        const k = g.locationId ?? "";
        reByLoc.set(k, (reByLoc.get(k) ?? D(0)).add(bal));
      }
      for (const [loc, amt] of reByLoc) {
        if (isZero(amt)) continue;
        lines.push({ accountId: re.id, amount: amt, locationId: loc || null, description: `FY${fiscalYear} net result` });
      }
      const posted =
        lines.length >= 2
          ? await postJournal(tx, {
              orgId: ctx.orgId,
              kind: "closing",
              sourceType: "period_close",
              sourceId: String(fiscalYear),
              sourceEvent: "year_end",
              idempotencyKey: `period_close:${fiscalYear}`,
              entryDate: end,
              memo: `Year-end close FY${fiscalYear}`,
              actorId: ctx.actorId,
              lines,
            })
          : null;
      await tx.accountingPeriod.updateMany({
        where: { orgId: ctx.orgId, fiscalYear },
        data: { status: "locked", lockedAt: new Date() },
      });
      return posted;
    },
    { timeout: 60_000 }
  );
  recordAccountingAudit(ctx, {
    action: "period.year_end_close",
    entityType: "AccountingPeriod",
    entityId: null,
    description: `Year-end close FY${fiscalYear}`,
    metadata: { journalEntryId: entry?.id ?? null },
  });
  return { fiscalYear, journalEntryId: entry?.id ?? null, locked: true };
}
