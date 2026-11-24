/**
 * Expense categories → ledger accounts.
 */
import type { ExpenseCategory } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/accounting/chartTemplate";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export function toCategoryDto(
  c: ExpenseCategory & {
    ledgerAccount?: { code: string; name: string } | null;
    defaultTaxCode?: { code: string; name: string; rate: unknown } | null;
  }
) {
  return {
    id: c.id,
    name: c.name,
    ledgerAccountId: c.ledgerAccountId,
    ledgerAccountCode: c.ledgerAccount?.code ?? null,
    ledgerAccountName: c.ledgerAccount?.name ?? null,
    defaultTaxCodeId: c.defaultTaxCodeId,
    defaultTaxCodeLabel: c.defaultTaxCode
      ? `${c.defaultTaxCode.code} — ${c.defaultTaxCode.name}`
      : null,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
  };
}

export async function seedExpenseCategories(tx: Db, orgId: string): Promise<void> {
  const accounts = await tx.ledgerAccount.findMany({
    where: { orgId, code: { in: DEFAULT_EXPENSE_CATEGORIES.map((c) => c.code) } },
    select: { id: true, code: true },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  let order = 0;
  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    order += 10;
    const ledgerAccountId = byCode.get(c.code);
    if (!ledgerAccountId) continue;
    const exists = await tx.expenseCategory.findUnique({ where: { orgId_name: { orgId, name: c.name } } });
    if (exists) continue;
    await tx.expenseCategory.create({ data: { orgId, name: c.name, ledgerAccountId, sortOrder: order } });
  }
}

export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    ledgerAccountId: z.string().min(1),
    defaultTaxCodeId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

async function assertCategoryRefs(ctx: AccountingCtx, input: Partial<z.infer<typeof categorySchema>>) {
  if (input.ledgerAccountId) {
    const a = await prisma.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, orgId: ctx.orgId } });
    if (!a || a.isHeader || a.archivedAt || (a.type !== "expense" && a.type !== "asset")) {
      throw acctError(ACCT.MAPPING_TYPE_INVALID, { fields: { ledgerAccountId: "Choose an active expense or asset account" } });
    }
  }
  if (input.defaultTaxCodeId) {
    const t = await prisma.taxCode.findFirst({ where: { id: input.defaultTaxCodeId, orgId: ctx.orgId, isActive: true } });
    if (!t) throw acctError(ACCT.NOT_FOUND, { fields: { defaultTaxCodeId: "Unknown tax code" } });
  }
}

export async function listExpenseCategories(ctx: AccountingCtx, includeInactive = false) {
  const rows = await prisma.expenseCategory.findMany({
    where: { orgId: ctx.orgId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const accounts = await prisma.ledgerAccount.findMany({
    where: { id: { in: rows.map((r) => r.ledgerAccountId) } },
    select: { id: true, code: true, name: true },
  });
  const taxIds = rows
    .map((r) => r.defaultTaxCodeId)
    .filter((id): id is string => Boolean(id));
  const taxCodes =
    taxIds.length > 0
      ? await prisma.taxCode.findMany({
          where: { id: { in: taxIds }, orgId: ctx.orgId },
          select: { id: true, code: true, name: true, rate: true },
        })
      : [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));
  return rows.map((r) =>
    toCategoryDto({
      ...r,
      ledgerAccount: byId.get(r.ledgerAccountId) ?? null,
      defaultTaxCode: r.defaultTaxCodeId
        ? taxById.get(r.defaultTaxCodeId) ?? null
        : null,
    })
  );
}

export async function createExpenseCategory(ctx: AccountingCtx, raw: unknown) {
  const input = categorySchema.parse(raw);
  await assertCategoryRefs(ctx, input);
  const dup = await prisma.expenseCategory.findUnique({ where: { orgId_name: { orgId: ctx.orgId, name: input.name } } });
  if (dup) throw acctError(ACCT.CODE_TAKEN, { fields: { name: "A category with this name exists" } });
  const created = await prisma.expenseCategory.create({
    data: {
      orgId: ctx.orgId,
      name: input.name,
      ledgerAccountId: input.ledgerAccountId,
      defaultTaxCodeId: input.defaultTaxCodeId ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  recordAccountingAudit(ctx, { action: "expense_category.create", entityType: "Expense", entityId: created.id, description: `Expense category ${created.name} created` });
  const [ledgerAccount, defaultTaxCode] = await Promise.all([
    prisma.ledgerAccount.findFirst({
      where: { id: created.ledgerAccountId, orgId: ctx.orgId },
      select: { code: true, name: true },
    }),
    created.defaultTaxCodeId
      ? prisma.taxCode.findFirst({
          where: { id: created.defaultTaxCodeId, orgId: ctx.orgId },
          select: { code: true, name: true, rate: true },
        })
      : Promise.resolve(null),
  ]);
  return toCategoryDto({ ...created, ledgerAccount, defaultTaxCode });
}

export async function updateExpenseCategory(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = categorySchema.partial().strict().parse(raw);
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const c = await prisma.expenseCategory.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw acctError(ACCT.NOT_FOUND);
  await assertCategoryRefs(ctx, input);
  if (input.name && input.name !== c.name) {
    const dup = await prisma.expenseCategory.findUnique({ where: { orgId_name: { orgId: ctx.orgId, name: input.name } } });
    if (dup) throw acctError(ACCT.CODE_TAKEN, { fields: { name: "A category with this name exists" } });
  }
  const updated = await prisma.expenseCategory.update({
    where: { id: c.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.ledgerAccountId ? { ledgerAccountId: input.ledgerAccountId } : {}),
      ...(input.defaultTaxCodeId !== undefined ? { defaultTaxCodeId: input.defaultTaxCodeId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  const [ledgerAccount, defaultTaxCode] = await Promise.all([
    prisma.ledgerAccount.findFirst({
      where: { id: updated.ledgerAccountId, orgId: ctx.orgId },
      select: { code: true, name: true },
    }),
    updated.defaultTaxCodeId
      ? prisma.taxCode.findFirst({
          where: { id: updated.defaultTaxCodeId, orgId: ctx.orgId },
          select: { code: true, name: true, rate: true },
        })
      : Promise.resolve(null),
  ]);
  const after = toCategoryDto({ ...updated, ledgerAccount, defaultTaxCode });
  recordAccountingAudit(ctx, {
    action: "expense_category.update",
    entityType: "Expense",
    entityId: c.id,
    description: `Expense category ${updated.name} updated`,
    before: toCategoryDto(c),
    after,
  });
  return after;
}
