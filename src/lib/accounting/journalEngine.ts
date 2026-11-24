/**
 * THE ledger writer. Every JournalEntry / JournalLine / AccountBalance row is
 * written here (R1). Posted entries are immutable; corrections are reversals.
 */
import type {
  AccountingSourceType,
  JournalEntry,
  JournalKind,
  JournalLine,
  LedgerAccount,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { applyBalanceDelta } from "@/lib/accounting/balances";
import { nextNumber } from "@/lib/accounting/sequences";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import {
  assertPeriodOpenForManual,
  getPeriodForDate,
  resolvePostingDateForSystem,
} from "@/lib/accounting/periods";
import {
  accountNeedsParty,
  assertPostable,
  getAccountsByIds,
  getSystemAccount,
} from "@/lib/accounting/accounts";
import { D, ZERO, round2, toApiString, toFx, type Dec } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { partyColumns, parsePartyKey, partyKeyFromLine } from "@/lib/accounting/partyKeys";
import type { AccountingCtx, Db, PartyRef } from "@/lib/accounting/types";
import { ctxHas } from "@/lib/accounting/types";

export const POSTED_STATUSES = ["posted", "reversed"] as const;

export type JournalLineInput = {
  accountId: string;
  /** Signed: positive = debit, negative = credit. Ignored when debit/credit given. */
  amount?: Dec;
  debit?: Dec;
  credit?: Dec;
  locationId?: string | null;
  description?: string | null;
  party?: PartyRef | null;
  taxCodeId?: string | null;
  taxBaseAmount?: Dec | null;
  bookingId?: string | null;
  posSaleId?: string | null;
  invoiceId?: string | null;
  supplierBillId?: string | null;
  expenseId?: string | null;
  posProductId?: string | null;
  shopProductId?: string | null;
};

export type PostJournalInput = {
  orgId: string;
  kind: JournalKind;
  sourceType: AccountingSourceType;
  sourceId?: string | null;
  sourceEvent?: string | null;
  idempotencyKey?: string | null;
  entryDate: Date;
  memo?: string | null;
  reference?: string | null;
  currency?: string | null;
  exchangeRate?: Dec | null;
  locationId?: string | null;
  lines: JournalLineInput[];
  actorId?: string | null;
  attachments?: Prisma.InputJsonValue | null;
  /** Manual journals: control-account, period, and exact-balance rules apply. */
  manual?: boolean;
  reversalOfId?: string | null;
};

type NormalizedLine = {
  input: JournalLineInput;
  debit: Dec;
  credit: Dec;
  foreignAmount: Dec | null;
};

const ROUNDING_TOLERANCE = D("0.05");

function normalizeLines(
  lines: JournalLineInput[],
  fx: { foreign: boolean; rate: Dec }
): NormalizedLine[] {
  const out: NormalizedLine[] = [];
  lines.forEach((l, i) => {
    let debit = l.debit ? D(l.debit) : ZERO;
    let credit = l.credit ? D(l.credit) : ZERO;
    if (l.debit == null && l.credit == null && l.amount != null) {
      const a = D(l.amount);
      if (a.greaterThan(0)) debit = a;
      else credit = a.neg();
    }
    if (debit.lessThan(0) || credit.lessThan(0)) {
      throw acctError(ACCT.LINE_INVALID, { fields: { [`lines.${i}`]: "Amounts must be positive" } });
    }
    if (debit.greaterThan(0) && credit.greaterThan(0)) {
      throw acctError(ACCT.LINE_INVALID, { fields: { [`lines.${i}`]: "A line is either a debit or a credit" } });
    }
    const foreignAmount = fx.foreign ? (debit.greaterThan(0) ? debit : credit.neg()) : null;
    if (fx.foreign) {
      debit = toFx(debit, fx.rate);
      credit = toFx(credit, fx.rate);
    } else {
      debit = round2(debit);
      credit = round2(credit);
    }
    if (debit.isZero() && credit.isZero()) return;
    out.push({ input: l, debit, credit, foreignAmount });
  });
  return out;
}

async function validateAndBalance(
  db: Db,
  input: PostJournalInput,
  baseCurrency: string
): Promise<{ lines: NormalizedLine[]; accounts: Map<string, LedgerAccount>; currency: string; rate: Dec }> {
  const currency = (input.currency || baseCurrency).toUpperCase();
  const foreign = currency !== baseCurrency;
  const rate = foreign ? D(input.exchangeRate ?? 0) : D(1);
  if (foreign && !rate.greaterThan(0)) throw acctError(ACCT.FX_RATE_REQUIRED);
  const lines = normalizeLines(input.lines, { foreign, rate });
  if (lines.length < 2) throw acctError(ACCT.EMPTY_JOURNAL);

  const accounts = await getAccountsByIds(db, input.orgId, lines.map((l) => l.input.accountId));
  lines.forEach((l, i) => {
    const acct = accounts.get(l.input.accountId);
    if (!acct) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.accountId`]: "Unknown account" } });
    assertPostable(acct, { manual: Boolean(input.manual), locationId: l.input.locationId ?? null });
    if (input.manual && accountNeedsParty(acct) && !l.input.party) {
      throw acctError(ACCT.PARTY_REQUIRED, { fields: { [`lines.${i}.party`]: "Party required" } });
    }
  });

  const totalDebit = lines.reduce((a, l) => a.add(l.debit), ZERO);
  const totalCredit = lines.reduce((a, l) => a.add(l.credit), ZERO);
  const diff = totalDebit.sub(totalCredit);
  if (!diff.isZero()) {
    const tolerance = foreign ? D("0.01").mul(lines.length) : input.manual ? ZERO : ROUNDING_TOLERANCE;
    if (diff.abs().greaterThan(tolerance)) {
      throw acctError(ACCT.UNBALANCED, {
        details: { totalDebit: toApiString(totalDebit), totalCredit: toApiString(totalCredit) },
      });
    }
    const rounding = await getSystemAccount(db, input.orgId, foreign ? "fx_gain_loss" : "rounding");
    accounts.set(rounding.id, rounding);
    lines.push({
      input: { accountId: rounding.id, locationId: input.locationId ?? null, description: "Rounding" },
      debit: diff.lessThan(0) ? diff.neg() : ZERO,
      credit: diff.greaterThan(0) ? diff : ZERO,
      foreignAmount: null,
    });
  }
  return { lines, accounts, currency, rate };
}

function lineData(
  orgId: string,
  entryId: string,
  entryDate: Date,
  l: NormalizedLine,
  index: number,
  currency: string,
  foreign: boolean
): Prisma.JournalLineCreateManyInput {
  return {
    orgId,
    entryId,
    lineNo: index + 1,
    ledgerAccountId: l.input.accountId,
    locationId: l.input.locationId ?? null,
    entryDate,
    debit: l.debit,
    credit: l.credit,
    foreignAmount: l.foreignAmount,
    foreignCurrency: foreign ? currency : null,
    description: l.input.description?.slice(0, 500) ?? null,
    ...partyColumns(l.input.party ?? null),
    taxCodeId: l.input.taxCodeId ?? null,
    taxBaseAmount: l.input.taxBaseAmount ?? null,
    bookingId: l.input.bookingId ?? null,
    posSaleId: l.input.posSaleId ?? null,
    invoiceId: l.input.invoiceId ?? null,
    supplierBillId: l.input.supplierBillId ?? null,
    expenseId: l.input.expenseId ?? null,
    posProductId: l.input.posProductId ?? null,
    shopProductId: l.input.shopProductId ?? null,
  };
}

/**
 * Post a balanced entry. Idempotent: an existing idempotencyKey returns the
 * existing entry without writing.
 */
export async function postJournal(db: Db, input: PostJournalInput): Promise<JournalEntry> {
  const settings = await requireAccountingSettings(input.orgId, db);
  if (input.idempotencyKey) {
    const existing = await db.journalEntry.findUnique({
      where: { orgId_idempotencyKey: { orgId: input.orgId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existing;
  }
  const { lines, currency } = await validateAndBalance(db, input, settings.baseCurrency);

  let entryDate = input.entryDate;
  let originalDate: Date | null = null;
  let lateForPeriodId: string | null = null;
  let periodId: string;
  if (input.manual) {
    if (entryDate < settings.goLiveDate && input.kind !== "opening_balance") {
      throw acctError(ACCT.BEFORE_GO_LIVE);
    }
    const period = await getPeriodForDate(db, settings, entryDate);
    assertPeriodOpenForManual(period);
    periodId = period.id;
  } else if (input.kind === "closing") {
    const period = await getPeriodForDate(db, settings, entryDate);
    if (period.status === "locked") throw acctError(ACCT.PERIOD_LOCKED);
    periodId = period.id;
  } else {
    const resolved = await resolvePostingDateForSystem(db, settings, entryDate);
    entryDate = resolved.entryDate;
    originalDate = resolved.originalDate;
    lateForPeriodId = resolved.lateForPeriodId;
    periodId = resolved.period.id;
  }

  const number = await nextNumber(db, input.orgId, "journal");
  const totalDebit = lines.reduce((a, l) => a.add(l.debit), ZERO);
  const totalCredit = lines.reduce((a, l) => a.add(l.credit), ZERO);
  const now = new Date();
  const entry = await db.journalEntry.create({
    data: {
      orgId: input.orgId,
      number,
      entryDate,
      originalDate,
      lateForPeriodId,
      periodId,
      status: "posted",
      kind: input.kind,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceEvent: input.sourceEvent ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      memo: input.memo?.slice(0, 1000) ?? null,
      reference: input.reference?.slice(0, 200) ?? null,
      currency,
      exchangeRate: currency === settings.baseCurrency ? D(1) : D(input.exchangeRate ?? 1),
      totalDebit,
      totalCredit,
      locationId: input.locationId ?? null,
      attachments: input.attachments ?? undefined,
      createdById: input.actorId ?? null,
      postedById: input.actorId ?? null,
      postedAt: now,
      reversalOfId: input.reversalOfId ?? null,
    },
  });
  const foreign = currency !== settings.baseCurrency;
  await db.journalLine.createMany({
    data: lines.map((l, i) => lineData(input.orgId, entry.id, entryDate, l, i, currency, foreign)),
  });
  await applyBalanceDelta(
    db,
    input.orgId,
    periodId,
    lines.map((l) => ({
      ledgerAccountId: l.input.accountId,
      locationId: l.input.locationId ?? null,
      debit: l.debit,
      credit: l.credit,
    }))
  );
  return entry;
}

function reversedLineInputs(lines: JournalLine[]): JournalLineInput[] {
  return lines.map((l) => ({
    accountId: l.ledgerAccountId,
    debit: D(l.credit),
    credit: D(l.debit),
    locationId: l.locationId,
    description: l.description ? `Reversal: ${l.description}`.slice(0, 500) : "Reversal",
    party: partyKeyFromLine(l),
    taxCodeId: l.taxCodeId,
    taxBaseAmount: l.taxBaseAmount ? D(l.taxBaseAmount).neg() : null,
    bookingId: l.bookingId,
    posSaleId: l.posSaleId,
    invoiceId: l.invoiceId,
    supplierBillId: l.supplierBillId,
    expenseId: l.expenseId,
    posProductId: l.posProductId,
    shopProductId: l.shopProductId,
  }));
}

/** Modules reverse their own system entries (voids, cancellations). */
export async function reverseSystemEntry(
  db: Db,
  orgId: string,
  idempotencyKey: string,
  opts: { reason: string; date?: Date; actorId?: string | null }
): Promise<JournalEntry | null> {
  const original = await db.journalEntry.findUnique({
    where: { orgId_idempotencyKey: { orgId, idempotencyKey } },
    include: { lines: true },
  });
  if (!original || original.status !== "posted") return null;
  const reversal = await postJournal(db, {
    orgId,
    kind: "reversal",
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    sourceEvent: `reverse:${original.sourceEvent ?? ""}`,
    idempotencyKey: `${idempotencyKey}:reversal`,
    entryDate: opts.date ?? new Date(),
    memo: `Reversal of ${original.number}: ${opts.reason}`.slice(0, 1000),
    currency: original.currency,
    exchangeRate: D(original.exchangeRate),
    locationId: original.locationId,
    actorId: opts.actorId ?? null,
    reversalOfId: original.id,
    lines: reversedLineInputs(original.lines),
  });
  await db.journalEntry.update({
    where: { id: original.id },
    data: {
      status: "reversed",
      reversedAt: new Date(),
      reversedById: opts.actorId ?? null,
      reversalReason: opts.reason.slice(0, 500),
    },
  });
  return reversal;
}

// ─── Manual journal workflow ───────────────────────────────────────────────

const moneyStr = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, c) => {
    if (v == null || v === "") return ZERO;
    try {
      const d = D(typeof v === "number" ? String(v) : v.trim());
      if (d.lessThan(0)) {
        c.addIssue({ code: z.ZodIssueCode.custom, message: "Must be ≥ 0" });
        return ZERO;
      }
      return d;
    } catch {
      c.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid amount" });
      return ZERO;
    }
  });

export const manualJournalSchema = z
  .object({
    entryDate: z.string().min(10),
    memo: z.string().max(1000).nullable().optional(),
    reference: z.string().max(200).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    exchangeRate: z.union([z.string(), z.number()]).optional(),
    locationId: z.string().nullable().optional(),
    attachments: z.array(z.object({ url: z.string().url(), name: z.string().max(200).optional() })).max(20).optional(),
    submit: z.boolean().optional(),
    lines: z
      .array(
        z
          .object({
            accountId: z.string().min(1),
            debit: moneyStr,
            credit: moneyStr,
            locationId: z.string().nullable().optional(),
            partyKey: z.string().nullable().optional(),
            taxCodeId: z.string().nullable().optional(),
            description: z.string().max(500).nullable().optional(),
          })
          .strict()
      )
      .min(2)
      .max(500),
  })
  .strict();

export type ManualJournalInput = z.infer<typeof manualJournalSchema>;

async function toLineInputs(ctx: AccountingCtx, input: ManualJournalInput): Promise<JournalLineInput[]> {
  const { assertLocationWritable } = await import("@/lib/accounting/scope");
  const out: JournalLineInput[] = [];
  for (const l of input.lines) {
    const locationId = await assertLocationWritable(ctx, l.locationId ?? input.locationId ?? null);
    out.push({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      locationId,
      description: l.description ?? null,
      party: l.partyKey ? await parsePartyKey(ctx.orgId, l.partyKey) : null,
      taxCodeId: l.taxCodeId ?? null,
    });
  }
  return out;
}

async function loadEntry(ctx: AccountingCtx, id: string, db: Db = prisma) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const entry = await db.journalEntry.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { lines: true },
  });
  if (!entry) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !ctx.scope.allLocations) {
    const visible = entry.lines.every((l) => l.locationId && ctx.scope.locationIds.includes(l.locationId));
    if (!visible) throw acctError(ACCT.NOT_FOUND);
  }
  return entry;
}

function entryAmount(lines: Array<{ debit: Prisma.Decimal }>): Dec {
  return lines.reduce((a, l) => a.add(D(l.debit)), ZERO);
}

export async function createManualDraft(ctx: AccountingCtx, raw: unknown) {
  const input = manualJournalSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const entryDate = parseDateInput(input.entryDate, settings.timezone, "entryDate");
  const lines = await toLineInputs(ctx, input);
  const base: PostJournalInput = {
    orgId: ctx.orgId,
    kind: "manual",
    sourceType: "manual",
    entryDate,
    memo: input.memo,
    reference: input.reference,
    currency: input.currency ?? settings.baseCurrency,
    exchangeRate: input.exchangeRate != null ? D(String(input.exchangeRate)) : null,
    locationId: input.locationId ?? null,
    lines,
    actorId: ctx.actorId,
    manual: true,
  };
  const created = await prisma.$transaction(async (tx) => {
    const { lines: norm, currency } = await validateAndBalance(tx, base, settings.baseCurrency);
    if (entryDate < settings.goLiveDate) throw acctError(ACCT.BEFORE_GO_LIVE);
    const period = await getPeriodForDate(tx, settings, entryDate);
    assertPeriodOpenForManual(period);
    const number = await nextNumber(tx, ctx.orgId, "journal");
    const total = norm.reduce((a, l) => a.add(l.debit), ZERO);
    const entry = await tx.journalEntry.create({
      data: {
        orgId: ctx.orgId,
        number,
        entryDate,
        periodId: period.id,
        status: "draft",
        kind: "manual",
        sourceType: "manual",
        memo: base.memo ?? null,
        reference: base.reference ?? null,
        currency,
        exchangeRate: currency === settings.baseCurrency ? D(1) : D(base.exchangeRate ?? 1),
        totalDebit: total,
        totalCredit: norm.reduce((a, l) => a.add(l.credit), ZERO),
        locationId: base.locationId ?? null,
        attachments: input.attachments ?? undefined,
        createdById: ctx.actorId,
      },
    });
    const foreign = currency !== settings.baseCurrency;
    await tx.journalLine.createMany({
      data: norm.map((l, i) => lineData(ctx.orgId, entry.id, entryDate, l, i, currency, foreign)),
    });
    return entry;
  });
  recordAccountingAudit(ctx, {
    action: "journal.create",
    entityType: "JournalEntry",
    entityId: created.id,
    description: `Draft journal ${created.number} created`,
  });
  if (input.submit) return submitForApproval(ctx, created.id);
  return getJournal(ctx, created.id);
}

export async function updateManualDraft(ctx: AccountingCtx, id: string, raw: unknown) {
  const entry = await loadEntry(ctx, id);
  if (entry.kind !== "manual" || !["draft", "pending_approval"].includes(entry.status)) {
    throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  }
  if (entry.createdById !== ctx.actorId && !ctxHas(ctx, "accounting:journals_write")) {
    throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  }
  const input = manualJournalSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const entryDate = parseDateInput(input.entryDate, settings.timezone, "entryDate");
  const lines = await toLineInputs(ctx, input);
  const base: PostJournalInput = {
    orgId: ctx.orgId,
    kind: "manual",
    sourceType: "manual",
    entryDate,
    currency: input.currency ?? settings.baseCurrency,
    exchangeRate: input.exchangeRate != null ? D(String(input.exchangeRate)) : null,
    lines,
    manual: true,
  };
  await prisma.$transaction(async (tx) => {
    const { lines: norm, currency } = await validateAndBalance(tx, base, settings.baseCurrency);
    const period = await getPeriodForDate(tx, settings, entryDate);
    assertPeriodOpenForManual(period);
    const res = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: { in: ["draft", "pending_approval"] } },
      data: {
        entryDate,
        periodId: period.id,
        status: "draft",
        memo: input.memo ?? null,
        reference: input.reference ?? null,
        currency,
        exchangeRate: currency === settings.baseCurrency ? D(1) : D(base.exchangeRate ?? 1),
        totalDebit: norm.reduce((a, l) => a.add(l.debit), ZERO),
        totalCredit: norm.reduce((a, l) => a.add(l.credit), ZERO),
        locationId: input.locationId ?? null,
        attachments: input.attachments ?? undefined,
        submittedAt: null,
        submittedById: null,
      },
    });
    if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
    await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
    const foreign = currency !== settings.baseCurrency;
    await tx.journalLine.createMany({
      data: norm.map((l, i) => lineData(ctx.orgId, entry.id, entryDate, l, i, currency, foreign)),
    });
    await tx.accountingApproval.updateMany({
      where: { entity: "journal_entry", entityId: entry.id, status: "pending" },
      data: { status: "cancelled", decidedAt: new Date(), decidedById: ctx.actorId },
    });
  });
  recordAccountingAudit(ctx, {
    action: "journal.update",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Draft journal ${entry.number} edited`,
  });
  if (input.submit) return submitForApproval(ctx, entry.id);
  return getJournal(ctx, entry.id);
}

export async function deleteManualDraft(ctx: AccountingCtx, id: string) {
  const entry = await loadEntry(ctx, id);
  if (entry.kind !== "manual" || !["draft", "pending_approval"].includes(entry.status)) {
    throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  }
  await prisma.$transaction(async (tx) => {
    await tx.accountingApproval.updateMany({
      where: { entity: "journal_entry", entityId: entry.id, status: "pending" },
      data: { status: "cancelled", decidedAt: new Date(), decidedById: ctx.actorId },
    });
    const res = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: { in: ["draft", "pending_approval"] } },
      data: { status: "void" },
    });
    if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  });
  recordAccountingAudit(ctx, {
    action: "journal.delete",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Draft journal ${entry.number} deleted`,
  });
  return { id: entry.id, status: "void" };
}

export async function submitForApproval(ctx: AccountingCtx, id: string) {
  const entry = await loadEntry(ctx, id);
  if (entry.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const { requestApproval } = await import("@/lib/accounting/approvals");
  await prisma.$transaction(async (tx) => {
    const res = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: "draft" },
      data: { status: "pending_approval", submittedAt: new Date(), submittedById: ctx.actorId },
    });
    if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
    await requestApproval(tx, {
      orgId: ctx.orgId,
      entity: "journal_entry",
      entityId: entry.id,
      amount: entryAmount(entry.lines),
      requestedById: ctx.actorId ?? "system",
      locationId: entry.locationId,
    });
  });
  recordAccountingAudit(ctx, {
    action: "journal.submit",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Journal ${entry.number} submitted for approval`,
  });
  return getJournal(ctx, entry.id);
}

export async function approveJournal(ctx: AccountingCtx, id: string, db: Db = prisma) {
  const entry = await loadEntry(ctx, id, db);
  if (entry.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const settings = await requireAccountingSettings(ctx.orgId, db);
  const maker = entry.submittedById ?? entry.createdById;
  if (!settings.allowSelfApproval && maker && maker === ctx.actorId) {
    throw acctError(ACCT.SELF_APPROVAL);
  }
  const res = await db.journalEntry.updateMany({
    where: { id: entry.id, status: "pending_approval" },
    data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actorId },
  });
  if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  recordAccountingAudit(ctx, {
    action: "journal.approve",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Journal ${entry.number} approved`,
  });
}

export async function rejectJournal(ctx: AccountingCtx, id: string, reason: string, db: Db = prisma) {
  const entry = await loadEntry(ctx, id, db);
  if (entry.status !== "pending_approval") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  const res = await db.journalEntry.updateMany({
    where: { id: entry.id, status: "pending_approval" },
    data: { status: "draft", rejectedById: ctx.actorId, rejectedReason: reason.slice(0, 500) },
  });
  if (res.count === 0) throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  recordAccountingAudit(ctx, {
    action: "journal.reject",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Journal ${entry.number} rejected`,
    reason,
  });
}

/** Post a manual draft/approved journal (approval enforced by settings). */
export async function postManual(ctx: AccountingCtx, id: string) {
  const entry = await loadEntry(ctx, id);
  if (entry.status === "posted" || entry.status === "reversed") throw acctError(ACCT.ALREADY_POSTED);
  if (entry.kind !== "manual" || !["draft", "approved", "pending_approval"].includes(entry.status)) {
    throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  }
  const settings = await requireAccountingSettings(ctx.orgId);
  const amount = entryAmount(entry.lines);
  const threshold = settings.manualJournalApprovalThreshold;
  const needsApproval =
    settings.requireApprovalForManualJournals ||
    (threshold != null && amount.greaterThanOrEqualTo(D(threshold)));
  if (needsApproval && entry.status !== "approved") throw acctError(ACCT.APPROVAL_REQUIRED);
  if (entry.status === "pending_approval") throw acctError(ACCT.APPROVAL_REQUIRED);

  await prisma.$transaction(async (tx) => {
    const accounts = await getAccountsByIds(tx, ctx.orgId, entry.lines.map((l) => l.ledgerAccountId));
    for (const l of entry.lines) {
      const acct = accounts.get(l.ledgerAccountId);
      if (!acct) throw acctError(ACCT.NOT_FOUND);
      assertPostable(acct, { manual: true, locationId: l.locationId });
    }
    const td = entry.lines.reduce((a, l) => a.add(D(l.debit)), ZERO);
    const tc = entry.lines.reduce((a, l) => a.add(D(l.credit)), ZERO);
    if (!td.equals(tc)) throw acctError(ACCT.UNBALANCED);
    const period = await getPeriodForDate(tx, settings, entry.entryDate);
    assertPeriodOpenForManual(period);
    const res = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: entry.status },
      data: { status: "posted", postedAt: new Date(), postedById: ctx.actorId, periodId: period.id },
    });
    if (res.count === 0) throw acctError(ACCT.ALREADY_POSTED);
    await applyBalanceDelta(
      tx,
      ctx.orgId,
      period.id,
      entry.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        locationId: l.locationId,
        debit: D(l.debit),
        credit: D(l.credit),
      }))
    );
  });
  recordAccountingAudit(ctx, {
    action: "journal.post",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Journal ${entry.number} posted`,
  });
  return getJournal(ctx, entry.id);
}

export const reverseSchema = z
  .object({
    reversalDate: z.string().min(10),
    reason: z.string().trim().min(3).max(500),
    correctionLines: manualJournalSchema.shape.lines.optional(),
  })
  .strict();

export async function reverseJournal(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = reverseSchema.parse(raw);
  const entry = await loadEntry(ctx, id);
  if (entry.status === "reversed") throw acctError(ACCT.ALREADY_REVERSED);
  if (entry.status !== "posted") throw acctError(ACCT.JOURNAL_NOT_EDITABLE);
  if (entry.kind === "reversal" || entry.reversalOfId) throw acctError(ACCT.ALREADY_REVERSED);
  const settings = await requireAccountingSettings(ctx.orgId);
  const reversalDate = parseDateInput(input.reversalDate, settings.timezone, "reversalDate");

  let correction: JournalLineInput[] | null = null;
  if (entry.kind !== "manual" && entry.kind !== "adjustment") {
    const suspense = await getSystemAccount(prisma, ctx.orgId, "suspense");
    const hitSuspense = entry.lines.some((l) => l.ledgerAccountId === suspense.id);
    if (!ctxHas(ctx, "accounting:manage") || !hitSuspense || !input.correctionLines?.length) {
      throw acctError(ACCT.SYSTEM_ENTRY_LOCKED);
    }
    correction = await toLineInputs(ctx, {
      entryDate: input.reversalDate,
      lines: input.correctionLines,
    } as ManualJournalInput);
  }

  const result = await prisma.$transaction(async (tx) => {
    const period = await getPeriodForDate(tx, settings, reversalDate);
    assertPeriodOpenForManual(period);
    const reversal = await postJournal(tx, {
      orgId: ctx.orgId,
      kind: "reversal",
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceEvent: `reverse:${entry.sourceEvent ?? entry.number}`,
      idempotencyKey: `reversal:${entry.id}`,
      entryDate: reversalDate,
      memo: `Reversal of ${entry.number}: ${input.reason}`.slice(0, 1000),
      currency: entry.currency,
      exchangeRate: D(entry.exchangeRate),
      locationId: entry.locationId,
      actorId: ctx.actorId,
      reversalOfId: entry.id,
      lines: reversedLineInputs(entry.lines),
    });
    const res = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: "posted" },
      data: {
        status: "reversed",
        reversedAt: new Date(),
        reversedById: ctx.actorId,
        reversalReason: input.reason,
      },
    });
    if (res.count === 0) throw acctError(ACCT.ALREADY_REVERSED);
    let corrected: JournalEntry | null = null;
    if (correction) {
      corrected = await postJournal(tx, {
        orgId: ctx.orgId,
        kind: "adjustment",
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceEvent: `correct:${entry.sourceEvent ?? entry.number}`,
        idempotencyKey: `correction:${entry.id}`,
        entryDate: reversalDate,
        memo: `Correction of ${entry.number}: ${input.reason}`.slice(0, 1000),
        actorId: ctx.actorId,
        lines: correction,
      });
    }
    return { reversal, corrected };
  });
  recordAccountingAudit(ctx, {
    action: "journal.reverse",
    entityType: "JournalEntry",
    entityId: entry.id,
    description: `Journal ${entry.number} reversed by ${result.reversal.number}`,
    reason: input.reason,
    metadata: { reversalId: result.reversal.id, correctionId: result.corrected?.id ?? null },
  });
  return getJournal(ctx, result.reversal.id);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export function toJournalLineDto(l: JournalLine & { account?: LedgerAccount | null }) {
  return {
    id: l.id,
    lineNo: l.lineNo,
    accountId: l.ledgerAccountId,
    accountCode: l.account?.code ?? null,
    accountName: l.account?.name ?? null,
    locationId: l.locationId,
    debit: toApiString(l.debit),
    credit: toApiString(l.credit),
    foreignAmount: l.foreignAmount ? toApiString(l.foreignAmount) : null,
    foreignCurrency: l.foreignCurrency,
    description: l.description,
    partyType: l.partyType,
    partyKey: (() => {
      const p = partyKeyFromLine(l);
      return p ? `${p.type}:${p.id}` : null;
    })(),
    taxCodeId: l.taxCodeId,
    bookingId: l.bookingId,
    posSaleId: l.posSaleId,
    invoiceId: l.invoiceId,
    supplierBillId: l.supplierBillId,
    expenseId: l.expenseId,
    reconciled: Boolean(l.reconciledInId),
  };
}

export function toJournalDto(
  e: JournalEntry & { lines?: Array<JournalLine & { account?: LedgerAccount | null }> }
) {
  return {
    id: e.id,
    number: e.number,
    entryDate: e.entryDate.toISOString(),
    originalDate: e.originalDate?.toISOString() ?? null,
    periodId: e.periodId,
    status: e.status,
    kind: e.kind,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    sourceEvent: e.sourceEvent,
    memo: e.memo,
    reference: e.reference,
    currency: e.currency,
    exchangeRate: D(e.exchangeRate).toString(),
    totalDebit: toApiString(e.totalDebit),
    totalCredit: toApiString(e.totalCredit),
    locationId: e.locationId,
    attachments: e.attachments ?? null,
    createdById: e.createdById,
    submittedById: e.submittedById,
    submittedAt: e.submittedAt?.toISOString() ?? null,
    approvedById: e.approvedById,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    rejectedReason: e.rejectedReason,
    postedById: e.postedById,
    postedAt: e.postedAt?.toISOString() ?? null,
    reversalOfId: e.reversalOfId,
    reversedAt: e.reversedAt?.toISOString() ?? null,
    reversalReason: e.reversalReason,
    createdAt: e.createdAt.toISOString(),
    lines: e.lines?.map(toJournalLineDto) ?? [],
  };
}

export type JournalDto = ReturnType<typeof toJournalDto>;

export async function getJournal(ctx: AccountingCtx, id: string) {
  await loadEntry(ctx, id);
  const entry = await prisma.journalEntry.findFirstOrThrow({
    where: { id, orgId: ctx.orgId },
    include: {
      lines: { include: { account: true }, orderBy: { lineNo: "asc" } },
      reversedBy: { select: { id: true, number: true } },
    },
  });
  const approvals = await prisma.accountingApproval.findMany({
    where: { orgId: ctx.orgId, entity: "journal_entry", entityId: id },
    orderBy: { requestedAt: "desc" },
  });
  return {
    ...toJournalDto(entry),
    reversedBy: entry.reversedBy ?? null,
    approvals: approvals.map((a) => ({
      id: a.id,
      status: a.status,
      requestedById: a.requestedById,
      requestedAt: a.requestedAt.toISOString(),
      decidedById: a.decidedById,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionReason: a.decisionReason,
    })),
  };
}

export async function listJournals(
  ctx: AccountingCtx,
  filters: {
    from?: Date;
    to?: Date;
    status?: string;
    kind?: string;
    sourceType?: string;
    accountId?: string;
    locationId?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }
) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where: Prisma.JournalEntryWhereInput = {
    orgId: ctx.orgId,
    status: filters.status ? (filters.status as never) : { not: "void" },
  };
  if (filters.from || filters.to) {
    where.entryDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.kind) where.kind = filters.kind as never;
  if (filters.sourceType) where.sourceType = filters.sourceType as never;
  if (filters.q) {
    where.OR = [
      { number: { contains: filters.q, mode: "insensitive" } },
      { memo: { contains: filters.q, mode: "insensitive" } },
      { reference: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  /**
   * Line filters use a single `some` predicate (index-friendly EXISTS).
   * Never combine with `lines.every` — that forced a full-line scan per entry
   * and made ?accountId=&locationId= hard refreshes very slow.
   */
  const lineSome: Prisma.JournalLineWhereInput = {};
  if (filters.accountId && isValidId(filters.accountId)) {
    lineSome.ledgerAccountId = filters.accountId;
  }
  if (filters.locationId && isValidId(filters.locationId)) {
    lineSome.locationId = filters.locationId;
  } else if (!ctx.scope.allLocations) {
    lineSome.locationId = { in: ctx.scope.locationIds };
  }
  if (Object.keys(lineSome).length > 0) {
    where.lines = { some: lineSome };
  }

  const rows = await prisma.journalEntry.findMany({
    where,
    orderBy: [{ entryDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    // List view does not need lines / attachments payloads.
    select: {
      id: true,
      number: true,
      entryDate: true,
      originalDate: true,
      periodId: true,
      status: true,
      kind: true,
      sourceType: true,
      sourceId: true,
      sourceEvent: true,
      memo: true,
      reference: true,
      currency: true,
      exchangeRate: true,
      totalDebit: true,
      totalCredit: true,
      locationId: true,
      attachments: true,
      createdById: true,
      submittedById: true,
      submittedAt: true,
      approvedById: true,
      approvedAt: true,
      rejectedReason: true,
      postedById: true,
      postedAt: true,
      reversalOfId: true,
      reversedAt: true,
      reversalReason: true,
      createdAt: true,
    },
    ...(filters.cursor && isValidId(filters.cursor)
      ? { cursor: { id: filters.cursor }, skip: 1 }
      : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((e) => toJournalDto(e)),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
