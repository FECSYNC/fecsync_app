/**
 * Chart of accounts: CRUD, system account lookup, postability checks.
 */
import type {
  AccountingSystemKey,
  LedgerAccount,
  LedgerAccountSubtype,
  LedgerAccountType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { FEC_DEFAULT_CHART, normalBalance } from "@/lib/accounting/chartTemplate";
import { csvRecords } from "@/lib/accounting/csv";
import { toApiString, isZero, D, type Dec } from "@/lib/accounting/money";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export const ACCOUNT_SUBTYPES = [
  "cash", "bank", "payment_clearing", "receivable", "inventory", "tax_receivable", "prepaid",
  "fixed_asset", "contra_asset", "other_current_asset", "payable", "tax_payable",
  "unearned_revenue", "stored_value_liability", "tips_payable", "accrued_liability", "loan",
  "other_liability", "equity_capital", "retained_earnings", "opening_balance_equity",
  "drawings", "operating_revenue", "other_income", "contra_revenue", "cost_of_sales",
  "operating_expense", "other_expense", "suspense",
] as const;

const SUBTYPE_TYPES: Record<LedgerAccountSubtype, LedgerAccountType[]> = {
  cash: ["asset"], bank: ["asset"], payment_clearing: ["asset"], receivable: ["asset"],
  inventory: ["asset"], tax_receivable: ["asset"], prepaid: ["asset"], fixed_asset: ["asset"],
  contra_asset: ["asset"], other_current_asset: ["asset"], suspense: ["asset", "liability"],
  payable: ["liability"], tax_payable: ["liability"], unearned_revenue: ["liability"],
  stored_value_liability: ["liability"], tips_payable: ["liability"],
  accrued_liability: ["liability"], loan: ["liability"], other_liability: ["liability"],
  equity_capital: ["equity"], retained_earnings: ["equity"], opening_balance_equity: ["equity"],
  drawings: ["equity"], operating_revenue: ["revenue"], other_income: ["revenue"],
  contra_revenue: ["revenue"], cost_of_sales: ["expense"], operating_expense: ["expense"],
  other_expense: ["expense"],
};

/** Control accounts must carry a party and cannot take manual journals. */
export const CONTROL_SYSTEM_KEYS: ReadonlySet<AccountingSystemKey> = new Set([
  "accounts_receivable",
  "accounts_payable",
  "goods_received_not_invoiced",
  "employee_reimbursements",
  "sales_tax_payable",
  "input_tax",
  "gift_card_liability",
  "stored_value_liability",
]);

export const PARTY_REQUIRED_KEYS: ReadonlySet<AccountingSystemKey> = new Set([
  "accounts_receivable",
  "accounts_payable",
  "goods_received_not_invoiced",
  "employee_reimbursements",
]);

export function toAccountDto(a: LedgerAccount, balance?: Dec | null) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    systemKey: a.systemKey,
    parentId: a.parentId,
    isHeader: a.isHeader,
    isActive: a.isActive,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    locationId: a.locationId,
    currency: a.currency,
    description: a.description,
    cashFlowCategory: a.cashFlowCategory,
    allowManualPosting: a.allowManualPosting,
    defaultTaxCodeId: a.defaultTaxCodeId,
    sortOrder: a.sortOrder,
    normalBalance: normalBalance(a.type, a.subtype),
    balance: balance == null ? null : toApiString(balance),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export type LedgerAccountDto = ReturnType<typeof toAccountDto>;

/** Per-call cache of system accounts (posting rules call this many times). */
export type AccountCache = Map<string, LedgerAccount>;

export async function getSystemAccount(
  db: Db,
  orgId: string,
  key: AccountingSystemKey,
  cache?: AccountCache
): Promise<LedgerAccount> {
  const ck = `sys:${key}`;
  const hit = cache?.get(ck);
  if (hit) return hit;
  const acct = await db.ledgerAccount.findUnique({
    where: { orgId_systemKey: { orgId, systemKey: key } },
  });
  if (!acct) {
    throw acctError(ACCT.MAPPING_MISSING, { message: `System account ${key} missing` });
  }
  cache?.set(ck, acct);
  return acct;
}

export async function getAccountsByIds(
  db: Db,
  orgId: string,
  ids: string[]
): Promise<Map<string, LedgerAccount>> {
  const unique = [...new Set(ids)].filter(isValidId);
  const rows = await db.ledgerAccount.findMany({ where: { orgId, id: { in: unique } } });
  return new Map(rows.map((r) => [r.id, r]));
}

export function assertPostable(
  account: LedgerAccount,
  opts: { manual: boolean; locationId?: string | null }
): void {
  if (account.isHeader) throw acctError(ACCT.HEADER_ACCOUNT, { details: { accountId: account.id } });
  if (!account.isActive || account.archivedAt) {
    throw acctError(ACCT.ACCOUNT_INACTIVE, { details: { accountId: account.id } });
  }
  if (opts.manual) {
    if (
      !account.allowManualPosting ||
      (account.systemKey && CONTROL_SYSTEM_KEYS.has(account.systemKey))
    ) {
      throw acctError(ACCT.CONTROL_ACCOUNT, { details: { accountId: account.id, code: account.code } });
    }
    if (account.locationId && opts.locationId !== account.locationId) {
      throw acctError(ACCT.LOCATION_OUT_OF_SCOPE, { details: { accountId: account.id } });
    }
  }
}

export function accountNeedsParty(account: LedgerAccount): boolean {
  if (account.systemKey && PARTY_REQUIRED_KEYS.has(account.systemKey)) return true;
  return account.subtype === "receivable" || account.subtype === "payable";
}

/** Setup: create the FEC template (idempotent by code). */
export async function seedChart(tx: Db, orgId: string): Promise<void> {
  const existing = await tx.ledgerAccount.findMany({
    where: { orgId },
    select: { id: true, code: true },
  });
  const byCode = new Map(existing.map((e) => [e.code, e.id]));
  let order = 0;
  for (const row of FEC_DEFAULT_CHART) {
    order += 10;
    if (byCode.has(row.code)) continue;
    const created = await tx.ledgerAccount.create({
      data: {
        orgId,
        code: row.code,
        name: row.name,
        type: row.type,
        subtype: row.subtype,
        systemKey: row.systemKey ?? null,
        isHeader: Boolean(row.isHeader),
        cashFlowCategory: row.cashFlowCategory,
        allowManualPosting: row.allowManualPosting ?? true,
        parentId: row.parentCode ? byCode.get(row.parentCode) ?? null : null,
        sortOrder: order,
      },
    });
    byCode.set(row.code, created.id);
  }
}

const accountInput = z
  .object({
    code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9.\-]+$/),
    name: z.string().trim().min(1).max(120),
    type: z.enum(ACCOUNT_TYPES),
    subtype: z.enum(ACCOUNT_SUBTYPES),
    parentId: z.string().nullable().optional(),
    isHeader: z.boolean().optional(),
    locationId: z.string().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    cashFlowCategory: z.enum(["cash", "operating", "investing", "financing", "none"]).optional(),
    allowManualPosting: z.boolean().optional(),
    defaultTaxCodeId: z.string().nullable().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export const createAccountSchema = accountInput;
export const updateAccountSchema = accountInput.partial().strict();

async function assertParent(
  db: Db,
  orgId: string,
  parentId: string | null | undefined,
  type: LedgerAccountType,
  selfId?: string
): Promise<string | null> {
  if (!parentId) return null;
  if (!isValidId(parentId) || parentId === selfId) throw acctError(ACCT.PARENT_TYPE_MISMATCH);
  const parent = await db.ledgerAccount.findFirst({ where: { id: parentId, orgId } });
  if (!parent || !parent.isHeader || parent.type !== type) {
    throw acctError(ACCT.PARENT_TYPE_MISMATCH);
  }
  return parent.id;
}

function assertSubtype(type: LedgerAccountType, subtype: LedgerAccountSubtype) {
  if (!SUBTYPE_TYPES[subtype].includes(type)) {
    throw acctError(ACCT.VALIDATION, { fields: { subtype: `Subtype ${subtype} is not valid for ${type}` } });
  }
}

export async function createAccount(ctx: AccountingCtx, raw: unknown) {
  const input = createAccountSchema.parse(raw);
  assertSubtype(input.type, input.subtype);
  const dup = await prisma.ledgerAccount.findUnique({
    where: { orgId_code: { orgId: ctx.orgId, code: input.code } },
  });
  if (dup) throw acctError(ACCT.CODE_TAKEN);
  const parentId = await assertParent(prisma, ctx.orgId, input.parentId, input.type);
  if (input.locationId) {
    const v = await prisma.venueLocation.findFirst({ where: { id: input.locationId, orgId: ctx.orgId } });
    if (!v) throw acctError(ACCT.LOCATION_OUT_OF_SCOPE);
  }
  const created = await prisma.ledgerAccount.create({
    data: {
      orgId: ctx.orgId,
      code: input.code,
      name: input.name,
      type: input.type,
      subtype: input.subtype,
      parentId,
      isHeader: Boolean(input.isHeader),
      locationId: input.locationId ?? null,
      currency: input.currency ?? null,
      description: input.description ?? null,
      cashFlowCategory: input.cashFlowCategory ?? defaultCashFlow(input.type, input.subtype),
      allowManualPosting: input.isHeader ? false : input.allowManualPosting ?? true,
      defaultTaxCodeId: input.defaultTaxCodeId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  recordAccountingAudit(ctx, {
    action: "account.create",
    entityType: "LedgerAccount",
    entityId: created.id,
    description: `Account ${created.code} ${created.name} created`,
    after: toAccountDto(created),
  });
  return toAccountDto(created);
}

function defaultCashFlow(type: LedgerAccountType, subtype: LedgerAccountSubtype) {
  if (subtype === "cash" || subtype === "bank" || subtype === "payment_clearing") return "cash" as const;
  if (subtype === "fixed_asset" || subtype === "contra_asset") return "investing" as const;
  if (subtype === "loan" || subtype === "equity_capital" || subtype === "drawings") return "financing" as const;
  if (type === "equity") return "none" as const;
  return "operating" as const;
}

export async function loadAccountInOrg(ctx: AccountingCtx, id: string, db: Db = prisma) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const acct = await db.ledgerAccount.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!acct) throw acctError(ACCT.NOT_FOUND);
  return acct;
}

export async function updateAccount(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = updateAccountSchema.parse(raw);
  const acct = await loadAccountInOrg(ctx, id);
  const typeChange =
    (input.type && input.type !== acct.type) || (input.subtype && input.subtype !== acct.subtype);
  if (typeChange) {
    if (acct.systemKey) throw acctError(ACCT.SYSTEM_ACCOUNT_LOCKED);
    const used = await prisma.journalLine.count({ where: { ledgerAccountId: acct.id } });
    if (used > 0) throw acctError(ACCT.ACCOUNT_TYPE_LOCKED);
    assertSubtype(input.type ?? acct.type, input.subtype ?? acct.subtype);
  }
  if (input.isHeader !== undefined && input.isHeader !== acct.isHeader) {
    const used = await prisma.journalLine.count({ where: { ledgerAccountId: acct.id } });
    if (used > 0) throw acctError(ACCT.ACCOUNT_TYPE_LOCKED);
  }
  if (input.code && input.code !== acct.code) {
    const dup = await prisma.ledgerAccount.findUnique({
      where: { orgId_code: { orgId: ctx.orgId, code: input.code } },
    });
    if (dup) throw acctError(ACCT.CODE_TAKEN);
  }
  if (acct.systemKey && input.allowManualPosting === true && CONTROL_SYSTEM_KEYS.has(acct.systemKey)) {
    throw acctError(ACCT.SYSTEM_ACCOUNT_LOCKED);
  }
  const parentId =
    input.parentId !== undefined
      ? await assertParent(prisma, ctx.orgId, input.parentId, input.type ?? acct.type, acct.id)
      : undefined;
  const data: Prisma.LedgerAccountUncheckedUpdateInput = {
    ...(input.code ? { code: input.code } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.subtype ? { subtype: input.subtype } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(input.isHeader !== undefined ? { isHeader: input.isHeader } : {}),
    ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.cashFlowCategory ? { cashFlowCategory: input.cashFlowCategory } : {}),
    ...(input.allowManualPosting !== undefined ? { allowManualPosting: input.allowManualPosting } : {}),
    ...(input.defaultTaxCodeId !== undefined ? { defaultTaxCodeId: input.defaultTaxCodeId } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  };
  const updated = await prisma.ledgerAccount.update({ where: { id: acct.id }, data });
  recordAccountingAudit(ctx, {
    action: "account.update",
    entityType: "LedgerAccount",
    entityId: acct.id,
    description: `Account ${updated.code} updated`,
    before: toAccountDto(acct),
    after: toAccountDto(updated),
  });
  return toAccountDto(updated);
}

export async function archiveAccount(ctx: AccountingCtx, id: string) {
  const acct = await loadAccountInOrg(ctx, id);
  if (acct.systemKey) throw acctError(ACCT.SYSTEM_ACCOUNT_LOCKED);
  const agg = await prisma.journalLine.aggregate({
    where: { orgId: ctx.orgId, ledgerAccountId: acct.id, entry: { status: { in: ["posted", "reversed"] } } },
    _sum: { debit: true, credit: true },
  });
  const bal = D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0));
  if (!isZero(bal)) throw acctError(ACCT.ACCOUNT_HAS_BALANCE, { details: { balance: toApiString(bal) } });
  const mappings = await prisma.accountingMapping.findMany({
    where: { orgId: ctx.orgId, ledgerAccountId: acct.id },
    select: { id: true, kind: true, matchKey: true, locationId: true },
  });
  const categories = await prisma.expenseCategory.count({
    where: { orgId: ctx.orgId, ledgerAccountId: acct.id, isActive: true },
  });
  const bank = await prisma.bankAccount.findFirst({ where: { ledgerAccountId: acct.id, archivedAt: null } });
  if (mappings.length || categories || bank) {
    throw acctError(ACCT.ACCOUNT_HAS_BALANCE, {
      message: "Account is still mapped",
      details: { mappings, expenseCategories: categories, bankAccountId: bank?.id ?? null },
    });
  }
  const children = await prisma.ledgerAccount.count({ where: { parentId: acct.id, archivedAt: null } });
  if (children) throw acctError(ACCT.ACCOUNT_HAS_BALANCE, { message: "Header still has active children" });
  const updated = await prisma.ledgerAccount.update({
    where: { id: acct.id },
    data: { isActive: false, archivedAt: new Date() },
  });
  recordAccountingAudit(ctx, {
    action: "account.archive",
    entityType: "LedgerAccount",
    entityId: acct.id,
    description: `Account ${acct.code} archived`,
  });
  return toAccountDto(updated);
}

export async function listAccounts(
  ctx: AccountingCtx,
  filters: {
    q?: string;
    type?: string;
    active?: string;
    includeBalances?: boolean;
    asOf?: Date;
    postableOnly?: boolean;
  } = {}
) {
  const where: Prisma.LedgerAccountWhereInput = { orgId: ctx.orgId };
  if (filters.type && (ACCOUNT_TYPES as readonly string[]).includes(filters.type)) {
    where.type = filters.type as LedgerAccountType;
  }
  if (filters.active === "true") where.archivedAt = null;
  if (filters.active === "false") where.archivedAt = { not: null };
  if (filters.postableOnly) {
    where.isHeader = false;
    where.archivedAt = null;
    where.isActive = true;
  }
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: "insensitive" } },
      { name: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.ledgerAccount.findMany({
    where,
    orderBy: [{ code: "asc" }],
    take: 2000,
  });
  if (!filters.includeBalances) return rows.map((r) => toAccountDto(r));
  const { balancesByAccount } = await import("@/lib/accounting/ledgerQueries");
  const balances = await balancesByAccount(ctx, { to: filters.asOf ?? new Date() });
  return rows.map((r) => {
    const b = balances.get(r.id);
    return toAccountDto(r, b ? b.debit.sub(b.credit) : D(0));
  });
}

export async function importAccountsCsv(ctx: AccountingCtx, csv: string) {
  if (csv.length > 1_000_000) throw acctError(ACCT.VALIDATION, { message: "CSV larger than 1 MB" });
  const records = csvRecords(csv);
  const errors: Array<{ row: number; error: string }> = [];
  const parsed: Array<z.infer<typeof createAccountSchema> & { parentCode?: string }> = [];
  const existing = await prisma.ledgerAccount.findMany({
    where: { orgId: ctx.orgId },
    select: { id: true, code: true, type: true, isHeader: true },
  });
  const codes = new Map(existing.map((e) => [e.code, e]));
  const fileCodes = new Set<string>();
  records.forEach((rec, i) => {
    const result = createAccountSchema.safeParse({
      code: rec.code,
      name: rec.name,
      type: rec.type,
      subtype: rec.subtype,
      ...(rec.isheader ? { isHeader: rec.isheader.toLowerCase() === "true" } : {}),
      ...(rec.description ? { description: rec.description } : {}),
    });
    if (!result.success) {
      errors.push({ row: i + 2, error: result.error.issues.map((x) => x.message).join("; ") });
      return;
    }
    if (!SUBTYPE_TYPES[result.data.subtype].includes(result.data.type)) {
      errors.push({ row: i + 2, error: "Subtype does not match type" });
      return;
    }
    if (codes.has(result.data.code) || fileCodes.has(result.data.code)) {
      errors.push({ row: i + 2, error: `Code ${result.data.code} already exists` });
      return;
    }
    fileCodes.add(result.data.code);
    parsed.push({ ...result.data, parentCode: rec.parentcode || undefined });
  });
  for (const [i, row] of parsed.entries()) {
    if (!row.parentCode) continue;
    const parentExisting = codes.get(row.parentCode);
    const parentInFile = parsed.find((p) => p.code === row.parentCode);
    const parentType = parentExisting?.type ?? parentInFile?.type;
    const parentHeader = parentExisting?.isHeader ?? parentInFile?.isHeader;
    if (!parentType || !parentHeader || parentType !== row.type) {
      errors.push({ row: i + 2, error: `Parent ${row.parentCode} is not a header of the same type` });
    }
  }
  if (errors.length) return { created: 0, errors };
  await prisma.$transaction(async (tx) => {
    const idByCode = new Map(existing.map((e) => [e.code, e.id]));
    const sorted = [...parsed].sort((a, b) => Number(Boolean(b.isHeader)) - Number(Boolean(a.isHeader)));
    for (const row of sorted) {
      const created = await tx.ledgerAccount.create({
        data: {
          orgId: ctx.orgId,
          code: row.code,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          isHeader: Boolean(row.isHeader),
          allowManualPosting: !row.isHeader,
          description: row.description ?? null,
          cashFlowCategory: defaultCashFlow(row.type, row.subtype),
          parentId: row.parentCode ? idByCode.get(row.parentCode) ?? null : null,
        },
      });
      idByCode.set(row.code, created.id);
    }
  });
  recordAccountingAudit(ctx, {
    action: "account.import",
    entityType: "LedgerAccount",
    entityId: null,
    description: `${parsed.length} accounts imported`,
  });
  return { created: parsed.length, errors: [] };
}
