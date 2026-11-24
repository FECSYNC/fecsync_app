/**
 * Bank reconciliation: tick ledger lines as cleared until the difference to
 * the statement ending balance is exactly 0.00, then complete.
 */
import type { BankReconciliation } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { loadBankAccount } from "@/lib/accounting/banking/bankAccounts";
import { ctxHas, type AccountingCtx } from "@/lib/accounting/types";

export function toReconciliationDto(
  r: BankReconciliation,
  extras?: { bankAccountName?: string | null }
) {
  return {
    id: r.id,
    number: r.number,
    bankAccountId: r.bankAccountId,
    bankAccountName: extras?.bankAccountName ?? null,
    statementDate: r.statementDate.toISOString(),
    statementEndingBalance: toApiString(r.statementEndingBalance),
    openingBalance: toApiString(r.openingBalance),
    clearedBalance: toApiString(r.clearedBalance),
    difference: toApiString(r.difference),
    status: r.status,
    clearedLineIds: r.clearedLineIds,
    completedById: r.completedById,
    completedAt: r.completedAt?.toISOString() ?? null,
    reopenedAt: r.reopenedAt?.toISOString() ?? null,
    reopenReason: r.reopenReason,
    createdAt: r.createdAt.toISOString(),
  };
}

export const startSchema = z
  .object({
    bankAccountId: z.string().min(1),
    statementDate: z.string().min(10),
    statementEndingBalance: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
  })
  .strict();

async function loadRec(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const r = await prisma.bankReconciliation.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw acctError(ACCT.NOT_FOUND);
  const bank = await loadBankAccount(ctx, r.bankAccountId);
  return { r, bank };
}

function computeCleared(opening: Dec, lines: Array<{ debit: unknown; credit: unknown }>): Dec {
  return lines.reduce<Dec>((a, l) => a.add(D(l.debit as never)).sub(D(l.credit as never)), opening);
}

export async function startReconciliation(ctx: AccountingCtx, raw: unknown) {
  const input = startSchema.parse(raw);
  const bank = await loadBankAccount(ctx, input.bankAccountId);
  const inProgress = await prisma.bankReconciliation.findFirst({ where: { bankAccountId: bank.id, status: "in_progress" } });
  if (inProgress) throw acctError(ACCT.RECON_IN_PROGRESS, { details: { id: inProgress.id } });
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const statementDate = parseDateInput(input.statementDate, settings.timezone, "statementDate");
  const last = await prisma.bankReconciliation.findFirst({
    where: { bankAccountId: bank.id, status: "completed" },
    orderBy: { statementDate: "desc" },
  });
  if (last && statementDate <= last.statementDate) {
    throw acctError(ACCT.VALIDATION, { fields: { statementDate: "Must be after the last completed reconciliation" } });
  }
  const opening = last ? D(last.statementEndingBalance) : D(bank.openingBalance);
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "reconciliation");
    return tx.bankReconciliation.create({
      data: {
        orgId: ctx.orgId,
        bankAccountId: bank.id,
        number,
        statementDate,
        statementEndingBalance: input.statementEndingBalance,
        openingBalance: opening,
        clearedBalance: opening,
        difference: round2(input.statementEndingBalance.sub(opening)),
        createdById: ctx.actorId ?? "system",
      },
    });
  });
  recordAccountingAudit(ctx, { action: "reconcile.start", entityType: "BankReconciliation", entityId: created.id, description: `Reconciliation ${created.number} started` });
  return getReconciliation(ctx, created.id);
}

export async function getReconciliation(ctx: AccountingCtx, id: string) {
  const { r, bank } = await loadRec(ctx, id);
  const lines = await prisma.journalLine.findMany({
    where: {
      orgId: ctx.orgId,
      ledgerAccountId: bank.ledgerAccountId,
      entryDate: { lte: new Date(r.statementDate.getTime() + 86_399_999) },
      entry: { status: { in: ["posted", "reversed"] } },
      OR: r.status === "completed" ? [{ reconciledInId: r.id }] : [{ reconciledInId: null }, { reconciledInId: r.id }],
    },
    include: { entry: { select: { number: true, memo: true } }, bankMatches: { select: { bankTransactionId: true } } },
    orderBy: [{ entryDate: "asc" }, { id: "asc" }],
    take: 5000,
  });
  const cleared = new Set(r.status === "completed" ? lines.map((l) => l.id) : r.clearedLineIds);
  return {
    reconciliation: toReconciliationDto(r),
    bankAccount: { id: bank.id, name: bank.name, ledgerAccountId: bank.ledgerAccountId },
    lines: lines.map((l) => ({
      id: l.id,
      entryNumber: l.entry.number,
      memo: l.entry.memo,
      description: l.description,
      entryDate: l.entryDate.toISOString(),
      amount: toApiString(D(l.debit).sub(D(l.credit))),
      cleared: cleared.has(l.id),
      matchedToBankLine: l.bankMatches.length > 0,
    })),
  };
}

export const toggleSchema = z
  .object({
    journalLineIds: z.array(z.string()).min(1).max(5000),
    cleared: z.boolean(),
  })
  .strict();

export async function toggleCleared(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = toggleSchema.parse(raw);
  const { r, bank } = await loadRec(ctx, id);
  if (r.status !== "in_progress") throw acctError(ACCT.ALREADY_RECONCILED);
  const valid = await prisma.journalLine.findMany({
    where: { orgId: ctx.orgId, id: { in: input.journalLineIds }, ledgerAccountId: bank.ledgerAccountId, reconciledInId: null },
    select: { id: true },
  });
  if (valid.length !== new Set(input.journalLineIds).size) throw acctError(ACCT.NOT_FOUND);
  const set = new Set(r.clearedLineIds);
  for (const l of valid) {
    if (input.cleared) set.add(l.id);
    else set.delete(l.id);
  }
  const clearedLines = await prisma.journalLine.findMany({ where: { id: { in: [...set] } }, select: { debit: true, credit: true } });
  const clearedBalance = round2(computeCleared(D(r.openingBalance), clearedLines));
  await prisma.bankReconciliation.update({
    where: { id: r.id },
    data: {
      clearedLineIds: [...set],
      clearedBalance,
      difference: round2(D(r.statementEndingBalance).sub(clearedBalance)),
    },
  });
  return getReconciliation(ctx, r.id);
}

export async function completeReconciliation(ctx: AccountingCtx, id: string) {
  const { r, bank } = await loadRec(ctx, id);
  if (r.status !== "in_progress") throw acctError(ACCT.ALREADY_RECONCILED);
  const clearedLines = await prisma.journalLine.findMany({
    where: { id: { in: r.clearedLineIds }, reconciledInId: null, ledgerAccountId: bank.ledgerAccountId },
    select: { id: true, debit: true, credit: true },
  });
  const clearedBalance = round2(computeCleared(D(r.openingBalance), clearedLines));
  const difference = round2(D(r.statementEndingBalance).sub(clearedBalance));
  if (!difference.isZero()) throw acctError(ACCT.RECON_DIFFERENCE, { details: { difference: toApiString(difference) } });
  await prisma.$transaction(async (tx) => {
    await tx.journalLine.updateMany({ where: { id: { in: clearedLines.map((l) => l.id) } }, data: { reconciledInId: r.id } });
    const matchedTxns = await tx.bankTransactionMatch.findMany({
      where: { journalLineId: { in: clearedLines.map((l) => l.id) } },
      select: { bankTransactionId: true },
    });
    await tx.bankTransaction.updateMany({
      where: { id: { in: [...new Set(matchedTxns.map((m) => m.bankTransactionId))] }, status: "matched" },
      data: { status: "reconciled", reconciliationId: r.id },
    });
    await tx.bankReconciliation.update({
      where: { id: r.id },
      data: { status: "completed", completedAt: new Date(), completedById: ctx.actorId, clearedBalance, difference: ZERO },
    });
    await tx.bankAccount.update({
      where: { id: bank.id },
      data: { lastReconciledAt: r.statementDate, lastReconciledBalance: r.statementEndingBalance },
    });
  });
  recordAccountingAudit(ctx, { action: "reconcile.complete", entityType: "BankReconciliation", entityId: r.id, description: `Reconciliation ${r.number} completed` });
  return getReconciliation(ctx, r.id);
}

export async function reopenReconciliation(ctx: AccountingCtx, id: string, reason: string) {
  if (!ctxHas(ctx, "accounting:manage")) throw acctError(ACCT.APPROVAL_REQUIRED, { message: "accounting:manage required" });
  const { r, bank } = await loadRec(ctx, id);
  if (r.status !== "completed") throw acctError(ACCT.RECON_IN_PROGRESS);
  const latest = await prisma.bankReconciliation.findFirst({
    where: { bankAccountId: bank.id, status: "completed" },
    orderBy: { statementDate: "desc" },
  });
  if (latest?.id !== r.id) throw acctError(ACCT.ALREADY_RECONCILED, { message: "Only the latest completed reconciliation can be reopened" });
  const prior = await prisma.bankReconciliation.findFirst({
    where: { bankAccountId: bank.id, status: "completed", statementDate: { lt: r.statementDate } },
    orderBy: { statementDate: "desc" },
  });
  const lineIds = (await prisma.journalLine.findMany({ where: { reconciledInId: r.id }, select: { id: true } })).map((l) => l.id);
  await prisma.$transaction(async (tx) => {
    await tx.journalLine.updateMany({ where: { reconciledInId: r.id }, data: { reconciledInId: null } });
    await tx.bankTransaction.updateMany({ where: { reconciliationId: r.id }, data: { status: "matched", reconciliationId: null } });
    await tx.bankReconciliation.update({
      where: { id: r.id },
      data: { status: "in_progress", clearedLineIds: lineIds, reopenedAt: new Date(), reopenedById: ctx.actorId, reopenReason: reason.slice(0, 500), completedAt: null },
    });
    await tx.bankAccount.update({
      where: { id: bank.id },
      data: { lastReconciledAt: prior?.statementDate ?? null, lastReconciledBalance: prior?.statementEndingBalance ?? null },
    });
  });
  recordAccountingAudit(ctx, { action: "reconcile.reopen", entityType: "BankReconciliation", entityId: r.id, description: `Reconciliation ${r.number} reopened`, reason });
  return getReconciliation(ctx, r.id);
}

export async function listReconciliations(ctx: AccountingCtx, bankAccountId?: string | null) {
  const banks = await prisma.bankAccount.findMany({
    where: { orgId: ctx.orgId, ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }) },
    select: { id: true, name: true },
  });
  const nameById = new Map(banks.map((b) => [b.id, b.name]));
  const ids = banks.map((b) => b.id).filter((id) => !bankAccountId || id === bankAccountId);
  if (!ids.length) return [];
  const rows = await prisma.bankReconciliation.findMany({
    where: { orgId: ctx.orgId, bankAccountId: { in: ids } },
    orderBy: [{ statementDate: "desc" }, { id: "desc" }],
    take: 500,
  });
  return rows.map((r) =>
    toReconciliationDto(r, { bankAccountName: nameById.get(r.bankAccountId) ?? null })
  );
}
