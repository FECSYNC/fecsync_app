/**
 * Bank reconciliation report and subledger-to-control reconciliation.
 */
import prisma from "@/lib/prisma";
import { D, ZERO, type Dec } from "@/lib/accounting/money";
import { balancesByAccount } from "@/lib/accounting/ledgerQueries";
import { getSystemAccount } from "@/lib/accounting/accounts";
import { arAging } from "@/lib/accounting/receivables/customers";
import { inventoryValuation } from "@/lib/accounting/inventory/valuation";
import { getReconciliation, listReconciliations } from "@/lib/accounting/banking/reconciliation";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function bankReconciliationReport(ctx: AccountingCtx, q: ReportQuery, sp: URLSearchParams) {
  const scoped = { ...ctx, scope: q.scope };
  const recId = sp.get("reconciliationId");
  if (recId) {
    const r = await getReconciliation(scoped, recId);
    const cleared = r.lines.filter((l) => l.cleared);
    const outstanding = r.lines.filter((l) => !l.cleared);
    return {
      meta: await reportMeta(ctx, q, `Bank reconciliation ${r.reconciliation.number}`),
      sections: [
        { key: "cleared", title: "Cleared items", rows: cleared },
        { key: "outstanding", title: "Outstanding items", rows: outstanding },
      ],
      totals: {
        statementEndingBalance: r.reconciliation.statementEndingBalance,
        clearedBalance: r.reconciliation.clearedBalance,
        difference: r.reconciliation.difference,
        outstanding: money(outstanding.reduce((a, l) => a.add(D(l.amount)), ZERO)),
      },
    };
  }
  const list = await listReconciliations(scoped, sp.get("bankAccountId"));
  return { meta: await reportMeta(ctx, q, "Bank reconciliations"), sections: [{ key: "reconciliations", title: "Reconciliations", rows: list }], totals: {} };
}

async function accountBalance(ctx: AccountingCtx, q: ReportQuery, accountIds: string[]): Promise<Dec> {
  if (!accountIds.length) return ZERO;
  const m = await balancesByAccount(ctx, { to: q.asOf, accountIds, scope: q.scope });
  let total = ZERO;
  for (const v of m.values()) total = total.add(v.debit).sub(v.credit);
  return total;
}

export async function subledgerReconciliation(ctx: AccountingCtx, q: ReportQuery) {
  const scoped = { ...ctx, scope: q.scope };
  const [ar, ap, gc, sv] = await Promise.all([
    getSystemAccount(prisma, ctx.orgId, "accounts_receivable"),
    getSystemAccount(prisma, ctx.orgId, "accounts_payable"),
    getSystemAccount(prisma, ctx.orgId, "gift_card_liability"),
    getSystemAccount(prisma, ctx.orgId, "stored_value_liability"),
  ]);
  const scopeLoc = q.scope.allLocations ? {} : { locationId: { in: q.scope.locationIds } };
  const arControl = await accountBalance(ctx, q, [ar.id]);
  const arParties = (await arAging(scoped, q.asOf)).reduce((a, r) => a.add(r.balance), ZERO);
  const apControl = (await accountBalance(ctx, q, [ap.id])).neg();
  const bills = await prisma.supplierBill.findMany({
    where: { orgId: ctx.orgId, status: { in: ["posted", "partially_paid"] }, billDate: { lte: q.asOf }, ...scopeLoc },
    select: { amountDue: true, kind: true, exchangeRate: true },
  });
  const unapplied = await prisma.supplierPayment.aggregate({
    where: { orgId: ctx.orgId, status: "posted", ...scopeLoc },
    _sum: { unappliedAmount: true },
  });
  const apDocs = bills
    .reduce((a, b) => a.add(D(b.amountDue).mul(D(b.exchangeRate)).mul(b.kind === "credit_note" ? -1 : 1)), ZERO)
    .sub(D(unapplied._sum.unappliedAmount ?? 0));
  const gcControl = (await accountBalance(ctx, q, [gc.id])).neg();
  const gcCards = await prisma.giftCard.aggregate({
    where: { orgId: ctx.orgId, status: "active", ...(q.scope.allLocations ? {} : { locationId: { in: q.scope.locationIds } }) },
    _sum: { remainingBalance: true },
  });
  const svControl = (await accountBalance(ctx, q, [sv.id])).neg();
  const [wallets, cashless] = await Promise.all([
    prisma.parkWallet.aggregate({ where: { orgId: ctx.orgId, ...scopeLoc }, _sum: { balance: true } }),
    prisma.cashlessAccount.aggregate({ where: { orgId: ctx.orgId, status: "active", ...scopeLoc }, _sum: { balance: true } }),
  ]);
  const inv = await inventoryValuation(scoped, { asOf: q.asOf });
  const clearingAccounts = await prisma.ledgerAccount.findMany({ where: { orgId: ctx.orgId, subtype: "payment_clearing", isHeader: false }, select: { id: true, code: true, name: true } });
  const unmatchedByAccount = await Promise.all(
    clearingAccounts.map(async (a) => {
      const agg = await prisma.journalLine.aggregate({
        where: { orgId: ctx.orgId, ledgerAccountId: a.id, entryDate: { lte: q.asOf }, reconciledInId: null, bankMatches: { none: {} }, entry: { status: { in: ["posted", "reversed"] } }, ...scopeLoc },
        _sum: { debit: true, credit: true },
      });
      return { accountId: a.id, code: a.code, name: a.name, unmatched: money(D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0))) };
    })
  );
  const row = (key: string, title: string, control: Dec, sub: Dec) => ({
    key,
    title,
    control: money(control),
    subledger: money(sub),
    difference: money(control.sub(sub)),
    reconciles: control.sub(sub).isZero(),
  });
  const rows = [
    row("ar", "Accounts receivable vs customer balances", arControl, arParties),
    row("ap", "Accounts payable vs open supplier bills", apControl, apDocs),
    row("gift_cards", "Gift card liability vs active gift card balances", gcControl, D(gcCards._sum.remainingBalance ?? 0)),
    row("stored_value", "Park wallet and cashless liability vs balances", svControl, D(wallets._sum.balance ?? 0).add(D(cashless._sum.balance ?? 0))),
    row("inventory", "Inventory accounts vs inventory valuation", D(inv.ledgerValue), D(inv.totalValue)),
  ];
  return {
    meta: await reportMeta(ctx, q, "Subledger reconciliation"),
    sections: [
      { key: "controls", title: "Control accounts", rows },
      { key: "clearing", title: "Unmatched clearing balances", rows: unmatchedByAccount },
    ],
    totals: { allReconcile: rows.every((r) => r.reconciles) },
  };
}
