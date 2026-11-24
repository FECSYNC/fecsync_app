/**
 * Balance sheet as of a date. Current-year earnings are computed from the
 * fiscal year start; earlier unclosed results show as prior-year earnings.
 * AR credit balances reclassify to customer deposits; AP debit balances to
 * supplier advances. Assets must equal liabilities + equity.
 */
import prisma from "@/lib/prisma";
import { D, ZERO, type Dec } from "@/lib/accounting/money";
import { balancesByAccount } from "@/lib/accounting/ledgerQueries";
import { fiscalYearBounds, fiscalYearForDate } from "@/lib/accounting/periods";
import { getSystemAccount } from "@/lib/accounting/accounts";
import { locationWhere } from "@/lib/accounting/scope";
import { computePnlTotals } from "@/lib/accounting/reports/profitAndLoss";
import { loadAccounts, money, natural, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

async function partySignSplit(ctx: AccountingCtx, accountId: string, asOf: Date, q: ReportQuery, partyCols: Array<"guestProfileId" | "bookingAccountId" | "customerUserId" | "supplierId">) {
  const rows = await prisma.journalLine.groupBy({
    by: partyCols,
    where: { orgId: ctx.orgId, ledgerAccountId: accountId, entryDate: { lte: asOf }, entry: { status: { in: ["posted", "reversed"] } }, ...locationWhere(q.scope) },
    _sum: { debit: true, credit: true },
  });
  let positive = ZERO;
  let negative = ZERO;
  for (const r of rows) {
    const net = D(r._sum.debit ?? 0).sub(D(r._sum.credit ?? 0));
    if (net.greaterThan(0)) positive = positive.add(net);
    else negative = negative.add(net);
  }
  return { positive, negative };
}

export async function balanceSheet(ctx: AccountingCtx, q: ReportQuery) {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const accounts = await loadAccounts(ctx.orgId);
  const sums = await balancesByAccount(ctx, { to: q.asOf, scope: q.scope });
  const fy = fiscalYearBounds(fiscalYearForDate(q.asOf, settings), settings);
  const currentYear = await computePnlTotals(ctx, fy.start, q.asOf, q.scope);
  const allTime = await computePnlTotals(ctx, new Date(0), q.asOf, q.scope);
  const priorEarnings = allTime.netProfit.sub(currentYear.netProfit);

  const ar = await getSystemAccount(prisma, ctx.orgId, "accounts_receivable");
  const ap = await getSystemAccount(prisma, ctx.orgId, "accounts_payable");
  const arSplit = await partySignSplit(ctx, ar.id, q.asOf, q, ["guestProfileId", "bookingAccountId", "customerUserId"]);
  const apSplit = await partySignSplit(ctx, ap.id, q.asOf, q, ["supplierId"]);

  const groups: Record<"asset" | "liability" | "equity", Array<{ accountId: string; code: string; name: string; subtype: string; amount: Dec }>> = {
    asset: [],
    liability: [],
    equity: [],
  };
  for (const [id, dc] of sums) {
    const a = accounts.get(id);
    if (!a || (a.type !== "asset" && a.type !== "liability" && a.type !== "equity")) continue;
    let amount = natural(a, dc.debit, dc.credit);
    if (a.id === ar.id) amount = arSplit.positive;
    if (a.id === ap.id) amount = apSplit.negative.neg();
    if (amount.isZero()) continue;
    groups[a.type].push({ accountId: a.id, code: a.code, name: a.name, subtype: a.subtype, amount });
  }
  if (!arSplit.negative.isZero()) {
    groups.liability.push({ accountId: `${ar.id}:credits`, code: ar.code, name: "Customer credit balances (deposits)", subtype: "unearned_revenue", amount: arSplit.negative.neg() });
  }
  if (!apSplit.positive.isZero()) {
    groups.asset.push({ accountId: `${ap.id}:advances`, code: ap.code, name: "Supplier advances", subtype: "prepaid", amount: apSplit.positive });
  }
  if (!priorEarnings.isZero()) {
    groups.equity.push({ accountId: "prior_year_earnings", code: "", name: "Prior years' earnings (not closed)", subtype: "retained_earnings", amount: priorEarnings });
  }
  groups.equity.push({ accountId: "current_year_earnings", code: "", name: "Current year earnings", subtype: "retained_earnings", amount: currentYear.netProfit });

  const total = (rows: Array<{ amount: Dec }>) => rows.reduce((a, r) => a.add(r.amount), ZERO);
  const totalAssets = total(groups.asset);
  const totalLiabilities = total(groups.liability);
  const totalEquity = total(groups.equity);
  const difference = totalAssets.sub(totalLiabilities).sub(totalEquity);
  const fmt = (rows: typeof groups.asset) =>
    rows.sort((a, b) => a.code.localeCompare(b.code)).map((r) => ({ ...r, amount: money(r.amount) }));
  return {
    meta: await reportMeta(ctx, q, "Balance sheet"),
    note: q.scope.allLocations
      ? null
      : "Park view: company-level balances (locationId empty) are excluded, so totals cover the selected parks only.",
    sections: [
      { key: "assets", title: "Assets", rows: fmt(groups.asset), total: money(totalAssets) },
      { key: "liabilities", title: "Liabilities", rows: fmt(groups.liability), total: money(totalLiabilities) },
      { key: "equity", title: "Equity", rows: fmt(groups.equity), total: money(totalEquity) },
    ],
    totals: {
      assets: money(totalAssets),
      liabilities: money(totalLiabilities),
      equity: money(totalEquity),
      liabilitiesAndEquity: money(totalLiabilities.add(totalEquity)),
      difference: money(difference),
      balanced: difference.isZero(),
    },
  };
}
