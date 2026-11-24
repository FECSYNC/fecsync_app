/**
 * Cash flow: indirect method by cashFlowCategory, plus a direct view of each
 * cash / bank / clearing account. Closing cash must equal cash balances.
 */
import { D, ZERO, type Dec } from "@/lib/accounting/money";
import { balancesByAccount } from "@/lib/accounting/ledgerQueries";
import { computePnlTotals } from "@/lib/accounting/reports/profitAndLoss";
import { loadAccounts, money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function cashFlow(ctx: AccountingCtx, q: ReportQuery) {
  const accounts = await loadAccounts(ctx.orgId);
  const before = new Date(q.from.getTime() - 1);
  const [opening, closing, period, pnl] = await Promise.all([
    balancesByAccount(ctx, { to: before, scope: q.scope }),
    balancesByAccount(ctx, { to: q.to, scope: q.scope }),
    balancesByAccount(ctx, { from: q.from, to: q.to, scope: q.scope }),
    computePnlTotals(ctx, q.from, q.to, q.scope),
  ]);
  const net = (m: Map<string, { debit: Dec; credit: Dec }>, id: string) => {
    const v = m.get(id);
    return v ? v.debit.sub(v.credit) : ZERO;
  };
  const operating: Array<{ name: string; amount: Dec }> = [{ name: "Net profit", amount: pnl.netProfit }];
  const investing: Array<{ name: string; amount: Dec }> = [];
  const financing: Array<{ name: string; amount: Dec }> = [];
  let openingCash = ZERO;
  let closingCash = ZERO;
  const direct: Array<{ accountId: string; code: string; name: string; opening: string; inflows: string; outflows: string; closing: string }> = [];
  for (const a of accounts.values()) {
    if (a.isHeader) continue;
    if (a.type === "revenue" || a.type === "expense") continue;
    const change = net(closing, a.id).sub(net(opening, a.id));
    if (a.cashFlowCategory === "cash") {
      openingCash = openingCash.add(net(opening, a.id));
      closingCash = closingCash.add(net(closing, a.id));
      const p = period.get(a.id) ?? { debit: ZERO, credit: ZERO };
      if (!net(opening, a.id).isZero() || !p.debit.isZero() || !p.credit.isZero()) {
        direct.push({
          accountId: a.id,
          code: a.code,
          name: a.name,
          opening: money(net(opening, a.id)),
          inflows: money(p.debit),
          outflows: money(p.credit),
          closing: money(net(closing, a.id)),
        });
      }
      continue;
    }
    if (change.isZero()) continue;
    // Cash effect of a balance-sheet change is the negative of its debit-side change.
    const effect = change.neg();
    const label = `${a.code} ${a.name}`;
    if (a.cashFlowCategory === "investing") investing.push({ name: label, amount: effect });
    else if (a.cashFlowCategory === "financing") financing.push({ name: label, amount: effect });
    else if (a.subtype === "opening_balance_equity" || a.subtype === "equity_capital") financing.push({ name: label, amount: effect });
    // Retained earnings moves only via year-end close, which also zeroes the P&L inside net profit.
    else operating.push({ name: label, amount: effect });
  }
  const sum = (rows: Array<{ amount: Dec }>) => rows.reduce((x, r) => x.add(r.amount), ZERO);
  const netOperating = sum(operating);
  const netInvesting = sum(investing);
  const netFinancing = sum(financing);
  const netChange = netOperating.add(netInvesting).add(netFinancing);
  const actualChange = closingCash.sub(openingCash);
  const unexplained = actualChange.sub(netChange);
  const fmt = (rows: Array<{ name: string; amount: Dec }>) => rows.filter((r) => !r.amount.isZero()).map((r) => ({ name: r.name, amount: money(r.amount) }));
  return {
    meta: await reportMeta(ctx, q, "Cash flow"),
    sections: [
      { key: "operating", title: "Operating activities", rows: fmt(operating), total: money(netOperating) },
      { key: "investing", title: "Investing activities", rows: fmt(investing), total: money(netInvesting) },
      { key: "financing", title: "Financing activities", rows: fmt(financing), total: money(netFinancing) },
    ],
    direct,
    totals: {
      openingCash: money(openingCash),
      netChange: money(netChange),
      closingCash: money(closingCash),
      actualChange: money(actualChange),
      unexplained: money(unexplained),
      reconciles: D(unexplained).isZero(),
    },
  };
}
