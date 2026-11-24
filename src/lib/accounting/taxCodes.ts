/**
 * Accounting tax codes. SALES mirrors checkout TaxSettings (synced on every
 * tax settings write). Booking/POS/order tax always comes from the document.
 */
import type { TaxCode } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, fromFloatBoundary, round2, type Dec } from "@/lib/accounting/money";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export function toTaxCodeDto(t: TaxCode) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    rate: D(t.rate).toFixed(4),
    kind: t.kind,
    salesTaxAccountId: t.salesTaxAccountId,
    purchaseTaxAccountId: t.purchaseTaxAccountId,
    isDefaultSales: t.isDefaultSales,
    isDefaultPurchase: t.isDefaultPurchase,
    isActive: t.isActive,
    syncedFromTaxSettings: t.syncedFromTaxSettings,
  };
}

/** Create/update SALES, PURCHASE, EXEMPT from checkout TaxSettings. */
export async function syncFromTaxSettings(db: Db, orgId: string): Promise<void> {
  const settings = await db.accountingSettings.findUnique({ where: { orgId }, select: { enabled: true } });
  if (!settings) return;
  const tax = await db.taxSettings.findUnique({ where: { orgId } });
  const rate = tax?.enabled && tax.rate != null ? fromFloatBoundary(tax.rate, 4) : ZERO;
  const label = tax?.label?.trim() || "Tax";
  const sys = await db.ledgerAccount.findMany({
    where: { orgId, systemKey: { in: ["sales_tax_payable", "input_tax"] } },
    select: { id: true, systemKey: true },
  });
  const salesAcct = sys.find((s) => s.systemKey === "sales_tax_payable")?.id ?? null;
  const inputAcct = sys.find((s) => s.systemKey === "input_tax")?.id ?? null;
  await db.taxCode.upsert({
    where: { orgId_code: { orgId, code: "SALES" } },
    create: {
      orgId,
      code: "SALES",
      name: `${label} (sales)`,
      rate,
      kind: "output",
      salesTaxAccountId: salesAcct,
      isDefaultSales: true,
      syncedFromTaxSettings: true,
    },
    update: { name: `${label} (sales)`, rate, salesTaxAccountId: salesAcct, isActive: true },
  });
  const purchase = await db.taxCode.findUnique({ where: { orgId_code: { orgId, code: "PURCHASE" } } });
  if (!purchase) {
    await db.taxCode.create({
      data: {
        orgId,
        code: "PURCHASE",
        name: `${label} (purchases)`,
        rate,
        kind: "input",
        purchaseTaxAccountId: inputAcct,
        isDefaultPurchase: true,
      },
    });
  }
  const exempt = await db.taxCode.findUnique({ where: { orgId_code: { orgId, code: "EXEMPT" } } });
  if (!exempt) {
    await db.taxCode.create({
      data: { orgId, code: "EXEMPT", name: "Exempt", rate: ZERO, kind: "exempt" },
    });
  }
}

/** Purchases, expenses, manual invoices only. */
export function computeTax(
  amount: Dec,
  taxCode: Pick<TaxCode, "rate" | "kind"> | null,
  inclusive: boolean
): { net: Dec; tax: Dec; gross: Dec } {
  const rate = taxCode && taxCode.kind !== "exempt" && taxCode.kind !== "zero_rated" ? D(taxCode.rate) : ZERO;
  if (rate.isZero()) return { net: round2(amount), tax: ZERO, gross: round2(amount) };
  if (inclusive) {
    const gross = round2(amount);
    const net = round2(gross.div(D(1).add(rate.div(100))));
    return { net, tax: gross.sub(net), gross };
  }
  const net = round2(amount);
  const tax = round2(net.mul(rate).div(100));
  return { net, tax, gross: net.add(tax) };
}

export async function loadTaxCode(db: Db, orgId: string, id: string | null | undefined): Promise<TaxCode | null> {
  if (!id) return null;
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND, { fields: { taxCodeId: "Unknown tax code" } });
  const t = await db.taxCode.findFirst({ where: { id, orgId } });
  if (!t || !t.isActive) throw acctError(ACCT.NOT_FOUND, { fields: { taxCodeId: "Unknown tax code" } });
  return t;
}

export async function listTaxCodes(ctx: AccountingCtx) {
  const rows = await prisma.taxCode.findMany({ where: { orgId: ctx.orgId }, orderBy: { code: "asc" } });
  return rows.map(toTaxCodeDto);
}

const taxCodeInput = z
  .object({
    code: z.string().trim().min(1).max(20).regex(/^[A-Z0-9_\-]+$/),
    name: z.string().trim().min(1).max(120),
    rate: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    kind: z.enum(["output", "input", "both", "exempt", "zero_rated"]),
    salesTaxAccountId: z.string().nullable().optional(),
    purchaseTaxAccountId: z.string().nullable().optional(),
    isDefaultSales: z.boolean().optional(),
    isDefaultPurchase: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

async function assertTaxAccounts(orgId: string, ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (!id) continue;
    const a = await prisma.ledgerAccount.findFirst({ where: { id, orgId } });
    if (!a || a.isHeader) throw acctError(ACCT.MAPPING_TYPE_INVALID);
    if (a.subtype !== "tax_payable" && a.subtype !== "tax_receivable") throw acctError(ACCT.MAPPING_TYPE_INVALID);
  }
}

export async function createTaxCode(ctx: AccountingCtx, raw: unknown) {
  const input = taxCodeInput.parse(raw);
  if (input.rate.lessThan(0) || input.rate.greaterThan(100)) {
    throw acctError(ACCT.VALIDATION, { fields: { rate: "Rate must be between 0 and 100" } });
  }
  if (input.code === "SALES") throw acctError(ACCT.CODE_TAKEN);
  const dup = await prisma.taxCode.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: input.code } } });
  if (dup) throw acctError(ACCT.CODE_TAKEN);
  await assertTaxAccounts(ctx.orgId, [input.salesTaxAccountId, input.purchaseTaxAccountId]);
  const created = await prisma.$transaction(async (tx) => {
    if (input.isDefaultSales) await tx.taxCode.updateMany({ where: { orgId: ctx.orgId }, data: { isDefaultSales: false } });
    if (input.isDefaultPurchase) await tx.taxCode.updateMany({ where: { orgId: ctx.orgId }, data: { isDefaultPurchase: false } });
    return tx.taxCode.create({
      data: {
        orgId: ctx.orgId,
        code: input.code,
        name: input.name,
        rate: input.rate,
        kind: input.kind,
        salesTaxAccountId: input.salesTaxAccountId ?? null,
        purchaseTaxAccountId: input.purchaseTaxAccountId ?? null,
        isDefaultSales: Boolean(input.isDefaultSales),
        isDefaultPurchase: Boolean(input.isDefaultPurchase),
        isActive: input.isActive ?? true,
      },
    });
  });
  recordAccountingAudit(ctx, {
    action: "tax_code.create",
    entityType: "TaxCode",
    entityId: created.id,
    description: `Tax code ${created.code} created`,
    after: toTaxCodeDto(created),
  });
  return toTaxCodeDto(created);
}

export async function updateTaxCode(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = taxCodeInput.partial().strict().parse(raw);
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const t = await prisma.taxCode.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw acctError(ACCT.NOT_FOUND);
  if (t.syncedFromTaxSettings && (input.rate !== undefined || input.code !== undefined || input.kind !== undefined)) {
    throw acctError(ACCT.SYSTEM_ACCOUNT_LOCKED, { message: "Edit checkout tax settings to change the SALES rate" });
  }
  if (input.rate && (input.rate.lessThan(0) || input.rate.greaterThan(100))) {
    throw acctError(ACCT.VALIDATION, { fields: { rate: "Rate must be between 0 and 100" } });
  }
  if (input.code && input.code !== t.code) {
    const dup = await prisma.taxCode.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: input.code } } });
    if (dup) throw acctError(ACCT.CODE_TAKEN);
  }
  await assertTaxAccounts(ctx.orgId, [input.salesTaxAccountId, input.purchaseTaxAccountId]);
  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefaultSales) await tx.taxCode.updateMany({ where: { orgId: ctx.orgId }, data: { isDefaultSales: false } });
    if (input.isDefaultPurchase) await tx.taxCode.updateMany({ where: { orgId: ctx.orgId }, data: { isDefaultPurchase: false } });
    return tx.taxCode.update({
      where: { id: t.id },
      data: {
        ...(input.code ? { code: input.code } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.rate ? { rate: input.rate } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.salesTaxAccountId !== undefined ? { salesTaxAccountId: input.salesTaxAccountId } : {}),
        ...(input.purchaseTaxAccountId !== undefined ? { purchaseTaxAccountId: input.purchaseTaxAccountId } : {}),
        ...(input.isDefaultSales !== undefined ? { isDefaultSales: input.isDefaultSales } : {}),
        ...(input.isDefaultPurchase !== undefined ? { isDefaultPurchase: input.isDefaultPurchase } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  });
  recordAccountingAudit(ctx, {
    action: "tax_code.update",
    entityType: "TaxCode",
    entityId: t.id,
    description: `Tax code ${updated.code} updated`,
    before: toTaxCodeDto(t),
    after: toTaxCodeDto(updated),
  });
  return toTaxCodeDto(updated);
}

export async function syncTaxCodesNow(ctx: AccountingCtx) {
  await syncFromTaxSettings(prisma, ctx.orgId);
  recordAccountingAudit(ctx, {
    action: "tax_code.sync",
    entityType: "TaxCode",
    entityId: null,
    description: "Tax codes synced from checkout tax settings",
  });
  return listTaxCodes(ctx);
}

/** Tax posting account for a code (falls back to the system tax accounts). */
export function taxAccountKey(side: "sales" | "purchase"): "sales_tax_payable" | "input_tax" {
  return side === "sales" ? "sales_tax_payable" : "input_tax";
}