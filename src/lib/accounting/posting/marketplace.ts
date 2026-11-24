/**
 * Marketplace package bookings (Connect destination charges).
 * Paid: Dr clearing amount / Cr marketplace revenue; Dr platform fees / Cr clearing.
 * Each MarketplaceRefund posts once; a dispute posts Dr chargebacks / Cr clearing.
 */
import { ZERO, fromMinor, round2 } from "@/lib/accounting/money";
import { stripeClearingAccount, sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { postFixed, reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";
import type { PartyRef } from "@/lib/accounting/types";

const PAID = new Set(["paid", "refunded", "partially_refunded", "disputed"]);

export async function syncMarketplaceBooking(pc: PostingContext, id: string, eventAt: Date): Promise<PostingOutcome> {
  const b = await pc.db.marketplaceBooking.findFirst({
    where: { id, orgId: pc.orgId },
    include: { refunds: true, events: true },
  });
  if (!b) return { skippedReason: "marketplace_booking_not_found" };
  if ((b.paidAt ?? b.createdAt) < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const loc = b.locationId;
  const party: PartyRef | null = b.customerUserId ? { type: "user", id: b.customerUserId } : null;
  const clearing = await stripeClearingAccount(pc, b.connectedAccountId, loc);
  const target: TargetLine[] = [];
  if (PAID.has(b.status)) {
    const amount = fromMinor(b.amountMinor);
    const fee = fromMinor(b.platformFeeMinor);
    target.push({ accountId: clearing, locationId: loc, amount, description: "Marketplace package payment" });
    target.push({ accountId: await sysAccount(pc, "revenue_marketplace"), locationId: loc, party, amount: amount.neg(), description: "Marketplace package" });
    if (!fee.isZero()) {
      target.push({ accountId: await sysAccount(pc, "platform_fees"), locationId: loc, amount: fee, description: "Platform fee" });
      target.push({ accountId: clearing, locationId: loc, amount: fee.neg(), description: "Platform fee" });
    }
  }
  let last: string | null = null;
  const sale = await reconcileToTarget(pc, {
    sourceType: "marketplace_booking",
    sourceId: b.id,
    eventPrefix: "paid",
    entryDate: b.paidAt ?? eventAt,
    memo: `Marketplace booking ${b.id}`,
    locationId: loc,
    target,
  });
  if (sale) last = sale.id;

  for (const r of b.refunds) {
    const amount = fromMinor(r.amountMinor);
    if (amount.isZero()) continue;
    const lines: TargetLine[] = [
      { accountId: await sysAccount(pc, "sales_refunds"), locationId: loc, party, amount, description: "Marketplace refund" },
      { accountId: clearing, locationId: loc, amount: amount.neg(), description: "Marketplace refund" },
    ];
    if (r.refundApplicationFee && b.amountMinor > 0 && b.platformFeeMinor > 0) {
      const feeBack = round2(fromMinor(b.platformFeeMinor).mul(r.amountMinor).div(b.amountMinor));
      if (!feeBack.isZero()) {
        lines.push({ accountId: clearing, locationId: loc, amount: feeBack, description: "Platform fee refunded" });
        lines.push({ accountId: await sysAccount(pc, "platform_fees"), locationId: loc, amount: feeBack.neg(), description: "Platform fee refunded" });
      }
    }
    const entry = await postFixed(pc, {
      sourceType: "marketplace_refund",
      sourceId: r.id,
      sourceEvent: "refund",
      entryDate: r.createdAt,
      memo: `Marketplace refund ${b.id}`,
      locationId: loc,
      lines,
    });
    if (entry) last = entry.id;
  }

  if (b.status === "disputed") {
    const disputeEvent = b.events.find((e) => /dispute/i.test(e.type));
    const refunded = b.refunds.reduce((a, r) => a.add(fromMinor(r.amountMinor)), ZERO);
    const disputed = round2(fromMinor(b.amountMinor).sub(refunded));
    if (disputed.greaterThan(0)) {
      const entry = await postFixed(pc, {
        sourceType: "marketplace_dispute",
        sourceId: b.id,
        sourceEvent: "dispute",
        entryDate: disputeEvent?.processedAt ?? eventAt,
        memo: `Marketplace dispute ${b.id}`,
        locationId: loc,
        lines: [
          { accountId: await sysAccount(pc, "chargebacks"), locationId: loc, amount: disputed, description: "Chargeback" },
          { accountId: clearing, locationId: loc, amount: disputed.neg(), description: "Chargeback" },
        ],
      });
      if (entry) last = entry.id;
    }
  }
  return last ? { journalEntryId: last, warningCode: postingWarning(pc) } : { skippedReason: "no_change" };
}