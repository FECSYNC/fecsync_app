/**
 * Bank / cash / clearing accounts. Each BankAccount owns exactly one ledger
 * account (created or linked in the same transaction).
 */
import type { BankAccount, BankAccountKind, LedgerAccountSubtype, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, isZero, toApiString, toApiStringOrNull } from "@/lib/accounting/money";
import { assertLocationWritable, isLocationVisible, locationWhere } from "@/lib/accounting/scope";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

const KIND_SUBTYPE: Record<BankAccountKind, LedgerAccountSubtype> = {
  bank: "bank",
  cash: "cash",
  petty_cash: "cash",
  till_cash: "cash",
  payment_clearing: "payment_clearing",
  credit_card: "bank",
};

export function toBankAccountDto(b: BankAccount & { ledgerAccount?: { code: string; name: string } | null }, balance?: string | null) {
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    locationId: b.locationId,
    ledgerAccountId: b.ledgerAccountId,
    ledgerAccountCode: b.ledgerAccount?.code ?? null,
    ledgerAccountName: b.ledgerAccount?.name ?? null,
    bankName: b.bankName,
    accountLast4: b.accountLast4,
    currency: b.currency,
    openingBalance: toApiString(b.openingBalance),
    openingBalanceDate: b.openingBalanceDate?.toISOString() ?? null,
    stripeAccountId: b.stripeAccountId,
    isDefault: b.isDefault,
    isActive: b.isActive,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    lastReconciledAt: b.lastReconciledAt?.toISOString() ?? null,
    lastReconciledBalance: toApiStringOrNull(b.lastReconciledBalance),
    balance: balance ?? null,
  };
}

async function nextChildCode(db: Db, orgId: string, baseCode: string): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const code = `${baseCode}-${String(i).padStart(2, "0")}`;
    const exists = await db.ledgerAccount.findUnique({ where: { orgId_code: { orgId, code } } });
    if (!exists) return code;
  }
  throw acctError(ACCT.CODE_TAKEN);
}

const BASE_CODE: Record<BankAccountKind, string> = {
  bank: "1100",
  cash: "1010",
  petty_cash: "1030",
  till_cash: "1020",
  payment_clearing: "1150",
  credit_card: "1100",
};

async function createLedgerForBank(
  db: Db,
  orgId: string,
  input: { name: string; kind: BankAccountKind; locationId: string | null; currency: string | null }
) {
  const parent = await db.ledgerAccount.findUnique({ where: { orgId_code: { orgId, code: "1000" } } });
  const code = await nextChildCode(db, orgId, BASE_CODE[input.kind]);
  return db.ledgerAccount.create({
    data: {
      orgId,
      code,
      name: input.name,
      type: input.kind === "credit_card" ? "liability" : "asset",
      subtype: input.kind === "credit_card" ? "other_liability" : KIND_SUBTYPE[input.kind],
      parentId: input.kind === "credit_card" ? null : parent?.id ?? null,
      cashFlowCategory: "cash",
      locationId: input.locationId,
      currency: input.currency,
    },
  });
}

export const bankAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["bank", "cash", "petty_cash", "till_cash", "payment_clearing", "credit_card"]),
    locationId: z.string().nullable().optional(),
    ledgerAccountId: z.string().nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    accountLast4: z.string().trim().regex(/^\d{2,4}$/).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    openingBalance: z.union([z.string(), z.number()]).optional(),
    openingBalanceDate: z.string().nullable().optional(),
    stripeAccountId: z.string().trim().regex(/^acct_[A-Za-z0-9]+$/).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export async function createBankAccount(ctx: AccountingCtx, raw: unknown, db?: Db) {
  const input = bankAccountSchema.parse(raw);
  const settings = await prisma.accountingSettings.findUniqueOrThrow({ where: { orgId: ctx.orgId } });
  const locationId = await assertLocationWritable(ctx, input.locationId ?? null);
  const currency = input.currency ?? settings.baseCurrency;
  const run = async (tx: Db) => {
    let ledgerAccountId: string;
    if (input.ledgerAccountId) {
      if (!isValidId(input.ledgerAccountId)) throw acctError(ACCT.NOT_FOUND);
      const acct = await tx.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, orgId: ctx.orgId } });
      if (!acct || acct.isHeader) throw acctError(ACCT.MAPPING_TYPE_INVALID);
      if (!["cash", "bank", "payment_clearing", "other_liability"].includes(acct.subtype)) {
        throw acctError(ACCT.MAPPING_TYPE_INVALID);
      }
      const used = await tx.bankAccount.findUnique({ where: { ledgerAccountId: acct.id } });
      if (used) throw acctError(ACCT.BANK_ACCOUNT_IN_USE);
      ledgerAccountId = acct.id;
    } else {
      ledgerAccountId = (await createLedgerForBank(tx, ctx.orgId, { name: input.name, kind: input.kind, locationId, currency })).id;
    }
    if (input.isDefault) {
      await tx.bankAccount.updateMany({ where: { orgId: ctx.orgId, kind: input.kind }, data: { isDefault: false } });
    }
    return tx.bankAccount.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        name: input.name,
        kind: input.kind,
        ledgerAccountId,
        bankName: input.bankName ?? null,
        accountLast4: input.accountLast4 ?? null,
        currency,
        openingBalance: input.openingBalance != null ? D(String(input.openingBalance)) : ZERO,
        openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null,
        stripeAccountId: input.stripeAccountId ?? null,
        isDefault: Boolean(input.isDefault),
      },
      include: { ledgerAccount: { select: { code: true, name: true } } },
    });
  };
  const created = db ? await run(db) : await prisma.$transaction((tx) => run(tx));
  recordAccountingAudit(ctx, {
    action: "bank_account.create",
    entityType: "BankAccount",
    entityId: created.id,
    description: `Bank account ${created.name} created`,
  });
  return toBankAccountDto(created);
}

export async function loadBankAccount(ctx: AccountingCtx, id: string, db: Db = prisma) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const b = await db.bankAccount.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { ledgerAccount: { select: { code: true, name: true } } },
  });
  if (!b) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, b.locationId)) throw acctError(ACCT.NOT_FOUND);
  return b;
}

export async function updateBankAccount(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = bankAccountSchema.partial().strict().parse(raw);
  const b = await loadBankAccount(ctx, id);
  if (input.kind && input.kind !== b.kind) throw acctError(ACCT.ACCOUNT_TYPE_LOCKED);
  if (input.ledgerAccountId && input.ledgerAccountId !== b.ledgerAccountId) throw acctError(ACCT.ACCOUNT_TYPE_LOCKED);
  const locationId = input.locationId !== undefined ? await assertLocationWritable(ctx, input.locationId) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.bankAccount.updateMany({ where: { orgId: ctx.orgId, kind: b.kind }, data: { isDefault: false } });
    }
    if (input.name) await tx.ledgerAccount.update({ where: { id: b.ledgerAccountId }, data: { name: input.name } });
    return tx.bankAccount.update({
      where: { id: b.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
        ...(input.accountLast4 !== undefined ? { accountLast4: input.accountLast4 } : {}),
        ...(input.openingBalance !== undefined ? { openingBalance: D(String(input.openingBalance)) } : {}),
        ...(input.openingBalanceDate !== undefined
          ? { openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : null }
          : {}),
        ...(input.stripeAccountId !== undefined ? { stripeAccountId: input.stripeAccountId } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
      include: { ledgerAccount: { select: { code: true, name: true } } },
    });
  });
  recordAccountingAudit(ctx, {
    action: "bank_account.update",
    entityType: "BankAccount",
    entityId: b.id,
    description: `Bank account ${updated.name} updated`,
    before: toBankAccountDto(b),
    after: toBankAccountDto(updated),
  });
  return toBankAccountDto(updated);
}

export async function archiveBankAccount(ctx: AccountingCtx, id: string) {
  const b = await loadBankAccount(ctx, id);
  const agg = await prisma.journalLine.aggregate({
    where: { orgId: ctx.orgId, ledgerAccountId: b.ledgerAccountId, entry: { status: { in: ["posted", "reversed"] } } },
    _sum: { debit: true, credit: true },
  });
  const bal = D(agg._sum.debit ?? 0).sub(D(agg._sum.credit ?? 0));
  const unreconciled = await prisma.bankTransaction.count({
    where: { bankAccountId: b.id, status: { in: ["unmatched", "matched"] } },
  });
  if (!isZero(bal) || unreconciled > 0) {
    throw acctError(ACCT.BANK_ACCOUNT_IN_USE, { details: { balance: toApiString(bal), unreconciled } });
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.ledgerAccount.update({ where: { id: b.ledgerAccountId }, data: { isActive: false, archivedAt: new Date() } });
    return tx.bankAccount.update({
      where: { id: b.id },
      data: { isActive: false, archivedAt: new Date(), isDefault: false },
      include: { ledgerAccount: { select: { code: true, name: true } } },
    });
  });
  recordAccountingAudit(ctx, {
    action: "bank_account.archive",
    entityType: "BankAccount",
    entityId: b.id,
    description: `Bank account ${b.name} archived`,
  });
  return toBankAccountDto(updated);
}

export async function listBankAccounts(ctx: AccountingCtx, opts: { includeArchived?: boolean } = {}) {
  const where: Prisma.BankAccountWhereInput = {
    orgId: ctx.orgId,
    ...(opts.includeArchived ? {} : { archivedAt: null }),
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  const rows = await prisma.bankAccount.findMany({
    where,
    include: { ledgerAccount: { select: { code: true, name: true } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  const balances = await prisma.journalLine.groupBy({
    by: ["ledgerAccountId"],
    where: {
      orgId: ctx.orgId,
      ledgerAccountId: { in: rows.map((r) => r.ledgerAccountId) },
      entry: { status: { in: ["posted", "reversed"] } },
      ...locationWhere(ctx.scope),
    },
    _sum: { debit: true, credit: true },
  });
  const unmatched = await prisma.bankTransaction.groupBy({
    by: ["bankAccountId"],
    where: {
      orgId: ctx.orgId,
      bankAccountId: { in: rows.map((r) => r.id) },
      status: "unmatched",
    },
    _count: { _all: true },
  });
  const balBy = new Map(
    balances.map((b) => [
      b.ledgerAccountId,
      D(b._sum.debit ?? 0).sub(D(b._sum.credit ?? 0)),
    ])
  );
  const unmatchedBy = new Map(
    unmatched.map((u) => [u.bankAccountId, u._count._all])
  );
  return rows.map((r) => ({
    ...toBankAccountDto(r, toApiString(balBy.get(r.ledgerAccountId) ?? ZERO)),
    unmatchedCount: unmatchedBy.get(r.id) ?? 0,
  }));
}

/**
 * Setup defaults: cash on hand, bank operating, petty cash, Stripe clearing
 * (org Connect), a till cash account per active venue, a Stripe clearing
 * account per franchise park Connect account, Paystack clearing if configured.
 */
export async function setupDefaultBankAccounts(tx: Db, orgId: string, currency: string): Promise<void> {
  const sys = await tx.ledgerAccount.findMany({
    where: { orgId, systemKey: { in: ["cash_on_hand", "bank_default", "petty_cash", "stripe_clearing", "paystack_clearing", "till_cash"] } },
  });
  const bySys = new Map(sys.map((s) => [s.systemKey!, s]));
  const existing = await tx.bankAccount.findMany({ where: { orgId }, select: { ledgerAccountId: true, stripeAccountId: true, locationId: true, kind: true } });
  const linked = new Set(existing.map((e) => e.ledgerAccountId));
  const orgConnect = await tx.organizationMarketplaceAccount.findUnique({
    where: { orgId },
    select: { stripeConnectedAccountId: true },
  });
  const defaults: Array<{ key: "cash_on_hand" | "bank_default" | "petty_cash" | "stripe_clearing" | "paystack_clearing"; name: string; kind: BankAccountKind; stripe?: string | null }> = [
    { key: "cash_on_hand", name: "Cash on hand", kind: "cash" },
    { key: "bank_default", name: "Bank operating", kind: "bank" },
    { key: "petty_cash", name: "Petty cash", kind: "petty_cash" },
    { key: "stripe_clearing", name: "Stripe clearing", kind: "payment_clearing", stripe: orgConnect?.stripeConnectedAccountId ?? null },
    ...(process.env.PAYSTACK_SECRET_KEY?.trim()
      ? [{ key: "paystack_clearing" as const, name: "Paystack clearing", kind: "payment_clearing" as const }]
      : []),
  ];
  for (const d of defaults) {
    const acct = bySys.get(d.key);
    if (!acct || linked.has(acct.id)) continue;
    await tx.bankAccount.create({
      data: { orgId, name: d.name, kind: d.kind, ledgerAccountId: acct.id, currency, isDefault: true, stripeAccountId: d.stripe ?? null },
    });
    linked.add(acct.id);
  }
  const venues = await tx.venueLocation.findMany({ where: { orgId, status: "active" }, select: { id: true, name: true } });
  const tillParent = bySys.get("till_cash");
  for (const v of venues) {
    if (existing.some((e) => e.kind === "till_cash" && e.locationId === v.id)) continue;
    const ledger = await createLedgerForBank(tx, orgId, { name: `Till cash – ${v.name}`, kind: "till_cash", locationId: v.id, currency });
    if (tillParent?.parentId) await tx.ledgerAccount.update({ where: { id: ledger.id }, data: { parentId: tillParent.parentId } });
    await tx.bankAccount.create({
      data: { orgId, name: `Till cash – ${v.name}`, kind: "till_cash", ledgerAccountId: ledger.id, locationId: v.id, currency },
    });
    await tx.accountingMapping.create({
      data: { orgId, kind: "location_default", matchKey: "till_cash", locationId: v.id, ledgerAccountId: ledger.id },
    });
  }
  const parks = await tx.venueLocationMarketplaceAccount.findMany({
    where: { orgId, stripeConnectedAccountId: { not: null } },
    select: { stripeConnectedAccountId: true, locationId: true, location: { select: { name: true } } },
  });
  for (const p of parks) {
    if (!p.stripeConnectedAccountId || existing.some((e) => e.stripeAccountId === p.stripeConnectedAccountId)) continue;
    const name = `Stripe clearing – ${p.location.name}`;
    const ledger = await createLedgerForBank(tx, orgId, { name, kind: "payment_clearing", locationId: p.locationId, currency });
    await tx.bankAccount.create({
      data: { orgId, name, kind: "payment_clearing", ledgerAccountId: ledger.id, locationId: p.locationId, currency, stripeAccountId: p.stripeConnectedAccountId },
    });
  }
}
