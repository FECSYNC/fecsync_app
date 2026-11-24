/**
 * Manual invoices and credit notes on BookingInvoice (the only invoice model).
 * Booking-kind invoices stay owned by src/lib/ticketing/invoices.ts.
 */
import type { BookingInvoice, BookingInvoiceLine, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { parsePartyKey, partyDisplayNames } from "@/lib/accounting/partyKeys";
import { computeTax } from "@/lib/accounting/taxCodes";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postManualInvoice, postWriteOff, voidManualInvoicePosting, invoiceParty } from "@/lib/accounting/posting/receivables";
import { requestApproval } from "@/lib/accounting/approvals";
import { nextInvoiceNumber, newInvoiceViewToken } from "@/lib/ticketing/invoices";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import type { AccountingCtx, Db } from "@/lib/accounting/types";

export function toAccountingInvoiceDto(
  i: BookingInvoice & { lines?: BookingInvoiceLine[] },
  extra: { customerLabel?: string | null } = {}
) {
  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    status: i.status,
    locationId: i.locationId,
    bookingId: i.bookingId,
    accountId: i.accountId,
    guestProfileId: i.guestProfileId,
    customerUserId: i.customerUserId,
    customerName: i.customerName ?? extra.customerLabel ?? null,
    customerEmail: i.customerEmail,
    issueDate: i.issueDate?.toISOString() ?? null,
    dueAt: i.dueAt?.toISOString() ?? null,
    sentAt: i.sentAt?.toISOString() ?? null,
    voidedAt: i.voidedAt?.toISOString() ?? null,
    currency: i.currency,
    subtotal: toApiString(i.subtotal),
    taxTotal: toApiString(i.taxTotal),
    amount: toApiString(i.amount),
    amountPaid: toApiString(i.amountPaid),
    amountDue: toApiString(i.amountDue),
    paymentTermsDays: i.paymentTermsDays,
    appliesToInvoiceId: i.appliesToInvoiceId,
    journalEntryId: i.journalEntryId,
    hasViewToken: Boolean(i.viewToken),
    /** Staff-only: public pay/view path uses this token. */
    viewToken: i.viewToken ?? null,
    writtenOffAt: i.writtenOffAt?.toISOString() ?? null,
    writeOffReason: i.writeOffReason,
    memo: i.memo,
    reminderCount: i.reminderCount,
    lastReminderAt: i.lastReminderAt?.toISOString() ?? null,
    lines:
      i.lines?.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        ledgerAccountId: l.ledgerAccountId,
        qty: D(l.qty).toString(),
        unitPrice: D(l.unitPrice).toFixed(4),
        taxCodeId: l.taxCodeId,
        taxAmount: toApiString(l.taxAmount),
        lineTotal: toApiString(l.lineTotal),
        locationId: l.locationId,
      })) ?? [],
    createdAt: i.createdAt.toISOString(),
  };
}

const lineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    ledgerAccountId: z.string().min(1),
    qty: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    unitPrice: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    taxCodeId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
  })
  .strict();

export const invoiceSchema = z
  .object({
    kind: z.enum(["manual", "credit_note"]).default("manual"),
    partyKey: z.string().min(3),
    locationId: z.string().min(1),
    issueDate: z.string().min(10),
    dueAt: z.string().min(10).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    memo: z.string().max(2000).nullable().optional(),
    appliesToInvoiceId: z.string().nullable().optional(),
    taxInclusive: z.boolean().optional(),
    lines: z.array(lineSchema).min(1).max(200),
  })
  .strict();

async function buildLines(ctx: AccountingCtx, input: z.infer<typeof invoiceSchema>) {
  const accountIds = [...new Set(input.lines.map((l) => l.ledgerAccountId))];
  const accounts = await prisma.ledgerAccount.findMany({ where: { orgId: ctx.orgId, id: { in: accountIds } } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const taxIds = [...new Set(input.lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x)))];
  const taxCodes = taxIds.length ? await prisma.taxCode.findMany({ where: { orgId: ctx.orgId, id: { in: taxIds }, isActive: true } }) : [];
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));
  let subtotal = ZERO;
  let taxTotal = ZERO;
  const lines: Prisma.BookingInvoiceLineCreateManyInvoiceInput[] = [];
  for (const [i, l] of input.lines.entries()) {
    if (!l.qty.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.qty`]: "Must be > 0" } });
    if (l.unitPrice.lessThan(0)) throw acctError(ACCT.VALIDATION, { fields: { [`lines.${i}.unitPrice`]: "Must be ≥ 0" } });
    const acct = byId.get(l.ledgerAccountId);
    if (!acct || acct.type !== "revenue" || acct.isHeader || acct.archivedAt) {
      throw acctError(ACCT.MAPPING_TYPE_INVALID, { fields: { [`lines.${i}.ledgerAccountId`]: "Choose an active revenue account" } });
    }
    const tax = l.taxCodeId ? taxById.get(l.taxCodeId) : null;
    if (l.taxCodeId && !tax) throw acctError(ACCT.NOT_FOUND, { fields: { [`lines.${i}.taxCodeId`]: "Unknown tax code" } });
    const lineLoc = l.locationId ? await assertLocationWritable(ctx, l.locationId) : null;
    const gross = round2(l.qty.mul(l.unitPrice));
    const t = computeTax(gross, tax ?? null, Boolean(input.taxInclusive));
    subtotal = subtotal.add(t.net);
    taxTotal = taxTotal.add(t.tax);
    lines.push({
      orgId: ctx.orgId,
      lineNo: i + 1,
      description: l.description,
      ledgerAccountId: acct.id,
      qty: l.qty,
      unitPrice: l.unitPrice,
      taxCodeId: tax?.id ?? null,
      taxAmount: t.tax,
      lineTotal: t.net,
      locationId: lineLoc,
    });
  }
  return { lines, subtotal: round2(subtotal), taxTotal: round2(taxTotal), total: round2(subtotal.add(taxTotal)) };
}

async function loadInvoice(ctx: AccountingCtx, id: string, db: Db = prisma) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const inv = await db.bookingInvoice.findFirst({ where: { id, orgId: ctx.orgId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!inv) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, inv.locationId)) throw acctError(ACCT.NOT_FOUND);
  return inv;
}

function assertManualKind(inv: BookingInvoice) {
  if (inv.kind === "booking") throw acctError(ACCT.INVOICE_KIND_LOCKED);
}

export async function createManualInvoice(ctx: AccountingCtx, raw: unknown) {
  const input = invoiceSchema.parse(raw);
  const settings = await requireAccountingSettings(ctx.orgId);
  const party = await parsePartyKey(ctx.orgId, input.partyKey);
  if (party.type === "supplier" || party.type === "employee") throw acctError(ACCT.PARTY_REQUIRED, { fields: { partyKey: "Choose a customer" } });
  const locationId = (await assertLocationWritable(ctx, input.locationId))!;
  const issueDate = parseDateInput(input.issueDate, settings.timezone, "issueDate");
  const terms = input.paymentTermsDays ?? settings.defaultPaymentTermsDays;
  const dueAt = input.dueAt ? parseDateInput(input.dueAt, settings.timezone, "dueAt") : new Date(issueDate.getTime() + terms * 86_400_000);
  if (dueAt < issueDate) throw acctError(ACCT.VALIDATION, { fields: { dueAt: "Due date must be on or after the issue date" } });
  const currency = input.currency ?? settings.baseCurrency;
  if (currency !== settings.baseCurrency) throw acctError(ACCT.CURRENCY_MISMATCH, { fields: { currency: `Invoices are issued in ${settings.baseCurrency}` } });
  const built = await buildLines(ctx, input);
  if (input.kind === "credit_note") {
    if (!input.appliesToInvoiceId) throw acctError(ACCT.VALIDATION, { fields: { appliesToInvoiceId: "Required for a credit note" } });
    const target = await loadInvoice(ctx, input.appliesToInvoiceId);
    assertManualKind(target);
    if (target.kind !== "manual" || !["sent", "overdue"].includes(target.status)) throw acctError(ACCT.INVOICE_NOT_ISSUED);
    if (built.total.greaterThan(D(target.amountDue))) throw acctError(ACCT.OVERALLOCATION, { details: { amountDue: toApiString(target.amountDue) } });
    const tp = invoiceParty(target);
    if (!tp || tp.type !== party.type || tp.id !== party.id) throw acctError(ACCT.ALLOCATION_PARTY_MISMATCH);
  }
  const names = await partyDisplayNames(ctx.orgId, [party]);
  const display = names.get(`${party.type}:${party.id}`);
  let created: BookingInvoice | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      const number = await nextInvoiceNumber(ctx.orgId, prisma, attempt);
      created = await prisma.bookingInvoice.create({
        data: {
          orgId: ctx.orgId,
          locationId,
          number,
          kind: input.kind,
          status: "draft",
          accountId: party.type === "account" ? party.id : null,
          guestProfileId: party.type === "guest" ? party.id : null,
          customerUserId: party.type === "user" ? party.id : null,
          customerName: display?.name ?? null,
          customerEmail: display?.email ?? null,
          issueDate,
          dueAt,
          paymentTermsDays: terms,
          currency,
          subtotal: built.subtotal,
          taxTotal: built.taxTotal,
          amount: built.total,
          amountDue: built.total,
          appliesToInvoiceId: input.kind === "credit_note" ? input.appliesToInvoiceId : null,
          memo: input.memo ?? null,
          lines: { createMany: { data: built.lines } },
        },
      });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code !== "P2002") throw err;
    }
  }
  if (!created) throw acctError(ACCT.CODE_TAKEN);
  recordAccountingAudit(ctx, {
    action: "invoice.create",
    entityType: "BookingInvoice",
    entityId: created.id,
    description: `${input.kind === "credit_note" ? "Credit note" : "Invoice"} ${created.number} drafted`,
  });
  return getInvoice(ctx, created.id);
}

export async function updateManualInvoice(ctx: AccountingCtx, id: string, raw: unknown) {
  const inv = await loadInvoice(ctx, id);
  assertManualKind(inv);
  if (inv.status !== "draft") throw acctError(ACCT.JOURNAL_NOT_EDITABLE, { message: "Only draft invoices can be edited" });
  const input = invoiceSchema.parse(raw);
  if (input.kind !== inv.kind) throw acctError(ACCT.INVOICE_KIND_LOCKED);
  const settings = await requireAccountingSettings(ctx.orgId);
  const party = await parsePartyKey(ctx.orgId, input.partyKey);
  const locationId = (await assertLocationWritable(ctx, input.locationId))!;
  const issueDate = parseDateInput(input.issueDate, settings.timezone, "issueDate");
  const terms = input.paymentTermsDays ?? settings.defaultPaymentTermsDays;
  const dueAt = input.dueAt ? parseDateInput(input.dueAt, settings.timezone, "dueAt") : new Date(issueDate.getTime() + terms * 86_400_000);
  if (dueAt < issueDate) throw acctError(ACCT.VALIDATION, { fields: { dueAt: "Due date must be on or after the issue date" } });
  const built = await buildLines(ctx, input);
  await prisma.$transaction(async (tx) => {
    await tx.bookingInvoiceLine.deleteMany({ where: { invoiceId: inv.id } });
    await tx.bookingInvoice.update({
      where: { id: inv.id },
      data: {
        locationId,
        accountId: party.type === "account" ? party.id : null,
        guestProfileId: party.type === "guest" ? party.id : null,
        customerUserId: party.type === "user" ? party.id : null,
        issueDate,
        dueAt,
        paymentTermsDays: terms,
        subtotal: built.subtotal,
        taxTotal: built.taxTotal,
        amount: built.total,
        amountDue: built.total,
        memo: input.memo ?? null,
        lines: { createMany: { data: built.lines } },
      },
    });
  });
  recordAccountingAudit(ctx, { action: "invoice.update", entityType: "BookingInvoice", entityId: inv.id, description: `Invoice ${inv.number} edited` });
  return getInvoice(ctx, inv.id);
}

/** amountPaid = receipts allocated + credit notes issued + write-offs. */
export async function recomputeInvoiceBalance(db: Db, invoiceId: string): Promise<void> {
  const inv = await db.bookingInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.kind !== "manual") return;
  const [alloc, credits, writeOffs] = await Promise.all([
    db.customerReceiptAllocation.aggregate({
      where: { invoiceId, receipt: { status: "posted" } },
      _sum: { amount: true },
    }),
    db.bookingInvoice.aggregate({
      where: { appliesToInvoiceId: invoiceId, kind: "credit_note", status: { in: ["sent", "paid", "overdue"] } },
      _sum: { amount: true },
    }),
    db.journalLine.aggregate({
      where: {
        orgId: inv.orgId,
        invoiceId,
        entry: { sourceType: "write_off", status: "posted" },
        account: { systemKey: "accounts_receivable" },
      },
      _sum: { credit: true },
    }),
  ]);
  const paid = round2(D(alloc._sum.amount ?? 0).add(D(credits._sum.amount ?? 0)).add(D(writeOffs._sum.credit ?? 0)));
  const due = round2(D(inv.amount).sub(paid));
  const settled = !due.greaterThan(0);
  let status = inv.status;
  if (inv.status !== "void" && inv.status !== "cancelled" && inv.status !== "draft") {
    status = settled ? "paid" : inv.dueAt && inv.dueAt < new Date() ? "overdue" : "sent";
  }
  await db.bookingInvoice.update({
    where: { id: invoiceId },
    data: { amountPaid: paid, amountDue: settled ? ZERO : due, status },
  });
}

export async function issueInvoice(ctx: AccountingCtx, id: string) {
  const inv = await loadInvoice(ctx, id);
  assertManualKind(inv);
  if (inv.status !== "draft") throw acctError(ACCT.ALREADY_POSTED);
  const settings = await requireAccountingSettings(ctx.orgId);
  await prisma.$transaction(async (tx) => {
    const res = await tx.bookingInvoice.updateMany({
      where: { id: inv.id, status: "draft" },
      data: {
        status: inv.kind === "credit_note" ? "paid" : "sent",
        viewToken: inv.viewToken ?? newInvoiceViewToken(),
        ...(inv.kind === "credit_note" ? { amountDue: ZERO, amountPaid: inv.amount } : {}),
      },
    });
    if (res.count === 0) throw acctError(ACCT.ALREADY_POSTED);
    const pc = await createPostingContext(tx, settings);
    const entry = await postManualInvoice(pc, inv.id);
    await tx.bookingInvoice.update({ where: { id: inv.id }, data: { journalEntryId: entry?.id ?? null } });
    if (inv.kind === "credit_note" && inv.appliesToInvoiceId) {
      await recomputeInvoiceBalance(tx, inv.appliesToInvoiceId);
    }
  });
  recordAccountingAudit(ctx, {
    action: "invoice.issue",
    entityType: "BookingInvoice",
    entityId: inv.id,
    description: `${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.number} issued`,
  });
  void import("@/lib/accounting/notifications")
    .then((n) => n.notifyManualInvoiceIssued(inv.id))
    .catch(() => undefined);
  return getInvoice(ctx, inv.id);
}

export async function voidInvoice(ctx: AccountingCtx, id: string, reason: string) {
  const inv = await loadInvoice(ctx, id);
  assertManualKind(inv);
  if (inv.status === "void" || inv.status === "cancelled") throw acctError(ACCT.ALREADY_REVERSED);
  const allocations = await prisma.customerReceiptAllocation.count({ where: { invoiceId: inv.id, receipt: { status: "posted" } } });
  const credits = await prisma.bookingInvoice.count({ where: { appliesToInvoiceId: inv.id, status: { in: ["sent", "paid", "overdue"] } } });
  if (allocations > 0 || credits > 0 || inv.writtenOffAt) throw acctError(ACCT.INVOICE_HAS_PAYMENTS);
  const settings = await requireAccountingSettings(ctx.orgId);
  await prisma.$transaction(async (tx) => {
    if (inv.status !== "draft") {
      const pc = await createPostingContext(tx, settings);
      await voidManualInvoicePosting(pc, inv.id, inv.kind === "credit_note" ? "credit_note" : "issue", reason, ctx.actorId);
    }
    await tx.bookingInvoice.update({
      where: { id: inv.id },
      data: { status: "void", voidedAt: new Date(), amountDue: ZERO },
    });
    if (inv.kind === "credit_note" && inv.appliesToInvoiceId) await recomputeInvoiceBalance(tx, inv.appliesToInvoiceId);
  });
  recordAccountingAudit(ctx, { action: "invoice.void", entityType: "BookingInvoice", entityId: inv.id, description: `Invoice ${inv.number} voided`, reason });
  return getInvoice(ctx, inv.id);
}

export const writeOffSchema = z
  .object({
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export async function requestWriteOff(ctx: AccountingCtx, id: string, raw: unknown) {
  const input = writeOffSchema.parse(raw);
  const inv = await loadInvoice(ctx, id);
  assertManualKind(inv);
  if (inv.kind !== "manual" || !["sent", "overdue"].includes(inv.status)) throw acctError(ACCT.INVOICE_NOT_ISSUED);
  if (!input.amount.greaterThan(0) || input.amount.greaterThan(D(inv.amountDue))) {
    throw acctError(ACCT.OVERALLOCATION, { details: { amountDue: toApiString(inv.amountDue) } });
  }
  const approval = await prisma.$transaction(async (tx) => {
    await tx.bookingInvoice.update({ where: { id: inv.id }, data: { writeOffReason: input.reason } });
    return requestApproval(tx, {
      orgId: ctx.orgId,
      entity: "write_off",
      entityId: inv.id,
      amount: round2(input.amount),
      requestedById: ctx.actorId ?? "system",
      locationId: inv.locationId,
    });
  });
  recordAccountingAudit(ctx, { action: "invoice.write_off_request", entityType: "BookingInvoice", entityId: inv.id, description: `Write-off requested on ${inv.number}`, reason: input.reason });
  return { approvalId: approval.id, invoice: await getInvoice(ctx, inv.id) };
}

export async function applyApprovedWriteOff(ctx: AccountingCtx, approvalId: string) {
  const approval = await prisma.accountingApproval.findFirst({ where: { id: approvalId, orgId: ctx.orgId, entity: "write_off" } });
  if (!approval || approval.status !== "pending") throw acctError(ACCT.NOT_FOUND);
  const settings = await requireAccountingSettings(ctx.orgId);
  if (!settings.allowSelfApproval && approval.requestedById === ctx.actorId) throw acctError(ACCT.SELF_APPROVAL);
  const inv = await loadInvoice(ctx, approval.entityId);
  const amount = D(approval.amount);
  if (amount.greaterThan(D(inv.amountDue))) throw acctError(ACCT.OVERALLOCATION);
  await prisma.$transaction(async (tx) => {
    const pc = await createPostingContext(tx, settings);
    await postWriteOff(pc, inv, amount, `writeoff:${approval.id}`, new Date());
    await tx.bookingInvoice.update({ where: { id: inv.id }, data: { writtenOffAt: new Date() } });
    await recomputeInvoiceBalance(tx, inv.id);
  });
  recordAccountingAudit(ctx, { action: "invoice.write_off", entityType: "BookingInvoice", entityId: inv.id, description: `Write-off ${toApiString(amount)} on ${inv.number}`, reason: inv.writeOffReason });
}

export async function rejectWriteOff(ctx: AccountingCtx, approvalId: string, reason: string) {
  const approval = await prisma.accountingApproval.findFirst({ where: { id: approvalId, orgId: ctx.orgId, entity: "write_off" } });
  if (!approval) throw acctError(ACCT.NOT_FOUND);
  await prisma.bookingInvoice.updateMany({ where: { id: approval.entityId, orgId: ctx.orgId, writtenOffAt: null }, data: { writeOffReason: null } });
  recordAccountingAudit(ctx, { action: "invoice.write_off_reject", entityType: "BookingInvoice", entityId: approval.entityId, description: "Write-off rejected", reason });
}

/** Cron helper (Step 2 schedules it): sent → overdue past due date. */
export async function markOverdueInvoices(orgId: string, now = new Date()): Promise<number> {
  const res = await prisma.bookingInvoice.updateMany({
    where: { orgId, kind: "manual", status: "sent", dueAt: { lt: now }, amountDue: { gt: 0 } },
    data: { status: "overdue" },
  });
  return res.count;
}

export async function getInvoice(ctx: AccountingCtx, id: string) {
  const inv = await loadInvoice(ctx, id);
  const [allocations, creditNotes] = await Promise.all([
    prisma.customerReceiptAllocation.findMany({
      where: { invoiceId: inv.id },
      include: { receipt: { select: { id: true, number: true, receiptDate: true, method: true, status: true } } },
    }),
    prisma.bookingInvoice.findMany({ where: { appliesToInvoiceId: inv.id }, select: { id: true, number: true, amount: true, status: true } }),
  ]);
  return {
    ...toAccountingInvoiceDto(inv),
    allocations: allocations.map((a) => ({
      receiptId: a.receiptId,
      receiptNumber: a.receipt.number,
      date: a.receipt.receiptDate.toISOString(),
      method: a.receipt.method,
      status: a.receipt.status,
      amount: toApiString(a.amount),
    })),
    creditNotes: creditNotes.map((c) => ({ id: c.id, number: c.number, amount: toApiString(c.amount), status: c.status })),
  };
}

export async function listInvoices(
  ctx: AccountingCtx,
  q: { kind?: string; status?: string; partyKey?: string; overdue?: boolean; from?: Date; to?: Date; cursor?: string; limit?: number; q?: string }
) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: Prisma.BookingInvoiceWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (q.kind && ["booking", "manual", "credit_note"].includes(q.kind)) where.kind = q.kind as never;
  if (q.status) where.status = q.status as never;
  if (q.overdue) {
    where.dueAt = { lt: new Date() };
    where.amountDue = { gt: 0 };
    where.status = { in: ["sent", "overdue"] };
  }
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  if (q.partyKey) {
    const p = await parsePartyKey(ctx.orgId, q.partyKey);
    if (p.type === "account") where.accountId = p.id;
    else if (p.type === "guest") where.guestProfileId = p.id;
    else if (p.type === "user") where.customerUserId = p.id;
  }
  if (q.q) {
    where.OR = [
      { number: { contains: q.q, mode: "insensitive" } },
      { customerName: { contains: q.q, mode: "insensitive" } },
      { customerEmail: { contains: q.q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.bookingInvoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map((i) => toAccountingInvoiceDto(i)), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}