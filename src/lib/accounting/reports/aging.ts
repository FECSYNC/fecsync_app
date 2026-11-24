/**
 * AR / AP aging and balance lists.
 */
import prisma from "@/lib/prisma";
import { D, ZERO } from "@/lib/accounting/money";
import { arAging, bucketsDto, emptyBuckets } from "@/lib/accounting/receivables/customers";
import { supplierBalances } from "@/lib/accounting/payables/suppliers";
import { partyDisplayNames } from "@/lib/accounting/partyKeys";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx, PartyRef } from "@/lib/accounting/types";

export async function arAgingReport(ctx: AccountingCtx, q: ReportQuery) {
  const scoped = { ...ctx, scope: q.scope };
  const rows = await arAging(scoped, q.asOf);
  const names = await partyDisplayNames(ctx.orgId, rows.map((r) => r.party).filter((p): p is PartyRef => Boolean(p)));
  const totals = emptyBuckets();
  for (const r of rows) for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = totals[k].add(r.buckets[k]);
  return {
    meta: await reportMeta(ctx, q, "Receivables aging"),
    sections: [
      {
        key: "customers",
        title: "Customers",
        rows: rows
          .sort((a, b) => b.balance.comparedTo(a.balance))
          .map((r) => ({ partyKey: r.partyKey, name: names.get(r.partyKey)?.name ?? "Unassigned", balance: money(r.balance), overdue: money(r.overdue), buckets: bucketsDto(r.buckets) })),
      },
    ],
    totals: { ...bucketsDto(totals), balance: money(Object.values(totals).reduce((a, v) => a.add(v), ZERO)) },
  };
}

export async function apAgingReport(ctx: AccountingCtx, q: ReportQuery) {
  const scoped = { ...ctx, scope: q.scope };
  const map = await supplierBalances(scoped, q.asOf);
  const suppliers = await prisma.supplier.findMany({ where: { orgId: ctx.orgId, id: { in: [...map.keys()] } }, select: { id: true, name: true, code: true } });
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const totals = emptyBuckets();
  const rows = [...map.entries()].map(([id, b]) => {
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] = totals[k].add(b[k]);
    const balance = Object.values(b).reduce((a, v) => a.add(v), ZERO);
    const overdue = b.d1_30.add(b.d31_60).add(b.d61_90).add(b.d90_plus);
    return { supplierId: id, code: byId.get(id)?.code ?? "", name: byId.get(id)?.name ?? "Supplier", balance: money(balance), overdue: money(overdue), buckets: bucketsDto(b) };
  });
  return {
    meta: await reportMeta(ctx, q, "Payables aging"),
    sections: [{ key: "suppliers", title: "Suppliers", rows: rows.filter((r) => !D(r.balance).isZero()).sort((a, b) => D(b.balance).comparedTo(D(a.balance))) }],
    totals: { ...bucketsDto(totals), balance: money(Object.values(totals).reduce((a, v) => a.add(v), ZERO)) },
  };
}

export async function customerBalancesReport(ctx: AccountingCtx, q: ReportQuery) {
  const r = await arAgingReport(ctx, q);
  return { ...r, meta: { ...r.meta, title: "Customer balances" } };
}

export async function supplierBalancesReport(ctx: AccountingCtx, q: ReportQuery) {
  const r = await apAgingReport(ctx, q);
  return { ...r, meta: { ...r.meta, title: "Supplier balances" } };
}
