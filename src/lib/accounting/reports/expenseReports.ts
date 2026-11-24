/**
 * Expense views from expense ledger lines and supplier documents.
 */
import prisma from "@/lib/prisma";
import { D, ZERO, type Dec } from "@/lib/accounting/money";
import { locationWhere } from "@/lib/accounting/scope";
import { money, monthKeys, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function expensesByCategory(ctx: AccountingCtx, q: ReportQuery) {
  const rows = await prisma.journalLine.groupBy({
    by: ["ledgerAccountId"],
    where: {
      orgId: ctx.orgId,
      entryDate: { gte: q.from, lte: q.to },
      account: { type: "expense" },
      entry: { status: { in: ["posted", "reversed"] } },
      ...locationWhere(q.scope),
    },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: rows.map((r) => r.ledgerAccountId) } }, select: { id: true, code: true, name: true, subtype: true } });
  const cats = await prisma.expenseCategory.findMany({ where: { orgId: ctx.orgId }, select: { name: true, ledgerAccountId: true } });
  const catByAccount = new Map<string, string[]>();
  cats.forEach((c) => catByAccount.set(c.ledgerAccountId, [...(catByAccount.get(c.ledgerAccountId) ?? []), c.name]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = rows
    .map((r) => {
      const a = byId.get(r.ledgerAccountId);
      return {
        accountId: r.ledgerAccountId,
        code: a?.code ?? "",
        name: a?.name ?? "",
        subtype: a?.subtype ?? null,
        categories: catByAccount.get(r.ledgerAccountId) ?? [],
        amount: D(r._sum.debit ?? 0).sub(D(r._sum.credit ?? 0)),
      };
    })
    .filter((r) => !r.amount.isZero())
    .sort((a, b) => b.amount.comparedTo(a.amount));
  let byMonth: Array<{ month: string; amount: string }> = [];
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const months = monthKeys(q.from, q.to, settings.timezone);
  if (months.length <= 36) {
    byMonth = await Promise.all(
      months.map(async (m) => {
        const agg = await prisma.journalLine.aggregate({
          where: { orgId: ctx.orgId, entryDate: { gte: m.from, lte: m.to }, account: { type: "expense" }, entry: { status: { in: ["posted", "reversed"] } }, ...locationWhere(q.scope) },
          _sum: { debit: true, credit: true },
        });
        return { month: m.key, amount: money(D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0))) };
      })
    );
  }
  return {
    meta: await reportMeta(ctx, q, "Expenses by category"),
    sections: [
      { key: "accounts", title: "Expense accounts", rows: out.map((r) => ({ ...r, amount: money(r.amount) })) },
      { key: "months", title: "By month", rows: byMonth },
    ],
    totals: { amount: money(out.reduce((a, r) => a.add(r.amount), ZERO)) },
  };
}

export async function expensesBySupplier(ctx: AccountingCtx, q: ReportQuery) {
  const bills = await prisma.supplierBill.groupBy({
    by: ["supplierId", "kind"],
    where: {
      orgId: ctx.orgId,
      billDate: { gte: q.from, lte: q.to },
      status: { in: ["posted", "partially_paid", "paid"] },
      ...(q.scope.allLocations ? {} : { locationId: { in: q.scope.locationIds } }),
    },
    _sum: { subtotal: true, total: true },
  });
  const map = new Map<string, { net: Dec; gross: Dec }>();
  for (const b of bills) {
    const sign = b.kind === "credit_note" ? -1 : 1;
    const cur = map.get(b.supplierId) ?? { net: ZERO, gross: ZERO };
    map.set(b.supplierId, { net: cur.net.add(D(b._sum.subtotal ?? 0).mul(sign)), gross: cur.gross.add(D(b._sum.total ?? 0).mul(sign)) });
  }
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: [...map.keys()] } }, select: { id: true, name: true, code: true } });
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const rows = [...map.entries()]
    .map(([id, v]) => ({ supplierId: id, code: byId.get(id)?.code ?? "", name: byId.get(id)?.name ?? "", net: v.net, gross: v.gross }))
    .sort((a, b) => b.gross.comparedTo(a.gross));
  return {
    meta: await reportMeta(ctx, q, "Expenses by supplier"),
    sections: [{ key: "suppliers", title: "Suppliers", rows: rows.map((r) => ({ ...r, net: money(r.net), gross: money(r.gross) })) }],
    totals: { net: money(rows.reduce((a, r) => a.add(r.net), ZERO)), gross: money(rows.reduce((a, r) => a.add(r.gross), ZERO)) },
  };
}
