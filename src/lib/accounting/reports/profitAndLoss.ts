/**
 * Profit & loss (accrual): revenue net of contra revenue, cost of sales,
 * gross profit, operating expenses, other income/expense, net profit.
 */
import prisma from "@/lib/prisma";
import { ZERO, round2, type Dec } from "@/lib/accounting/money";
import { balancesByAccount, sumsByAccountLocation } from "@/lib/accounting/ledgerQueries";
import {
  compareWindow,
  loadAccounts,
  money,
  monthKeys,
  natural,
  reportMeta,
  type ReportQuery,
} from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

type Section = "revenue" | "cost_of_sales" | "operating_expense" | "other_income" | "other_expense";

function sectionOf(type: string, subtype: string): Section | null {
  if (type === "revenue") return subtype === "other_income" ? "other_income" : "revenue";
  if (type === "expense") {
    if (subtype === "cost_of_sales") return "cost_of_sales";
    if (subtype === "other_expense") return "other_expense";
    return "operating_expense";
  }
  return null;
}

export async function computePnlTotals(ctx: AccountingCtx, from: Date, to: Date, scope = ctx.scope) {
  const accounts = await loadAccounts(ctx.orgId);
  const sums = await balancesByAccount(ctx, { from, to, scope });
  const totals: Record<Section, Dec> = { revenue: ZERO, cost_of_sales: ZERO, operating_expense: ZERO, other_income: ZERO, other_expense: ZERO };
  const perAccount = new Map<string, Dec>();
  for (const [id, dc] of sums) {
    const a = accounts.get(id);
    if (!a) continue;
    const sec = sectionOf(a.type, a.subtype);
    if (!sec) continue;
    // Contra revenue is debit-normal; its natural amount reduces revenue.
    const amt = a.subtype === "contra_revenue" ? dc.debit.sub(dc.credit).neg() : natural(a, dc.debit, dc.credit);
    totals[sec] = totals[sec].add(amt);
    perAccount.set(id, amt);
  }
  const grossProfit = totals.revenue.sub(totals.cost_of_sales);
  const operatingProfit = grossProfit.sub(totals.operating_expense);
  const netProfit = operatingProfit.add(totals.other_income).sub(totals.other_expense);
  return { totals, grossProfit, operatingProfit, netProfit, perAccount, accounts };
}

export async function profitAndLoss(ctx: AccountingCtx, q: ReportQuery) {
  const cur = await computePnlTotals(ctx, q.from, q.to, q.scope);
  const cmpWin = compareWindow(q);
  const cmp = cmpWin ? await computePnlTotals(ctx, cmpWin.from, cmpWin.to, q.scope) : null;
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });

  let columnKeys: string[] = [];
  const columnValues = new Map<string, Map<string, Dec>>();
  if (q.columns === "location") {
    const byLoc = await sumsByAccountLocation(ctx.orgId, q.scope, { from: q.from, to: q.to });
    const keys = new Set<string>();
    for (const [acct, locs] of byLoc) {
      const a = cur.accounts.get(acct);
      if (!a || !sectionOf(a.type, a.subtype)) continue;
      const m = new Map<string, Dec>();
      for (const [loc, dc] of locs) {
        keys.add(loc || "company");
        const amt = a.subtype === "contra_revenue" ? dc.debit.sub(dc.credit).neg() : natural(a, dc.debit, dc.credit);
        m.set(loc || "company", amt);
      }
      columnValues.set(acct, m);
    }
    columnKeys = [...keys];
  } else if (q.columns === "month") {
    const months = monthKeys(q.from, q.to, settings.timezone);
    columnKeys = months.map((m) => m.key);
    for (const m of months) {
      const s = await balancesByAccount(ctx, { from: m.from, to: m.to, scope: q.scope });
      for (const [acct, dc] of s) {
        const a = cur.accounts.get(acct);
        if (!a || !sectionOf(a.type, a.subtype)) continue;
        const amt = a.subtype === "contra_revenue" ? dc.debit.sub(dc.credit).neg() : natural(a, dc.debit, dc.credit);
        const row = columnValues.get(acct) ?? new Map<string, Dec>();
        row.set(m.key, amt);
        columnValues.set(acct, row);
      }
    }
  }

  const sectionRows = (sec: Section) =>
    [...cur.accounts.values()]
      .filter((a) => sectionOf(a.type, a.subtype) === sec && !a.isHeader)
      .map((a) => {
        const amount = cur.perAccount.get(a.id) ?? ZERO;
        const compareAmount = cmp ? cmp.perAccount.get(a.id) ?? ZERO : null;
        const cols = columnValues.get(a.id);
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          parentId: a.parentId,
          subtype: a.subtype,
          amount: money(amount),
          compareAmount: compareAmount ? money(compareAmount) : null,
          columns: cols ? Object.fromEntries(columnKeys.map((k) => [k, money(cols.get(k) ?? ZERO)])) : undefined,
          _abs: amount.abs().add(compareAmount?.abs() ?? ZERO),
        };
      })
      .filter((r) => !r._abs.isZero())
      .map(({ _abs, ...r }) => {
        void _abs;
        return r;
      });

  const margin = cur.totals.revenue.isZero() ? null : round2(cur.grossProfit.div(cur.totals.revenue).mul(100));
  return {
    meta: await reportMeta(ctx, q, "Profit and loss"),
    columns: columnKeys,
    sections: [
      { key: "revenue", title: "Revenue", rows: sectionRows("revenue"), total: money(cur.totals.revenue), compareTotal: cmp ? money(cmp.totals.revenue) : null },
      { key: "cost_of_sales", title: "Cost of sales", rows: sectionRows("cost_of_sales"), total: money(cur.totals.cost_of_sales), compareTotal: cmp ? money(cmp.totals.cost_of_sales) : null },
      { key: "operating_expense", title: "Operating expenses", rows: sectionRows("operating_expense"), total: money(cur.totals.operating_expense), compareTotal: cmp ? money(cmp.totals.operating_expense) : null },
      { key: "other_income", title: "Other income", rows: sectionRows("other_income"), total: money(cur.totals.other_income), compareTotal: cmp ? money(cmp.totals.other_income) : null },
      { key: "other_expense", title: "Other expenses", rows: sectionRows("other_expense"), total: money(cur.totals.other_expense), compareTotal: cmp ? money(cmp.totals.other_expense) : null },
    ],
    totals: {
      revenue: money(cur.totals.revenue),
      costOfSales: money(cur.totals.cost_of_sales),
      grossProfit: money(cur.grossProfit),
      grossMarginPercent: margin ? margin.toFixed(2) : null,
      operatingExpenses: money(cur.totals.operating_expense),
      operatingProfit: money(cur.operatingProfit),
      otherIncome: money(cur.totals.other_income),
      otherExpenses: money(cur.totals.other_expense),
      netProfit: money(cur.netProfit),
      compareNetProfit: cmp ? money(cmp.netProfit) : null,
    },
  };
}