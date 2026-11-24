/**
 * In-app customer notifications for shipment lifecycle (Phase 4 S8).
 * Type `order` + metadata.href → profile orders tab.
 */

import { createNotification } from "@/services/notificationService";
import { sanitizePublicHttpUrl } from "./serialize";

export type CustomerShipmentNotifyStatus =
  | "shipping"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed";

const COPY: Record<
  CustomerShipmentNotifyStatus,
  { title: string; message: (shortId: string) => string }
> = {
  shipping: {
    title: "Your order is shipping",
    message: (shortId) =>
      `Order #${shortId} has a courier label. Open your orders to track delivery.`,
  },
  shipped: {
    title: "Your order is on the way",
    message: (shortId) =>
      `Order #${shortId} is in transit. Track it from your profile orders.`,
  },
  delivered: {
    title: "Your order was delivered",
    message: (shortId) =>
      `Order #${shortId} was marked delivered. View details in your profile.`,
  },
  cancelled: {
    title: "Shipment cancelled",
    message: (shortId) =>
      `The shipment for order #${shortId} was cancelled. Check your order for updates.`,
  },
  failed: {
    title: "Shipment update",
    message: (shortId) =>
      `There was a problem with the shipment for order #${shortId}. We will follow up.`,
  },
};

/**
 * Notify the order owner about a shipment status change.
 * Best-effort — never throws to callers.
 */
export async function notifyCustomerShipmentStatus(input: {
  userId: string;
  orderId: string;
  shipmentId: string;
  status: CustomerShipmentNotifyStatus;
  trackingUrl?: string | null;
}): Promise<void> {
  const userId = String(input.userId || "").trim();
  const orderId = String(input.orderId || "").trim();
  const shipmentId = String(input.shipmentId || "").trim();
  if (!userId || !orderId || !shipmentId) return;

  const copy = COPY[input.status];
  if (!copy) return;

  const shortId = orderId.slice(-8);
  const trackingUrl = sanitizePublicHttpUrl(input.trackingUrl) || undefined;
  try {
    await createNotification(userId, copy.title, copy.message(shortId), "order", {
      orderId,
      shipmentId,
      href: `/profile?tab=orders&orderId=${encodeURIComponent(orderId)}`,
      trackingUrl,
      shipmentStatus: input.status,
    });
  } catch (err) {
    console.error(
      `[notifyCustomerShipmentStatus] order=${orderId} status=${input.status}:`,
      err
    );
  }
}
