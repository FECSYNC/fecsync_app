/**
 * Sales views from revenue ledger lines (net of contra revenue).
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { D, ZERO, type Dec } from "@/lib/accounting/money";
import { locationWhere } from "@/lib/accounting/scope";
import { money, reportMeta, type ReportQuery } from "@/lib/accounting/reports/common";
import type { AccountingCtx } from "@/lib/accounting/types";

function revenueWhere(ctx: AccountingCtx, q: ReportQuery): Prisma.JournalLineWhereInput {
  return {
    orgId: ctx.orgId,
    entryDate: { gte: q.from, lte: q.to },
    account: { type: "revenue" },
    entry: { status: { in: ["posted", "reversed"] } },
    ...locationWhere(q.scope),
  };
}

const credit = (r: { _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null } }): Dec =>
  D(r._sum.credit ?? 0).sub(D(r._sum.debit ?? 0));

export async function salesByLocation(ctx: AccountingCtx, q: ReportQuery) {
  const rows = await prisma.journalLine.groupBy({ by: ["locationId"], where: revenueWhere(ctx, q), _sum: { debit: true, credit: true } });
  const venues = await prisma.venueLocation.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } });
  const name = new Map(venues.map((v) => [v.id, v.name]));
  const out = rows.map((r) => ({ locationId: r.locationId, name: r.locationId ? name.get(r.locationId) ?? r.locationId : "Company level", amount: credit(r) }));
  const total = out.reduce((a, r) => a.add(r.amount), ZERO);
  return {
    meta: await reportMeta(ctx, q, "Sales by location"),
    sections: [{ key: "locations", title: "Locations", rows: out.sort((a, b) => b.amount.comparedTo(a.amount)).map((r) => ({ ...r, amount: money(r.amount) })) }],
    totals: { amount: money(total) },
  };
}

export async function salesByAccount(ctx: AccountingCtx, q: ReportQuery) {
  const rows = await prisma.journalLine.groupBy({ by: ["ledgerAccountId"], where: revenueWhere(ctx, q), _sum: { debit: true, credit: true } });
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: rows.map((r) => r.ledgerAccountId) } }, select: { id: true, code: true, name: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = rows.map((r) => ({ accountId: r.ledgerAccountId, code: byId.get(r.ledgerAccountId)?.code ?? "", name: byId.get(r.ledgerAccountId)?.name ?? "", amount: credit(r) }));
  const total = out.reduce((a, r) => a.add(r.amount), ZERO);
  return {
    meta: await reportMeta(ctx, q, "Sales by account"),
    sections: [{ key: "accounts", title: "Revenue accounts", rows: out.sort((a, b) => a.code.localeCompare(b.code)).map((r) => ({ ...r, amount: money(r.amount) })) }],
    totals: { amount: money(total) },
  };
}

export async function salesByProduct(ctx: AccountingCtx, q: ReportQuery) {
  const byPos = await prisma.journalLine.groupBy({
    by: ["posProductId"],
    where: { ...revenueWhere(ctx, q), posProductId: { not: null } },
    _sum: { debit: true, credit: true },
  });
  const byDesc = await prisma.journalLine.groupBy({
    by: ["description"],
    where: { ...revenueWhere(ctx, q), posProductId: null, bookingId: { not: null } },
    _sum: { debit: true, credit: true },
  });
  const products = await prisma.posProduct.findMany({ where: { id: { in: byPos.map((r) => r.posProductId!) } }, select: { id: true, name: true } });
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const rows = [
    ...byPos.map((r) => ({ key: `pos:${r.posProductId}`, name: pname.get(r.posProductId!) ?? "POS product", source: "pos", amount: credit(r) })),
    ...byDesc.map((r) => ({ key: `booking:${r.description ?? ""}`, name: r.description ?? "Booking", source: "booking", amount: credit(r) })),
  ].sort((a, b) => b.amount.comparedTo(a.amount));
  return {
    meta: await reportMeta(ctx, q, "Sales by product"),
    sections: [{ key: "products", title: "Products", rows: rows.map((r) => ({ ...r, amount: money(r.amount) })) }],
    totals: { amount: money(rows.reduce((a, r) => a.add(r.amount), ZERO)) },
  };
}

const CHANNEL: Record<string, string> = {
  booking: "Bookings and parties",
  booking_payment: "Bookings and parties",
  booking_refund: "Bookings and parties",
  pos_sale: "POS",
  pos_refund: "POS",
  membership_payment: "Memberships",
  revenue_recognition: "Revenue recognition",
  shop_order: "Online shop",
  marketplace_booking: "Marketplace packages",
  marketplace_refund: "Marketplace packages",
  tailoring_payment: "Tailoring",
  manual_invoice: "Manual invoices",
  gift_card: "Gift cards",
  park_wallet: "Stored value",
  cashless: "Stored value",
};

export async function salesByChannel(ctx: AccountingCtx, q: ReportQuery) {
  const lines = await prisma.journalLine.findMany({
    where: revenueWhere(ctx, q),
    select: { debit: true, credit: true, entry: { select: { sourceType: true } } },
  });
  const map = new Map<string, Dec>();
  for (const l of lines) {
    const ch = CHANNEL[l.entry.sourceType] ?? "Other";
    map.set(ch, (map.get(ch) ?? ZERO).add(D(l.credit)).sub(D(l.debit)));
  }
  const rows = [...map.entries()].map(([channel, amount]) => ({ channel, amount })).sort((a, b) => b.amount.comparedTo(a.amount));
  return {
    meta: await reportMeta(ctx, q, "Sales by channel"),
    sections: [{ key: "channels", title: "Channels", rows: rows.map((r) => ({ ...r, amount: money(r.amount) })) }],
    totals: { amount: money(rows.reduce((a, r) => a.add(r.amount), ZERO)) },
  };
}

export async function tenderSummary(ctx: AccountingCtx, q: ReportQuery) {
  const rows = await prisma.journalLine.groupBy({
    by: ["ledgerAccountId"],
    where: {
      orgId: ctx.orgId,
      entryDate: { gte: q.from, lte: q.to },
      account: { cashFlowCategory: "cash" },
      entry: { status: { in: ["posted", "reversed"] }, sourceType: { in: ["booking_payment", "booking_refund", "pos_sale", "pos_refund", "membership_payment", "marketplace_booking", "marketplace_refund", "shop_order", "tailoring_payment", "customer_receipt"] } },
      ...locationWhere(q.scope),
    },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.ledgerAccount.findMany({ where: { id: { in: rows.map((r) => r.ledgerAccountId) } }, select: { id: true, code: true, name: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = rows.map((r) => ({
    accountId: r.ledgerAccountId,
    code: byId.get(r.ledgerAccountId)?.code ?? "",
    name: byId.get(r.ledgerAccountId)?.name ?? "",
    received: money(D(r._sum.debit ?? 0)),
    paidOut: money(D(r._sum.credit ?? 0)),
    net: money(D(r._sum.debit ?? 0).sub(D(r._sum.credit ?? 0))),
  }));
  return {
    meta: await reportMeta(ctx, q, "Tender summary"),
    sections: [{ key: "tenders", title: "Cash, bank and clearing accounts", rows: out }],
    totals: { net: money(rows.reduce((a, r) => a.add(D(r._sum.debit ?? 0)).sub(D(r._sum.credit ?? 0)), ZERO)) },
  };
}
