/**
 * Ledger reads. Whole periods inside a range come from AccountBalance; the
 * partial edges come from JournalLine (posted + reversed entries only).
 */
import type { LedgerAccount, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { D, ZERO, toApiString, type Dec } from "@/lib/accounting/money";
import { normalBalance } from "@/lib/accounting/chartTemplate";
import { locationKeyWhere, locationWhere, narrowScope } from "@/lib/accounting/scope";
import { partyLineWhere } from "@/lib/accounting/partyKeys";
import type { AccountingCtx, PartyRef, ScopeFilter } from "@/lib/accounting/types";

export const POSTED = { in: ["posted", "reversed"] as Array<"posted" | "reversed"> };

export type DebitCredit = { debit: Dec; credit: Dec };

export type AccountLocationSums = Map<string, Map<string, DebitCredit>>;

/**
 * Sums per account and location ("" = company-level) for [from, to].
 */
export async function sumsByAccountLocation(
  orgId: string,
  scope: ScopeFilter,
  range: { from?: Date | null; to: Date; accountIds?: string[] }
): Promise<AccountLocationSums> {
  const periods = await prisma.accountingPeriod.findMany({
    where: { orgId },
    select: { id: true, startsOn: true, endsOn: true },
  });
  const fullIds = periods
    .filter((p) => (!range.from || p.startsOn >= range.from) && p.endsOn <= range.to)
    .map((p) => p.id);
  const accountFilter = range.accountIds ? { ledgerAccountId: { in: range.accountIds } } : {};
  const out: AccountLocationSums = new Map();
  const addTo = (acct: string, loc: string, debit: Dec, credit: Dec) => {
    const byLoc = out.get(acct) ?? new Map<string, DebitCredit>();
    const cur = byLoc.get(loc) ?? { debit: ZERO, credit: ZERO };
    byLoc.set(loc, { debit: cur.debit.add(debit), credit: cur.credit.add(credit) });
    out.set(acct, byLoc);
  };
  if (fullIds.length) {
    const rows = await prisma.accountBalance.groupBy({
      by: ["ledgerAccountId", "locationKey"],
      where: { orgId, periodId: { in: fullIds }, ...locationKeyWhere(scope), ...accountFilter },
      _sum: { debitTotal: true, creditTotal: true },
    });
    for (const r of rows) {
      addTo(r.ledgerAccountId, r.locationKey, D(r._sum.debitTotal ?? 0), D(r._sum.creditTotal ?? 0));
    }
  }
  const lineRows = await prisma.journalLine.groupBy({
    by: ["ledgerAccountId", "locationId"],
    where: {
      orgId,
      entryDate: { ...(range.from ? { gte: range.from } : {}), lte: range.to },
      ...locationWhere(scope),
      ...accountFilter,
      entry: { status: POSTED, ...(fullIds.length ? { periodId: { notIn: fullIds } } : {}) },
    },
    _sum: { debit: true, credit: true },
  });
  for (const r of lineRows) {
    addTo(r.ledgerAccountId, r.locationId ?? "", D(r._sum.debit ?? 0), D(r._sum.credit ?? 0));
  }
  return out;
}

export function collapseLocations(sums: AccountLocationSums): Map<string, DebitCredit> {
  const out = new Map<string, DebitCredit>();
  for (const [acct, byLoc] of sums) {
    let debit = ZERO;
    let credit = ZERO;
    for (const v of byLoc.values()) {
      debit = debit.add(v.debit);
      credit = credit.add(v.credit);
    }
    out.set(acct, { debit, credit });
  }
  return out;
}

export async function balancesByAccount(
  ctx: AccountingCtx,
  range: { from?: Date | null; to: Date; accountIds?: string[]; scope?: ScopeFilter }
): Promise<Map<string, DebitCredit>> {
  return collapseLocations(await sumsByAccountLocation(ctx.orgId, range.scope ?? ctx.scope, range));
}

/** Signed balance in the account's natural sign (debit − credit). */
export async function getAccountBalance(
  ctx: AccountingCtx,
  accountId: string,
  opts: { asOf: Date; scope?: ScopeFilter }
): Promise<Dec> {
  const m = await balancesByAccount(ctx, { to: opts.asOf, accountIds: [accountId], scope: opts.scope });
  const b = m.get(accountId);
  return b ? b.debit.sub(b.credit) : ZERO;
}

export function signedForDisplay(account: Pick<LedgerAccount, "type" | "subtype">, dc: DebitCredit): Dec {
  const net = dc.debit.sub(dc.credit);
  return normalBalance(account.type, account.subtype) === "debit" ? net : net.neg();
}

export async function getLedger(
  ctx: AccountingCtx,
  q: { accountId: string; from?: Date; to?: Date; locationId?: string | null; cursor?: string; limit?: number }
) {
  if (!isValidId(q.accountId)) throw acctError(ACCT.NOT_FOUND);
  const account = await prisma.ledgerAccount.findFirst({ where: { id: q.accountId, orgId: ctx.orgId } });
  if (!account) throw acctError(ACCT.NOT_FOUND);
  const scope = narrowScope(ctx.scope, q.locationId ?? null);
  const to = q.to ?? new Date();
  const limit = Math.min(Math.max(q.limit ?? 200, 1), 1000);
  let opening = ZERO;
  if (q.from) {
    const before = new Date(q.from.getTime() - 1);
    const m = await balancesByAccount(ctx, { to: before, accountIds: [account.id], scope });
    const b = m.get(account.id);
    opening = b ? b.debit.sub(b.credit) : ZERO;
  }
  const where: Prisma.JournalLineWhereInput = {
    orgId: ctx.orgId,
    ledgerAccountId: account.id,
    entryDate: { ...(q.from ? { gte: q.from } : {}), lte: to },
    ...locationWhere(scope),
    entry: { status: POSTED },
  };
  let runningStart = opening;
  if (q.cursor && isValidId(q.cursor)) {
    const cursorLine = await prisma.journalLine.findFirst({ where: { id: q.cursor, orgId: ctx.orgId } });
    if (cursorLine) {
      const prior = await prisma.journalLine.aggregate({
        where: {
          ...where,
          OR: [
            { entryDate: { lt: cursorLine.entryDate } },
            { entryDate: cursorLine.entryDate, id: { lte: cursorLine.id } },
          ],
        },
        _sum: { debit: true, credit: true },
      });
      runningStart = opening.add(D(prior._sum.debit ?? 0)).sub(D(prior._sum.credit ?? 0));
    }
  }
  const rows = await prisma.journalLine.findMany({
    where,
    include: { entry: { select: { id: true, number: true, memo: true, sourceType: true, sourceId: true, kind: true, reference: true } } },
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  let running = runningStart;
  const items = page.map((l) => {
    running = running.add(D(l.debit)).sub(D(l.credit));
    return {
      id: l.id,
      entryId: l.entryId,
      entryNumber: l.entry.number,
      entryDate: l.entryDate.toISOString(),
      memo: l.entry.memo,
      reference: l.entry.reference,
      kind: l.entry.kind,
      sourceType: l.entry.sourceType,
      sourceId: l.entry.sourceId,
      description: l.description,
      locationId: l.locationId,
      debit: toApiString(l.debit),
      credit: toApiString(l.credit),
      runningBalance: toApiString(running),
      reconciled: Boolean(l.reconciledInId),
    };
  });
  const totals = await prisma.journalLine.aggregate({ where, _sum: { debit: true, credit: true } });
  const closing = opening.add(D(totals._sum.debit ?? 0)).sub(D(totals._sum.credit ?? 0));
  return {
    account: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      normalBalance: normalBalance(account.type, account.subtype),
    },
    openingBalance: toApiString(opening),
    closingBalance: toApiString(closing),
    periodDebit: toApiString(totals._sum.debit ?? 0),
    periodCredit: toApiString(totals._sum.credit ?? 0),
    items,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export async function trialBalance(ctx: AccountingCtx, q: { from?: Date | null; to: Date; scope?: ScopeFilter }) {
  const scope = q.scope ?? ctx.scope;
  const accounts = await prisma.ledgerAccount.findMany({
    where: { orgId: ctx.orgId, isHeader: false },
    orderBy: { code: "asc" },
  });
  const openingMap = q.from
    ? await balancesByAccount(ctx, { to: new Date(q.from.getTime() - 1), scope })
    : new Map<string, DebitCredit>();
  const periodMap = await balancesByAccount(ctx, { from: q.from ?? null, to: q.to, scope });
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const rows = accounts
    .map((a) => {
      const o = openingMap.get(a.id) ?? { debit: ZERO, credit: ZERO };
      const p = periodMap.get(a.id) ?? { debit: ZERO, credit: ZERO };
      const openingNet = o.debit.sub(o.credit);
      const closingNet = openingNet.add(p.debit).sub(p.credit);
      return { a, openingNet, p, closingNet };
    })
    .filter((r) => !r.openingNet.isZero() || !r.p.debit.isZero() || !r.p.credit.isZero())
    .map((r) => {
      const closingDebit = r.closingNet.greaterThan(0) ? r.closingNet : ZERO;
      const closingCredit = r.closingNet.lessThan(0) ? r.closingNet.neg() : ZERO;
      totalDebit = totalDebit.add(closingDebit);
      totalCredit = totalCredit.add(closingCredit);
      return {
        accountId: r.a.id,
        code: r.a.code,
        name: r.a.name,
        type: r.a.type,
        subtype: r.a.subtype,
        opening: toApiString(r.openingNet),
        periodDebit: toApiString(r.p.debit),
        periodCredit: toApiString(r.p.credit),
        closingDebit: toApiString(closingDebit),
        closingCredit: toApiString(closingCredit),
      };
    });
  return {
    rows,
    totalDebit: toApiString(totalDebit),
    totalCredit: toApiString(totalCredit),
    balanced: totalDebit.equals(totalCredit),
    difference: toApiString(totalDebit.sub(totalCredit)),
  };
}

/** Party balance on control accounts (AR for customers, AP/GRNI for suppliers). */
export async function partyBalance(
  orgId: string,
  party: PartyRef,
  opts: { asOf?: Date; accountIds?: string[]; scope?: ScopeFilter } = {}
): Promise<Dec> {
  const agg = await prisma.journalLine.aggregate({
    where: {
      orgId,
      ...partyLineWhere(party),
      ...(opts.accountIds ? { ledgerAccountId: { in: opts.accountIds } } : {}),
      ...(opts.asOf ? { entryDate: { lte: opts.asOf } } : {}),
      ...(opts.scope ? locationWhere(opts.scope) : {}),
      entry: { status: POSTED },
    },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0));
}
