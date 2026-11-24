/**
 * Supplier bills and supplier credit notes.
 */
import type { Prisma, SupplierBill, SupplierBillLine } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { computeTax } from "@/lib/accounting/taxCodes";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import { needsApproval, requestApproval, markApprovalDecided, assertNotSelfApproval } from "@/lib/accounting/approvals";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postSupplierBill } from "@/lib/accounting/posting/payables";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import { recordInventoryMovement } from "@/lib/accounting/inventory/movements";
import { flushAccountingQueueSoon } from "@/lib/accounting/postingQueue";
import { loadSupplier } from "@/lib/accounting/payables/suppliers";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export function toBillDto(b: SupplierBill & { lines?: SupplierBillLine[]; supplier?: { name: string } | null }) {
  return {
    id: b.id,
    number: b.number,
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    kind: b.kind,
    status: b.status,
    supplierId: b.supplierId,
    supplierName: b.supplier?.name ?? null,
    locationId: b.locationId,
    billDate: b.billDate.toISOString(),
    dueDate: b.dueDate.toISOString(),
    currency: b.currency,
    exchangeRate: D(b.exchangeRate).toString(),
    subtotal: toApiString(b.subtotal),
    taxTotal: toApiString(b.taxTotal),
    total: toApiString(b.total),
    amountPaid: toApiString(b.amountPaid),
    amountDue: toApiString(b.amountDue),
    purchaseOrderId: b.purchaseOrderId,
    appliesToBillId: b.appliesToBillId,
    expenseId: b.expenseId,
    journalEntryId: b.journalEntryId,
    attachments: b.attachments ?? [],
    notes: b.notes,
    approvedById: b.approvedById,
    approvedAt: b.approvedAt?.toISOString() ?? null,
    postedAt: b.postedAt?.toISOString() ?? null,
    voidedAt: b.voidedAt?.toISOString() ?? null,
    voidReason: b.voidReason,
    createdById: b.createdById,
    lines:
      b.lines?.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        ledgerAccountId: l.ledgerAccountId,
        posProductId: l.posProductId,
        shopProductId: l.shopProductId,
        purchaseOrderLineId: l.purchaseOrderLineId,
        qty: D(l.qty).toString(),
        unitCost: D(l.unitCost).toFixed(4),
        taxCodeId: l.taxCodeId,
        taxAmount: toApiString(l.taxAmount),
        lineTotal: toApiString(l.lineTotal),
        locationId: l.locationId,
      })) ?? [],
    createdAt: b.createdAt.toISOString(),
  };
}

const billLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    ledgerAccountId: z.string().nullable().optional(),
    posProductId: z.string().nullable().optional(),
    shopProductId: z.string().nullable().optional(),
    purchaseOrderLineId: z.string().nullable().optional(),
    qty: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    unitCost: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    taxCodeId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
  })
  .strict();

const attachmentSchema = z.object({ url: z.string().url(), name: z.string().max(200).optional(), publicId: z.string().max(300).optional() }).strict();

export const billSchema = z
  .object({
    supplierId: z.string().min(1),
    locationId: z.string().nullable().optional(),
    supplierInvoiceNumber: z.string().trim().max(100).nullable().optional(),
    kind: z.enum(["bill", "credit_note"]).default("bill"),
    billDate: z.string().min(10),
    dueDate: z.string().min(10).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    exchangeRate: z.union([z.string(), z.number()]).optional(),
    purchaseOrderId: z.string().nullable().optional(),
    appliesToBillId: z.string().nullable().optional(),
    taxInclusive: z.boolean().optional(),
    attachments: z.array(attachmentSchema).max(20).optional(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z.array(billLineSchema).min(1).max(200),
  })
  .strict();

async function buildBillLines(ctx: AccountingCtx, input: z.infer<typeof billSchema>, locationId: string | null) {
  let subtotal = ZERO;
  let taxTotal = ZERO;
  const lines: Prisma.SupplierBillLineCreateManyBillInput[] = [];
  const poLines = input.purchaseOrderId
    ? await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: input.purchaseOrderId, orgId: ctx.orgId } })
    : [];
  for (const [i, l] of input.lines.entries()) {
    if (!l.qty.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.qty`]: "Must be > 0" } });
    if (l.unitCost.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.unitCost`]: "Must be ≥ 0" } });
    const refs = [l.posProductId, l.shopProductId, l.ledgerAccountId].filter(Boolean).length;
    if (refs !== 1) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}`]: "Pick exactly one product or account" } });
    if (l.purchaseOrderLineId && !poLines.some((p) => p.id === l.purchaseOrderLineId)) {
      throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.purchaseOrderLineId`]: "Not on this purchase order" } });
    }
    if (l.ledgerAccountId) {
      const a = await prisma.ledgerAccount.findFirst({ where: { id: l.ledgerAccountId, orgId: ctx.orgId } });
      if (!a || a.isHeader || a.archivedAt || (a.type !== "expense" && a.type !== "asset")) {
        throw acctError(ACCT.MAPPING_TYPE_INVALID, { fields: { [`lines.${i}.ledgerAccountId`]: "Choose an expense or asset account" } });
      }
      if (a.systemKey === "accounts_receivable" || a.subtype === "receivable") throw acctError(ACCT.CONTROL_ACCOUNT);
    }
    if (l.posProductId) {
      const p = await prisma.posProduct.findFirst({ where: { id: l.posProductId, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.posProductId`]: "Unknown product" } });
    }
    if (l.shopProductId) {
      const p = await prisma.product.findFirst({ where: { id: l.shopProductId, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.shopProductId`]: "Unknown product" } });
    }
    const tax = l.taxCodeId ? await prisma.taxCode.findFirst({ where: { id: l.taxCodeId, orgId: ctx.orgId, isActive: true } }) : null;
    if (l.taxCodeId && !tax) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.taxCodeId`]: "Unknown tax code" } });
    const lineLoc = l.locationId ? await assertLocationWritable(ctx, l.locationId) : locationId;
    const t = computeTax(round2(l.qty.mul(l.unitCost)), tax, Boolean(input.taxInclusive));
    subtotal = subtotal.add(t.net);
    taxTotal = taxTotal.add(t.tax);
    lines.push({
      orgId: ctx.orgId,
      lineNo: i + 1,
      description: l.description,
      ledgerAccountId: l.ledgerAccountId ?? null,
      posProductId: l.posProductId ?? null,
      shopProductId: l.shopProductId ?? null,
      purchaseOrderLineId: l.purchaseOrderLineId ?? null,
      qty: l.qty,
      unitCost: l.unitCost,
      taxCodeId: tax?.id ?? null,
      taxAmount: t.tax,
      lineTotal: t.net,
      locationId: lineLoc,
    });
  }
  return { lines, subtotal: round2(subtotal), taxTotal: round2(taxTotal), total: round2(subtotal.add(taxTotal)) };
}

async function loadBill(ctx: AccountingCtx, id: string, db: Db = prisma) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const b = await db.supplierBill.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { lines: { orderBy: { lineNo: "asc" } }, supplier: { select: { name: true } } },
  });
  if (!b) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, b.locationId)) throw acctError(ACCT.NOT_FOUND);
  return b;
}

async function assertNoDuplicateInvoice(ctx: AccountingCtx, supplierId: string, number: string | null | undefined, excludeId?: string) {
  if (!number) return;
  const dup = await prisma.supplierBill.findFirst({
    where: { orgId: ctx.orgId, supplierId, supplierInvoiceNumber: number, status: { not: "void" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, number: true },
  });
  if (dup) throw acctError(ACCT.DUPLICATE_SUPPLIER_INVOICE, { details: dup });
}

export async function createBill(ctx: AccountingCtx, raw: unknown, db?: Db) {
  const input = billSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const supplier = await loadSupplier(ctx, input.supplierId);
  if (supplier.archivedAt || !supplier.isActive) throw acctError(ACCT.SUPPLIER_ARCHIVED);
  await assertNoDuplicateInvoice(ctx, supplier.id, input.supplierInvoiceNumber);
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, orgId: ctx.orgId, supplierId: supplier.id } });
    if (!po) throw acctError(ACCT.NOT_FOUND, { fields: { purchaseOrderId: "Unknown purchase order for this supplier" } });
    if (po.status === "cancelled") throw acctError(ACCT.PO_CLOSED);
  }
  if (input.kind === "credit_note") {
    if (!input.appliesToBillId) throw acctError(ACCT.VALIDATION, { fields: { appliesToBillId: "Required for a credit note" } });
    const target = await loadBill(ctx, input.appliesToBillId);
    if (target.supplierId !== supplier.id) throw acctError(ACCT.ALLOCATION_PARTY_MISMATCH);
    if (!["posted", "partially_paid"].includes(target.status)) throw acctError(ACCT.BILL_NOT_APPROVED);
  }
  const currency = input.currency ?? supplier.currency ?? settings.baseCurrency;
  const rate = currency === settings.baseCurrency ? D(1) : D(String(input.exchangeRate ?? 0));
  if (!rate.greaterThan(0)) throw acctError(ACCT.FX_RATE_REQUIRED);
  const billDate = parseDateInput(input.billDate, settings.timezone, "billDate");
  const terms = supplier.paymentTermsDays ?? settings.defaultPaymentTermsDays;
  const dueDate = input.dueDate ? parseDateInput(input.dueDate, settings.timezone, "dueDate") : new Date(billDate.getTime() + terms * 86_400_000);
  if (dueDate < billDate) throw acctError(ACCT.VALIDATION, { fields: { dueDate: "Due date must be on or after the bill date" } });
  const built = await buildBillLines(ctx, input, locationId);
  if (input.kind === "credit_note") {
    const target = await prisma.supplierBill.findUniqueOrThrow({ where: { id: input.appliesToBillId! } });
    if (built.total.greaterThan(D(target.amountDue))) throw acctError(ACCT.OVERALLOCATION, { details: { amountDue: toApiString(target.amountDue) } });
  }
  const run = async (tx: Db) => {
    const number = await nextNumber(tx, ctx.orgId, "bill");
    return tx.supplierBill.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        supplierId: supplier.id,
        number,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        kind: input.kind,
        billDate,
        dueDate,
        currency,
        exchangeRate: rate,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        total: built.total,
        amountDue: built.total,
        purchaseOrderId: input.purchaseOrderId ?? null,
        appliesToBillId: input.kind === "credit_note" ? input.appliesToBillId : null,
        attachments: input.attachments ?? undefined,
        notes: input.notes ?? null,
        createdById: ctx.actorId ?? "system",
        lines: { createMany: { data: built.lines } },
      },
    });
  };
  const created = db ? await run(db) : await prisma.$transaction((tx) => run(tx));
  recordAccountingAudit(ctx, { action: "bill.create", entityType: "SupplierBill", entityId: created.id, description: `${input.kind === "credit_note" ? "Supplier credit note" : "Bill"} ${created.number} drafted` });
  return db ? toBillDto(created) : getBill(ctx, created.id);
}

export async function updateBill(ctx: AccountingCtx, id: string, raw: unknown) {
  const b = await loadBill(ctx, id);
  if (b.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE, { message: "Only draft bills can be edited" });
  const input = billSchema.parse(raw);
  if (input.kind !== b.kind) throw acctError(ACCT.INVOICE_KIND_LOCKED);
  const settings = await requireAccountingSettings(ctx.orgId);
  const supplier = await loadSupplier(ctx, input.supplierId);
  await assertNoDuplicateInvoice(ctx, supplier.id, input.supplierInvoiceNumber, b.id);
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  const built = await buildBillLines(ctx, input, locationId);
  const billDate = parseDateInput(input.billDate, settings.timezone, "billDate");
  const dueDate = input.dueDate
    ? parseDateInput(input.dueDate, settings.timezone, "dueDate")
    : new Date(billDate.getTime() + (supplier.paymentTermsDays ?? settings.defaultPaymentTermsDays) * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.supplierBillLine.deleteMany({ where: { billId: b.id } });
    await tx.supplierBill.update({
      where: { id: b.id },
      data: {
        supplierId: supplier.id,
        locationId,
        supplierInvoiceNumber: input.supplierInvoiceNumber ?? null,
        billDate,
        dueDate,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        total: built.total,
        amountDue: built.total,
        attachments: input.attachments ?? undefined,
        notes: input.notes ?? null,
        lines: { createMany: { data: built.lines } },
      },
    });
  });
  recordAccountingAudit(ctx, { action: "bill.update", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} edited` });
  return getBill(ctx, b.id);
}

export async function submitBill(ctx: AccountingCtx, id: string) {
  const b = await loadBill(ctx, id);
  if (b.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  const total = D(b.total).mul(D(b.exchangeRate));
  await prisma.$transaction(async (tx) => {
    if (needsApproval(settings, "supplier_bill", total)) {
      await tx.supplierBill.update({ where: { id: b.id }, data: { status: "pending_approval", submittedById: ctx.actorId } });
      await requestApproval(tx, { orgId: ctx.orgId, entity: "supplier_bill", entityId: b.id, amount: total, requestedById: ctx.actorId ?? "system", locationId: b.locationId });
    } else {
      await tx.supplierBill.update({ where: { id: b.id }, data: { status: "approved", submittedById: ctx.actorId, approvedAt: new Date(), approvedById: ctx.actorId } });
    }
  });
  recordAccountingAudit(ctx, { action: "bill.submit", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} submitted` });
  return getBill(ctx, b.id);
}

export async function approveBill(ctx: AccountingCtx, id: string) {
  const b = await loadBill(ctx, id);
  if (b.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  assertNotSelfApproval(settings, b.submittedById ?? b.createdById, ctx.actorId);
  const res = await prisma.supplierBill.updateMany({
    where: { id: b.id, status: "pending_approval" },
    data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId },
  });
  if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "supplier_bill", entityId: b.id, status: "approved", actorId: ctx.actorId });
  recordAccountingAudit(ctx, { action: "bill.approve", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} approved` });
  return getBill(ctx, b.id);
}

export async function rejectBill(ctx: AccountingCtx, id: string, reason: string) {
  const b = await loadBill(ctx, id);
  if (b.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await prisma.supplierBill.update({ where: { id: b.id }, data: { status: "draft" } });
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "supplier_bill", entityId: b.id, status: "rejected", actorId: ctx.actorId, reason });
  recordAccountingAudit(ctx, { action: "bill.reject", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} rejected`, reason });
  return getBill(ctx, b.id);
}

/** amountPaid = posted payment allocations + posted credit notes applied. */
export async function recomputeBillBalance(db: Db, billId: string): Promise<void> {
  const b = await db.supplierBill.findUnique({ where: { id: billId } });
  if (!b || b.kind !== "bill" || !["posted", "partially_paid", "paid"].includes(b.status)) return;
  const [alloc, credits] = await Promise.all([
    db.supplierPaymentAllocation.aggregate({ where: { billId, payment: { status: "posted" } }, _sum: { amount: true } }),
    db.supplierBill.aggregate({ where: { appliesToBillId: billId, kind: "credit_note", status: { in: ["posted", "paid"] } }, _sum: { total: true } }),
  ]);
  const paid = round2(D(alloc._sum.amount ?? 0).add(D(credits._sum.total ?? 0)));
  const due = round2(D(b.total).sub(paid));
  await db.supplierBill.update({
    where: { id: billId },
    data: {
      amountPaid: paid,
      amountDue: due.greaterThan(0) ? due : ZERO,
      status: !due.greaterThan(0) ? "paid" : paid.greaterThan(0) ? "partially_paid" : "posted",
    },
  });
}

export async function postBill(ctx: AccountingCtx, id: string, db?: Db) {
  const b = await loadBill(ctx, id, db ?? prisma);
  if (["posted", "partially_paid", "paid"].includes(b.status)) throw acctError(ACCT.ALREADY_POSTED);
  const settings = await requireAccountingSettings(ctx.orgId);
  const total = D(b.total).mul(D(b.exchangeRate));
  const needs = needsApproval(settings, "supplier_bill", total);
  if (b.status === "pending_approval" || (needs && b.status !== "approved")) throw acctError(ACCT.BILL_NOT_APPROVED);
  if (b.status !== "draft" && b.status !== "approved") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const run = async (tx: Db) => {
    const res = await tx.supplierBill.updateMany({
      where: { id: b.id, status: b.status },
      data: { status: "posted", postedAt: new Date() },
    });
    if (res.count === 0) throw acctError(ACCT.ALREADY_POSTED);
    const sign = b.kind === "credit_note" ? -1 : 1;
    for (const l of b.lines) {
      if (l.purchaseOrderLineId) {
        const pol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.purchaseOrderLineId } });
        await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { qtyBilled: D(pol.qtyBilled).add(D(l.qty).mul(sign)) } });
      } else if (l.posProductId || l.shopProductId) {
        await recordInventoryMovement(tx, {
          orgId: ctx.orgId,
          productRef: l.posProductId ? { posProductId: l.posProductId } : { shopProductId: l.shopProductId! },
          kind: sign === 1 ? "purchase_receipt" : "supplier_return",
          qty: D(l.qty).mul(sign),
          unitCost: D(l.unitCost).mul(D(b.exchangeRate)),
          sourceType: "supplier_bill",
          sourceId: `${b.id}:${l.id}`,
          reason: `${b.kind === "credit_note" ? "Returned on" : "Received on"} ${b.number}`,
          actorId: ctx.actorId,
        });
      }
    }
    const pc = await createPostingContext(tx as Prisma.TransactionClient, settings);
    const entry = await postSupplierBill(pc, b.id);
    await tx.supplierBill.update({ where: { id: b.id }, data: { journalEntryId: entry?.id ?? null } });
    if (b.kind === "credit_note" && b.appliesToBillId) {
      await tx.supplierBill.update({ where: { id: b.id }, data: { status: "paid", amountDue: ZERO, amountPaid: b.total } });
      await recomputeBillBalance(tx, b.appliesToBillId);
    }
    if (b.expenseId) {
      await tx.expense.updateMany({ where: { id: b.expenseId, orgId: ctx.orgId }, data: { journalEntryId: entry?.id ?? null } });
    }
  };
  if (db) await run(db);
  else await prisma.$transaction((tx) => run(tx), { timeout: 60_000 });
  flushAccountingQueueSoon(ctx.orgId);
  recordAccountingAudit(ctx, { action: "bill.post", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} posted` });
  return db ? null : getBill(ctx, b.id);
}

export async function voidBill(ctx: AccountingCtx, id: string, reason: string) {
  const b = await loadBill(ctx, id);
  if (b.status === "void") throw acctError(ACCT.ALREADY_REVERSED);
  const allocations = await prisma.supplierPaymentAllocation.count({ where: { billId: b.id, payment: { status: "posted" } } });
  const credits = await prisma.supplierBill.count({ where: { appliesToBillId: b.id, status: { in: ["posted", "paid"] } } });
  if (allocations > 0 || credits > 0) throw acctError(ACCT.INVOICE_HAS_PAYMENTS, { message: "Void the supplier payments and credit notes first" });
  const posted = ["posted", "partially_paid", "paid"].includes(b.status);
  await prisma.$transaction(async (tx) => {
    if (posted) {
      await reverseSystemEntry(tx, ctx.orgId, `supplier_bill:${b.id}:${b.kind === "credit_note" ? "credit_note" : "post"}`, { reason, actorId: ctx.actorId });
      const sign = b.kind === "credit_note" ? -1 : 1;
      for (const l of b.lines) {
        if (l.purchaseOrderLineId) {
          const pol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.purchaseOrderLineId } });
          await tx.purchaseOrderLine.update({ where: { id: pol.id }, data: { qtyBilled: D(pol.qtyBilled).sub(D(l.qty).mul(sign)) } });
        } else if (l.posProductId || l.shopProductId) {
          await recordInventoryMovement(tx, {
            orgId: ctx.orgId,
            productRef: l.posProductId ? { posProductId: l.posProductId } : { shopProductId: l.shopProductId! },
            kind: sign === 1 ? "supplier_return" : "purchase_receipt",
            qty: D(l.qty).mul(-sign),
            unitCost: D(l.unitCost).mul(D(b.exchangeRate)),
            sourceType: "supplier_bill",
            sourceId: `void:${b.id}:${l.id}`,
            reason: `Void of ${b.number}`,
            actorId: ctx.actorId,
          });
        }
      }
    }
    await tx.supplierBill.update({
      where: { id: b.id },
      data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500), amountDue: ZERO },
    });
    await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "supplier_bill", entityId: b.id, status: "cancelled", actorId: ctx.actorId });
    if (b.kind === "credit_note" && b.appliesToBillId) await recomputeBillBalance(tx, b.appliesToBillId);
  });
  recordAccountingAudit(ctx, { action: "bill.void", entityType: "SupplierBill", entityId: b.id, description: `Bill ${b.number} voided`, reason });
  return getBill(ctx, b.id);
}

export async function createBillCreditNote(ctx: AccountingCtx, billId: string, raw: unknown) {
  const b = await loadBill(ctx, billId);
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return createBill(ctx, {
    ...body,
    supplierId: b.supplierId,
    locationId: b.locationId,
    kind: "credit_note",
    appliesToBillId: b.id,
    currency: b.currency,
    ...(D(b.exchangeRate).equals(1) ? {} : { exchangeRate: D(b.exchangeRate).toString() }),
  });
}

export async function getBill(ctx: AccountingCtx, id: string) {
  const b = await loadBill(ctx, id);
  const [allocations, credits] = await Promise.all([
    prisma.supplierPaymentAllocation.findMany({ where: { billId: b.id }, include: { payment: { select: { id: true, number: true, paymentDate: true, status: true } } } }),
    prisma.supplierBill.findMany({ where: { appliesToBillId: b.id }, select: { id: true, number: true, total: true, status: true } }),
  ]);
  return {
    ...toBillDto(b),
    payments: allocations.map((a) => ({ paymentId: a.paymentId, number: a.payment.number, date: a.payment.paymentDate.toISOString(), status: a.payment.status, amount: toApiString(a.amount) })),
    creditNotes: credits.map((c) => ({ id: c.id, number: c.number, total: toApiString(c.total), status: c.status })),
  };
}

export async function listBills(
  ctx: AccountingCtx,
  q: { status?: string; supplierId?: string; dueBefore?: Date; overdue?: boolean; cursor?: string; limit?: number; q?: string }
) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: Prisma.SupplierBillWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (q.status) where.status = q.status as never;
  if (q.supplierId && isValidId(q.supplierId)) where.supplierId = q.supplierId;
  if (q.dueBefore) where.dueDate = { lte: q.dueBefore };
  if (q.overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { in: ["posted", "partially_paid"] };
  }
  if (q.q) where.OR = [{ number: { contains: q.q, mode: "insensitive" } }, { supplierInvoiceNumber: { contains: q.q, mode: "insensitive" } }];
  const rows = await prisma.supplierBill.findMany({
    where,
    include: { supplier: { select: { name: true } } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map((b) => toBillDto(b)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}
