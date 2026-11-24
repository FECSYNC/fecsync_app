/**
 * Expenses: draft → submitted → approved (posts) → paid (reimbursable) / void.
 * on_account expenses create a SupplierBill and post through payables.
 */
import type { Expense, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { computeTax, loadTaxCode } from "@/lib/accounting/taxCodes";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import { needsApproval, requestApproval, markApprovalDecided, assertNotSelfApproval } from "@/lib/accounting/approvals";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postExpenseApproval, postExpenseReimbursement } from "@/lib/accounting/posting/expenses";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import { ctxHas, type AccountingCtx } from "@/lib/accounting/types";

export function toExpenseDto(e: Expense & { category?: { name: string } | null; supplier?: { name: string } | null }) {
  return {
    id: e.id,
    number: e.number,
    status: e.status,
    locationId: e.locationId,
    expenseDate: e.expenseDate.toISOString(),
    categoryId: e.categoryId,
    categoryName: e.category?.name ?? null,
    supplierId: e.supplierId,
    supplierName: e.supplier?.name ?? null,
    payeeName: e.payeeName,
    description: e.description,
    amount: toApiString(e.amount),
    taxCodeId: e.taxCodeId,
    taxAmount: toApiString(e.taxAmount),
    netAmount: toApiString(e.netAmount),
    currency: e.currency,
    exchangeRate: D(e.exchangeRate).toString(),
    paymentMode: e.paymentMode,
    bankAccountId: e.bankAccountId,
    employeeUserId: e.employeeUserId,
    receiptUrls: e.receiptUrls,
    submittedById: e.submittedById,
    submittedAt: e.submittedAt?.toISOString() ?? null,
    approvedById: e.approvedById,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    rejectedById: e.rejectedById,
    rejectedReason: e.rejectedReason,
    paidAt: e.paidAt?.toISOString() ?? null,
    paymentBankAccountId: e.paymentBankAccountId,
    journalEntryId: e.journalEntryId,
    paymentJournalEntryId: e.paymentJournalEntryId,
    supplierBillId: e.supplierBillId,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
  };
}

export const expenseSchema = z
  .object({
    expenseDate: z.string().min(10),
    categoryId: z.string().min(1),
    supplierId: z.string().nullable().optional(),
    payeeName: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().min(1).max(500),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    taxCodeId: z.string().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    exchangeRate: z.union([z.string(), z.number()]).optional(),
    paymentMode: z.enum(["paid_now", "reimbursable", "on_account"]),
    bankAccountId: z.string().nullable().optional(),
    employeeUserId: z.string().nullable().optional(),
    receiptUrls: z.array(z.string().url()).max(10).default([]),
    locationId: z.string().nullable().optional(),
    submit: z.boolean().optional(),
  })
  .strict();

type ExpenseInput = z.infer<typeof expenseSchema>;

async function validateRefs(ctx: AccountingCtx, input: ExpenseInput) {
  if (!input.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { amount: "Must be > 0" } });
  const category = await prisma.expenseCategory.findFirst({ where: { id: input.categoryId, orgId: ctx.orgId, isActive: true } });
  if (!category) throw acctError(ACCT.NOT_FOUND, { fields: { categoryId: "Unknown category" } });
  if (input.paymentMode === "paid_now") {
    if (!input.bankAccountId) throw acctError(ACCT.VALIDATION, { fields: { bankAccountId: "Choose the account it was paid from" } });
    const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: ctx.orgId, archivedAt: null } });
    if (!bank || !isLocationVisible(ctx.scope, bank.locationId)) throw acctError(ACCT.NOT_FOUND, { fields: { bankAccountId: "Unknown bank account" } });
  }
  if (input.paymentMode === "reimbursable") {
    const employee = input.employeeUserId ?? ctx.actorId;
    if (!employee || !isValidId(employee)) throw acctError(ACCT.VALIDATION, { fields: { employeeUserId: "Choose the employee to reimburse" } });
    const m = await prisma.membership.findFirst({ where: { orgId: ctx.orgId, userId: employee, status: "active" } });
    if (!m) throw acctError(ACCT.NOT_FOUND, { fields: { employeeUserId: "Not an active team member" } });
  }
  if (input.paymentMode === "on_account" || input.supplierId) {
    if (input.paymentMode === "on_account" && !input.supplierId) throw acctError(ACCT.VALIDATION, { fields: { supplierId: "Choose the supplier" } });
    if (input.supplierId) {
      const s = await prisma.supplier.findFirst({ where: { id: input.supplierId, orgId: ctx.orgId } });
      if (!s) throw acctError(ACCT.NOT_FOUND, { fields: { supplierId: "Unknown supplier" } });
      if (s.archivedAt) throw acctError(ACCT.SUPPLIER_ARCHIVED);
    }
  }
  const tax = await loadTaxCode(prisma, ctx.orgId, input.taxCodeId ?? category.defaultTaxCodeId ?? null);
  return { category, tax };
}

async function loadExpense(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const e = await prisma.expense.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (!e) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, e.locationId)) throw acctError(ACCT.NOT_FOUND);
  const canSeeAll = ctxHas(ctx, "accounting:expenses_read") || ctxHas(ctx, "accounting:expenses_approve") || ctxHas(ctx, "accounting:expenses_write");
  if (!canSeeAll && e.createdById !== ctx.actorId) throw acctError(ACCT.NOT_FOUND);
  return e;
}

export async function createExpense(ctx: AccountingCtx, raw: unknown) {
  const input = expenseSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const { tax } = await validateRefs(ctx, input);
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  const currency = input.currency ?? settings.baseCurrency;
  const rate = currency === settings.baseCurrency ? D(1) : D(String(input.exchangeRate ?? 0));
  if (!rate.greaterThan(0)) throw acctError(ACCT.FX_RATE_REQUIRED);
  const t = computeTax(round2(input.amount), tax, true);
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "expense");
    return tx.expense.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        number,
        expenseDate: parseDateInput(input.expenseDate, settings.timezone, "expenseDate"),
        categoryId: input.categoryId,
        supplierId: input.supplierId ?? null,
        payeeName: input.payeeName ?? null,
        description: input.description,
        amount: t.gross,
        taxCodeId: tax?.id ?? null,
        taxAmount: t.tax,
        netAmount: t.net,
        currency,
        exchangeRate: rate,
        paymentMode: input.paymentMode,
        bankAccountId: input.paymentMode === "paid_now" ? input.bankAccountId ?? null : null,
        employeeUserId: input.paymentMode === "reimbursable" ? input.employeeUserId ?? ctx.actorId : null,
        receiptUrls: input.receiptUrls,
        createdById: ctx.actorId ?? "system",
      },
    });
  });
  recordAccountingAudit(ctx, { action: "expense.create", entityType: "Expense", entityId: created.id, description: `Expense ${created.number} drafted` });
  if (input.submit) return submitExpense(ctx, created.id);
  return getExpense(ctx, created.id);
}

export async function updateExpense(ctx: AccountingCtx, id: string, raw: unknown) {
  const e = await loadExpense(ctx, id);
  if (e.status !== "draft" && e.status !== "rejected") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  if (e.createdById !== ctx.actorId && !ctxHas(ctx, "accounting:expenses_write")) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const input = expenseSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const { tax } = await validateRefs(ctx, input);
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  const t = computeTax(round2(input.amount), tax, true);
  await prisma.expense.update({
    where: { id: e.id },
    data: {
      locationId,
      expenseDate: parseDateInput(input.expenseDate, settings.timezone, "expenseDate"),
      categoryId: input.categoryId,
      supplierId: input.supplierId ?? null,
      payeeName: input.payeeName ?? null,
      description: input.description,
      amount: t.gross,
      taxCodeId: tax?.id ?? null,
      taxAmount: t.tax,
      netAmount: t.net,
      paymentMode: input.paymentMode,
      bankAccountId: input.paymentMode === "paid_now" ? input.bankAccountId ?? null : null,
      employeeUserId: input.paymentMode === "reimbursable" ? input.employeeUserId ?? e.createdById : null,
      receiptUrls: input.receiptUrls,
      status: "draft",
      rejectedReason: null,
      rejectedById: null,
    },
  });
  recordAccountingAudit(ctx, { action: "expense.update", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} edited` });
  if (input.submit) return submitExpense(ctx, e.id);
  return getExpense(ctx, e.id);
}

export async function submitExpense(ctx: AccountingCtx, id: string) {
  const e = await loadExpense(ctx, id);
  if (e.status !== "draft" && e.status !== "rejected") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  if (e.createdById !== ctx.actorId && !ctxHas(ctx, "accounting:expenses_write")) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  const amountBase = D(e.amount).mul(D(e.exchangeRate));
  if (settings.receiptRequiredAbove != null && amountBase.greaterThanOrEqualTo(D(settings.receiptRequiredAbove)) && e.receiptUrls.length === 0) {
    throw acctError(ACCT.EXPENSE_RECEIPT_REQUIRED);
  }
  const overThreshold = needsApproval(settings, "expense", amountBase);
  const canSelf = ctxHas(ctx, "accounting:expenses_approve") && settings.allowSelfApproval;
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id: e.id }, data: { status: "submitted", submittedAt: new Date(), submittedById: ctx.actorId } });
    if (overThreshold || !canSelf) {
      await requestApproval(tx, { orgId: ctx.orgId, entity: "expense", entityId: e.id, amount: amountBase, requestedById: ctx.actorId ?? "system", locationId: e.locationId });
    }
  });
  recordAccountingAudit(ctx, { action: "expense.submit", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} submitted` });
  void import("@/lib/accounting/notifications").then((n) => n.notifyExpenseSubmitted(e.id)).catch(() => undefined);
  if (!overThreshold && canSelf) return approveExpense(ctx, e.id);
  return getExpense(ctx, e.id);
}

export async function approveExpense(ctx: AccountingCtx, id: string) {
  const e = await loadExpense(ctx, id);
  if (e.status !== "submitted") throw acctError(ACCT.EXPENSE_NOT_SUBMITTED);
  const settings = await requireAccountingSettings(ctx.orgId);
  assertNotSelfApproval(settings, e.submittedById ?? e.createdById, ctx.actorId);
  await prisma.$transaction(
    async (tx) => {
      const res = await tx.expense.updateMany({
        where: { id: e.id, status: "submitted" },
        data: {
          status: e.paymentMode === "paid_now" ? "paid" : "approved",
          approvedAt: new Date(),
          approvedById: ctx.actorId,
          ...(e.paymentMode === "paid_now" ? { paidAt: e.expenseDate, paymentBankAccountId: e.bankAccountId } : {}),
        },
      });
      if (res.count === 0) throw acctError(ACCT.EXPENSE_NOT_SUBMITTED);
      if (e.paymentMode === "on_account") {
        const { createBill, postBill } = await import("@/lib/accounting/payables/bills");
        const category = await tx.expenseCategory.findUniqueOrThrow({ where: { id: e.categoryId } });
        const bill = await createBill(
          ctx,
          {
            supplierId: e.supplierId!,
            locationId: e.locationId,
            billDate: e.expenseDate.toISOString().slice(0, 10),
            currency: e.currency,
            ...(D(e.exchangeRate).equals(1) ? {} : { exchangeRate: D(e.exchangeRate).toString() }),
            notes: `Expense ${e.number}`,
            taxInclusive: true,
            lines: [
              {
                description: e.description,
                ledgerAccountId: category.ledgerAccountId,
                qty: "1",
                unitCost: D(e.amount).toString(),
                ...(e.taxCodeId ? { taxCodeId: e.taxCodeId } : {}),
              },
            ],
          },
          tx
        );
        await tx.supplierBill.update({ where: { id: bill.id }, data: { expenseId: e.id, status: "approved", approvedAt: new Date(), approvedById: ctx.actorId } });
        await postBill(ctx, bill.id, tx);
        await tx.expense.update({ where: { id: e.id }, data: { supplierBillId: bill.id } });
      } else {
        const pc = await createPostingContext(tx, settings);
        const entry = await postExpenseApproval(pc, e.id);
        await tx.expense.update({ where: { id: e.id }, data: { journalEntryId: entry?.id ?? null } });
      }
      await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "expense", entityId: e.id, status: "approved", actorId: ctx.actorId });
    },
    { timeout: 60_000 }
  );
  recordAccountingAudit(ctx, { action: "expense.approve", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} approved` });
  void import("@/lib/accounting/notifications").then((n) => n.notifyExpenseApproved(e.id)).catch(() => undefined);
  return getExpense(ctx, e.id);
}

export async function rejectExpense(ctx: AccountingCtx, id: string, reason: string) {
  const e = await loadExpense(ctx, id);
  if (e.status !== "submitted") throw acctError(ACCT.EXPENSE_NOT_SUBMITTED);
  if (!reason || reason.trim().length < 3) throw acctError(ACCT.VALIDATION, { fields: { reason: "Reason is required" } });
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id: e.id }, data: { status: "rejected", rejectedById: ctx.actorId, rejectedReason: reason.slice(0, 500) } });
    await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "expense", entityId: e.id, status: "rejected", actorId: ctx.actorId, reason });
  });
  recordAccountingAudit(ctx, { action: "expense.reject", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} rejected`, reason });
  void import("@/lib/accounting/notifications")
    .then((n) => n.notifyExpenseRejected(e.id, reason))
    .catch(() => undefined);
  return getExpense(ctx, e.id);
}

export const paySchema = z
  .object({ bankAccountId: z.string().min(1), paidDate: z.string().min(10) })
  .strict();

export async function payReimbursement(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = paySchema.parse(raw);
  const e = await loadExpense(ctx, id);
  if (e.paymentMode !== "reimbursable") throw acctError(ACCT.VALIDATION, { message: "Only reimbursable expenses are paid here" });
  if (e.status !== "approved") throw acctError(ACCT.EXPENSE_NOT_SUBMITTED);
  const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: ctx.orgId, archivedAt: null } });
  if (!bank || !isLocationVisible(ctx.scope, bank.locationId)) throw acctError(ACCT.NOT_FOUND, { fields: { bankAccountId: "Unknown bank account" } });
  const settings = await requireAccountingSettings(ctx.orgId);
  const paidAt = parseDateInput(input.paidDate, settings.timezone, "paidDate");
  await prisma.$transaction(async (tx) => {
    const res = await tx.expense.updateMany({
      where: { id: e.id, status: "approved" },
      data: { status: "paid", paidAt, paymentBankAccountId: bank.id },
    });
    if (res.count === 0) throw acctError(ACCT.ALREADY_POSTED);
    const pc = await createPostingContext(tx, settings);
    const entry = await postExpenseReimbursement(pc, e.id);
    await tx.expense.update({ where: { id: e.id }, data: { paymentJournalEntryId: entry?.id ?? null } });
  });
  recordAccountingAudit(ctx, { action: "expense.pay", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} reimbursed` });
  void import("@/lib/accounting/notifications").then((n) => n.notifyExpenseReimbursed(e.id)).catch(() => undefined);
  return getExpense(ctx, e.id);
}

export async function voidExpense(ctx: AccountingCtx, id: string, reason: string) {
  const e = await loadExpense(ctx, id);
  if (e.status === "void") throw acctError(ACCT.ALREADY_REVERSED);
  await prisma.$transaction(async (tx) => {
    if (e.paymentJournalEntryId) await reverseSystemEntry(tx, ctx.orgId, `expense_payment:${e.id}:pay`, { reason, actorId: ctx.actorId });
    if (e.journalEntryId && !e.supplierBillId) await reverseSystemEntry(tx, ctx.orgId, `expense:${e.id}:approve`, { reason, actorId: ctx.actorId });
    await tx.expense.update({ where: { id: e.id }, data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500) } });
    await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "expense", entityId: e.id, status: "cancelled", actorId: ctx.actorId });
  });
  if (e.supplierBillId) {
    const { voidBill } = await import("@/lib/accounting/payables/bills");
    await voidBill(ctx, e.supplierBillId, `Expense ${e.number} voided: ${reason}`);
  }
  recordAccountingAudit(ctx, { action: "expense.void", entityType: "Expense", entityId: e.id, description: `Expense ${e.number} voided`, reason });
  return getExpense(ctx, e.id);
}

export async function getExpense(ctx: AccountingCtx, id: string) {
  return toExpenseDto(await loadExpense(ctx, id));
}

const EXPENSE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "paid",
  "void",
] as const;
type ExpenseStatusValue = (typeof EXPENSE_STATUSES)[number];

export async function listExpenses(
  ctx: AccountingCtx,
  q: { status?: string; categoryId?: string; mine?: boolean; from?: Date; to?: Date; cursor?: string; limit?: number }
) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const canSeeAll = ctxHas(ctx, "accounting:expenses_read") || ctxHas(ctx, "accounting:expenses_approve") || ctxHas(ctx, "accounting:expenses_write");
  const where: Prisma.ExpenseWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
    ...(!canSeeAll || q.mine ? { createdById: ctx.actorId ?? "__none__" } : {}),
  };
  if (q.status) {
    if (!(EXPENSE_STATUSES as readonly string[]).includes(q.status)) {
      throw acctError(ACCT.VALIDATION, {
        fields: { status: "Must be draft, submitted, approved, rejected, paid, or void" },
      });
    }
    where.status = q.status as ExpenseStatusValue;
  }
  if (q.categoryId && isValidId(q.categoryId)) where.categoryId = q.categoryId;
  if (q.from || q.to) where.expenseDate = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  const rows = await prisma.expense.findMany({
    where,
    include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const total = await prisma.expense.aggregate({ where, _sum: { amount: true } });
  return {
    items: page.map((e) => toExpenseDto(e)),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    totalAmount: toApiString(total._sum.amount ?? ZERO),
  };
}
