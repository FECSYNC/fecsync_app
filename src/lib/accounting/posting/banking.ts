/**
 * Bank transfers and entries created from bank statement lines.
 */
import type { JournalEntry } from "@prisma/client";
import { D, round2 } from "@/lib/accounting/money";
import { sysAccount, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PartyRef } from "@/lib/accounting/types";

export async function postBankTransfer(pc: PostingContext, transferId: string): Promise<JournalEntry | null> {
  const t = await pc.db.bankTransfer.findFirst({
    where: { id: transferId, orgId: pc.orgId },
    include: { from: true, to: true },
  });
  if (!t) return null;
  const amount = round2(D(t.amount));
  const fee = round2(D(t.feeAmount));
  const lines: TargetLine[] = [
    { accountId: t.to.ledgerAccountId, locationId: t.to.locationId, amount, description: `Transfer ${t.number}` },
    { accountId: t.from.ledgerAccountId, locationId: t.from.locationId, amount: amount.neg(), description: `Transfer ${t.number}` },
  ];
  if (!fee.isZero()) {
    lines.push({ accountId: await sysAccount(pc, "bank_charges"), locationId: t.from.locationId, amount: fee, description: "Transfer fee" });
    lines.push({ accountId: t.from.ledgerAccountId, locationId: t.from.locationId, amount: fee.neg(), description: "Transfer fee" });
  }
  return postFixed(pc, {
    sourceType: "bank_transfer",
    sourceId: t.id,
    sourceEvent: "post",
    entryDate: t.transferDate,
    memo: `Transfer ${t.number}${t.reference ? ` (${t.reference})` : ""}`,
    locationId: null,
    lines,
  });
}

export async function postBankLineEntry(
  pc: PostingContext,
  opts: {
    bankTransactionId: string;
    bankLedgerAccountId: string;
    bankLocationId: string | null;
    amount: ReturnType<typeof D>;
    date: Date;
    offsetAccountId: string;
    taxAccountId?: string | null;
    taxAmount?: ReturnType<typeof D> | null;
    taxCodeId?: string | null;
    party?: PartyRef | null;
    memo: string;
  }
): Promise<JournalEntry | null> {
  const amount = round2(opts.amount);
  const tax = opts.taxAmount && opts.taxAccountId ? round2(opts.taxAmount.abs()) : D(0);
  const isOut = amount.lessThan(0);
  const net = amount.abs().sub(tax);
  const lines: TargetLine[] = [
    { accountId: opts.bankLedgerAccountId, locationId: opts.bankLocationId, amount, description: opts.memo },
    {
      accountId: opts.offsetAccountId,
      locationId: opts.bankLocationId,
      party: opts.party ?? null,
      amount: isOut ? net : net.neg(),
      description: opts.memo,
      taxCodeId: opts.taxCodeId ?? null,
    },
  ];
  if (!tax.isZero() && opts.taxAccountId) {
    lines.push({
      accountId: opts.taxAccountId,
      locationId: opts.bankLocationId,
      amount: isOut ? tax : tax.neg(),
      description: "Tax",
      taxCodeId: opts.taxCodeId ?? null,
      taxBaseAmount: net,
    });
  }
  return postFixed(pc, {
    sourceType: "bank_line",
    sourceId: opts.bankTransactionId,
    sourceEvent: "entry",
    entryDate: opts.date,
    memo: opts.memo,
    locationId: opts.bankLocationId,
    lines,
  });
}
