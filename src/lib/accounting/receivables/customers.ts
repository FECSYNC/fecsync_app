/**
 * Customer (AR) subledger: balances, aging, detail. Customers are GuestProfile,
 * BookingAccount, or a shop User — never a separate customer table.
 */
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { locationWhere } from "@/lib/accounting/scope";
import { getSystemAccount } from "@/lib/accounting/accounts";
import {
  parsePartyKey,
  partyDisplayNames,
  partyKeyFromLine,
  partyLineWhere,
  formatPartyKey,
} from "@/lib/accounting/partyKeys";
import type { AccountingCtx, PartyRef } from "@/lib/accounting/types";

export type AgingBuckets = { current: Dec; d1_30: Dec; d31_60: Dec; d61_90: Dec; d90_plus: Dec };

export function emptyBuckets(): AgingBuckets {
  return { current: ZERO, d1_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90_plus: ZERO };
}

export function bucketFor(due: Date, asOf: Date): keyof AgingBuckets {
  const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export function bucketsDto(b: AgingBuckets) {
  return {
    current: toApiString(b.current),
    d1_30: toApiString(b.d1_30),
    d31_60: toApiString(b.d31_60),
    d61_90: toApiString(b.d61_90),
    d90_plus: toApiString(b.d90_plus),
  };
}

const PARTY_GROUP = ["guestProfileId", "bookingAccountId", "customerUserId"] as const;

/**
 * Open items for AR aging: debit lines (invoices/bookings) minus credits
 * applied oldest-first per party (FIFO), due date = invoice due or entry date
 * + default terms.
 */
export async function arAging(ctx: AccountingCtx, asOf: Date, party?: PartyRef | null) {
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const ar = await getSystemAccount(prisma, ctx.orgId, "accounts_receivable");
  const lines = await prisma.journalLine.findMany({
    where: {
      orgId: ctx.orgId,
      ledgerAccountId: ar.id,
      entryDate: { lte: asOf },
      entry: { status: { in: ["posted", "reversed"] } },
      ...locationWhere(ctx.scope),
      ...(party ? partyLineWhere(party) : {}),
    },
    select: {
      debit: true,
      credit: true,
      entryDate: true,
      invoiceId: true,
      bookingId: true,
      guestProfileId: true,
      bookingAccountId: true,
      customerUserId: true,
    },
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
  });
  const invoiceIds = [...new Set(lines.map((l) => l.invoiceId).filter((x): x is string => Boolean(x)))];
  const invoices = invoiceIds.length
    ? await prisma.bookingInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, dueAt: true } })
    : [];
  const dueByInvoice = new Map(invoices.map((i) => [i.id, i.dueAt]));
  const byParty = new Map<string, { party: PartyRef | null; items: Array<{ due: Date; open: Dec }>; credit: Dec }>();
  for (const l of lines) {
    const p = partyKeyFromLine(l);
    const key = formatPartyKey(p) ?? "unassigned";
    const rec = byParty.get(key) ?? { party: p, items: [], credit: ZERO };
    const debit = D(l.debit);
    const credit = D(l.credit);
    if (debit.greaterThan(0)) {
      const due =
        (l.invoiceId && dueByInvoice.get(l.invoiceId)) ||
        new Date(l.entryDate.getTime() + settings.defaultPaymentTermsDays * 86_400_000);
      rec.items.push({ due, open: debit });
    }
    if (credit.greaterThan(0)) rec.credit = rec.credit.add(credit);
    byParty.set(key, rec);
  }
  const result: Array<{ partyKey: string; party: PartyRef | null; balance: Dec; buckets: AgingBuckets; overdue: Dec }> = [];
  for (const [key, rec] of byParty) {
    let credit = rec.credit;
    const buckets = emptyBuckets();
    for (const item of rec.items) {
      const applied = credit.greaterThan(item.open) ? item.open : credit;
      credit = credit.sub(applied);
      const open = item.open.sub(applied);
      if (open.isZero()) continue;
      const b = bucketFor(item.due, asOf);
      buckets[b] = buckets[b].add(open);
    }
    if (credit.greaterThan(0)) buckets.current = buckets.current.sub(credit);
    const balance = round2(Object.values(buckets).reduce((a, v) => a.add(v), ZERO));
    const overdue = round2(buckets.d1_30.add(buckets.d31_60).add(buckets.d61_90).add(buckets.d90_plus));
    if (balance.isZero() && overdue.isZero()) continue;
    result.push({ partyKey: key, party: rec.party, balance, buckets, overdue });
  }
  return result;
}

export async function listCustomers(
  ctx: AccountingCtx,
  q: { q?: string; hasBalance?: boolean; overdueOnly?: boolean; asOf?: Date; limit?: number; offset?: number }
) {
  const asOf = q.asOf ?? new Date();
  const aging = await arAging(ctx, asOf);
  const refs = aging.map((a) => a.party).filter((p): p is PartyRef => Boolean(p));
  const names = await partyDisplayNames(ctx.orgId, refs);
  const lastActivity = await prisma.journalLine.groupBy({
    by: [...PARTY_GROUP],
    where: { orgId: ctx.orgId, partyType: "customer", entry: { status: { in: ["posted", "reversed"] } }, ...locationWhere(ctx.scope) },
    _max: { entryDate: true },
  });
  const lastBy = new Map(
    lastActivity.map((l) => [formatPartyKey(partyKeyFromLine(l)) ?? "", l._max.entryDate?.toISOString() ?? null])
  );
  let rows = aging.map((a) => {
    const n = a.party ? names.get(a.partyKey) : null;
    return {
      partyKey: a.partyKey,
      type: a.party?.type ?? null,
      name: n?.name ?? (a.party ? "Customer" : "Unassigned customer"),
      email: n?.email ?? null,
      phone: n?.phone ?? null,
      balance: toApiString(a.balance),
      overdue: toApiString(a.overdue),
      buckets: bucketsDto(a.buckets),
      lastActivityAt: lastBy.get(a.partyKey) ?? null,
    };
  });
  if (q.q) {
    const needle = q.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.email ?? "").toLowerCase().includes(needle) || (r.phone ?? "").includes(needle));
  }
  if (q.hasBalance) rows = rows.filter((r) => D(r.balance).abs().greaterThan(0));
  if (q.overdueOnly) rows = rows.filter((r) => D(r.overdue).greaterThan(0));
  rows.sort((a, b) => D(b.balance).comparedTo(D(a.balance)));
  const total = rows.reduce((a, r) => a.add(D(r.balance)), ZERO);
  const offset = Math.max(q.offset ?? 0, 0);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  return { items: rows.slice(offset, offset + limit), total: rows.length, totalBalance: toApiString(total) };
}

export async function searchCustomerParties(ctx: AccountingCtx, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const [guests, accounts] = await Promise.all([
    prisma.guestProfile.findMany({
      where: {
        orgId: ctx.orgId,
        OR: [
          { firstName: { contains: term, mode: "insensitive" } },
          { lastName: { contains: term, mode: "insensitive" } },
          { email: { contains: term, mode: "insensitive" } },
          { phone: { contains: term } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      take: 20,
    }),
    prisma.bookingAccount.findMany({
      where: { orgId: ctx.orgId, archivedAt: null, name: { contains: term, mode: "insensitive" } },
      select: { id: true, name: true, billingEmail: true },
      take: 10,
    }),
  ]);
  return [
    ...accounts.map((a) => ({ partyKey: `account:${a.id}`, name: a.name, email: a.billingEmail, type: "account" })),
    ...guests.map((g) => ({ partyKey: `guest:${g.id}`, name: `${g.firstName} ${g.lastName}`.trim(), email: g.email, type: "guest" })),
  ];
}

export async function getCustomer(ctx: AccountingCtx, partyKey: string) {
  const party = await parsePartyKey(ctx.orgId, partyKey);
  if (party.type === "supplier" || party.type === "employee") throw acctError(ACCT.NOT_FOUND);
  const names = await partyDisplayNames(ctx.orgId, [party]);
  const asOf = new Date();
  const [aging] = await arAging(ctx, asOf, party);
  const invoiceWhere: Prisma.BookingInvoiceWhereInput = {
    orgId: ctx.orgId,
    ...(party.type === "account" ? { accountId: party.id } : party.type === "guest" ? { guestProfileId: party.id } : { customerUserId: party.id }),
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  const bookingWhere: Prisma.BookingWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (party.type === "account") bookingWhere.accountId = party.id;
  else if (party.type === "user") bookingWhere.userId = party.id;
  else {
    const g = await prisma.guestProfile.findFirst({ where: { id: party.id }, select: { email: true, userId: true } });
    bookingWhere.OR = [
      ...(g?.userId ? [{ userId: g.userId }] : []),
      ...(g?.email ? [{ primaryContactEmail: g.email }] : []),
    ];
    if (!bookingWhere.OR.length) bookingWhere.id = "__none__";
  }
  const receiptWhere: Prisma.CustomerReceiptWhereInput = {
    orgId: ctx.orgId,
    ...(party.type === "account" ? { bookingAccountId: party.id } : party.type === "guest" ? { guestProfileId: party.id } : { customerUserId: party.id }),
  };
  const [invoices, bookings, receipts] = await Promise.all([
    prisma.bookingInvoice.findMany({ where: invoiceWhere, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.booking.findMany({
      where: bookingWhere,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, publicId: true, status: true, total: true, amountPaid: true, amountDue: true, visitStartsAt: true, createdAt: true, payments: { select: { id: true, tender: true, amount: true, status: true, createdAt: true } } },
    }),
    prisma.customerReceipt.findMany({ where: receiptWhere, orderBy: { receiptDate: "desc" }, take: 200 }),
  ]);
  return {
    partyKey,
    party,
    name: names.get(partyKey)?.name ?? "Customer",
    email: names.get(partyKey)?.email ?? null,
    phone: names.get(partyKey)?.phone ?? null,
    balance: toApiString(aging?.balance ?? ZERO),
    overdue: toApiString(aging?.overdue ?? ZERO),
    buckets: bucketsDto(aging?.buckets ?? emptyBuckets()),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      amount: toApiString(i.amount),
      amountDue: toApiString(i.amountDue),
      dueAt: i.dueAt?.toISOString() ?? null,
      issueDate: i.issueDate?.toISOString() ?? null,
      bookingId: i.bookingId,
    })),
    bookings: bookings.map((b) => ({
      id: b.id,
      publicId: b.publicId,
      status: b.status,
      total: toApiString(b.total),
      amountPaid: toApiString(b.amountPaid),
      amountDue: toApiString(b.amountDue),
      visitStartsAt: b.visitStartsAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
    payments: [
      ...bookings.flatMap((b) =>
        b.payments
          .filter((p) => p.status !== "failed" && p.status !== "cancelled" && p.status !== "pending")
          .map((p) => ({
            id: p.id,
            source: "booking" as const,
            reference: b.publicId,
            method: p.tender,
            amount: toApiString(p.amount),
            status: p.status,
            date: p.createdAt.toISOString(),
          }))
      ),
      ...receipts.map((r) => ({
        id: r.id,
        source: "receipt" as const,
        reference: r.number,
        method: r.method,
        amount: toApiString(r.amount),
        status: r.status,
        date: r.receiptDate.toISOString(),
      })),
    ].sort((a, b) => b.date.localeCompare(a.date)),
    credits: receipts
      .filter((r) => D(r.unappliedAmount).greaterThan(0) && r.status === "posted")
      .map((r) => ({ id: r.id, number: r.number, unapplied: toApiString(r.unappliedAmount) })),
  };
}
