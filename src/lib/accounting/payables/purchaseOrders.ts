/**
 * Purchase orders: draft → (approval) → approved → sent → receive → bill.
 * Receiving moves stock (recordInventoryMovement) and posts Dr inventory / Cr GRNI.
 */
import type { PurchaseOrder, PurchaseOrderLine, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { computeTax } from "@/lib/accounting/taxCodes";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import { needsApproval, requestApproval, markApprovalDecided, assertNotSelfApproval } from "@/lib/accounting/approvals";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postPurchaseReceipt } from "@/lib/accounting/posting/payables";
import { recordInventoryMovement } from "@/lib/accounting/inventory/movements";
import { flushAccountingQueueSoon } from "@/lib/accounting/postingQueue";
import { loadSupplier } from "@/lib/accounting/payables/suppliers";
import type { AccountingCtx } from "@/lib/accounting/types";

export function toPoDto(po: PurchaseOrder & { lines?: PurchaseOrderLine[]; supplier?: { name: string } | null }) {
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    supplierId: po.supplierId,
    supplierName: po.supplier?.name ?? null,
    locationId: po.locationId,
    orderDate: po.orderDate.toISOString(),
    expectedDate: po.expectedDate?.toISOString() ?? null,
    currency: po.currency,
    exchangeRate: D(po.exchangeRate).toString(),
    subtotal: toApiString(po.subtotal),
    taxTotal: toApiString(po.taxTotal),
    total: toApiString(po.total),
    notes: po.notes,
    approvedById: po.approvedById,
    approvedAt: po.approvedAt?.toISOString() ?? null,
    sentAt: po.sentAt?.toISOString() ?? null,
    closedAt: po.closedAt?.toISOString() ?? null,
    cancelledAt: po.cancelledAt?.toISOString() ?? null,
    cancelReason: po.cancelReason,
    createdById: po.createdById,
    lines:
      po.lines?.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        posProductId: l.posProductId,
        shopProductId: l.shopProductId,
        ledgerAccountId: l.ledgerAccountId,
        description: l.description,
        qty: D(l.qty).toString(),
        qtyReceived: D(l.qtyReceived).toString(),
        qtyBilled: D(l.qtyBilled).toString(),
        unitCost: D(l.unitCost).toFixed(4),
        taxCodeId: l.taxCodeId,
        taxAmount: toApiString(l.taxAmount),
        lineTotal: toApiString(l.lineTotal),
      })) ?? [],
    createdAt: po.createdAt.toISOString(),
  };
}

const poLineSchema = z
  .object({
    posProductId: z.string().nullable().optional(),
    shopProductId: z.string().nullable().optional(),
    ledgerAccountId: z.string().nullable().optional(),
    description: z.string().trim().min(1).max(500),
    qty: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    unitCost: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    taxCodeId: z.string().nullable().optional(),
  })
  .strict();

export const poSchema = z
  .object({
    supplierId: z.string().min(1),
    locationId: z.string().min(1),
    orderDate: z.string().min(10),
    expectedDate: z.string().min(10).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    exchangeRate: z.union([z.string(), z.number()]).optional(),
    notes: z.string().max(2000).nullable().optional(),
    lines: z.array(poLineSchema).min(1).max(200),
  })
  .strict();

async function buildPoLines(ctx: AccountingCtx, locationId: string, lines: z.infer<typeof poLineSchema>[]) {
  let subtotal = ZERO;
  let taxTotal = ZERO;
  const out: Prisma.PurchaseOrderLineCreateManyPurchaseOrderInput[] = [];
  for (const [i, l] of lines.entries()) {
    if (!l.qty.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.qty`]: "Must be > 0" } });
    if (l.unitCost.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.unitCost`]: "Must be ≥ 0" } });
    const refs = [l.posProductId, l.shopProductId, l.ledgerAccountId].filter(Boolean).length;
    if (refs !== 1) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}`]: "Pick exactly one product or account" } });
    if (l.posProductId) {
      const p = await prisma.posProduct.findFirst({ where: { id: l.posProductId, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.posProductId`]: "Unknown product" } });
      if (p.locationId !== locationId) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE, { fields: { [`lines.${i}.posProductId`]: "Product belongs to another venue" } });
    }
    if (l.shopProductId) {
      const p = await prisma.product.findFirst({ where: { id: l.shopProductId, orgId: ctx.orgId } });
      if (!p) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.shopProductId`]: "Unknown product" } });
    }
    if (l.ledgerAccountId) {
      const a = await prisma.ledgerAccount.findFirst({ where: { id: l.ledgerAccountId, orgId: ctx.orgId } });
      if (!a || a.isHeader || (a.type !== "expense" && a.type !== "asset")) {
        throw acctError(ACCT.MAPPING_TYPE_INVALID, { fields: { [`lines.${i}.ledgerAccountId`]: "Choose an expense or asset account" } });
      }
    }
    const tax = l.taxCodeId ? await prisma.taxCode.findFirst({ where: { id: l.taxCodeId, orgId: ctx.orgId, isActive: true } }) : null;
    if (l.taxCodeId && !tax) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.taxCodeId`]: "Unknown tax code" } });
    const t = computeTax(round2(l.qty.mul(l.unitCost)), tax, false);
    subtotal = subtotal.add(t.net);
    taxTotal = taxTotal.add(t.tax);
    out.push({
      orgId: ctx.orgId,
      lineNo: i + 1,
      posProductId: l.posProductId ?? null,
      shopProductId: l.shopProductId ?? null,
      ledgerAccountId: l.ledgerAccountId ?? null,
      description: l.description,
      qty: l.qty,
      unitCost: l.unitCost,
      taxCodeId: tax?.id ?? null,
      taxAmount: t.tax,
      lineTotal: t.net,
    });
  }
  return { lines: out, subtotal: round2(subtotal), taxTotal: round2(taxTotal), total: round2(subtotal.add(taxTotal)) };
}

async function loadPo(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { lines: { orderBy: { lineNo: "asc" } }, supplier: { select: { name: true, isActive: true, archivedAt: true, email: true } } },
  });
  if (!po) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, po.locationId)) throw acctError(ACCT.NOT_FOUND);
  return po;
}

export async function createPurchaseOrder(ctx: AccountingCtx, raw: unknown) {
  const input = poSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const supplier = await loadSupplier(ctx, input.supplierId);
  if (supplier.archivedAt || !supplier.isActive) throw acctError(ACCT.SUPPLIER_ARCHIVED);
  const locationId = (await assertLocationWritable(ctx, input.locationId))!;
  const currency = input.currency ?? supplier.currency ?? settings.baseCurrency;
  const rate = currency === settings.baseCurrency ? D(1) : D(String(input.exchangeRate ?? 0));
  if (!rate.greaterThan(0)) throw acctError(ACCT.FX_RATE_REQUIRED);
  const built = await buildPoLines(ctx, locationId, input.lines);
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "purchase_order");
    return tx.purchaseOrder.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        supplierId: supplier.id,
        number,
        orderDate: parseDateInput(input.orderDate, settings.timezone, "orderDate"),
        expectedDate: input.expectedDate ? parseDateInput(input.expectedDate, settings.timezone, "expectedDate") : null,
        currency,
        exchangeRate: rate,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        total: built.total,
        notes: input.notes ?? null,
        createdById: ctx.actorId ?? "system",
        lines: { createMany: { data: built.lines } },
      },
    });
  });
  recordAccountingAudit(ctx, { action: "po.create", entityType: "PurchaseOrder", entityId: created.id, description: `PO ${created.number} drafted` });
  return getPurchaseOrder(ctx, created.id);
}

export async function updatePurchaseOrder(ctx: AccountingCtx, id: string, raw: unknown) {
  const po = await loadPo(ctx, id);
  if (po.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE, { message: "Only draft purchase orders can be edited" });
  const input = poSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const supplier = await loadSupplier(ctx, input.supplierId);
  if (supplier.archivedAt) throw acctError(ACCT.SUPPLIER_ARCHIVED);
  const locationId = (await assertLocationWritable(ctx, input.locationId))!;
  const built = await buildPoLines(ctx, locationId, input.lines);
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id } });
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        supplierId: supplier.id,
        locationId,
        orderDate: parseDateInput(input.orderDate, settings.timezone, "orderDate"),
        expectedDate: input.expectedDate ? parseDateInput(input.expectedDate, settings.timezone, "expectedDate") : null,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        total: built.total,
        notes: input.notes ?? null,
        lines: { createMany: { data: built.lines } },
      },
    });
  });
  recordAccountingAudit(ctx, { action: "po.update", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} edited` });
  return getPurchaseOrder(ctx, po.id);
}

export async function submitPurchaseOrder(ctx: AccountingCtx, id: string) {
  const po = await loadPo(ctx, id);
  if (po.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  const total = D(po.total).mul(D(po.exchangeRate));
  await prisma.$transaction(async (tx) => {
    if (needsApproval(settings, "purchase_order", total)) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "pending_approval" } });
      await requestApproval(tx, { orgId: ctx.orgId, entity: "purchase_order", entityId: po.id, amount: total, requestedById: ctx.actorId ?? "system", locationId: po.locationId });
    } else {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId } });
    }
  });
  recordAccountingAudit(ctx, { action: "po.submit", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} submitted` });
  return getPurchaseOrder(ctx, po.id);
}

export async function approvePurchaseOrder(ctx: AccountingCtx, id: string) {
  const po = await loadPo(ctx, id);
  if (po.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId);
  assertNotSelfApproval(settings, po.createdById, ctx.actorId);
  const res = await prisma.purchaseOrder.updateMany({
    where: { id: po.id, status: "pending_approval" },
    data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId },
  });
  if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "purchase_order", entityId: po.id, status: "approved", actorId: ctx.actorId });
  recordAccountingAudit(ctx, { action: "po.approve", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} approved` });
  return getPurchaseOrder(ctx, po.id);
}

export async function rejectPurchaseOrder(ctx: AccountingCtx, id: string, reason: string) {
  const po = await loadPo(ctx, id);
  if (po.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "draft" } });
  await markApprovalDecided(prisma, { orgId: ctx.orgId, entity: "purchase_order", entityId: po.id, status: "rejected", actorId: ctx.actorId, reason });
  recordAccountingAudit(ctx, { action: "po.reject", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} rejected`, reason });
  return getPurchaseOrder(ctx, po.id);
}

/** Marks the PO sent (email delivery is the Step 2 notification). */
export async function markPurchaseOrderSent(ctx: AccountingCtx, id: string) {
  const po = await loadPo(ctx, id);
  if (po.status !== "approved" && po.status !== "sent") throw acctError(ACCT.BILL_NOT_APPROVED);
  const updated = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "sent", sentAt: new Date() } });
  recordAccountingAudit(ctx, { action: "po.send", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} sent` });
  void import("@/lib/accounting/notifications")
    .then((n) => n.notifyPurchaseOrderSent(po.id))
    .catch(() => undefined);
  return { ...(await getPurchaseOrder(ctx, updated.id)), supplierEmail: po.supplier.email };
}

export const receiveSchema = z
  .object({
    receivedDate: z.string().min(10).optional(),
    lines: z
      .array(
        z
          .object({
            lineId: z.string().min(1),
            qty: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
            unitCost: z.union([z.string(), z.number()]).optional().transform((v) => (v == null || v === "" ? null : D(String(v)))),
          })
          .strict()
      )
      .min(1)
      .max(200),
  })
  .strict();

export async function receivePurchaseOrder(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = receiveSchema.parse(raw);
  const po = await loadPo(ctx, id);
  if (!["approved", "sent", "partially_received"].includes(po.status)) {
    throw acctError(po.status === "closed" || po.status === "cancelled" ? ACCT.PO_CLOSED : ACCT.BILL_NOT_APPROVED);
  }
  const settings = await requireAccountingSettings(ctx.orgId);
  const date = input.receivedDate ? parseDateInput(input.receivedDate, settings.timezone, "receivedDate") : new Date();
  const receiptKey = `${Date.now()}`;
  const rate = D(po.exchangeRate);
  await prisma.$transaction(
    async (tx) => {
      const postingLines: Array<{ posProductId?: string | null; shopProductId?: string | null; ledgerAccountId?: string | null; value: Dec; description: string }> = [];
      for (const r of input.lines) {
        const line = po.lines.find((l) => l.id === r.lineId);
        if (!line) throw acctError(ACCT.NOT_FOUND, { fields: { lineId: "Unknown line" } });
        if (!r.qty.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { qty: "Must be > 0" } });
        const remaining = D(line.qty).sub(D(line.qtyReceived));
        if (r.qty.greaterThan(remaining)) throw acctError(ACCT.PO_RECEIVE_EXCEEDS, { details: { lineId: line.id, remaining: remaining.toString() } });
        const unitCostBase = (r.unitCost ?? D(line.unitCost)).mul(rate);
        const value = round2(r.qty.mul(unitCostBase));
        if (line.posProductId || line.shopProductId) {
          await recordInventoryMovement(tx, {
            orgId: ctx.orgId,
            productRef: line.posProductId ? { posProductId: line.posProductId } : { shopProductId: line.shopProductId! },
            kind: "purchase_receipt",
            qty: r.qty,
            unitCost: unitCostBase,
            sourceType: "purchase_receipt",
            sourceId: `${po.id}:${receiptKey}:${line.id}`,
            reason: `Received on ${po.number}`,
            actorId: ctx.actorId,
          });
        }
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { qtyReceived: D(line.qtyReceived).add(r.qty), receivedValue: D(line.receivedValue).add(value) },
        });
        postingLines.push({ posProductId: line.posProductId, shopProductId: line.shopProductId, ledgerAccountId: line.ledgerAccountId, value, description: line.description });
      }
      const pc = await createPostingContext(tx, settings);
      await postPurchaseReceipt(pc, {
        purchaseOrderId: po.id,
        receiptKey,
        supplierId: po.supplierId,
        locationId: po.locationId,
        date,
        number: po.number,
        lines: postingLines,
      });
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
      const allReceived = lines.every((l) => D(l.qtyReceived).greaterThanOrEqualTo(D(l.qty)));
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: allReceived ? "received" : "partially_received" } });
    },
    { timeout: 60_000 }
  );
  flushAccountingQueueSoon(ctx.orgId);
  recordAccountingAudit(ctx, { action: "po.receive", entityType: "PurchaseOrder", entityId: po.id, description: `Goods received on ${po.number}` });
  return getPurchaseOrder(ctx, po.id);
}

export async function closePurchaseOrder(ctx: AccountingCtx, id: string) {
  const po = await loadPo(ctx, id);
  if (po.status === "closed" || po.status === "cancelled") throw acctError(ACCT.PO_CLOSED);
  if (po.status === "draft" || po.status === "pending_approval") throw acctError(ACCT.BILL_NOT_APPROVED);
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "closed", closedAt: new Date() } });
  recordAccountingAudit(ctx, { action: "po.close", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} closed` });
  return getPurchaseOrder(ctx, po.id);
}

export async function cancelPurchaseOrder(ctx: AccountingCtx, id: string, reason: string) {
  const po = await loadPo(ctx, id);
  if (po.status === "closed" || po.status === "cancelled") throw acctError(ACCT.PO_CLOSED);
  const received = po.lines.some((l) => D(l.qtyReceived).greaterThan(0));
  const bills = await prisma.supplierBill.count({ where: { purchaseOrderId: po.id, status: { not: "void" } } });
  if (received || bills) throw acctError(ACCT.PO_CLOSED, { message: "Received or billed purchase orders cannot be cancelled" });
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason.slice(0, 500) } });
    await markApprovalDecided(tx, { orgId: ctx.orgId, entity: "purchase_order", entityId: po.id, status: "cancelled", actorId: ctx.actorId });
  });
  recordAccountingAudit(ctx, { action: "po.cancel", entityType: "PurchaseOrder", entityId: po.id, description: `PO ${po.number} cancelled`, reason });
  return getPurchaseOrder(ctx, po.id);
}

/** Prefill a bill from received-but-not-billed quantities. */
export async function convertToBill(ctx: AccountingCtx, id: string) {
  const po = await loadPo(ctx, id);
  const lines = po.lines
    .map((l) => ({ l, qty: D(l.qtyReceived).sub(D(l.qtyBilled)) }))
    .filter((x) => x.qty.greaterThan(0));
  if (!lines.length) throw acctError(ACCT.VALIDATION, { message: "Nothing received that is not already billed" });
  const { createBill } = await import("@/lib/accounting/payables/bills");
  const settings = await requireAccountingSettings(ctx.orgId);
  const today = new Date().toISOString().slice(0, 10);
  return createBill(ctx, {
    supplierId: po.supplierId,
    locationId: po.locationId,
    billDate: today,
    purchaseOrderId: po.id,
    currency: po.currency,
    ...(po.currency !== settings.baseCurrency ? { exchangeRate: D(po.exchangeRate).toString() } : {}),
    lines: lines.map(({ l, qty }) => ({
      description: l.description,
      purchaseOrderLineId: l.id,
      ...(l.posProductId ? { posProductId: l.posProductId } : {}),
      ...(l.shopProductId ? { shopProductId: l.shopProductId } : {}),
      ...(l.ledgerAccountId ? { ledgerAccountId: l.ledgerAccountId } : {}),
      qty: qty.toString(),
      unitCost: D(l.unitCost).toString(),
      ...(l.taxCodeId ? { taxCodeId: l.taxCodeId } : {}),
    })),
  });
}

export async function getPurchaseOrder(ctx: AccountingCtx, id: string) {
  return toPoDto(await loadPo(ctx, id));
}

export async function listPurchaseOrders(ctx: AccountingCtx, q: { status?: string; supplierId?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: Prisma.PurchaseOrderWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (q.status) where.status = q.status as never;
  if (q.supplierId && isValidId(q.supplierId)) where.supplierId = q.supplierId;
  const rows = await prisma.purchaseOrder.findMany({
    where,
    include: { supplier: { select: { name: true } } },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map((p) => toPoDto(p)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}
