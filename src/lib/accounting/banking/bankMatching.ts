/**
 * Match bank statement lines to ledger lines on the bank's ledger account.
 */
import type { BankTransaction, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { loadBankAccount } from "@/lib/accounting/banking/bankAccounts";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postBankLineEntry } from "@/lib/accounting/posting/banking";
import { parsePartyKey } from "@/lib/accounting/partyKeys";
import { loadTaxCode, computeTax } from "@/lib/accounting/taxCodes";
import { assertPostable } from "@/lib/accounting/accounts";
import type { AccountingCtx } from "@/lib/accounting/types";

export function toBankTxnDto(t: BankTransaction & { matches?: Array<{ journalLineId: string; amount: Prisma.Decimal }> }) {
  return {
    id: t.id,
    bankAccountId: t.bankAccountId,
    txnDate: t.txnDate.toISOString(),
    description: t.description,
    reference: t.reference,
    amount: toApiString(t.amount),
    runningBalance: t.runningBalance ? toApiString(t.runningBalance) : null,
    source: t.source,
    status: t.status,
    reconciliationId: t.reconciliationId,
    excludedReason: t.excludedReason,
    matches: t.matches?.map((m) => ({ journalLineId: m.journalLineId, amount: toApiString(m.amount) })) ?? [],
    createdAt: t.createdAt.toISOString(),
  };
}

async function loadTxn(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const t = await prisma.bankTransaction.findFirst({ where: { id, orgId: ctx.orgId }, include: { matches: true } });
  if (!t) throw acctError(ACCT.NOT_FOUND);
  const bank = await loadBankAccount(ctx, t.bankAccountId);
  return { t, bank };
}

export async function listBankTransactions(
  ctx: AccountingCtx,
  bankAccountId: string,
  q: { status?: string; from?: Date; to?: Date; cursor?: string; limit?: number }
) {
  const bank = await loadBankAccount(ctx, bankAccountId);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const where: Prisma.BankTransactionWhereInput = { orgId: ctx.orgId, bankAccountId: bank.id };
  if (q.status) where.status = q.status as never;
  if (q.from || q.to) where.txnDate = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const rows = await prisma.bankTransaction.findMany({
    where,
    include: { matches: true },
    orderBy: [{ txnDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map(toBankTxnDto), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

async function unmatchedLines(orgId: string, ledgerAccountId: string, from: Date, to: Date) {
  return prisma.journalLine.findMany({
    where: {
      orgId,
      ledgerAccountId,
      entryDate: { gte: from, lte: to },
      reconciledInId: null,
      bankMatches: { none: {} },
      entry: { status: { in: ["posted", "reversed"] } },
    },
    include: { entry: { select: { number: true, memo: true, reference: true } } },
    orderBy: { entryDate: "asc" },
    take: 500,
  });
}

/** Single-line matches by amount/date/reference plus subset sums (payouts). */
export async function suggestMatches(ctx: AccountingCtx, txnId: string) {
  const { t, bank } = await loadTxn(ctx, txnId);
  const amount = round2(D(t.amount));
  const from = new Date(t.txnDate.getTime() - 5 * 86_400_000);
  const to = new Date(t.txnDate.getTime() + 5 * 86_400_000);
  const lines = await unmatchedLines(ctx.orgId, bank.ledgerAccountId, new Date(from.getTime() - 25 * 86_400_000), to);
  const signed = lines.map((l) => ({ l, amt: D(l.debit).sub(D(l.credit)) }));
  const ref = (t.reference ?? "").toLowerCase();
  const single = signed
    .filter((x) => x.amt.equals(amount) && x.l.entryDate >= from && x.l.entryDate <= to)
    .map((x) => {
      const days = Math.abs(x.l.entryDate.getTime() - t.txnDate.getTime()) / 86_400_000;
      const refHit = ref && ((x.l.entry.reference ?? "").toLowerCase().includes(ref) || (x.l.entry.memo ?? "").toLowerCase().includes(ref));
      return { journalLineIds: [x.l.id], score: 100 - days * 5 + (refHit ? 20 : 0) };
    });
  const groups: Array<{ journalLineIds: string[]; score: number }> = [];
  const sameSign = signed.filter((x) => (amount.greaterThan(0) ? x.amt.greaterThan(0) : x.amt.lessThan(0)));
  // Greedy window: consecutive lines (by date) up to the bank date summing to the amount.
  for (let start = 0; start < sameSign.length && groups.length < 5; start++) {
    let sum = ZERO;
    const ids: string[] = [];
    for (let k = start; k < sameSign.length && ids.length < 200; k++) {
      sum = sum.add(sameSign[k]!.amt);
      ids.push(sameSign[k]!.l.id);
      if (sum.equals(amount) && ids.length > 1) {
        groups.push({ journalLineIds: [...ids], score: 60 });
        break;
      }
      if (sum.abs().greaterThan(amount.abs())) break;
    }
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  return [...single, ...groups]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => ({
      score: Math.round(s.score),
      lines: s.journalLineIds.map((id) => {
        const l = byId.get(id)!;
        return {
          id: l.id,
          entryNumber: l.entry.number,
          entryDate: l.entryDate.toISOString(),
          memo: l.entry.memo,
          amount: toApiString(D(l.debit).sub(D(l.credit))),
        };
      }),
    }));
}

export const matchSchema = z.object({ journalLineIds: z.array(z.string()).min(1).max(500) }).strict();

export async function matchTransaction(ctx: AccountingCtx, txnId: string, raw: unknown) {
  const { journalLineIds } = matchSchema.parse(raw);
  const { t, bank } = await loadTxn(ctx, txnId);
  if (t.status === "reconciled") throw acctError(ACCT.ALREADY_RECONCILED);
  if (t.status === "excluded") throw acctError(ACCT.JOURNAL_NOT_EDITABLE, { message: "Line is excluded" });
  const lines = await prisma.journalLine.findMany({
    where: { orgId: ctx.orgId, id: { in: journalLineIds }, ledgerAccountId: bank.ledgerAccountId, entry: { status: { in: ["posted", "reversed"] } } },
    include: { bankMatches: true },
  });
  if (lines.length !== new Set(journalLineIds).size) throw acctError(ACCT.NOT_FOUND, { message: "Lines not found on this bank account" });
  if (lines.some((l) => l.bankMatches.some((m) => m.bankTransactionId !== t.id))) {
    throw acctError(ACCT.MATCH_AMOUNT_MISMATCH, { message: "A line is already matched to another bank transaction" });
  }
  const sum = lines.reduce((a, l) => a.add(D(l.debit)).sub(D(l.credit)), ZERO);
  if (!round2(sum).equals(round2(D(t.amount)))) {
    throw acctError(ACCT.MATCH_AMOUNT_MISMATCH, { details: { bank: toApiString(t.amount), ledger: toApiString(sum) } });
  }
  await prisma.$transaction(async (tx) => {
    await tx.bankTransactionMatch.deleteMany({ where: { bankTransactionId: t.id } });
    await tx.bankTransactionMatch.createMany({
      data: lines.map((l) => ({
        orgId: ctx.orgId,
        bankTransactionId: t.id,
        journalLineId: l.id,
        amount: D(l.debit).sub(D(l.credit)),
      })),
    });
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "matched" } });
  });
  recordAccountingAudit(ctx, {
    action: "bank.match",
    entityType: "BankTransaction",
    entityId: t.id,
    description: `Matched bank line to ${lines.length} ledger line(s)`,
  });
  return toBankTxnDto((await loadTxn(ctx, t.id)).t);
}

export async function unmatchTransaction(ctx: AccountingCtx, txnId: string) {
  const { t } = await loadTxn(ctx, txnId);
  if (t.status === "reconciled") throw acctError(ACCT.ALREADY_RECONCILED);
  await prisma.$transaction(async (tx) => {
    await tx.bankTransactionMatch.deleteMany({ where: { bankTransactionId: t.id } });
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "unmatched", excludedReason: null } });
  });
  recordAccountingAudit(ctx, { action: "bank.unmatch", entityType: "BankTransaction", entityId: t.id, description: "Bank line unmatched" });
  return toBankTxnDto((await loadTxn(ctx, t.id)).t);
}

export async function excludeTransaction(ctx: AccountingCtx, txnId: string, reason: string) {
  const { t } = await loadTxn(ctx, txnId);
  if (t.status === "reconciled") throw acctError(ACCT.ALREADY_RECONCILED);
  await prisma.$transaction(async (tx) => {
    await tx.bankTransactionMatch.deleteMany({ where: { bankTransactionId: t.id } });
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "excluded", excludedReason: reason.slice(0, 500) } });
  });
  recordAccountingAudit(ctx, { action: "bank.exclude", entityType: "BankTransaction", entityId: t.id, description: "Bank line excluded", reason });
  return toBankTxnDto((await loadTxn(ctx, t.id)).t);
}

export const createEntrySchema = z
  .object({
    accountId: z.string().min(1),
    taxCodeId: z.string().nullable().optional(),
    memo: z.string().trim().min(1).max(500),
    partyKey: z.string().nullable().optional(),
  })
  .strict();

/** Fees, interest, unknown deposits: post Dr/Cr chosen account vs bank and match. */
export async function createEntryFromBankLine(ctx: AccountingCtx, txnId: string, raw: unknown) {
  const input = createEntrySchema.parse(raw);
  const { t, bank } = await loadTxn(ctx, txnId);
  if (t.status !== "unmatched") throw acctError(ACCT.ALREADY_RECONCILED, { message: "Line is already matched" });
  const offset = await prisma.ledgerAccount.findFirst({ where: { id: input.accountId, orgId: ctx.orgId } });
  if (!offset) throw acctError(ACCT.NOT_FOUND, { fields: { accountId: "Unknown account" } });
  assertPostable(offset, { manual: !input.partyKey, locationId: bank.locationId });
  const party = input.partyKey ? await parsePartyKey(ctx.orgId, input.partyKey) : null;
  const taxCode = await loadTaxCode(prisma, ctx.orgId, input.taxCodeId ?? null);
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const gross = D(t.amount).abs();
  const tax = taxCode ? computeTax(gross, taxCode, true).tax : ZERO;
  const isOut = D(t.amount).lessThan(0);
  const taxAccountId = taxCode
    ? (isOut ? taxCode.purchaseTaxAccountId : taxCode.salesTaxAccountId) ??
      (await prisma.ledgerAccount.findUnique({
        where: { orgId_systemKey: { orgId: ctx.orgId, systemKey: isOut ? "input_tax" : "sales_tax_payable" } },
      }))?.id ??
      null
    : null;
  const entry = await prisma.$transaction(async (tx) => {
    const pc = await createPostingContext(tx, settings);
    const posted = await postBankLineEntry(pc, {
      bankTransactionId: t.id,
      bankLedgerAccountId: bank.ledgerAccountId,
      bankLocationId: bank.locationId,
      amount: D(t.amount),
      date: t.txnDate,
      offsetAccountId: offset.id,
      taxAccountId,
      taxAmount: tax,
      taxCodeId: taxCode?.id ?? null,
      party,
      memo: input.memo,
    });
    if (!posted) throw acctError(ACCT.EMPTY_JOURNAL);
    const bankLine = await tx.journalLine.findFirst({ where: { entryId: posted.id, ledgerAccountId: bank.ledgerAccountId } });
    if (bankLine) {
      await tx.bankTransactionMatch.create({
        data: { orgId: ctx.orgId, bankTransactionId: t.id, journalLineId: bankLine.id, amount: D(bankLine.debit).sub(D(bankLine.credit)) },
      });
      await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "matched" } });
    }
    return posted;
  });
  recordAccountingAudit(ctx, {
    action: "bank.create_entry",
    entityType: "BankTransaction",
    entityId: t.id,
    description: `Journal ${entry.number} created from bank line`,
  });
  return { journalEntryId: entry.id, number: entry.number, transaction: toBankTxnDto((await loadTxn(ctx, t.id)).t) };
}
