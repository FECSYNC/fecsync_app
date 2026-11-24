/**
 * Customer receipts for manual invoices / on-account money (booking payments
 * stay BookingPayment). Allocations only to manual invoices of the same party.
 */
import type { CustomerReceipt, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import { acctError, ACCT } from "@/lib/accounting/errors";
import { recordAccountingAudit } from "@/lib/accounting/audit";
import { D, ZERO, round2, toApiString, type Dec } from "@/lib/accounting/money";
import { parseDateInput } from "@/lib/accounting/dates";
import { nextNumber } from "@/lib/accounting/sequences";
import { parsePartyKey } from "@/lib/accounting/partyKeys";
import { assertLocationWritable, isLocationVisible } from "@/lib/accounting/scope";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { postCustomerReceipt, postReceiptRefund, invoiceParty } from "@/lib/accounting/posting/receivables";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import { recomputeInvoiceBalance } from "@/lib/accounting/receivables/manualInvoices";
import { requireAccountingSettings } from "@/lib/accounting/settings";
import type { AccountingCtx, Db, PartyRef } from "@/lib/accounting/types";

export function toReceiptDto(r: CustomerReceipt & { allocations?: Array<{ invoiceId: string; amount: Prisma.Decimal }> }) {
  return {
    id: r.id,
    number: r.number,
    receiptDate: r.receiptDate.toISOString(),
    locationId: r.locationId,
    partyKey: r.bookingAccountId
      ? `account:${r.bookingAccountId}`
      : r.guestProfileId
        ? `guest:${r.guestProfileId}`
        : r.customerUserId
          ? `user:${r.customerUserId}`
          : null,
    method: r.method,
    bankAccountId: r.bankAccountId,
    amount: toApiString(r.amount),
    unappliedAmount: toApiString(r.unappliedAmount),
    refundedAmount: toApiString(r.refundedAmount),
    currency: r.currency,
    reference: r.reference,
    status: r.status,
    journalEntryId: r.journalEntryId,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    allocations: r.allocations?.map((a) => ({ invoiceId: a.invoiceId, amount: toApiString(a.amount) })) ?? [],
    createdAt: r.createdAt.toISOString(),
  };
}

const allocationSchema = z
  .object({
    invoiceId: z.string().min(1),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
  })
  .strict();

export const receiptSchema = z
  .object({
    partyKey: z.string().min(3),
    method: z.enum(["bank_transfer", "cash", "card", "cheque", "mobile_money", "other"]),
    bankAccountId: z.string().min(1),
    amount: z.union([z.string(), z.number()]).transform((v) => D(String(v))),
    receiptDate: z.string().min(10),
    reference: z.string().trim().max(200).nullable().optional(),
    locationId: z.string().nullable().optional(),
    allocations: z.array(allocationSchema).max(200).default([]),
  })
  .strict();

function sameParty(a: PartyRef | null, b: PartyRef): boolean {
  return Boolean(a && a.type === b.type && a.id === b.id);
}

async function applyAllocations(
  db: Db,
  ctx: AccountingCtx,
  receipt: { id: string; amount: Dec; alreadyAllocated: Dec },
  party: PartyRef,
  allocations: Array<{ invoiceId: string; amount: Dec }>
): Promise<Dec> {
  let total = receipt.alreadyAllocated;
  for (const a of allocations) {
    if (!a.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { allocations: "Amounts must be > 0" } });
    if (!isValidId(a.invoiceId)) throw acctError(ACCT.NOT_FOUND);
    const inv = await db.bookingInvoice.findFirst({ where: { id: a.invoiceId, orgId: ctx.orgId } });
    if (!inv) throw acctError(ACCT.NOT_FOUND);
    if (inv.kind !== "manual") throw acctError(ACCT.INVOICE_KIND_LOCKED);
    if (!["sent", "overdue"].includes(inv.status)) throw acctError(ACCT.INVOICE_NOT_ISSUED);
    if (!sameParty(invoiceParty(inv), party)) throw acctError(ACCT.ALLOCATION_PARTY_MISMATCH);
    if (a.amount.greaterThan(D(inv.amountDue))) throw acctError(ACCT.OVERALLOCATION, { details: { invoiceId: inv.id, amountDue: toApiString(inv.amountDue) } });
    total = total.add(a.amount);
    if (total.greaterThan(receipt.amount)) throw acctError(ACCT.OVERALLOCATION);
    const existing = await db.customerReceiptAllocation.findUnique({ where: { receiptId_invoiceId: { receiptId: receipt.id, invoiceId: inv.id } } });
    if (existing) {
      await db.customerReceiptAllocation.update({ where: { id: existing.id }, data: { amount: D(existing.amount).add(a.amount) } });
    } else {
      await db.customerReceiptAllocation.create({ data: { orgId: ctx.orgId, receiptId: receipt.id, invoiceId: inv.id, amount: a.amount } });
    }
    await recomputeInvoiceBalance(db, inv.id);
  }
  return total;
}

export async function createReceipt(ctx: AccountingCtx, raw: unknown) {
  const input = receiptSchema.parse(raw);
  if (!input.amount.greaterThan(0)) throw acctError(ACCT.VALIDATION, { fields: { amount: "Must be > 0" } });
  const settings = await requireAccountingSettings(ctx.orgId);
  const party = await parsePartyKey(ctx.orgId, input.partyKey);
  if (party.type === "supplier" || party.type === "employee") throw acctError(ACCT.PARTY_REQUIRED, { fields: { partyKey: "Choose a customer" } });
  const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, orgId: ctx.orgId, archivedAt: null } });
  if (!bank || !isLocationVisible(ctx.scope, bank.locationId)) throw acctError(ACCT.NOT_FOUND, { fields: { bankAccountId: "Unknown bank account" } });
  const locationId = await assertLocationWritable(ctx, input.locationId ?? bank.locationId ?? null);
  const receiptDate = parseDateInput(input.receiptDate, settings.timezone, "receiptDate");
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "receipt");
    const r = await tx.customerReceipt.create({
      data: {
        orgId: ctx.orgId,
        locationId,
        number,
        receiptDate,
        guestProfileId: party.type === "guest" ? party.id : null,
        bookingAccountId: party.type === "account" ? party.id : null,
        customerUserId: party.type === "user" ? party.id : null,
        method: input.method,
        bankAccountId: bank.id,
        amount: round2(input.amount),
        unappliedAmount: round2(input.amount),
        currency: settings.baseCurrency,
        reference: input.reference ?? null,
        createdById: ctx.actorId,
      },
    });
    const allocated = await applyAllocations(tx, ctx, { id: r.id, amount: r.amount as unknown as Dec, alreadyAllocated: ZERO }, party, input.allocations);
    const pc = await createPostingContext(tx, settings);
    const entry = await postCustomerReceipt(pc, r.id);
    return tx.customerReceipt.update({
      where: { id: r.id },
      data: { unappliedAmount: round2(D(r.amount).sub(allocated)), journalEntryId: entry?.id ?? null },
      include: { allocations: true },
    });
  });
  recordAccountingAudit(ctx, { action: "receipt.create", entityType: "CustomerReceipt", entityId: created.id, description: `Receipt ${created.number} ${toApiString(created.amount)}` });
  return toReceiptDto(created);
}

export async function allocateUnapplied(ctx: AccountingCtx, receiptId: string, raw: unknown) {
  const { allocations } = z.object({ allocations: z.array(allocationSchema).min(1).max(200) }).strict().parse(raw);
  const r = await loadReceipt(ctx, receiptId);
  if (r.status !== "posted") throw acctError(ACCT.ALREADY_REVERSED);
  const party = toParty(r);
  if (!party) throw acctError(ACCT.PARTY_REQUIRED);
  const updated = await prisma.$transaction(async (tx) => {
    const already = r.allocations.reduce((a, x) => a.add(D(x.amount)), ZERO);
    const total = await applyAllocations(tx, ctx, { id: r.id, amount: D(r.amount), alreadyAllocated: already }, party, allocations);
    return tx.customerReceipt.update({
      where: { id: r.id },
      data: { unappliedAmount: round2(D(r.amount).sub(total)) },
      include: { allocations: true },
    });
  });
  recordAccountingAudit(ctx, { action: "receipt.allocate", entityType: "CustomerReceipt", entityId: r.id, description: `Receipt ${r.number} allocated` });
  return toReceiptDto(updated);
}

function toParty(r: CustomerReceipt): PartyRef | null {
  if (r.bookingAccountId) return { type: "account", id: r.bookingAccountId };
  if (r.guestProfileId) return { type: "guest", id: r.guestProfileId };
  if (r.customerUserId) return { type: "user", id: r.customerUserId };
  return null;
}

async function loadReceipt(ctx: AccountingCtx, id: string) {
  if (!isValidId(id)) throw acctError(ACCT.NOT_FOUND);
  const r = await prisma.customerReceipt.findFirst({ where: { id, orgId: ctx.orgId }, include: { allocations: true } });
  if (!r) throw acctError(ACCT.NOT_FOUND);
  if (!ctx.system && !isLocationVisible(ctx.scope, r.locationId)) throw acctError(ACCT.NOT_FOUND);
  return r;
}

export async function getReceipt(ctx: AccountingCtx, id: string) {
  return toReceiptDto(await loadReceipt(ctx, id));
}

export async function voidReceipt(ctx: AccountingCtx, id: string, reason: string) {
  const r = await loadReceipt(ctx, id);
  if (r.status === "void") throw acctError(ACCT.ALREADY_REVERSED);
  const invoiceIds = r.allocations.map((a) => a.invoiceId);
  const updated = await prisma.$transaction(async (tx) => {
    await reverseSystemEntry(tx, ctx.orgId, `customer_receipt:${r.id}:receipt`, { reason, actorId: ctx.actorId });
    const u = await tx.customerReceipt.update({
      where: { id: r.id },
      data: { status: "void", voidedAt: new Date(), voidReason: reason.slice(0, 500), unappliedAmount: ZERO },
      include: { allocations: true },
    });
    for (const invId of invoiceIds) await recomputeInvoiceBalance(tx, invId);
    return u;
  });
  recordAccountingAudit(ctx, { action: "receipt.void", entityType: "CustomerReceipt", entityId: r.id, description: `Receipt ${r.number} voided`, reason });
  return toReceiptDto(updated);
}

export async function listReceipts(ctx: AccountingCtx, q: { partyKey?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const where: Prisma.CustomerReceiptWhereInput = {
    orgId: ctx.orgId,
    ...(ctx.scope.allLocations ? {} : { locationId: { in: ctx.scope.locationIds } }),
  };
  if (q.partyKey) {
    const p = await parsePartyKey(ctx.orgId, q.partyKey);
    if (p.type === "account") where.bookingAccountId = p.id;
    else if (p.type === "guest") where.guestProfileId = p.id;
    else if (p.type === "user") where.customerUserId = p.id;
  }
  const rows = await prisma.customerReceipt.findMany({
    where,
    include: { allocations: true },
    orderBy: [{ receiptDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(q.cursor && isValidId(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { items: page.map(toReceiptDto), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

/**
 * Public invoice pay flow (Stripe webhook). Idempotent by PaymentIntent id.
 */
export async function createReceiptFromStripe(
  tx: Db,
  input: { orgId: string; invoiceId: string; paymentIntentId: string; amountMinor: number; connectedAccountId: string | null }
): Promise<CustomerReceipt | null> {
  const existing = await tx.customerReceipt.findUnique({ where: { stripePaymentIntentId: input.paymentIntentId } });
  if (existing) return existing;
  const settings = await tx.accountingSettings.findUnique({ where: { orgId: input.orgId } });
  if (!settings?.enabled) return null;
  const inv = await tx.bookingInvoice.findFirst({ where: { id: input.invoiceId, orgId: input.orgId } });
  if (!inv || inv.kind !== "manual") return null;
  const party = invoiceParty(inv);
  const amount = D(input.amountMinor).div(100);
  const bank =
    (input.connectedAccountId
      ? await tx.bankAccount.findFirst({ where: { orgId: input.orgId, stripeAccountId: input.connectedAccountId, archivedAt: null } })
      : null) ??
    (await tx.bankAccount.findFirst({
      where: { orgId: input.orgId, ledgerAccount: { systemKey: "stripe_clearing" } },
    }));
  if (!bank) return null;
  const number = await nextNumber(tx, input.orgId, "receipt");
  const r = await tx.customerReceipt.create({
    data: {
      orgId: input.orgId,
      locationId: inv.locationId,
      number,
      receiptDate: new Date(),
      guestProfileId: party?.type === "guest" ? party.id : null,
      bookingAccountId: party?.type === "account" ? party.id : null,
      customerUserId: party?.type === "user" ? party.id : null,
      method: "card",
      bankAccountId: bank.id,
      amount: round2(amount),
      unappliedAmount: ZERO,
      currency: settings.baseCurrency,
      reference: `Invoice ${inv.number}`,
      stripePaymentIntentId: input.paymentIntentId,
    },
  });
  const applied = D(inv.amountDue).lessThan(amount) ? D(inv.amountDue) : amount;
  if (applied.greaterThan(0)) {
    await tx.customerReceiptAllocation.create({ data: { orgId: input.orgId, receiptId: r.id, invoiceId: inv.id, amount: applied } });
  }
  await recomputeInvoiceBalance(tx, inv.id);
  const pc = await createPostingContext(tx as Prisma.TransactionClient, settings);
  const entry = await postCustomerReceipt(pc, r.id);
  return tx.customerReceipt.update({
    where: { id: r.id },
    data: { unappliedAmount: round2(amount.sub(applied)), journalEntryId: entry?.id ?? null },
  });
}

/** charge.refunded for an invoice payment. */
export async function applyStripeInvoiceRefund(
  tx: Prisma.TransactionClient,
  input: { orgId: string; paymentIntentId: string; amountRefundedMinor: number; fullyRefunded: boolean }
) {
  const r = await tx.customerReceipt.findUnique({ where: { stripePaymentIntentId: input.paymentIntentId }, include: { allocations: true } });
  if (!r || r.orgId !== input.orgId || r.status === "void") return;
  const settings = await tx.accountingSettings.findUnique({ where: { orgId: input.orgId } });
  if (!settings?.enabled) return;
  const pc = await createPostingContext(tx, settings);
  if (input.fullyRefunded) {
    await reverseSystemEntry(tx, input.orgId, `customer_receipt:${r.id}:receipt`, { reason: "Stripe refund" });
    await tx.customerReceipt.update({ where: { id: r.id }, data: { status: "void", voidedAt: new Date(), voidReason: "Stripe refund", refundedAmount: r.amount } });
    await tx.customerReceiptAllocation.deleteMany({ where: { receiptId: r.id } });
  } else {
    await postReceiptRefund(pc, r.id, D(input.amountRefundedMinor).div(100));
    let remaining = D(input.amountRefundedMinor).div(100).sub(D(r.refundedAmount));
    for (const a of r.allocations) {
      if (!remaining.greaterThan(0)) break;
      const cut = D(a.amount).lessThan(remaining) ? D(a.amount) : remaining;
      const next = D(a.amount).sub(cut);
      if (next.isZero()) await tx.customerReceiptAllocation.delete({ where: { id: a.id } });
      else await tx.customerReceiptAllocation.update({ where: { id: a.id }, data: { amount: next } });
      remaining = remaining.sub(cut);
    }
  }
  for (const a of r.allocations) await recomputeInvoiceBalance(tx, a.invoiceId);
}
