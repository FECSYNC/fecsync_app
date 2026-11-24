/**
 * Gift card / park wallet ledger rows not covered by a sale or booking.
 * Rows tied to a POS sale or booking are posted by those rules (tender and
 * issue lines), so only standalone issues, adjustments and voids post here.
 */
import { D, round2 } from "@/lib/accounting/money";
import { sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

export async function postGiftCardLedger(pc: PostingContext, ledgerId: string): Promise<PostingOutcome> {
  const row = await pc.db.giftCardLedger.findFirst({
    where: { id: ledgerId, orgId: pc.orgId },
    include: { giftCard: { select: { locationId: true, last4: true } } },
  });
  if (!row) return { skippedReason: "ledger_not_found" };
  if (row.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  if (row.saleId || row.bookingId) return { skippedReason: "covered_by_source" };
  const loc = row.giftCard.locationId;
  const amount = round2(D(row.amount).abs());
  if (amount.isZero()) return { skippedReason: "zero_amount" };
  const liability = await sysAccount(pc, "gift_card_liability");
  let lines: TargetLine[];
  switch (row.type) {
    case "issue":
      lines = [
        { accountId: await sysAccount(pc, "sales_discounts"), locationId: loc, amount, description: "Promotional gift card" },
        { accountId: liability, locationId: loc, amount: amount.neg(), description: "Gift card issued" },
      ];
      break;
    case "void": {
      const target = pc.settings.giftCardBreakageOnExpiry ? "gift_card_breakage" : "revenue_other";
      lines = [
        { accountId: liability, locationId: loc, amount, description: "Gift card void" },
        { accountId: await sysAccount(pc, target), locationId: loc, amount: amount.neg(), description: "Gift card void" },
      ];
      break;
    }
    case "adjust":
    case "refund": {
      const signed = round2(D(row.amount));
      const other = await sysAccount(pc, "revenue_other");
      lines = [
        { accountId: other, locationId: loc, amount: signed, description: "Gift card adjustment" },
        { accountId: liability, locationId: loc, amount: signed.neg(), description: "Gift card adjustment" },
      ];
      break;
    }
    case "redeem": {
      // Standalone redeem (no sale/booking): release liability into undeposited funds.
      lines = [
        { accountId: liability, locationId: loc, amount, description: "Gift card redeem" },
        {
          accountId: await sysAccount(pc, "undeposited_funds"),
          locationId: loc,
          amount: amount.neg(),
          description: "Gift card redeem",
        },
      ];
      break;
    }
    default:
      return { skippedReason: "covered_by_source" };
  }
  const entry = await postFixed(pc, {
    sourceType: "gift_card",
    sourceId: row.id,
    sourceEvent: row.type,
    entryDate: row.createdAt,
    memo: `Gift card ${row.giftCard.last4 ?? ""} ${row.type}`.trim(),
    locationId: loc,
    lines,
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}

export async function postParkWalletTxn(pc: PostingContext, txnId: string): Promise<PostingOutcome> {
  const row = await pc.db.parkWalletTxn.findFirst({
    where: { id: txnId, orgId: pc.orgId },
    include: { wallet: { select: { locationId: true, guestProfileId: true } } },
  });
  if (!row) return { skippedReason: "txn_not_found" };
  if (row.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  if (row.saleId) return { skippedReason: "covered_by_source" };
  const loc = row.wallet.locationId;
  const amount = round2(D(row.amount).abs());
  if (amount.isZero()) return { skippedReason: "zero_amount" };
  const signed = row.type === "redeem" ? amount.neg() : amount;
  const liability = await sysAccount(pc, "stored_value_liability");
  const other = await sysAccount(pc, "revenue_other");
  const entry = await postFixed(pc, {
    sourceType: "park_wallet",
    sourceId: row.id,
    sourceEvent: row.type,
    entryDate: row.createdAt,
    memo: `Park wallet ${row.type}`,
    locationId: loc,
    lines: [
      { accountId: other, locationId: loc, amount: signed, description: `Wallet ${row.type}` },
      { accountId: liability, locationId: loc, amount: signed.neg(), description: `Wallet ${row.type}` },
    ],
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}

/**
 * Manual cashless adjustment (no txn table): payload carries the signed delta,
 * keyed by the caller's reference so it posts once.
 */
export async function postCashlessAdjustment(
  pc: PostingContext,
  sourceId: string,
  payload: Record<string, unknown>,
  eventAt: Date
): Promise<PostingOutcome> {
  const accountId = typeof payload.cashlessAccountId === "string" ? payload.cashlessAccountId : null;
  const delta = typeof payload.delta === "string" ? D(payload.delta) : null;
  if (!accountId || !delta || delta.isZero()) return { skippedReason: "invalid_payload" };
  const acct = await pc.db.cashlessAccount.findFirst({ where: { id: accountId, orgId: pc.orgId } });
  if (!acct) return { skippedReason: "cashless_not_found" };
  const loc = acct.locationId;
  const amount = round2(delta);
  const liability = await sysAccount(pc, "stored_value_liability");
  const other = await sysAccount(pc, "revenue_other");
  const entry = await postFixed(pc, {
    sourceType: "cashless",
    sourceId,
    sourceEvent: "adjust",
    entryDate: eventAt,
    memo: `Cashless ${acct.last4 ?? ""} adjustment`.trim(),
    locationId: loc,
    lines: [
      { accountId: other, locationId: loc, amount, description: "Cashless adjustment" },
      { accountId: liability, locationId: loc, amount: amount.neg(), description: "Cashless adjustment" },
    ],
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}
