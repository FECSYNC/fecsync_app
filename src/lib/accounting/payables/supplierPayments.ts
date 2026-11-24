/**
 * Supplier payments with allocations to posted bills.
 */
import type { Prisma, SupplierPayment } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { isLocationVisible } from "@/lib/accounting/scope";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import { needsApproval, requestApproval, markApprovalDecided, assertNotSelfApproval } from "@/lib/accounting/approvals";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postSupplierPayment } from "@/lib/accounting/posting/payables";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import { recomputeBillBalance } from "@/lib/accounting/payables/bills";
import { loadSupplier } from "@/lib/accounting/payables/suppliers";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export function toSupplierPaymentDto(
  p: SupplierPayment & { allocations?: Array<{ billId: string; amount: Prisma.Decimal; bill?: { number: string } | null }>; supplier?: { name: string } | null }
) {
  return {
    id: p.id,
    number: p.number,
    supplierId: p.supplierId,
    supplierName: p.supplier?.name ?? null,
    locationId: p.locationId,
    paymentDate: p.paymentDate.toISOString(),
    method: p.method,
    bankAccountId: p.bankAccountId,
    amount: toApiString(p.amount),
    unappliedAmount: toApiString(p.unappliedAmount),
    currency: p.currency,
    exchangeRate: D(p.exchangeRate).toString(),
    reference: p.reference,
    status: p.status,
    journalEntryId: p.journalEntryId,
    approvedById: p.approvedById,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    voidedAt: p.voidedAt?.toISOString() ?? null,
    voidReason: p.voidReason,
    remittanceSentAt: p.remittanceSentAt?.toISOString() ?? null,
    createdById: p.createdById,
    allocations: p.allocations?.map((a) => ({ billId: a.billId, billNumber: a.bill?.number ?? null, amount: toApiString(a.amount) })) ?? [],
    createdAt: p.createdAt.toISOString(),
  };
}

export const supplierPaymentSchema = z
  .object({
    supplierId: z.string().min(1),
    bankAccountId: z.string().min(1),
    paymentDate: z.string().min(10),
    method: z.enum(["bank_transfer", "cash", "card", "cheque", "mobile_money", "other"]),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    exchangeRate: z.union([z.string(), z.number()]).optional(),
    reference: z.string().trim().max(200).nullable().optional(),
    allocations: z
      .array(z.object({ billId: z.string().min(1), amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))) }).strict())
      .max(200)
      .default([]),
  })
  .strict();

async function loadPayment(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const p = await prisma.supplierPayment.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { allocations: { include: { bill: { select: { number: true } } } }, supplier: { select: { name: true, email: true } } },
  });
  if (!p) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, p.locationId)) throw acctError(ACCT.NOT_FOUND);
  return p;
}

export async function createSupplierPayment(ctx: AccountingCtx, raw: unknown) {
  const input = supplierPaymentSchema.parse(raw);
  if (!input.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { amount: "Must be > 0" } });
  const settings = await requireAccountingSettings(ctx.orgId);
  const supplier = await loadSupplier(ctx, input.supplierId);
  const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: ctx.orgId, archivedAt: null, isActive: true } });
  if (!bank || !isLocationVisible(ctx.scope, bank.locationId)) throw acctError(ACCT.NOT_FOUND, { fields: { bankAccountId: "Unknown bank account" } });
  const currency = input.currency ?? settings.baseCurrency;
  const rate = currency === settings.baseCurrency ? D(1) : D(String(input.exchangeRate ?? 0));
  if (!rate.greaterThan(0)) throw acctError(ACCT.FX_RATE_REQUIRED);
  let allocated = ZERO;
  for (const a of input.allocations) {
    if (!a.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { allocations: "Amounts must be > 0" } });
    const bill = await prisma.supplierBill.findFirst({ where: { id: a.billId, orgId: ctx.orgId } });
    if (!bill) throw acctError(ACCT.NOT_FOUND, { fields: { allocations: "Unknown bill" } });
    if (bill.supplierId !== supplier.id) throw acctError(ACCT.ALLOCATION_PARTY_MISMATCH);
    if (bill.kind !== "bill" || !["posted", "partially_paid"].includes(bill.status)) throw acctError(ACCT.BILL_NOT_APPROVED);
    if (bill.currency !== currency) throw acctError(ACCT.CURRENCY_MISMATCH);
    if (a.amount.greaterThan(D(bill.amountDue))) throw acctError(ACCT.OVERALLOCATION, { details: { billId: bill.id, amountDue: toApiString(bill.amountDue) } });
    allocated = allocated.add(a.amount);
  }
  if (allocated.greaterThan(input.amount)) throw acctError(ACCT.OVERALLOCATION);
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "supplier_payment");
    return tx.supplierPayment.create({
      data: {
        orgId: ctx.orgId,
        locationId: bank.locationId,
        supplierId: supplier.id,
        number,
        paymentDate: parseDateInput(input.paymentDate, settings.timezone, "paymentDate"),
        method: input.method,
        bankAccountId: bank.id,
        amount: round2(input.amount),
        unappliedAmount: round2(input.amount.sub(allocated)),
        currency,
        exchangeRate: rate,
        reference: input.reference ?? null,
        status: "draft",
        createdById: ctx.actorId ?? "system",
        allocations: {
          createMany: { data: input.allocations.map((a) => ({ orgId: ctx.orgId, billId: a.billId, amount: round2(a.amount) })) },
        },
      },
    });
  });
  recordAccountingAudit(ctx, { action: "supplier_payment.create", entityType: "SupplierPayment", entityId: created.id, description: `Supplier payment ${created.number} drafted` });
  const amountBase = D(created.amount).mul(rate);
  if (needsApproval(settings, "supplier_payment", amountBase)) {
    await prisma.$transaction(async (tx) => {
      await tx.supplierPayment.update({ where: { id: created.id }, data: { status: "pending_approval" } });
      await requestApproval(tx, { orgId: ctx.orgId, entity: "supplier_payment", entityId: created.id, amount: amountBase, requestedById: ctx.actorId ?? "system", locationId: created.locationId });
    });
  } else {
    await prisma.supplierPayment.update({ where: { id: created.id }, data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId } });
  }
  return getSupplierPayment(ctx, created.id);
}

export async function approveSupplierPayment(ctx: AccountingCtx, id: string) {
  const p = await loadPayment(ctx, id);
  if (p.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  assertNotSelfApproval(settings, p.createdById, ctx.actorId);
  const res = await prisma.supplierPayment.updateMany({
    where: { id: p.id, status: "pending_approval" },
    data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId },
  });
  if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "supplier_payment", entityId: p.id, status: "approved", actorId: ctx.actorId });
  recordAccountingAudit(ctx, { action: "supplier_payment.approve", entityType: "SupplierPayment", entityId: p.id, description: `Supplier payment ${p.number} approved` });
  return getSupplierPayment(ctx, p.id);
}

export async function rejectSupplierPayment(ctx: AccountingCtx, id: string, reason: string) {
  const p = await loadPayment(ctx, id);
  if (p.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await prisma.supplierPayment.update({ where: { id: p.id }, data: { status: "void", voidedAt: new Date(), voidReason: `Rejected: ${reason}`.slice(0, 500) } });
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "supplier_payment", entityId: p.id, status: "rejected", actorId: ctx.actorId, reason });
  recordAccountingAudit(ctx, { action: "supplier_payment.reject", entityType: "SupplierPayment", entityId: p.id, description: `Supplier payment ${p.number} rejected`, reason });
  return getSupplierPayment(ctx, p.id);
}

export async function postSupplierPaymentDoc(ctx: AccountingCtx, id: string) {
  const p = await loadPayment(ctx, id);
  if (p.status === "posted") throw acctError(ACCT.ALREADY_POSTED);
  if (p.status !== "approved") throw acctError(ACCT.APPROVAL_REQUIRED);
  const settings = await requireAccountingSettings(ctx.orgId);
  await prisma.$transaction(async (tx) => {
    for (const a of p.allocations) {
      const bill = await tx.supplierBill.findUniqueOrThrow({ where: { id: a.billId } });
      if (D(a.amount).greaterThan(D(bill.amountDue))) throw acctError(ACCT.OVERALLOCATION, { details: { billId: bill.id } });
    }
    const res = await tx.supplierPayment.updateMany({ where: { id: p.id, status: "approved" }, data: { status: "posted" } });
    if (res.count === 0) throw acctError(ACCT.ALREADY_POSTED);
    const pc = await createPostingContext(tx, settings);
    const entry = await postSupplierPayment(pc, p.id);
    await tx.supplierPayment.update({ where: { id: p.id }, data: { journalEntryId: entry?.id ?? null } });
    for (const a of p.allocations) await recomputeBillBalance(tx, a.billId);
  });
  recordAccountingAudit(ctx, { action: "supplier_payment.post", entityType: "SupplierPayment", entityId: p.id, description: `Supplier payment ${p.number} posted` });
  void import("@/lib/accounting/notifications")
    .then((n) => n.notifySupplierRemittance(p.id))
    .catch(() => undefined);
  return getSupplierPayment(ctx, p.id);
}

export async function voidSupplierPayment(ctx: AccountingCtx, id: string, reason: string) {
  const p = await loadPayment(ctx, id);
  if (p.status === "void") throw acctError(ACCT.ALREADY_REVERSED);
  await prisma.$transaction(async (tx) => {
    if (p.status === "posted") await reverseSystemEntry(tx, ctx.orgId, `supplier_payment:${p.id}:post`, { reason, actorId: ctx.actorId });
    await tx.supplierPayment.update({ where: { id: p.id }, data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500) } });
    await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "supplier_payment", entityId: p.id, status: "cancelled", actorId: ctx.actorId });
    for (const a of p.allocations) await recomputeBillBalance(tx, a.billId);
  });
  recordAccountingAudit(ctx, { action: "supplier_payment.void", entityType: "SupplierPayment", entityId: p.id, description: `Supplier payment ${p.number} voided`, reason });
  return getSupplierPayment(ctx, p.id);
}

/** Remittance data (email delivery is Step 2). */
export async function remittanceData(ctx: AccountingCtx, id: string) {
  const p = await loadPayment(ctx, id);
  return { payment: toSupplierPaymentDto(p), supplierEmail: p.supplier.email };
}

export async function markRemittanceSent(db: Db, paymentId: string) {
  await db.supplierPayment.update({ where: { id: paymentId }, data: { remittanceSentAt: new Date() } });
}

export async function getSupplierPayment(ctx: AccountingCtx, id: string) {
  return toSupplierPaymentDto(await loadPayment(ctx, id));
}

export async function listSupplierPayments(ctx: AccountingCtx, q: { status?: string; supplierId?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: Prisma.SupplierPaymentWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (q.status) where.status = q.status as never;
  if (q.supplierId && isValidId(q.supplierId)) where.supplierId = q.supplierId;
  const rows = await prisma.supplierPayment.findMany({
    where,
    include: { allocations: { include: { bill: { select: { number: true } } } }, supplier: { select: { name: true } } },
    orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map((p) => toSupplierPaymentDto(p)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}
