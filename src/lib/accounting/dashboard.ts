/**
 * Accounting dashboard KPIs (aggregate queries only; no per-row loops).
 */
import moment from "moment-timezone";
import prisma from "@/lib/prisma";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { balancesByAccount } from "@/lib/accounting/ledgerQueries";
import { computePnlTotals } from "@/lib/accounting/reports/profitAndLoss";
import { arAging } from "@/lib/accounting/receivables/customers";
import { supplierBalances } from "@/lib/accounting/payables/suppliers";
import { inventoryValuation } from "@/lib/accounting/inventory/valuation";
import { narrowScopeMany } from "@/lib/accounting/scope";
import { listPendingApprovals } from "@/lib/accounting/approvals";
import { fiscalYearBounds, fiscalYearForDate } from "@/lib/accounting/periods";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function getAccountingDashboard(
  ctx: AccountingCtx,
  q: { from?: Date; to?: Date; locationIds?: string[] }
) {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const tz = settings.timezone;
  const now = new Date();
  const to = q.to ?? now;
  const from = q.from ?? moment(to).tz(tz).startOf("month").toDate();
  const scope = narrowScopeMany(ctx.scope, q.locationIds ?? []);
  const scoped = { ...ctx, scope };

  const [pnl, accounts] = await Promise.all([
    computePnlTotals(ctx, from, to, scope),
    prisma.ledgerAccount.findMany({
      where: { orgId: ctx.orgId, isHeader: false },
      select: { id: true, code: true, name: true, subtype: true, systemKey: true, cashFlowCategory: true, type: true },
    }),
  ]);
  const balances = await balancesByAccount(ctx, { to, scope });
  const bal = (id: string) => {
    const b = balances.get(id);
    return b ? b.debit.sub(b.credit) : ZERO;
  };
  const sumKey = (pred: (a: (typeof accounts)[number]) => boolean, sign: 1 | -1) =>
    accounts.filter(pred).reduce((acc, a) => acc.add(bal(a.id).mul(sign)), ZERO);

  const cashAccounts = accounts
    .filter((a) => a.cashFlowCategory === "cash")
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, balance: bal(a.id) }))
    .filter((a) => !a.balance.isZero());
  const cash = cashAccounts.reduce((a, c) => a.add(c.balance), ZERO);
  const taxPayable = sumKey((a) => a.subtype === "tax_payable", -1).sub(sumKey((a) => a.subtype === "tax_receivable", 1));
  const giftCardLiability = sumKey((a) => a.systemKey === "gift_card_liability", -1);
  const customerDeposits = sumKey((a) => a.systemKey === "customer_deposits", -1);

  const aging = await arAging(scoped, to);
  const arTotal = aging.reduce((a, r) => a.add(r.balance), ZERO);
  const arOverdue = aging.reduce((a, r) => a.add(r.overdue), ZERO);
  const arCredits = aging.filter((r) => r.balance.lessThan(0)).reduce((a, r) => a.add(r.balance.neg()), ZERO);
  const topOverdue = aging
    .filter((r) => r.overdue.greaterThan(0))
    .sort((a, b) => b.overdue.comparedTo(a.overdue))
    .slice(0, 5);

  const apMap = await supplierBalances(scoped, to);
  let apTotal = ZERO;
  for (const b of apMap.values()) apTotal = apTotal.add(Object.values(b).reduce((a, v) => a.add(v), ZERO));
  const weekAhead = new Date(to.getTime() + 7 * 86_400_000);
  const billsDueSoon = await prisma.supplierBill.findMany({
    where: {
      orgId: ctx.orgId,
      status: { in: ["posted", "partially_paid"] },
      dueDate: { lte: weekAhead },
      ...(scope.allLocations ? {} : { locationId: { in: scope.locationIds } }),
    },
    include: { supplier: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
    take: 10,
  });
  const apDue7 = billsDueSoon.reduce((a, b) => a.add(D(b.amountDue).mul(D(b.exchangeRate))), ZERO);

  const inventory = await inventoryValuation(scoped, { asOf: to });

  const [exceptions, unreconciled, approvals] = await Promise.all([
    prisma.accountingPostingQueue.count({ where: { orgId: ctx.orgId, OR: [{ status: "failed" }, { warningCode: { not: null } }] } }),
    prisma.bankTransaction.count({ where: { orgId: ctx.orgId, status: "unmatched" } }),
    listPendingApprovals(ctx),
  ]);
  const suspense = accounts.find((a) => a.systemKey === "suspense");

  const start12 = moment(to).tz(tz).startOf("month").subtract(11, "months");
  const trend = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const m = start12.clone().add(i, "months");
      const mFrom = m.toDate();
      const mTo = m.clone().endOf("month").toDate();
      const t = await computePnlTotals(ctx, mFrom, mTo > to ? to : mTo, scope);
      const monthExpenses = t.totals.cost_of_sales
        .add(t.totals.operating_expense)
        .add(t.totals.other_expense);
      return {
        month: m.format("YYYY-MM"),
        revenue: toApiString(t.totals.revenue.add(t.totals.other_income)),
        expenses: toApiString(monthExpenses),
        profit: toApiString(t.netProfit),
      };
    })
  );
  const fy = fiscalYearBounds(fiscalYearForDate(to, settings), settings);
  const ytd = await computePnlTotals(ctx, fy.start, to, scope);
  const expenses = pnl.totals.cost_of_sales.add(pnl.totals.operating_expense).add(pnl.totals.other_expense);
  const grossMargin: Dec | null = pnl.totals.revenue.isZero() ? null : round2(pnl.grossProfit.div(pnl.totals.revenue).mul(100));

  const names = await import("@/lib/accounting/partyKeys").then((m) =>
    m.partyDisplayNames(ctx.orgId, topOverdue.map((r) => r.party).filter((p): p is NonNullable<typeof p> => Boolean(p)))
  );
  return {
    currency: settings.baseCurrency,
    range: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      revenue: toApiString(pnl.totals.revenue.add(pnl.totals.other_income)),
      expenses: toApiString(expenses),
      netProfit: toApiString(pnl.netProfit),
      grossProfit: toApiString(pnl.grossProfit),
      grossMarginPercent: grossMargin ? grossMargin.toFixed(2) : null,
      revenueYtd: toApiString(ytd.totals.revenue.add(ytd.totals.other_income)),
      netProfitYtd: toApiString(ytd.netProfit),
      cashAndBank: toApiString(cash),
      receivables: toApiString(arTotal.add(arCredits)),
      receivablesOverdue: toApiString(arOverdue),
      customerDeposits: toApiString(customerDeposits.add(arCredits)),
      payables: toApiString(apTotal),
      payablesDueIn7Days: toApiString(apDue7),
      inventoryValue: inventory.totalValue,
      taxPayable: toApiString(taxPayable),
      giftCardLiability: toApiString(giftCardLiability),
    },
    cashAccounts: cashAccounts.map((c) => ({ ...c, balance: toApiString(c.balance) })),
    topOverdueCustomers: topOverdue.map((r) => ({ partyKey: r.partyKey, name: names.get(r.partyKey)?.name ?? "Customer", overdue: toApiString(r.overdue), balance: toApiString(r.balance) })),
    billsDueSoon: billsDueSoon.map((b) => ({ id: b.id, number: b.number, supplierName: b.supplier.name, dueDate: b.dueDate.toISOString(), amountDue: toApiString(b.amountDue) })),
    alerts: {
      postingExceptions: exceptions,
      pendingApprovals: approvals.length,
      unreconciledBankLines: unreconciled,
      suspenseBalance: suspense ? toApiString(bal(suspense.id)) : "0.00",
    },
    trend,
  };
}
