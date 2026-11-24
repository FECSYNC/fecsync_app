/**
 * Transfers between bank / cash / clearing accounts.
 */
import type { BankTransfer } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, toApiString } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { loadBankAccount } from "@/lib/accounting/banking/bankAccounts";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postBankTransfer } from "@/lib/accounting/posting/banking";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import type { AccountingCtx } from "@/lib/accounting/types";

export function toTransferDto(
  t: BankTransfer,
  names?: { fromName?: string | null; toName?: string | null }
) {
  return {
    id: t.id,
    number: t.number,
    fromBankAccountId: t.fromBankAccountId,
    toBankAccountId: t.toBankAccountId,
    fromName: names?.fromName ?? null,
    toName: names?.toName ?? null,
    amount: toApiString(t.amount),
    feeAmount: toApiString(t.feeAmount),
    transferDate: t.transferDate.toISOString(),
    reference: t.reference,
    journalEntryId: t.journalEntryId,
    status: t.status,
    voidedAt: t.voidedAt?.toISOString() ?? null,
    voidReason: t.voidReason,
    createdAt: t.createdAt.toISOString(),
  };
}

export const transferSchema = z
  .object({
    fromBankAccountId: z.string().min(1),
    toBankAccountId: z.string().min(1),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    feeAmount: z.union([z.string(), z.number()]).optional().transform((v) => (v == null || v === "" ? D(0) : D(String(v)))),
    transferDate: z.string().min(10),
    reference: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export async function createTransfer(ctx: AccountingCtx, raw: unknown) {
  const input = transferSchema.parse(raw);
  if (input.fromBankAccountId === input.toBankAccountId) throw acctError(ACCT.TRANSFER_SAME_ACCOUNT);
  if (!input.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { amount: "Must be > 0" } });
  if (input.feeAmount.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { feeAmount: "Must be ≥ 0" } });
  const [from, to] = await Promise.all([
    loadBankAccount(ctx, input.fromBankAccountId),
    loadBankAccount(ctx, input.toBankAccountId),
  ]);
  if (from.archivedAt || to.archivedAt || !from.isActive || !to.isActive) throw acctError(ACCT.ACCOUNT_INACTIVE);
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const date = parseDateInput(input.transferDate, settings.timezone, "transferDate");
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "transfer");
    const t = await tx.bankTransfer.create({
      data: {
        orgId: ctx.orgId,
        number,
        fromBankAccountId: from.id,
        toBankAccountId: to.id,
        amount: input.amount,
        feeAmount: input.feeAmount,
        transferDate: date,
        reference: input.reference ?? null,
        createdById: ctx.actorId ?? "system",
      },
    });
    const pc = await createPostingContext(tx, settings);
    const entry = await postBankTransfer(pc, t.id);
    return tx.bankTransfer.update({ where: { id: t.id }, data: { journalEntryId: entry?.id ?? null } });
  });
  recordAccountingAudit(ctx, {
    action: "bank.transfer",
    entityType: "BankTransfer",
    entityId: created.id,
    description: `Transfer ${created.number} ${toApiString(created.amount)}`,
  });
  return toTransferDto(created);
}

export async function voidTransfer(ctx: AccountingCtx, id: string, reason: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const t = await prisma.bankTransfer.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw acctError(ACCT.NOT_FOUND);
  await loadBankAccount(ctx, t.fromBankAccountId);
  if (t.status === "void") throw acctError(ACCT.ALREADY_REVERSED);
  const updated = await prisma.$transaction(async (tx) => {
    await reverseSystemEntry(tx, ctx.orgId, `bank_transfer:${t.id}:post`, { reason, actorId: ctx.actorId });
    return tx.bankTransfer.update({
      where: { id: t.id },
      data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500) },
    });
  });
  recordAccountingAudit(ctx, { action: "bank.transfer_void", entityType: "BankTransfer", entityId: t.id, description: `Transfer ${t.number} voided`, reason });
  return toTransferDto(updated);
}

export async function listTransfers(ctx: AccountingCtx) {
  const visibleBanks = await prisma.bankAccount.findMany({
    where: { orgId: ctx.orgId, ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }) },
    select: { id: true, name: true },
  });
  const ids = visibleBanks.map((b) => b.id);
  const nameById = new Map(visibleBanks.map((b) => [b.id, b.name]));
  // Resolve names for counterparties outside park scope (still readable by id).
  const rows = await prisma.bankTransfer.findMany({
    where: { orgId: ctx.orgId, OR: [{ fromBankAccountId: { in: ids } }, { toBankAccountId: { in: ids } }] },
    orderBy: [{ transferDate: "desc" }, { id: "desc" }],
    take: 500,
  });
  const missing = new Set<string>();
  for (const t of rows) {
    if (!nameById.has(t.fromBankAccountId)) missing.add(t.fromBankAccountId);
    if (!nameById.has(t.toBankAccountId)) missing.add(t.toBankAccountId);
  }
  if (missing.size) {
    const extra = await prisma.bankAccount.findMany({
      where: { orgId: ctx.orgId, id: { in: [...missing] } },
      select: { id: true, name: true },
    });
    for (const b of extra) nameById.set(b.id, b.name);
  }
  return rows.map((t) =>
    toTransferDto(t, {
      fromName: nameById.get(t.fromBankAccountId) ?? null,
      toName: nameById.get(t.toBankAccountId) ?? null,
    })
  );
}
