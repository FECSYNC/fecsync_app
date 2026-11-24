/**
 * Bookings (incl. parties — a party IS a booking).
 *
 * Revenue: reconcile to Booking state (confirmed → Dr AR total / Cr revenue
 * per line / Cr tax; on_visit credits unearned until visit end; cancelled,
 * expired, refunded → zero).
 * Receipts: one fixed entry per completed BookingPayment (Dr tender, Cr AR).
 * BookingPayment rows with posSaleId are skipped — the POS sale posts that money.
 * Refunds: always Dr AR / Cr tender (gift card refunds Cr gift card liability);
 * reconciled to amountRefunded watermarks so partial refunds post once.
 */
import type { Booking, BookingLine, BookingPayment } from "@prisma/client";
import { D, ZERO, allocateProportionally, fromMinor, round2, type Dec } from "@/lib/accounting/money";
import { resolveBookingCustomer } from "@/lib/accounting/partyKeys";
import {
  mappedAccount,
  stripeClearingAccount,
  sysAccount,
  postingWarning,
  type PostingContext,
} from "@/lib/accounting/posting/context";
import { postFixed, reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";
import type { PartyRef } from "@/lib/accounting/types";

const RECEIPT_STATUSES = new Set(["completed", "partial_refund", "refunded"]);

export async function bookingTenderAccount(
  pc: PostingContext,
  p: Pick<BookingPayment, "tender" | "connectedAccountId" | "locationId">
): Promise<string> {
  if (p.tender === "card" || p.tender === "stored_card") {
    return stripeClearingAccount(pc, p.connectedAccountId, p.locationId, [
      { kind: "booking_tender", matchKey: p.tender },
    ]);
  }
  if (p.tender === "gift_card") {
    return mappedAccount(pc, [{ kind: "booking_tender", matchKey: "gift_card" }], p.locationId, "gift_card_liability");
  }
  if (p.tender === "cash" || p.tender === "split_component") {
    return mappedAccount(pc, [{ kind: "booking_tender", matchKey: p.tender }], p.locationId, "till_cash");
  }
  return mappedAccount(pc, [{ kind: "booking_tender", matchKey: p.tender }], p.locationId, "undeposited_funds");
}

function revenueRecognized(pc: PostingContext, booking: Booking, now: Date): boolean {
  if (pc.settings.bookingRevenueRecognition !== "on_visit") return true;
  const end = booking.visitEndsAt ?? booking.visitStartsAt;
  return !end || end.getTime() <= now.getTime();
}

async function revenueTarget(
  pc: PostingContext,
  booking: Booking & { lines: BookingLine[] },
  party: PartyRef | null,
  now: Date
): Promise<TargetLine[]> {
  if (booking.status !== "confirmed") return [];
  const loc = booking.locationId;
  const refs = { bookingId: booking.id };
  const total = round2(D(booking.total));
  const tax = round2(D(booking.taxAmount));
  const recognized = revenueRecognized(pc, booking, now);
  const unearned = recognized ? null : await sysAccount(pc, "booking_unearned");
  const lines: TargetLine[] = [
    { ...refs, accountId: await sysAccount(pc, "accounts_receivable"), locationId: loc, party, amount: total, description: `Booking ${booking.publicId}` },
  ];
  let lineSum = ZERO;
  for (const l of booking.lines) {
    const amount = round2(D(l.lineTotal));
    if (amount.isZero()) continue;
    lineSum = lineSum.add(amount);
    const fallback = l.productType === "party_package" ? "revenue_party" : "revenue_admission";
    const accountId =
      unearned ??
      (await mappedAccount(
        pc,
        [
          ...(l.productId ? [{ kind: "admission_product" as const, matchKey: l.productId }] : []),
          { kind: "admission_product_type" as const, matchKey: l.productType },
        ],
        loc,
        fallback
      ));
    lines.push({ ...refs, accountId, locationId: loc, amount: amount.neg(), description: l.productName });
  }
  if (!tax.isZero()) {
    lines.push({ ...refs, accountId: await sysAccount(pc, "sales_tax_payable"), locationId: loc, amount: tax.neg(), description: "Sales tax" });
  }
  const residue = total.sub(lineSum).sub(tax);
  if (!residue.isZero()) {
    if (residue.lessThan(0)) {
      lines.push({ ...refs, accountId: await sysAccount(pc, "sales_discounts"), locationId: loc, amount: residue.neg(), description: "Booking discount" });
    } else {
      lines.push({ ...refs, accountId: unearned ?? (await sysAccount(pc, "revenue_other")), locationId: loc, amount: residue.neg(), description: "Booking adjustment" });
    }
  }
  return lines;
}

export async function syncBookingAccounting(
  pc: PostingContext,
  bookingId: string,
  eventAt: Date
): Promise<PostingOutcome> {
  const booking = await pc.db.booking.findFirst({
    where: { id: bookingId, orgId: pc.orgId },
    include: { lines: true, payments: true, giftCardsIssued: { include: { ledger: true } } },
  });
  if (!booking) return { skippedReason: "booking_not_found" };
  const goLive = pc.settings.goLiveDate;
  const party = await resolveBookingCustomer(pc.db, booking);
  const loc = booking.locationId;
  const arAccount = await sysAccount(pc, "accounts_receivable");
  let lastEntryId: string | null = null;

  if (booking.createdAt >= goLive) {
    const target = await revenueTarget(pc, booking, party, new Date());
    const entry = await reconcileToTarget(pc, {
      sourceType: "booking",
      sourceId: booking.id,
      eventPrefix: "rev",
      entryDate: eventAt,
      memo: `Booking ${booking.publicId} ${booking.status}`,
      locationId: loc,
      target,
      refs: { bookingId: booking.id },
    });
    if (entry) lastEntryId = entry.id;
  }

  for (const p of booking.payments) {
    if (p.posSaleId || p.tender === "invoice") continue;
    if (!RECEIPT_STATUSES.has(p.status)) continue;
    if (p.createdAt < goLive) continue;
    const amount = round2(D(p.amount));
    if (amount.isZero()) continue;
    const tenderAccount = await bookingTenderAccount(pc, p);
    const receipt = await postFixed(pc, {
      sourceType: "booking_payment",
      sourceId: p.id,
      sourceEvent: "receipt",
      entryDate: p.createdAt,
      memo: `Payment ${p.tender} for booking ${booking.publicId}`,
      locationId: loc,
      refs: { bookingId: booking.id },
      lines: [
        { accountId: tenderAccount, locationId: loc, amount, description: `${p.tender} payment` },
        { accountId: arAccount, locationId: loc, party, amount: amount.neg(), description: `Booking ${booking.publicId}` },
      ],
    });
    if (receipt) lastEntryId = receipt.id;
    if (p.connectedAccountId && p.platformFeeMinor && p.platformFeeMinor > 0) {
      const fee = fromMinor(p.platformFeeMinor);
      const feeEntry = await postFixed(pc, {
        sourceType: "booking_payment",
        sourceId: p.id,
        sourceEvent: "platform_fee",
        entryDate: p.createdAt,
        memo: `Platform fee on booking ${booking.publicId}`,
        locationId: loc,
        refs: { bookingId: booking.id },
        lines: [
          { accountId: await sysAccount(pc, "platform_fees"), locationId: loc, amount: fee, description: "Platform fee" },
          { accountId: tenderAccount, locationId: loc, amount: fee.neg(), description: "Platform fee" },
        ],
      });
      if (feeEntry) lastEntryId = feeEntry.id;
    }
  }

  const refundTarget = await refundTargetFor(pc, booking, party, arAccount);
  const refundEntry = await reconcileToTarget(pc, {
    sourceType: "booking_refund",
    sourceId: booking.id,
    eventPrefix: "refund",
    entryDate: eventAt,
    memo: `Refunds for booking ${booking.publicId}`,
    locationId: loc,
    target: refundTarget,
    refs: { bookingId: booking.id },
  });
  if (refundEntry) lastEntryId = refundEntry.id;

  return { journalEntryId: lastEntryId, warningCode: postingWarning(pc), ...(lastEntryId ? {} : { skippedReason: "no_change" }) };
}

async function refundTargetFor(
  pc: PostingContext,
  booking: Booking & {
    payments: BookingPayment[];
    giftCardsIssued: Array<{ id: string; createdAt: Date; ledger: Array<{ type: string; amount: unknown }> }>;
  },
  party: PartyRef | null,
  arAccount: string
): Promise<TargetLine[]> {
  const goLive = pc.settings.goLiveDate;
  const loc = booking.locationId;
  const lines: TargetLine[] = [];
  const preGoLive = booking.createdAt < goLive;
  // Pre-go-live bookings: only money received after go-live is in the ledger
  // (opening balances carry the rest), so refunds follow those tenders only.
  const counted = booking.payments.filter(
    (p) =>
      p.tender !== "invoice" &&
      RECEIPT_STATUSES.has(p.status) &&
      (!preGoLive || p.createdAt >= goLive)
  );
  const gross = counted.reduce((a, p) => a.add(D(p.amount)), ZERO);
  let giftIssued = ZERO;
  for (const gc of booking.giftCardsIssued) {
    if (gc.createdAt < goLive) continue;
    const issue = gc.ledger.filter((l) => l.type === "issue").reduce((a, l) => a.add(D(l.amount as never)), ZERO);
    if (issue.isZero()) continue;
    giftIssued = giftIssued.add(issue);
    const gcAccount = await sysAccount(pc, "gift_card_liability");
    lines.push({ accountId: arAccount, locationId: loc, party, amount: issue, description: "Refund to gift card" });
    lines.push({ accountId: gcAccount, locationId: loc, amount: issue.neg(), description: "Refund to gift card" });
  }
  const tenderRefund = preGoLive
    ? round2(counted.reduce((a, p) => a.add(D(p.amountRefunded)), ZERO))
    : round2(gross.sub(D(booking.amountPaid)).sub(giftIssued));
  if (tenderRefund.greaterThan(0)) {
    const refunded = counted.filter((p) => D(p.amountRefunded).greaterThan(0));
    const basis = refunded.length ? refunded : counted;
    const weights: Dec[] = basis.map((p) => (refunded.length ? D(p.amountRefunded) : D(p.amount)));
    const parts = allocateProportionally(tenderRefund, weights);
    for (let i = 0; i < basis.length; i++) {
      const p = basis[i]!;
      const part = parts[i]!;
      if (part.isZero()) continue;
      const tenderAccount = await bookingTenderAccount(pc, p);
      lines.push({ accountId: arAccount, locationId: loc, party, amount: part, description: `Refund ${p.tender}` });
      lines.push({ accountId: tenderAccount, locationId: loc, amount: part.neg(), description: `Refund ${p.tender}` });
    }
  }
  return lines;
}
