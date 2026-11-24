/**
 * Posting dispatcher: outbox sourceType → posting rule.
 */
import type { AccountingPostingQueue, AccountingSettings, Prisma } from "@prisma/client";
import { createPostingContext } from "@/lib/accounting/posting/context";
import { syncBookingAccounting } from "@/lib/accounting/posting/bookings";
import { syncPosSaleAccounting } from "@/lib/accounting/posting/pos";
import { postTillClose, postTillMovement } from "@/lib/accounting/posting/tills";
import { postCashlessAdjustment, postGiftCardLedger, postParkWalletTxn } from "@/lib/accounting/posting/storedValue";
import { postMembershipPayment, recognizeMembershipRevenue } from "@/lib/accounting/posting/memberships";
import { syncMarketplaceBooking } from "@/lib/accounting/posting/marketplace";
import { syncShopOrder } from "@/lib/accounting/posting/shop";
import { syncTailoringJob } from "@/lib/accounting/posting/tailoring";
import { postInventoryMovement } from "@/lib/accounting/posting/inventory";
import { postProcessorFee } from "@/lib/accounting/posting/processorFees";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";

export async function dispatchPosting(
  tx: Prisma.TransactionClient,
  settings: AccountingSettings,
  item: AccountingPostingQueue
): Promise<PostingOutcome> {
  const pc = await createPostingContext(tx, settings);
  const payload = (item.payload && typeof item.payload === "object" ? item.payload : {}) as Record<string, unknown>;
  switch (item.sourceType) {
    case "booking":
    case "booking_payment":
    case "booking_refund": {
      let bookingId = item.sourceId;
      if (item.sourceType === "booking_payment") {
        const payment = await tx.bookingPayment.findFirst({
          where: { id: item.sourceId, orgId: item.orgId },
          select: { bookingId: true },
        });
        if (payment) bookingId = payment.bookingId;
      }
      return syncBookingAccounting(pc, bookingId, item.eventAt);
    }
    case "pos_sale":
    case "pos_refund":
    case "pos_void":
      if (
        item.sourceType === "pos_sale" &&
        typeof item.sourceEvent === "string" &&
        item.sourceEvent.startsWith("late_settle:")
      ) {
        const { postPosLateSettle } = await import("@/lib/accounting/posting/pos");
        return postPosLateSettle(pc, item.sourceId, item.sourceEvent, item.eventAt, payload);
      }
      return syncPosSaleAccounting(pc, item.sourceId, item.eventAt);
    case "till_movement":
      return postTillMovement(pc, item.sourceId);
    case "till_close":
      return postTillClose(pc, item.sourceId, item.eventAt);
    case "gift_card":
      return postGiftCardLedger(pc, item.sourceId);
    case "park_wallet":
      return postParkWalletTxn(pc, item.sourceId);
    case "cashless":
      return postCashlessAdjustment(pc, item.sourceId, payload, item.eventAt);
    case "membership_payment":
    case "membership_refund":
      return postMembershipPayment(pc, item.sourceId);
    case "revenue_recognition":
      if (payload.kind === "membership") return recognizeMembershipRevenue(pc, item.sourceId, item.eventAt);
      return syncBookingAccounting(pc, item.sourceId, item.eventAt);
    case "marketplace_booking":
    case "marketplace_refund":
    case "marketplace_dispute":
      return syncMarketplaceBooking(pc, item.sourceId, item.eventAt);
    case "shop_order":
    case "shop_order_refund":
      return syncShopOrder(pc, item.sourceId, item.eventAt);
    case "tailoring_payment":
      return syncTailoringJob(pc, item.sourceId, item.eventAt);
    case "inventory_movement":
      return postInventoryMovement(pc, item.sourceId);
    case "processor_fee":
      return postProcessorFee(pc, item.sourceId, payload, item.eventAt);
    default:
      return { skippedReason: `posted_by_document:${item.sourceType}` };
  }
}
