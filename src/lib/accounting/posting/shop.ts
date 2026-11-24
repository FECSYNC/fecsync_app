/**
 * Shop orders (registered companies only; never the storefront org).
 * Paid states: Dr gateway clearing (wallet → platform wallet clearing, since
 * Wallet has no orgId) / Cr shop revenue, shipping income, sales tax.
 * Cancelled after payment → zero (reversal). Float → Decimal once here.
 */
import { fromFloatBoundary, round2 } from "@/lib/accounting/money";
import { mappedAccount, sysAccount, postingWarning, type PostingContext } from "@/lib/accounting/posting/context";
import { reconcileToTarget, type TargetLine } from "@/lib/accounting/posting/reconcile";
import type { PostingOutcome } from "@/lib/accounting/postingQueue";
import type { PartyRef } from "@/lib/accounting/types";

const PAID = new Set(["paid", "shipped", "shipping", "delivered"]);

export async function syncShopOrder(pc: PostingContext, orderId: string, eventAt: Date): Promise<PostingOutcome> {
  if (!pc.settings.postShopOrders) return { skippedReason: "shop_posting_disabled" };
  const order = await pc.db.order.findFirst({
    where: { id: orderId, orgId: pc.orgId },
    include: { org: { select: { isDefault: true } } },
  });
  if (!order) return { skippedReason: "order_not_found" };
  if (order.org.isDefault) return { skippedReason: "storefront_org" };
  if (order.createdAt < pc.settings.goLiveDate) return { skippedReason: "before_go_live" };
  const loc = order.venueLocationId;
  const party: PartyRef = { type: "user", id: order.userId };
  const target: TargetLine[] = [];
  const wasPaid = PAID.has(order.status) || (order.status === "cancelled" && order.paidNotifiedAt != null);
  if (PAID.has(order.status)) {
    const total = round2(fromFloatBoundary(order.amount));
    const tax = round2(fromFloatBoundary(order.taxAmount));
    const shipping = round2(fromFloatBoundary(order.shippingFee));
    const subtotal = round2(total.sub(tax).sub(shipping));
    const clearingKey =
      order.paymentProvider === "paystack"
        ? "paystack_clearing"
        : order.paymentProvider === "wallet"
          ? "platform_wallet_clearing"
          : "stripe_clearing";
    target.push({ accountId: await sysAccount(pc, clearingKey), locationId: loc, amount: total, description: `Order ${order.id}` });
    const cartLines = await pc.db.cartLine.findMany({
      where: { cartId: order.cartId, productId: { not: null } },
      select: { product: { select: { categoryId: true } } },
      take: 1,
    });
    const categoryId = cartLines[0]?.product?.categoryId ?? null;
    const revenue = await mappedAccount(
      pc,
      categoryId ? [{ kind: "shop_category", matchKey: categoryId }] : [],
      loc,
      "revenue_shop"
    );
    if (!subtotal.isZero()) target.push({ accountId: revenue, locationId: loc, party, amount: subtotal.neg(), description: "Shop sale" });
    if (!shipping.isZero()) target.push({ accountId: await sysAccount(pc, "revenue_shipping"), locationId: loc, party, amount: shipping.neg(), description: "Shipping" });
    if (!tax.isZero()) target.push({ accountId: await sysAccount(pc, "sales_tax_payable"), locationId: loc, amount: tax.neg(), description: "Sales tax" });
  }
  if (!wasPaid && target.length === 0) {
    const posted = await pc.db.journalEntry.count({ where: { orgId: pc.orgId, sourceType: "shop_order", sourceId: order.id } });
    if (posted === 0) return { skippedReason: `status_${order.status}` };
  }
  const entry = await reconcileToTarget(pc, {
    sourceType: "shop_order",
    sourceId: order.id,
    eventPrefix: "order",
    entryDate: PAID.has(order.status) ? order.fulfilledAt ?? order.updatedAt : eventAt,
    memo: `Shop order ${order.id} ${order.status}`,
    locationId: loc,
    target,
  });
  return entry ? { journalEntryId: entry.id, warningCode: postingWarning(pc) } : { skippedReason: "no_change" };
}