/**
 * Suppliers. Bank numbers are encrypted (secretCrypto); only last4 is returned.
 */
import type { Prisma, Supplier } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { encryptSecret, secretLast4 } from "@/lib/secretCrypto";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, toApiString } from "@/lib/accounting/money";
import { nextNumber } from "@/lib/accounting/sequences";
import { csvRecords } from "@/lib/accounting/csv";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { getSystemAccount } from "@/lib/accounting/accounts";
import { bucketFor, bucketsDto, emptyBuckets } from "@/lib/accounting/receivables/customers";
import type { AccountingCtx } from "@/lib/accounting/types";

export function toSupplierDto(s: Supplier, extra: { balance?: string; overdue?: string } = {}) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    legalName: s.legalName,
    email: s.email,
    phone: s.phone,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2,
    city: s.city,
    state: s.state,
    country: s.country,
    postalCode: s.postalCode,
    taxId: s.taxId,
    paymentTermsDays: s.paymentTermsDays,
    currency: s.currency,
    defaultExpenseAccountId: s.defaultExpenseAccountId,
    defaultTaxCodeId: s.defaultTaxCodeId,
    bankName: s.bankName,
    bankAccountName: s.bankAccountName,
    bankAccountLast4: s.bankAccountLast4,
    notes: s.notes,
    locationId: s.locationId,
    isActive: s.isActive,
    archivedAt: s.archivedAt?.toISOString() ?? null,
    balance: extra.balance ?? null,
    overdue: extra.overdue ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export const supplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
    phone: z.string().trim().regex(/^[+\d\s().-]{5,30}$/).nullable().optional().or(z.literal("").transform(() => null)),
    addressLine1: z.string().trim().max(200).nullable().optional(),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    postalCode: z.string().trim().max(30).nullable().optional(),
    taxId: z.string().trim().max(60).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    defaultExpenseAccountId: z.string().nullable().optional(),
    defaultTaxCodeId: z.string().nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    bankAccountName: z.string().trim().max(120).nullable().optional(),
    bankAccountNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{4,40}$/).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    locationId: z.string().nullable().optional(),
  })
  .strict();

async function assertRefs(ctx: AccountingCtx, input: z.infer<typeof supplierSchema>) {
  if (input.defaultExpenseAccountId) {
    const a = await prisma.ledgerAccount.findFirst({ where: { id: input.defaultExpenseAccountId, orgId: ctx.orgId } });
    if (!a || a.isHeader || (a.type !== "expense" && a.type !== "asset")) {
      throw acctError(ACCT.MAPPING_TYPE_INVALID, { fields: { defaultExpenseAccountId: "Choose an expense or asset account" } });
    }
  }
  if (input.defaultTaxCodeId) {
    const t = await prisma.taxCode.findFirst({ where: { id: input.defaultTaxCodeId, orgId: ctx.orgId, isActive: true } });
    if (!t) throw acctError(ACCT.NOT_FOUND, { fields: { defaultTaxCodeId: "Unknown tax code" } });
  }
}

export async function createSupplier(ctx: AccountingCtx, raw: unknown) {
  const input = supplierSchema.parse(raw);
  await assertRefs(ctx, input);
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  const created = await prisma.$transaction(async (tx) => {
    const code = await nextNumber(tx, ctx.orgId, "supplier_code");
    const { bankAccountNumber, locationId: _l, ...rest } = input;
    void _l;
    return tx.supplier.create({
      data: {
        ...rest,
        orgId: ctx.orgId,
        code,
        locationId,
        bankAccountLast4: bankAccountNumber ? secretLast4(bankAccountNumber.replace(/\s/g, "")) : null,
        bankAccountCiphertext: bankAccountNumber ? encryptSecret(bankAccountNumber.replace(/\s/g, "")) : null,
        createdById: ctx.actorId,
      },
    });
  });
  recordAccountingAudit(ctx, { action: "supplier.create", entityType: "Supplier", entityId: created.id, description: `Supplier ${created.code} ${created.name} created` });
  return toSupplierDto(created);
}

export async function loadSupplier(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const s = await prisma.supplier.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && s.locationId && !isLocationVisible(ctx.scope, s.locationId)) throw acctError(ACCT.NOT_FOUND);
  return s;
}

export async function updateSupplier(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = supplierSchema.partial().strict().parse(raw);
  const s = await loadSupplier(ctx, id);
  await assertRefs(ctx, input as z.infer<typeof supplierSchema>);
  const locationId = input.locationId !== undefined ? await assertLocationWritable(ctx, input.locationId) : undefined;
  const { bankAccountNumber, locationId: _l, ...rest } = input;
  void _l;
  const updated = await prisma.supplier.update({
    where: { id: s.id },
    data: {
      ...rest,
      ...(locationId !== undefined ? { locationId } : {}),
      ...(bankAccountNumber !== undefined
        ? {
            bankAccountLast4: bankAccountNumber ? secretLast4(bankAccountNumber.replace(/\s/g, "")) : null,
            bankAccountCiphertext: bankAccountNumber ? encryptSecret(bankAccountNumber.replace(/\s/g, "")) : null,
          }
        : {}),
    },
  });
  recordAccountingAudit(ctx, {
    action: "supplier.update",
    entityType: "Supplier",
    entityId: s.id,
    description: `Supplier ${s.code} updated`,
    before: toSupplierDto(s),
    after: toSupplierDto(updated),
  });
  return toSupplierDto(updated);
}

export async function archiveSupplier(ctx: AccountingCtx, id: string) {
  const s = await loadSupplier(ctx, id);
  const open = await prisma.supplierBill.count({
    where: { orgId: ctx.orgId, supplierId: s.id, status: { in: ["draft", "pending_approval", "approved", "posted", "partially_paid"] } },
  });
  const ap = await getSystemAccount(prisma, ctx.orgId, "accounts_payable");
  const agg = await prisma.journalLine.aggregate({
    where: { orgId: ctx.orgId, supplierId: s.id, ledgerAccountId: ap.id, entry: { status: { in: ["posted", "reversed"] } } },
    _sum: { debit: true, credit: true },
  });
  const balance = D(agg._sum.credit ?? 0).sub(D(agg._sum.debit ?? 0));
  if (open > 0 || !balance.isZero()) throw acctError(ACCT.SUPPLIER_HAS_OPEN_BILLS, { details: { openBills: open, balance: toApiString(balance) } });
  const updated = await prisma.supplier.update({ where: { id: s.id }, data: { isActive: false, archivedAt: new Date() } });
  recordAccountingAudit(ctx, { action: "supplier.archive", entityType: "Supplier", entityId: s.id, description: `Supplier ${s.code} archived` });
  return toSupplierDto(updated);
}

/** AP balance + aging per supplier from posted bills (open amountDue by due date). */
export async function supplierBalances(ctx: AccountingCtx, asOf = new Date(), supplierId?: string) {
  const bills = await prisma.supplierBill.findMany({
    where: {
      orgId: ctx.orgId,
      ...(supplierId ? { supplierId } : {}),
      status: { in: ["posted", "partially_paid"] },
      billDate: { lte: asOf },
      ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
    },
    select: { supplierId: true, amountDue: true, dueDate: true, kind: true },
  });
  const payments = await prisma.supplierPayment.findMany({
    where: { orgId: ctx.orgId, ...(supplierId ? { supplierId } : {}), status: "posted", unappliedAmount: { gt: 0 } },
    select: { supplierId: true, unappliedAmount: true },
  });
  const map = new Map<string, ReturnType<typeof emptyBuckets>>();
  for (const b of bills) {
    const buckets = map.get(b.supplierId) ?? emptyBuckets();
    const due = D(b.amountDue).mul(b.kind === "credit_note" ? -1 : 1);
    const k = bucketFor(b.dueDate, asOf);
    buckets[k] = buckets[k].add(due);
    map.set(b.supplierId, buckets);
  }
  for (const p of payments) {
    const buckets = map.get(p.supplierId) ?? emptyBuckets();
    buckets.current = buckets.current.sub(D(p.unappliedAmount));
    map.set(p.supplierId, buckets);
  }
  return map;
}

export async function listSuppliers(ctx: AccountingCtx, q: { q?: string; active?: string; hasBalance?: boolean }) {
  const where: Prisma.SupplierWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { OR: [{ locationId: null }, { locationId: { in: ctx.scope.locationIds } }] }),
  };
  if (q.active === "true") where.archivedAt = null;
  if (q.active === "false") where.archivedAt = { not: null };
  if (q.q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { code: { contains: q.q, mode: "insensitive" } },
          { email: { contains: q.q, mode: "insensitive" } },
        ],
      },
    ];
  }
  const rows = await prisma.supplier.findMany({ where, orderBy: { name: "asc" }, take: 1000 });
  const balances = await supplierBalances(ctx);
  const out = rows.map((s) => {
    const b = balances.get(s.id) ?? emptyBuckets();
    const balance = Object.values(b).reduce((a, v) => a.add(v), ZERO);
    const overdue = b.d1_30.add(b.d31_60).add(b.d61_90).add(b.d90_plus);
    return toSupplierDto(s, { balance: toApiString(balance), overdue: toApiString(overdue) });
  });
  return q.hasBalance ? out.filter((s) => !D(s.balance ?? "0").isZero()) : out;
}

export async function getSupplier(ctx: AccountingCtx, id: string) {
  const s = await loadSupplier(ctx, id);
  const [bills, payments, pos, balances] = await Promise.all([
    prisma.supplierBill.findMany({ where: { orgId: ctx.orgId, supplierId: s.id }, orderBy: { billDate: "desc" }, take: 200 }),
    prisma.supplierPayment.findMany({ where: { orgId: ctx.orgId, supplierId: s.id }, orderBy: { paymentDate: "desc" }, take: 200 }),
    prisma.purchaseOrder.findMany({ where: { orgId: ctx.orgId, supplierId: s.id }, orderBy: { orderDate: "desc" }, take: 200 }),
    supplierBalances(ctx, new Date(), s.id),
  ]);
  const b = balances.get(s.id) ?? emptyBuckets();
  const balance = Object.values(b).reduce((a, v) => a.add(v), ZERO);
  return {
    supplier: toSupplierDto(s, { balance: toApiString(balance) }),
    aging: bucketsDto(b),
    bills: bills.map((x) => ({ id: x.id, number: x.number, supplierInvoiceNumber: x.supplierInvoiceNumber, kind: x.kind, status: x.status, billDate: x.billDate.toISOString(), dueDate: x.dueDate.toISOString(), total: toApiString(x.total), amountDue: toApiString(x.amountDue) })),
    payments: payments.map((x) => ({ id: x.id, number: x.number, status: x.status, paymentDate: x.paymentDate.toISOString(), amount: toApiString(x.amount), unappliedAmount: toApiString(x.unappliedAmount) })),
    purchaseOrders: pos.map((x) => ({ id: x.id, number: x.number, status: x.status, orderDate: x.orderDate.toISOString(), total: toApiString(x.total) })),
  };
}

export async function importSuppliersCsv(ctx: AccountingCtx, csv: string) {
  if (csv.length > 1_000_000) throw acctError(ACCT.VALIDATION, { message: "CSV larger than 1 MB" });
  const records = csvRecords(csv);
  const errors: Array<{ row: number; error: string }> = [];
  const parsed: Array<z.infer<typeof supplierSchema>> = [];
  records.forEach((r, i) => {
    const res = supplierSchema.safeParse({
      name: r.name,
      ...(r.email ? { email: r.email } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.taxid ? { taxId: r.taxid } : {}),
      ...(r.paymenttermsdays ? { paymentTermsDays: Number(r.paymenttermsdays) } : {}),
      ...(r.addressline1 ? { addressLine1: r.addressline1 } : {}),
      ...(r.city ? { city: r.city } : {}),
      ...(r.country ? { country: r.country } : {}),
    });
    if (!res.success) errors.push({ row: i + 2, error: res.error.issues.map((x) => x.message).join("; ") });
    else parsed.push(res.data);
  });
  if (errors.length) return { created: 0, errors };
  await prisma.$transaction(async (tx) => {
    for (const p of parsed) {
      const code = await nextNumber(tx, ctx.orgId, "supplier_code");
      const { bankAccountNumber: _bank, locationId: _loc, ...rest } = p;
      void _bank;
      void _loc;
      await tx.supplier.create({ data: { ...rest, orgId: ctx.orgId, code, createdById: ctx.actorId } });
    }
  });
  recordAccountingAudit(ctx, { action: "supplier.import", entityType: "Supplier", entityId: null, description: `${parsed.length} suppliers imported` });
  return { created: parsed.length, errors: [] };
}
