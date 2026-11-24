/**
 * Tax summary: output tax on tax payable accounts, input tax on tax
 * receivable accounts, net payable; tax-exempt bookings listed.
 */
import prisma from "@/lib/prisma";
import { D, ZERO } from "@/lib/accounting/money";
import { locationWhere } from "@/lib/accounting/scope";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

export async function taxSummary(ctx: AccountingCtx, q: ReportQuery) {
  const base = {
    orgId: ctx.orgId,
    entryDate: { gte: q.from, lte: q.to },
    entry: { status: { in: ["posted" as const, "reversed" as const] } },
    ...locationWhere(q.scope),
  };
  const [output, input, codes, exempt] = await Promise.all([
    prisma.journalLine.groupBy({ by: ["taxCodeId", "ledgerAccountId"], where: { ...base, account: { subtype: "tax_payable" } }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.groupBy({ by: ["taxCodeId", "ledgerAccountId"], where: { ...base, account: { subtype: "tax_receivable" } }, _sum: { debit: true, credit: true } }),
    prisma.taxCode.findMany({ where: { orgId: ctx.orgId }, select: { id: true, code: true, name: true, rate: true } }),
    prisma.booking.findMany({
      where: {
        orgId: ctx.orgId,
        taxExempt: true,
        status: "confirmed",
        createdAt: { gte: q.from, lte: q.to },
        ...(q.scope.allLocations ? {} : { locationId: { in: q.scope.locationIds } }),
      },
      select: { id: true, publicId: true, total: true, taxExemptReason: true, createdAt: true, locationId: true },
      take: 1000,
    }),
  ]);
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const fmt = (rows: typeof output, sign: 1 | -1) =>
    rows.map((r) => {
      const amt = D(r._sum.credit ?? 0).sub(D(r._sum.debit ?? 0)).mul(sign);
      const c = r.taxCodeId ? codeById.get(r.taxCodeId) : null;
      return { taxCodeId: r.taxCodeId, code: c?.code ?? "SALES", name: c?.name ?? "Sales tax (from source documents)", rate: c ? D(c.rate).toFixed(4) : null, accountId: r.ledgerAccountId, amount: amt };
    });
  const out = fmt(output, 1);
  const inp = fmt(input, -1);
  const outputTotal = out.reduce((a, r) => a.add(r.amount), ZERO);
  const inputTotal = inp.reduce((a, r) => a.add(r.amount), ZERO);
  return {
    meta: await reportMeta(ctx, q, "Tax summary"),
    sections: [
      { key: "output", title: "Output tax (collected)", rows: out.map((r) => ({ ...r, amount: money(r.amount) })), total: money(outputTotal) },
      { key: "input", title: "Input tax (recoverable)", rows: inp.map((r) => ({ ...r, amount: money(r.amount) })), total: money(inputTotal) },
      {
        key: "exempt",
        title: "Tax-exempt bookings",
        rows: exempt.map((b) => ({ bookingId: b.id, publicId: b.publicId, total: money(D(b.total)), reason: b.taxExemptReason, date: b.createdAt.toISOString(), locationId: b.locationId })),
      },
    ],
    totals: { output: money(outputTotal), input: money(inputTotal), netPayable: money(outputTotal.sub(inputTotal)) },
  };
}
