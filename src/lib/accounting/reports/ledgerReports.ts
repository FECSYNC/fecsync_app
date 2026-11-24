/**
 * Trial balance, general ledger, journal report.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { D, ZERO } from "@/lib/accounting/money";
import { getLedger, trialBalance as tb } from "@/lib/accounting/ledgerQueries";
import { locationWhere } from "@/lib/accounting/scope";
import { toJournalDto } from "@/lib/accounting/journalEngine";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function trialBalanceReport(ctx: AccountingCtx, q: ReportQuery) {
  const result = await tb(ctx, { from: q.from, to: q.to, scope: q.scope });
  return {
    meta: await reportMeta(ctx, q, "Trial balance"),
    sections: [{ key: "accounts", title: "Accounts", rows: result.rows }],
    totals: { debit: result.totalDebit, credit: result.totalCredit, balanced: result.balanced, difference: result.difference },
  };
}

export async function generalLedgerReport(ctx: AccountingCtx, q: ReportQuery) {
  if (q.accountId && isValidId(q.accountId)) {
    const ledger = await getLedger(ctx, {
      accountId: q.accountId,
      from: q.from,
      to: q.to,
      locationId: q.locationIds.length === 1 ? q.locationIds[0] : null,
      limit: Math.min(q.limit, 1000),
    });
    return { meta: await reportMeta(ctx, q, "General ledger"), sections: [{ key: ledger.account.id, title: `${ledger.account.code} ${ledger.account.name}`, ledger }], totals: {} };
  }
  const lines = await prisma.journalLine.findMany({
    where: {
      orgId: ctx.orgId,
      entryDate: { gte: q.from, lte: q.to },
      entry: { status: { in: ["posted", "reversed"] } },
      ...locationWhere(q.scope),
    },
    include: { account: { select: { code: true, name: true } }, entry: { select: { number: true, memo: true } } },
    orderBy: [{ account: { code: "asc" } }, { entryDate: "asc" }, { id: "asc" }],
    take: q.limit,
  });
  const byAccount = new Map<string, { code: string; name: string; rows: unknown[]; debit: typeof ZERO; credit: typeof ZERO }>();
  for (const l of lines) {
    const g = byAccount.get(l.ledgerAccountId) ?? { code: l.account.code, name: l.account.name, rows: [], debit: ZERO, credit: ZERO };
    g.rows.push({
      id: l.id,
      entryNumber: l.entry.number,
      entryDate: l.entryDate.toISOString(),
      memo: l.entry.memo,
      description: l.description,
      locationId: l.locationId,
      debit: money(D(l.debit)),
      credit: money(D(l.credit)),
    });
    g.debit = g.debit.add(D(l.debit));
    g.credit = g.credit.add(D(l.credit));
    byAccount.set(l.ledgerAccountId, g);
  }
  return {
    meta: await reportMeta(ctx, q, "General ledger"),
    truncated: lines.length >= q.limit,
    sections: [...byAccount.entries()].map(([id, g]) => ({
      key: id,
      title: `${g.code} ${g.name}`,
      rows: g.rows,
      totalDebit: money(g.debit),
      totalCredit: money(g.credit),
    })),
    totals: {},
  };
}

export async function journalReport(ctx: AccountingCtx, q: ReportQuery) {
  const where: Prisma.JournalEntryWhereInput = {
    orgId: ctx.orgId,
    entryDate: { gte: q.from, lte: q.to },
    status: { in: ["posted", "reversed"] },
    ...(q.scope.allLocations ? {} : { lines: { every: { locationId: { in: q.scope.locationIds } } } }),
  };
  const entries = await prisma.journalEntry.findMany({
    where,
    include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
    orderBy: [{ entryDate: "asc" }, { number: "asc" }],
    take: Math.min(q.limit, 5000),
  });
  return {
    meta: await reportMeta(ctx, q, "Journal"),
    truncated: entries.length >= Math.min(q.limit, 5000),
    sections: [{ key: "entries", title: "Entries", rows: entries.map((e) => toJournalDto(e)) }],
    totals: {
      debit: money(entries.reduce((a, e) => a.add(D(e.totalDebit)), ZERO)),
      credit: money(entries.reduce((a, e) => a.add(D(e.totalCredit)), ZERO)),
    },
  };
}
