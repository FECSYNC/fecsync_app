/**
 * Customer / supplier statements and expiring statement tokens.
 */
import { randomBytes } from "crypto";
import type { AccountingStatementToken } from "@prisma/client";
import prisma from "@/lib/prisma";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, toApiString } from "@/lib/accounting/money";
import { getSystemAccount } from "@/lib/accounting/accounts";
import { parsePartyKey, partyDisplayNames, partyLineWhere } from "@/lib/accounting/partyKeys";
import { locationWhere } from "@/lib/accounting/scope";
import { arAging, bucketsDto, emptyBuckets } from "@/lib/accounting/receivables/customers";
import { systemCtx, type AccountingCtx, type PartyRef } from "@/lib/accounting/types";

async function buildStatement(
  ctx: AccountingCtx,
  party: PartyRef,
  accountKeys: Array<"accounts_receivable" | "accounts_payable" | "goods_received_not_invoiced" | "customer_deposits">,
  from: Date,
  to: Date,
  sign: 1 | -1
) {
  const accounts = await Promise.all(accountKeys.map((k) => getSystemAccount(prisma, ctx.orgId, k)));
  const accountIds = accounts.map((a) => a.id);
  const base = {
    orgId: ctx.orgId,
    ledgerAccountId: { in: accountIds },
    ...partyLineWhere(party),
    ...locationWhere(ctx.scope),
    entry: { status: { in: ["posted" as const, "reversed" as const] } },
  };
  const opening = await prisma.journalLine.aggregate({
    where: { ...base, entryDate: { lt: from } },
    _sum: { debit: true, credit: true },
  });
  const openingBal = D(opening._sum.debit ?? 0).sub(D(opening._sum.credit ?? 0)).mul(sign);
  const lines = await prisma.journalLine.findMany({
    where: { ...base, entryDate: { gte: from, lte: to } },
    include: { entry: { select: { number: true, memo: true, sourceType: true, sourceId: true, reference: true } } },
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
    take: 5000,
  });
  let running = openingBal;
  const items = lines.map((l) => {
    const amount = D(l.debit).sub(D(l.credit)).mul(sign);
    running = running.add(amount);
    return {
      date: l.entryDate.toISOString(),
      entryNumber: l.entry.number,
      sourceType: l.entry.sourceType,
      sourceId: l.entry.sourceId,
      reference: l.entry.reference,
      description: l.description ?? l.entry.memo,
      charges: amount.greaterThan(0) ? toApiString(amount) : "0.00",
      credits: amount.lessThan(0) ? toApiString(amount.neg()) : "0.00",
      balance: toApiString(running),
    };
  });
  return { openingBalance: toApiString(openingBal), closingBalance: toApiString(running), items };
}

export async function buildCustomerStatement(ctx: AccountingCtx, partyKey: string, from: Date, to: Date) {
  const party = await parsePartyKey(ctx.orgId, partyKey);
  if (party.type === "supplier" || party.type === "employee") throw acctError(ACCT.NOT_FOUND);
  const [names, settings, org, profile] = await Promise.all([
    partyDisplayNames(ctx.orgId, [party]),
    prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId } }),
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true } }),
    prisma.companyProfile.findUnique({ where: { orgId: ctx.orgId }, select: { tradingName: true, legalName: true, logoUrl: true, supportEmail: true, phone: true } }),
  ]);
  const body = await buildStatement(ctx, party, ["accounts_receivable", "customer_deposits"], from, to, 1);
  const [aging] = await arAging(ctx, to, party);
  return {
    company: {
      name: profile?.tradingName || profile?.legalName || org?.name || "",
      logoUrl: profile?.logoUrl ?? null,
      email: profile?.supportEmail ?? null,
      phone: profile?.phone ?? null,
    },
    customer: { partyKey, name: names.get(partyKey)?.name ?? "Customer", email: names.get(partyKey)?.email ?? null },
    currency: settings?.baseCurrency ?? "USD",
    from: from.toISOString(),
    to: to.toISOString(),
    ...body,
    aging: bucketsDto(aging?.buckets ?? emptyBuckets()),
    footer: settings?.statementFooter ?? null,
  };
}

export async function buildSupplierStatement(ctx: AccountingCtx, supplierId: string, from: Date, to: Date) {
  const party = await parsePartyKey(ctx.orgId, `supplier:${supplierId}`);
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { id: supplierId, orgId: ctx.orgId }, select: { name: true, email: true, code: true } });
  const body = await buildStatement(ctx, party, ["accounts_payable"], from, to, -1);
  const settings = await prisma.accountingSettings.findUnique({ where: { orgId: ctx.orgId } });
  return {
    supplier: { id: supplierId, code: supplier.code, name: supplier.name, email: supplier.email },
    currency: settings?.baseCurrency ?? "USD",
    from: from.toISOString(),
    to: to.toISOString(),
    ...body,
  };
}

export async function createStatementToken(
  ctx: AccountingCtx,
  partyKey: string,
  from: Date,
  to: Date,
  ttlDays = 14
) {
  const party = await parsePartyKey(ctx.orgId, partyKey);
  if (party.type === "employee") throw acctError(ACCT.NOT_FOUND);
  const token = randomBytes(24).toString("base64url");
  const row = await prisma.accountingStatementToken.create({
    data: {
      orgId: ctx.orgId,
      token,
      partyType: party.type === "supplier" ? "supplier" : "customer",
      guestProfileId: party.type === "guest" ? party.id : null,
      bookingAccountId: party.type === "account" ? party.id : null,
      customerUserId: party.type === "user" ? party.id : null,
      supplierId: party.type === "supplier" ? party.id : null,
      fromDate: from,
      toDate: to,
      expiresAt: new Date(Date.now() + Math.min(Math.max(ttlDays, 1), 90) * 86_400_000),
      createdById: ctx.actorId,
    },
  });
  recordAccountingAudit(ctx, { action: "statement.link", entityType: party.type === "supplier" ? "Supplier" : "CustomerReceipt", entityId: row.id, description: `Statement link created for ${partyKey}` });
  return { token, expiresAt: row.expiresAt.toISOString(), path: `/statement/${token}` };
}

function partyFromToken(t: AccountingStatementToken): string {
  if (t.supplierId) return `supplier:${t.supplierId}`;
  if (t.bookingAccountId) return `account:${t.bookingAccountId}`;
  if (t.guestProfileId) return `guest:${t.guestProfileId}`;
  return `user:${t.customerUserId}`;
}

export async function resolveStatementToken(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw acctError(ACCT.TOKEN_INVALID);
  const t = await prisma.accountingStatementToken.findUnique({ where: { token } });
  if (!t) throw acctError(ACCT.TOKEN_INVALID);
  if (t.expiresAt < new Date()) throw acctError(ACCT.TOKEN_EXPIRED);
  await prisma.accountingStatementToken.update({ where: { id: t.id }, data: { lastViewedAt: new Date() } });
  const ctx = systemCtx(t.orgId);
  const key = partyFromToken(t);
  if (t.supplierId) return { kind: "supplier" as const, statement: await buildSupplierStatement(ctx, t.supplierId, t.fromDate, t.toDate) };
  return { kind: "customer" as const, statement: await buildCustomerStatement(ctx, key, t.fromDate, t.toDate) };
}