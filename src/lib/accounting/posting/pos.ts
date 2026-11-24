/**
 * POS sales. Target (completed / unpaid / refunded states):
 * Cr revenue per non-booking line (product → kind → line kind mapping),
 * Cr gift card / stored value liability for issue lines, Cr tips payable,
 * Dr sales discounts, Cr AR of each linked booking's customer for booking
 * lines (the booking posts its own revenue), tax = the remainder up to the
 * sale total. Dr each completed tender; unpaid remainder Dr AR (guest).
 * Voided → zero. Each PosSaleRefund posts once (Dr sales refunds + tax share,
 * Cr tender). COGS posts from inventory movements, not here.
 */
import type { PosSalePayment } from "@prisma/client";
import { D, ZERO, fromMinor, maxDec, round2 } from "@/lib/accounting/money";
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

const POSTED_SALE_STATUSES = new Set(["completed", "unpaid", "refunded", "partially_refunded"]);

export async function posTenderAccount(
  pc: PostingContext,
  tender: string,
  locationId: string,
  connectedAccountId: string | null
): Promise<string> {
  const candidates = [{ kind: "pos_tender" as const, matchKey: tender }];
  switch (tender) {
    case "card":
    case "stored_card":
    case "payment_link":
      return stripeClearingAccount(pc, connectedAccountId, locationId, candidates);
    case "cash":
    case "split_component":
      return mappedAccount(pc, candidates, locationId, "till_cash");
    case "gift_card":
      return mappedAccount(pc, candidates, locationId, "gift_card_liability");
    case "park_wallet":
    case "cashless":
      return mappedAccount(pc, candidates, locationId, "stored_value_liability");
    default:
      return mappedAccount(pc, candidates, locationId, "undeposited_funds");
  }
}

export async function syncPosSaleAccounting(
  pc: PostingContext,
  saleId: string,
  eventAt: Date
): Promise<PostingOutcome> {
  const sale = await pc.db.posSale.findFirst({
    where: { id: saleId, orgId: pc.orgId },
    include: {
      lines: true,
      payments: true,
      refunds: true,
      bookings: { include: { booking: true } },
    },
  });
  if (!sale) return { skippedReason: "sale_not_found" };
  if (sale.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const loc = sale.locationId;
  const refs = { posSaleId: sale.id };
  const guestParty: PartyRef | null = sale.guestProfileId ? { type: "guest", id: sale.guestProfileId } : null;
  let lastEntryId: string | null = null;

  const target: TargetLine[] = [];
  if (POSTED_SALE_STATUSES.has(sale.status)) {
    const productIds = sale.lines.map((l) => l.productId).filter((x): x is string => Boolean(x));
    const products = productIds.length
      ? await pc.db.posProduct.findMany({
          where: { id: { in: productIds } },
          select: { id: true, kind: true, revenueAccountId: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const arAccount = await sysAccount(pc, "accounts_receivable");
    let credits = ZERO;
    let discountDr = round2(D(sale.discountTotal));

    for (const b of sale.bookings) {
      const amount = round2(D(b.booking.total));
      if (amount.isZero()) continue;
      const party = await resolveBookingCustomer(pc.db, b.booking);
      target.push({ ...refs, bookingId: b.bookingId, accountId: arAccount, locationId: loc, party, amount: amount.neg(), description: `Booking ${b.booking.publicId} via POS` });
      credits = credits.add(amount);
    }

    for (const l of sale.lines) {
      const amount = round2(D(l.lineTotal));
      if (amount.isZero()) continue;
      if (l.kind === "booking") continue;
      const product = l.productId ? productById.get(l.productId) : undefined;
      if (l.kind === "discount") {
        discountDr = discountDr.add(amount.abs());
        continue;
      }
      if (l.kind === "tip") {
        target.push({ ...refs, accountId: await sysAccount(pc, "tips_payable"), locationId: loc, amount: amount.neg(), description: l.name });
        credits = credits.add(amount);
        continue;
      }
      if (l.kind === "round") {
        target.push({ ...refs, accountId: await sysAccount(pc, "rounding"), locationId: loc, amount: amount.neg(), description: l.name });
        credits = credits.add(amount);
        continue;
      }
      let accountId: string;
      if (l.kind === "gift_card_issue" || product?.kind === "gift_card") {
        accountId = await sysAccount(pc, "gift_card_liability");
      } else if (l.kind === "cashless" || l.kind === "wallet" || product?.kind === "cashless_card" || product?.kind === "park_wallet") {
        accountId = await sysAccount(pc, "stored_value_liability");
      } else if (l.kind === "membership" || product?.kind === "membership_plan") {
        accountId =
          pc.settings.membershipRecognition === "over_term"
            ? await sysAccount(pc, "membership_unearned")
            : await mappedAccount(
                pc,
                [
                  ...(l.refId ? [{ kind: "membership_plan" as const, matchKey: l.refId }] : []),
                  { kind: "pos_product_kind" as const, matchKey: "membership_plan" },
                ],
                loc,
                "revenue_membership"
              );
      } else if (product?.revenueAccountId) {
        accountId = product.revenueAccountId;
      } else {
        const fallback =
          product?.kind === "food" || product?.kind === "beverage"
            ? "revenue_food_beverage"
            : product?.kind === "merchandise"
              ? "revenue_merchandise"
              : "revenue_other";
        accountId = await mappedAccount(
          pc,
          [
            ...(l.productId ? [{ kind: "pos_product" as const, matchKey: l.productId }] : []),
            ...(product ? [{ kind: "pos_product_kind" as const, matchKey: product.kind }] : []),
            { kind: "pos_line_kind" as const, matchKey: l.kind },
          ],
          loc,
          fallback
        );
      }
      target.push({ ...refs, accountId, locationId: loc, amount: amount.neg(), description: l.name, posProductId: l.productId });
      credits = credits.add(amount);
    }

    const tip = round2(D(sale.tipAmount));
    const tipLines = sale.lines.some((l) => l.kind === "tip");
    if (!tip.isZero() && !tipLines) {
      target.push({ ...refs, accountId: await sysAccount(pc, "tips_payable"), locationId: loc, amount: tip.neg(), description: "Tips" });
      credits = credits.add(tip);
    }
    if (!discountDr.isZero()) {
      target.push({ ...refs, accountId: await sysAccount(pc, "sales_discounts"), locationId: loc, amount: discountDr, description: "Discount" });
      credits = credits.sub(discountDr);
    }
    const total = round2(D(sale.total));
    const tax = maxDec(round2(total.sub(credits)), ZERO);
    if (!tax.isZero()) {
      target.push({ ...refs, accountId: await sysAccount(pc, "sales_tax_payable"), locationId: loc, amount: tax.neg(), description: "Sales tax" });
    }

    let paid = ZERO;
    for (const p of sale.payments) {
      if (p.status !== "completed" && p.status !== "refunded" && p.status !== "partial_refund") continue;
      const amount = round2(D(p.amount));
      if (amount.isZero()) continue;
      paid = paid.add(amount);
      const account = await posTenderAccount(pc, p.tender, loc, p.connectedAccountId);
      target.push({ ...refs, accountId: account, locationId: loc, amount, description: `${p.tender} tender` });
      if (p.connectedAccountId && p.platformFeeMinor && p.platformFeeMinor > 0) {
        const fee = fromMinor(p.platformFeeMinor);
        target.push({ ...refs, accountId: await sysAccount(pc, "platform_fees"), locationId: loc, amount: fee, description: "Platform fee" });
        target.push({ ...refs, accountId: account, locationId: loc, amount: fee.neg(), description: "Platform fee" });
      }
    }
    const unpaid = round2(total.sub(paid));
    if (unpaid.greaterThan(0)) {
      target.push({ ...refs, accountId: arAccount, locationId: loc, party: guestParty, amount: unpaid, description: `Unpaid POS ${sale.publicId}` });
    }
  }

  const saleEntry = await reconcileToTarget(pc, {
    sourceType: "pos_sale",
    sourceId: sale.id,
    eventPrefix: "sale",
    entryDate: sale.status === "voided" ? eventAt : sale.createdAt,
    memo: `POS sale ${sale.publicId} ${sale.status}`,
    locationId: loc,
    target,
    refs,
  });
  if (saleEntry) lastEntryId = saleEntry.id;

  for (const r of sale.refunds) {
    const entry = await postPosRefund(pc, sale, r, guestParty);
    if (entry) lastEntryId = entry;
  }

  return { journalEntryId: lastEntryId, warningCode: postingWarning(pc), ...(lastEntryId ? {} : { skippedReason: "no_change" }) };
}

/** Card (etc.) settled after the sale was already voided/refunded — hold as undeposited. */
export async function postPosLateSettle(
  pc: PostingContext,
  saleId: string,
  sourceEvent: string,
  eventAt: Date,
  payload: Record<string, unknown>
): Promise<PostingOutcome> {
  const paymentId =
    (typeof payload.paymentId === "string" && payload.paymentId) ||
    sourceEvent.replace(/^late_settle:/, "");
  if (!paymentId) return { skippedReason: "missing_payment" };
  const sale = await pc.db.posSale.findFirst({
    where: { id: saleId, orgId: pc.orgId },
    select: { id: true, publicId: true, locationId: true, status: true, createdAt: true },
  });
  if (!sale) return { skippedReason: "sale_not_found" };
  if (sale.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  if (sale.status !== "voided" && sale.status !== "refunded") {
    return syncPosSaleAccounting(pc, saleId, eventAt);
  }
  const payment = await pc.db.posSalePayment.findFirst({
    where: { id: paymentId, saleId: sale.id, orgId: pc.orgId },
  });
  if (!payment || payment.status !== "completed") return { skippedReason: "payment_not_completed" };
  const amount = round2(D(payment.amount));
  if (amount.isZero()) return { skippedReason: "zero_amount" };
  const loc = sale.locationId;
  const tenderAccount = await posTenderAccount(pc, payment.tender, loc, payment.connectedAccountId);
  const undeposited = await sysAccount(pc, "undeposited_funds");
  const entry = await postFixed(pc, {
    sourceType: "pos_sale",
    sourceId: sale.id,
    sourceEvent,
    entryDate: eventAt,
    memo: `Late settle on ${sale.status} POS ${sale.publicId}`,
    locationId: loc,
    lines: [
      { accountId: tenderAccount, locationId: loc, amount, description: `${payment.tender} late settle` },
      { accountId: undeposited, locationId: loc, amount: amount.neg(), description: "Unapplied after void/refund" },
    ],
    refs: { posSaleId: sale.id },
  });
  return { journalEntryId: entry?.id ?? null, warningCode: postingWarning(pc) };
}

async function postPosRefund(
  pc: PostingContext,
  sale: { id: string; publicId: string; locationId: string; total: unknown; taxAmount: unknown; payments: PosSalePayment[]; bookings: Array<{ bookingId: string }> },
  r: { id: string; amount: unknown; tender: string; createdAt: Date },
  guestParty: PartyRef | null
): Promise<string | null> {
  const loc = sale.locationId;
  const amount = round2(D(r.amount as never));
  if (amount.isZero()) return null;
  const total = D(sale.total as never);
  const taxShare = total.isZero() ? ZERO : round2(amount.mul(D(sale.taxAmount as never)).div(total));
  const original = sale.payments.find((p) => p.tender === r.tender);
  const tenderAccount = await posTenderAccount(pc, r.tender, loc, original?.connectedAccountId ?? null);
  const lines: TargetLine[] = [];
  if (sale.bookings.length && !sale.payments.some((p) => p.tender !== r.tender)) {
    lines.push({ accountId: await sysAccount(pc, "accounts_receivable"), locationId: loc, party: guestParty, amount, description: "POS refund on booking sale" });
  } else {
    lines.push({ accountId: await sysAccount(pc, "sales_refunds"), locationId: loc, amount: amount.sub(taxShare), description: "POS refund" });
    if (!taxShare.isZero()) {
      lines.push({ accountId: await sysAccount(pc, "sales_tax_payable"), locationId: loc, amount: taxShare, description: "Refund tax" });
    }
  }
  lines.push({ accountId: tenderAccount, locationId: loc, amount: amount.neg(), description: `Refund ${r.tender}` });
  const entry = await postFixed(pc, {
    sourceType: "pos_refund",
    sourceId: r.id,
    sourceEvent: "refund",
    entryDate: r.createdAt,
    memo: `POS refund on ${sale.publicId}`,
    locationId: loc,
    lines,
    refs: { posSaleId: sale.id },
  });
  return entry?.id ?? null;
}