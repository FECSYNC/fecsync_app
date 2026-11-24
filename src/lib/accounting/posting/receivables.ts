/**
 * Manual invoices, credit notes, write-offs, customer receipts.
 * Booking-kind invoices never post (the booking already posted AR).
 */
import type { BookingInvoice, BookingInvoiceLine, JournalEntry } from "@prisma/client";
import { D, round2 } from "@/lib/accounting/money";
import { reverseSystemEntry } from "@/lib/accounting/journalEngine";
import { sysAccount, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PartyRef } from "@/lib/accounting/types";

export function invoiceParty(inv: Pick<BookingInvoice, "accountId" | "guestProfileId" | "customerUserId">): PartyRef | null {
  if (inv.accountId) return { type: "account", id: inv.accountId };
  if (inv.guestProfileId) return { type: "guest", id: inv.guestProfileId };
  if (inv.customerUserId) return { type: "user", id: inv.customerUserId };
  return null;
}

async function invoiceLines(
  pc: PostingContext,
  inv: BookingInvoice & { lines: BookingInvoiceLine[] },
  sign: 1 | -1
): Promise<TargetLine[]> {
  const party = invoiceParty(inv);
  const loc = inv.locationId;
  const refs = { invoiceId: inv.id };
  const total = round2(D(inv.amount));
  const ar = await sysAccount(pc, "accounts_receivable");
  const out: TargetLine[] = [
    { ...refs, accountId: ar, locationId: loc, party, amount: sign === 1 ? total : total.neg(), description: `Invoice ${inv.number}` },
  ];
  const taxCodeIds = [...new Set(inv.lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x)))];
  const taxCodes = taxCodeIds.length
    ? await pc.db.taxCode.findMany({ where: { id: { in: taxCodeIds }, orgId: pc.orgId } })
    : [];
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));
  const salesTax = await sysAccount(pc, "sales_tax_payable");
  for (const l of inv.lines) {
    const net = round2(D(l.lineTotal));
    const tax = round2(D(l.taxAmount));
    const lineLoc = l.locationId ?? loc;
    if (!net.isZero()) {
      out.push({ ...refs, accountId: l.ledgerAccountId, locationId: lineLoc, party, amount: sign === 1 ? net.neg() : net, description: l.description, taxCodeId: l.taxCodeId });
    }
    if (!tax.isZero()) {
      const taxAccount = (l.taxCodeId && taxById.get(l.taxCodeId)?.salesTaxAccountId) || salesTax;
      out.push({ ...refs, accountId: taxAccount, locationId: lineLoc, amount: sign === 1 ? tax.neg() : tax, description: "Sales tax", taxCodeId: l.taxCodeId, taxBaseAmount: net });
    }
  }
  return out;
}

export async function postManualInvoice(pc: PostingContext, invoiceId: string): Promise<JournalEntry | null> {
  const inv = await pc.db.bookingInvoice.findFirst({
    where: { id: invoiceId, orgId: pc.orgId },
    include: { lines: true },
  });
  if (!inv || inv.kind === "booking") return null;
  const isCredit = inv.kind === "credit_note";
  return postFixed(pc, {
    sourceType: "manual_invoice",
    sourceId: inv.id,
    sourceEvent: isCredit ? "credit_note" : "issue",
    entryDate: inv.issueDate ?? new Date(),
    memo: `${isCredit ? "Credit note" : "Invoice"} ${inv.number}`,
    locationId: inv.locationId,
    lines: await invoiceLines(pc, inv, isCredit ? -1 : 1),
    refs: { invoiceId: inv.id },
  });
}

export async function voidManualInvoicePosting(pc: PostingContext, invoiceId: string, kind: "issue" | "credit_note", reason: string, actorId: string | null) {
  return reverseSystemEntry(pc.db, pc.orgId, `manual_invoice:${invoiceId}:${kind}`, { reason, actorId });
}

export async function postWriteOff(
  pc: PostingContext,
  inv: BookingInvoice,
  amount: ReturnType<typeof D>,
  key: string,
  date: Date
): Promise<JournalEntry | null> {
  const party = invoiceParty(inv);
  return postFixed(pc, {
    sourceType: "write_off",
    sourceId: inv.id,
    sourceEvent: key,
    entryDate: date,
    memo: `Write-off ${inv.number}`,
    locationId: inv.locationId,
    refs: { invoiceId: inv.id },
    lines: [
      { accountId: await sysAccount(pc, "bad_debt"), locationId: inv.locationId, amount, description: "Bad debt" },
      { accountId: await sysAccount(pc, "accounts_receivable"), locationId: inv.locationId, party, amount: amount.neg(), description: `Write-off ${inv.number}` },
    ],
  });
}

export async function postCustomerReceipt(pc: PostingContext, receiptId: string): Promise<JournalEntry | null> {
  const r = await pc.db.customerReceipt.findFirst({ where: { id: receiptId, orgId: pc.orgId } });
  if (!r || r.status !== "posted") return null;
  const bank = await pc.db.bankAccount.findFirst({ where: { id: r.bankAccountId, orgId: pc.orgId } });
  if (!bank) return null;
  const party: PartyRef | null = r.bookingAccountId
    ? { type: "account", id: r.bookingAccountId }
    : r.guestProfileId
      ? { type: "guest", id: r.guestProfileId }
      : r.customerUserId
        ? { type: "user", id: r.customerUserId }
        : null;
  const amount = round2(D(r.amount));
  return postFixed(pc, {
    sourceType: "customer_receipt",
    sourceId: r.id,
    sourceEvent: "receipt",
    entryDate: r.receiptDate,
    memo: `Receipt ${r.number}`,
    locationId: r.locationId,
    lines: [
      { accountId: bank.ledgerAccountId, locationId: r.locationId, amount, description: `Receipt ${r.number}` },
      { accountId: await sysAccount(pc, "accounts_receivable"), locationId: r.locationId, party, amount: amount.neg(), description: `Receipt ${r.number}` },
    ],
  });
}

/** Partial Stripe refund of an invoice payment: Dr AR / Cr bank, keyed by refunded watermark. */
export async function postReceiptRefund(pc: PostingContext, receiptId: string, refundedTotal: ReturnType<typeof D>) {
  const r = await pc.db.customerReceipt.findFirst({ where: { id: receiptId, orgId: pc.orgId } });
  if (!r) return null;
  const bank = await pc.db.bankAccount.findFirst({ where: { id: r.bankAccountId, orgId: pc.orgId } });
  if (!bank) return null;
  const already = round2(D(r.refundedAmount));
  const delta = round2(refundedTotal.sub(already));
  if (!delta.greaterThan(0)) return null;
  const party: PartyRef | null = r.guestProfileId
    ? { type: "guest", id: r.guestProfileId }
    : r.customerUserId
      ? { type: "user", id: r.customerUserId }
      : r.bookingAccountId
        ? { type: "account", id: r.bookingAccountId }
        : null;
  const entry = await postFixed(pc, {
    sourceType: "customer_receipt",
    sourceId: r.id,
    sourceEvent: `refund:${refundedTotal.toFixed(2)}`,
    entryDate: new Date(),
    memo: `Refund of receipt ${r.number}`,
    locationId: r.locationId,
    lines: [
      { accountId: await sysAccount(pc, "accounts_receivable"), locationId: r.locationId, party, amount: delta, description: "Payment refunded" },
      { accountId: bank.ledgerAccountId, locationId: r.locationId, amount: delta.neg(), description: "Payment refunded" },
    ],
  });
  await pc.db.customerReceipt.update({ where: { id: r.id }, data: { refundedAmount: refundedTotal } });
  return entry;
}
