/**
 * Inventory valuation, movements, gross margin by product, wastage.
 */
import prisma from "@/lib/prisma";
import { D, ZERO, round2, type Dec } from "@/lib/accounting/money";
import { inventoryValuation, listMovements } from "@/lib/accounting/inventory/valuation";
import { locationWhere } from "@/lib/accounting/scope";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function inventoryValuationReport(ctx: AccountingCtx, q: ReportQuery) {
  const v = await inventoryValuation({ ...ctx, scope: q.scope }, { asOf: q.asOf });
  return {
    meta: await reportMeta(ctx, q, "Inventory valuation"),
    sections: [{ key: "products", title: "Products", rows: v.rows }],
    totals: { value: v.totalValue, ledgerValue: v.ledgerValue, difference: v.difference },
  };
}

export async function inventoryMovementsReport(ctx: AccountingCtx, q: ReportQuery) {
  const m = await listMovements({ ...ctx, scope: q.scope }, { from: q.from, to: q.to, limit: Math.min(q.limit, 500) });
  const wastage = await prisma.inventoryMovement.aggregate({
    where: { orgId: ctx.orgId, kind: "wastage", createdAt: { gte: q.from, lte: q.to }, ...locationWhere(q.scope) },
    _sum: { totalCost: true },
  });
  return {
    meta: await reportMeta(ctx, q, "Inventory movements"),
    sections: [{ key: "movements", title: "Movements", rows: m.items }],
    totals: { wastageCost: money(D(wastage._sum.totalCost ?? 0).neg()) },
  };
}

export async function grossMarginReport(ctx: AccountingCtx, q: ReportQuery) {
  const base = { orgId: ctx.orgId, entryDate: { gte: q.from, lte: q.to }, entry: { status: { in: ["posted" as const, "reversed" as const] } }, ...locationWhere(q.scope), posProductId: { not: null } };
  const [revenue, cogs] = await Promise.all([
    prisma.journalLine.groupBy({ by: ["posProductId"], where: { ...base, account: { type: "revenue" } }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.groupBy({ by: ["posProductId"], where: { ...base, account: { subtype: "cost_of_sales" } }, _sum: { debit: true, credit: true } }),
  ]);
  const ids = [...new Set([...revenue, ...cogs].map((r) => r.posProductId!))];
  const products = await prisma.posProduct.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, kind: true } });
  const pById = new Map(products.map((p) => [p.id, p]));
  const map = new Map<string, { revenue: Dec; cogs: Dec }>();
  for (const r of revenue) map.set(r.posProductId!, { revenue: D(r._sum.credit ?? 0).sub(D(r._sum.debit ?? 0)), cogs: ZERO });
  for (const c of cogs) {
    const cur = map.get(c.posProductId!) ?? { revenue: ZERO, cogs: ZERO };
    map.set(c.posProductId!, { ...cur, cogs: D(c._sum.debit ?? 0).sub(D(c._sum.credit ?? 0)) });
  }
  let tr = ZERO;
  let tc = ZERO;
  const rows = [...map.entries()].map(([id, v]) => {
    tr = tr.add(v.revenue);
    tc = tc.add(v.cogs);
    const gp = v.revenue.sub(v.cogs);
    return {
      posProductId: id,
      name: pById.get(id)?.name ?? "Product",
      kind: pById.get(id)?.kind ?? null,
      revenue: money(v.revenue),
      cogs: money(v.cogs),
      grossProfit: money(gp),
      marginPercent: v.revenue.isZero() ? null : round2(gp.div(v.revenue).mul(100)).toFixed(2),
    };
  });
  return {
    meta: await reportMeta(ctx, q, "Gross margin by product"),
    sections: [{ key: "products", title: "Products", rows: rows.sort((a, b) => D(b.grossProfit).comparedTo(D(a.grossProfit))) }],
    totals: { revenue: money(tr), cogs: money(tc), grossProfit: money(tr.sub(tc)), marginPercent: tr.isZero() ? null : round2(tr.sub(tc).div(tr).mul(100)).toFixed(2) },
  };
}
