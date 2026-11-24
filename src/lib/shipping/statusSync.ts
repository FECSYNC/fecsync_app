/**
 * Shipment ↔ Order status sync from provider webhooks (Phase 3).
 *
 * Manual admin PUT /api/order/[id] status is authoritative going forward:
 * alignShipmentWithManualOrderStatus mirrors shipped/delivered/cancelled onto
 * the active Shipment. Webhooks must not downgrade a newer/higher order status
 * (monotonic forward only). Duplicate events are skipped via
 * Shipment.lastWebhookEventId.
 */

import type { OrderStatus, ShipmentStatus, ShippingProviderCode } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendOrderStatusEmail } from "@/lib/mailer";
import { createNotification } from "@/services/notificationService";
import { logActivityEntry } from "@/lib/audit/activityLog";
import { P } from "@/lib/auth/permissions";
import {
  effectiveMembershipPermissions,
  templatePermissionsForMembership,
} from "@/lib/membership";
import { sanitizePublicHttpUrl } from "./serialize";
import { hasSiblingLiveShipment } from "./consistency";

/** Monotonic order ranks — webhooks never move backwards. */
const ORDER_STATUS_RANK: Partial<Record<OrderStatus, number>> = {
  paid: 1,
  shipping: 2,
  shipped: 3,
  delivered: 4,
};

const SHIPMENT_STATUS_RANK: Record<ShipmentStatus, number> = {
  pending: 0,
  booked: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
  failed: -1,
  cancelled: -1,
};

export function mapShipmentStatusToOrderStatus(
  shipmentStatus: ShipmentStatus
): OrderStatus | null {
  switch (shipmentStatus) {
    case "booked":
    case "picked_up":
      return "shipping";
    case "in_transit":
    case "out_for_delivery":
      return "shipped";
    case "delivered":
      return "delivered";
    case "cancelled":
    case "failed":
    case "pending":
      return null; // leave order as-is (re-book / admin decides)
    default:
      return null;
  }
}

/** Normalize provider status strings → ShipmentStatus. */
export function normalizeProviderShipmentStatus(
  raw: string | null | undefined,
  event?: string | null
): ShipmentStatus | null {
  const eventKey = String(event || "")
    .trim()
    .toLowerCase();
  if (eventKey === "shipment.cancelled" || eventKey.includes("cancel")) {
    return "cancelled";
  }
  if (eventKey === "shipment.label.created") {
    return "booked";
  }

  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!key) return null;

  if (
    key === "pending" ||
    key === "label_created" ||
    key === "created" ||
    key === "booked" ||
    key === "confirmed" ||
    key === "assigned" ||
    key === "processing" ||
    key === "pending_payment" ||
    key === "pending_pick_up" ||
    key === "pending_pickup"
  ) {
    return "booked";
  }
  if (
    key === "picked_up" ||
    key === "pickup" ||
    key === "collected" ||
    key === "pickedup"
  ) {
    return "picked_up";
  }
  if (
    key === "in_transit" ||
    key === "transit" ||
    key === "intransit" ||
    key === "on_the_way" ||
    key === "dispatched"
  ) {
    return "in_transit";
  }
  if (
    key === "out_for_delivery" ||
    key === "out_for_delievery" || // common provider typo
    key === "ofd"
  ) {
    return "out_for_delivery";
  }
  if (key === "delivered" || key === "completed") {
    return "delivered";
  }
  if (key === "cancelled" || key === "canceled") {
    return "cancelled";
  }
  if (
    key === "failed" ||
    key === "failure" ||
    key === "returned" ||
    key === "return"
  ) {
    return "failed";
  }
  return null;
}

export function shouldUpgradeOrderStatus(
  current: OrderStatus,
  next: OrderStatus
): boolean {
  const a = ORDER_STATUS_RANK[current];
  const b = ORDER_STATUS_RANK[next];
  if (a == null || b == null) return false;
  return b > a;
}

/**
 * Align Order.status from an already-persisted Shipment status.
 * Used on duplicate/unmapped/skip webhook paths so retries heal drift.
 * Forward: booked→shipping, in_transit→shipped, delivered→delivered.
 * Rollback: cancelled/failed with order still shipping|shipped → paid (re-bookable),
 * only when no sibling live shipment remains.
 */
async function healOrderStatusFromShipment(
  order: { id: string; status: OrderStatus },
  shipmentStatus: ShipmentStatus,
  shipmentId: string
): Promise<OrderStatus | null> {
  if (shipmentStatus === "cancelled" || shipmentStatus === "failed") {
    if (order.status !== "shipping" && order.status !== "shipped") {
      return null;
    }
    const siblings = await prisma.shipment.findMany({
      where: { orderId: order.id },
      select: { id: true, status: true, providerShipmentId: true },
    });
    if (hasSiblingLiveShipment(siblings, shipmentId)) {
      return null;
    }
    const rolled = await prisma.order.updateMany({
      where: {
        id: order.id,
        status: { in: ["shipping", "shipped"] },
      },
      data: { status: "paid" },
    });
    return rolled.count > 0 ? "paid" : null;
  }

  const target = mapShipmentStatusToOrderStatus(shipmentStatus);
  if (!target || !shouldUpgradeOrderStatus(order.status, target)) {
    return null;
  }
  await prisma.order.update({
    where: { id: order.id },
    data: { status: target },
  });
  return target;
}

export function shouldUpgradeShipmentStatus(
  current: ShipmentStatus,
  next: ShipmentStatus
): boolean {
  // Delivered is terminal — ignore late cancel/fail/status noise from the courier.
  if (current === "delivered") return false;

  if (next === "cancelled" || next === "failed") {
    // Allow terminal cancel/fail from in-flight states only (not from already-terminal).
    if (current === "cancelled" || current === "failed") return false;
    return true;
  }
  if (current === "cancelled" || current === "failed") {
    // Recovery only via explicit re-book (not webhook flip).
    return false;
  }
  return SHIPMENT_STATUS_RANK[next] >= SHIPMENT_STATUS_RANK[current];
}

/**
 * Map a manual admin Order.status to the shipment status we should align to.
 * Does not invent a courier label (never pending → booked without a provider id).
 */
export function mapManualOrderStatusToShipmentStatus(
  orderStatus: OrderStatus
): ShipmentStatus | null {
  switch (orderStatus) {
    case "shipped":
      return "in_transit";
    case "delivered":
      return "delivered";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * Keep Shipment in sync when staff manually set Order.status (PUT /api/order/[id]).
 * Webhooks remain forward-only; this is the reverse direction for admin authority.
 *
 * - shipped / delivered → monotonic local shipment upgrade (orders:manage OK)
 * - cancelled + allowCourierCancel → provider cancel (requires deliveries:manage)
 * - cancelled without allowCourierCancel → local cancel only + staff reconcile alert
 */
export async function alignShipmentWithManualOrderStatus(input: {
  orderId: string;
  nextOrderStatus: OrderStatus;
  /**
   * When true, may call the courier cancel API.
   * Must only be set when the actor has deliveries:manage.
   */
  allowCourierCancel?: boolean;
}): Promise<{
  shipmentId: string | null;
  aligned: boolean;
  shipmentCancelled: boolean;
}> {
  const orderId = String(input.orderId || "").trim();
  if (!orderId) {
    return { shipmentId: null, aligned: false, shipmentCancelled: false };
  }

  const target = mapManualOrderStatusToShipmentStatus(input.nextOrderStatus);
  if (!target) {
    return { shipmentId: null, aligned: false, shipmentCancelled: false };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orgId: true,
      shippingMethod: true,
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  if (!order?.shipments?.length) {
    return { shipmentId: null, aligned: false, shipmentCancelled: false };
  }

  const { findActiveShipment } = await import("./consistency");
  const { parseOrderShippingMethodJson } = await import("./address");
  const preferred = parseOrderShippingMethodJson(order.shippingMethod)?.provider;
  const active = findActiveShipment(order.shipments, preferred);
  if (!active) {
    return { shipmentId: null, aligned: false, shipmentCancelled: false };
  }

  if (target === "cancelled") {
    if (active.status === "delivered") {
      const { ShippingError } = await import("./errors");
      throw new ShippingError(
        "cannot_cancel_delivered_shipment",
        "Cannot cancel an order that has a delivered shipment"
      );
    }
    if (active.status === "cancelled") {
      return {
        shipmentId: active.id,
        aligned: true,
        shipmentCancelled: true,
      };
    }

    // Privilege boundary: courier cancel is deliveries:manage only.
    if (input.allowCourierCancel) {
      try {
        const { cancelShipmentRecord } = await import("./booking");
        await cancelShipmentRecord(active.id, order.orgId);
        return {
          shipmentId: active.id,
          aligned: true,
          shipmentCancelled: true,
        };
      } catch (err) {
        const { isShippingError } = await import("./errors");
        // Courier cancel succeeded but local persist failed — surface so order
        // status can roll back instead of leaving cancelled order + live row.
        if (isShippingError(err) && err.code === "cancel_persist_failed") {
          throw err;
        }
        console.error(
          `[alignShipment] courier cancel failed order=${orderId} shipment=${active.id}:`,
          err
        );
      }
    }

    if (!shouldUpgradeShipmentStatus(active.status, "cancelled")) {
      return {
        shipmentId: active.id,
        aligned: false,
        shipmentCancelled: false,
      };
    }

    const hadLiveLabel = Boolean(active.providerShipmentId);
    const priorCourierId = active.providerShipmentId?.trim() || null;
    try {
      await prisma.shipment.update({
        where: { id: active.id },
        data: {
          status: "cancelled",
          trackingUrl: null,
          labelUrl: null,
          // Keep providerShipmentId for webhook find-by-id; reclaim clears on re-book.
          deliveredAt: null,
          failureReason: [
            input.allowCourierCancel
              ? "Order cancelled by staff; courier cancel failed — reconcile manually"
              : "Order cancelled by staff; courier cancel skipped (missing deliveries:manage) — cancel label via Deliveries",
            priorCourierId ? `Prior courier id: ${priorCourierId}` : null,
          ]
            .filter(Boolean)
            .join(" ")
            .slice(0, 500),
        },
      });
    } catch (persistErr) {
      const { ShippingError } = await import("./errors");
      throw new ShippingError(
        "cancel_persist_failed",
        persistErr instanceof Error
          ? persistErr.message
          : "Failed to mark shipment cancelled"
      );
    }
    // Order was cancelled — no shipping/shipped→paid heal needed.
    if (hadLiveLabel) {
      await notifyStaffShipmentAlert({
        orgId: order.orgId,
        orderId,
        shipmentId: active.id,
        title: "Shipment cancel needs reconcile",
        message: input.allowCourierCancel
          ? `Order #${orderId.slice(-8)} was cancelled but courier cancel failed. Check the label.`
          : `Order #${orderId.slice(-8)} was cancelled without deliveries:manage. Cancel the courier label via Deliveries.`,
      });
    }
    const orderOwner = await prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (orderOwner?.userId) {
      const { notifyCustomerShipmentUpdate } = await import(
        "@/lib/notifyShipmentStatus"
      );
      await notifyCustomerShipmentUpdate({
        userId: orderOwner.userId,
        orderId,
        shipmentId: active.id,
        status: "cancelled",
        trackingUrl: null,
      });
    }
    return {
      shipmentId: active.id,
      aligned: true,
      shipmentCancelled: true,
    };
  }

  if (!shouldUpgradeShipmentStatus(active.status, target)) {
    return {
      shipmentId: active.id,
      aligned: active.status === target,
      shipmentCancelled: false,
    };
  }

  // Never invent courier progress without a live label (pending/failed/cancelled).
  if (target === "in_transit" || target === "delivered") {
    const hasLiveLabel = Boolean(
      String(active.providerShipmentId || "").trim()
    );
    const bookableProgress =
      active.status === "booked" ||
      active.status === "picked_up" ||
      active.status === "in_transit" ||
      active.status === "out_for_delivery" ||
      active.status === "delivered";
    if (!hasLiveLabel || !bookableProgress) {
      return {
        shipmentId: active.id,
        aligned: false,
        shipmentCancelled: false,
      };
    }
  }

  const data: {
    status: ShipmentStatus;
    deliveredAt?: Date | null;
    failureReason?: string | null;
  } = { status: target };
  if (target === "delivered") {
    data.deliveredAt = new Date();
    data.failureReason = null;
  }

  await prisma.shipment.update({
    where: { id: active.id },
    data,
  });

  return {
    shipmentId: active.id,
    aligned: true,
    shipmentCancelled: false,
  };
}

async function notifyStaffShipmentAlert(input: {
  orgId: string;
  orderId: string;
  shipmentId: string;
  title: string;
  message: string;
}): Promise<void> {
  try {
    const members = await prisma.membership.findMany({
      where: { orgId: input.orgId, status: "active" },
      select: {
        userId: true,
        orgId: true,
        rolePreset: true,
        roleTemplateId: true,
        permissionsOverride: true,
      },
    });

    await Promise.allSettled(
      members.map(async (member) => {
        const templatePermissions = await templatePermissionsForMembership({
          orgId: member.orgId,
          roleTemplateId: member.roleTemplateId,
        });
        const permissions = effectiveMembershipPermissions({
          rolePreset: String(member.rolePreset ?? ""),
          permissionsOverride: member.permissionsOverride,
          templatePermissions,
        });
        if (
          !permissions.includes(P.DeliveriesRead) &&
          !permissions.includes(P.DeliveriesManage) &&
          !permissions.includes(P.OrdersRead)
        ) {
          return;
        }
        await createNotification(
          member.userId,
          input.title,
          input.message,
          "system",
          {
            orderId: input.orderId,
            shipmentId: input.shipmentId,
          }
        );
      })
    );
  } catch (err) {
    console.error("[statusSync] staff alert failed:", err);
  }
}

export type ApplyShipmentWebhookInput = {
  provider: ShippingProviderCode;
  providerShipmentId: string;
  eventId: string;
  eventName?: string | null;
  providerStatus?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  courierName?: string | null;
  /** Provider event timestamp when available (stale cancel / replay guard). */
  eventAt?: string | Date | null;
  rawPayload?: unknown;
};

/**
 * Apply a verified provider webhook to Shipment + Order.
 * Idempotent on eventId; never downgrades order status rank.
 */
export async function applyShipmentWebhookEvent(
  input: ApplyShipmentWebhookInput
): Promise<{ ok: boolean; skipped?: string; shipmentId?: string }> {
  const providerShipmentId = String(input.providerShipmentId || "").trim();
  if (!providerShipmentId) {
    return { ok: false, skipped: "missing_provider_shipment_id" };
  }

  const matches = await prisma.shipment.findMany({
    where: {
      provider: input.provider,
      providerShipmentId,
    },
    include: {
      order: {
        include: {
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              username: true,
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 5,
  });

  if (matches.length > 1) {
    console.error(
      `[statusSync] duplicate providerShipmentId provider=${input.provider} id=${providerShipmentId} count=${matches.length} — applying to most recent`
    );
  }

  const shipment = matches[0];

  if (!shipment) {
    console.warn(
      `[statusSync] no shipment for providerShipmentId=${providerShipmentId}`
    );
    return { ok: false, skipped: "shipment_not_found" };
  }

  if (
    shipment.lastWebhookEventId &&
    shipment.lastWebhookEventId === input.eventId
  ) {
    // Prior attempt may have written lastWebhookEventId + shipment status but
    // crashed before Order.status — heal on duplicate ACK.
    await healOrderStatusFromShipment(shipment.order, shipment.status, shipment.id);
    return { ok: true, skipped: "duplicate_event", shipmentId: shipment.id };
  }

  const nextStatus = normalizeProviderShipmentStatus(
    input.providerStatus,
    input.eventName
  );
  const safeTrackingUrl = sanitizePublicHttpUrl(input.trackingUrl);
  const safeLabelUrl = sanitizePublicHttpUrl(input.labelUrl);
  const safeTrackingNumber = input.trackingNumber
    ? String(input.trackingNumber).trim().slice(0, 128) || null
    : null;
  const safeCourierName = input.courierName
    ? String(input.courierName).trim().slice(0, 200) || null
    : null;

  if (!nextStatus) {
    // Still record event id so we don't reprocess unknowns forever after fix.
    // Never revive tracking/label URLs on terminal rows from unmapped noise.
    const terminal =
      shipment.status === "cancelled" ||
      shipment.status === "failed" ||
      shipment.status === "delivered";
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        lastWebhookEventId: input.eventId,
        rawProviderPayload: (input.rawPayload ?? undefined) as object | undefined,
        ...(terminal
          ? {}
          : {
              trackingNumber: safeTrackingNumber || shipment.trackingNumber,
              trackingUrl: safeTrackingUrl || shipment.trackingUrl,
              labelUrl: safeLabelUrl || shipment.labelUrl,
              courierName: safeCourierName || shipment.courierName,
            }),
      },
    });
    await healOrderStatusFromShipment(shipment.order, shipment.status, shipment.id);
    return { ok: true, skipped: "unmapped_status", shipmentId: shipment.id };
  }

  // Stale cancel after re-book: ignore when bookedAt is newer than event time.
  if (nextStatus === "cancelled" && shipment.bookedAt && input.eventAt) {
    const eventMs =
      input.eventAt instanceof Date
        ? input.eventAt.getTime()
        : Date.parse(String(input.eventAt));
    if (
      Number.isFinite(eventMs) &&
      shipment.bookedAt.getTime() > (eventMs as number)
    ) {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { lastWebhookEventId: input.eventId },
      });
      return {
        ok: true,
        skipped: "stale_cancel_after_rebook",
        shipmentId: shipment.id,
      };
    }
  }

  if (!shouldUpgradeShipmentStatus(shipment.status, nextStatus)) {
    const terminal =
      shipment.status === "cancelled" ||
      shipment.status === "failed" ||
      shipment.status === "delivered";
    const hadTrackingUrl = Boolean(
      sanitizePublicHttpUrl(shipment.trackingUrl)
    );
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        lastWebhookEventId: input.eventId,
        // Same status can still deliver tracking/label after initial book.
        ...(terminal
          ? {}
          : {
              trackingNumber: safeTrackingNumber || shipment.trackingNumber,
              trackingUrl: safeTrackingUrl || shipment.trackingUrl,
              labelUrl: safeLabelUrl || shipment.labelUrl,
              courierName: safeCourierName || shipment.courierName,
            }),
      },
    });
    await healOrderStatusFromShipment(shipment.order, shipment.status, shipment.id);

    // First tracking URL after book — email customer (status already notified).
    if (
      !terminal &&
      !hadTrackingUrl &&
      safeTrackingUrl &&
      shipment.order.user?.email?.trim()
    ) {
      const email = shipment.order.user.email.trim();
      const customerName =
        [shipment.order.user.firstName, shipment.order.user.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        shipment.order.user.username ||
        undefined;
      const orderStatusForEmail =
        mapShipmentStatusToOrderStatus(shipment.status) ||
        shipment.order.status;
      void sendOrderStatusEmail({
        to: email,
        customerName,
        orderId: shipment.order.id,
        status:
          orderStatusForEmail === "shipped" ||
          orderStatusForEmail === "delivered" ||
          orderStatusForEmail === "shipping"
            ? orderStatusForEmail
            : "shipping",
        trackingUrl: safeTrackingUrl,
        courierName: safeCourierName || shipment.courierName || undefined,
        trackingNumber: safeTrackingNumber || shipment.trackingNumber || undefined,
        orgId: shipment.order.orgId ?? null,
      }).catch((err) => {
        console.error(
          `[statusSync] tracking-ready email failed order=${shipment.order.id}:`,
          err
        );
      });
    }

    return { ok: true, skipped: "shipment_not_upgraded", shipmentId: shipment.id };
  }

  // Manual/admin delivered is authoritative — never cancel/fail the shipment
  // out from under a delivered order (would desync Order vs Shipment).
  if (
    (nextStatus === "cancelled" || nextStatus === "failed") &&
    shipment.order.status === "delivered"
  ) {
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { lastWebhookEventId: input.eventId },
    });
    console.warn(
      `[statusSync] ignore ${nextStatus} webhook for delivered order=${shipment.order.id} shipment=${shipment.id}`
    );
    return {
      ok: true,
      skipped: "order_already_delivered",
      shipmentId: shipment.id,
    };
  }

  const orderTarget = mapShipmentStatusToOrderStatus(nextStatus);
  const now = new Date();

  const shipmentUpdate: {
    status: ShipmentStatus;
    lastWebhookEventId: string;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    labelUrl?: string | null;
    courierName?: string;
    rawProviderPayload?: object;
    deliveredAt?: Date | null;
    failureReason?: string | null;
  } = {
    status: nextStatus,
    lastWebhookEventId: input.eventId,
    rawProviderPayload: (input.rawPayload ?? undefined) as object | undefined,
  };
  if (safeTrackingNumber) shipmentUpdate.trackingNumber = safeTrackingNumber;
  if (safeTrackingUrl) shipmentUpdate.trackingUrl = safeTrackingUrl;
  if (safeLabelUrl) shipmentUpdate.labelUrl = safeLabelUrl;
  if (safeCourierName) shipmentUpdate.courierName = safeCourierName;
  if (nextStatus === "delivered") shipmentUpdate.deliveredAt = now;
  if (nextStatus === "failed") {
    shipmentUpdate.failureReason =
      String(input.providerStatus || "Provider reported failure").slice(0, 500);
  }
  if (nextStatus === "cancelled" || nextStatus === "failed") {
    // Public links must not stay live after terminal cancel/fail.
    shipmentUpdate.trackingUrl = null;
    shipmentUpdate.labelUrl = null;
  }
  if (nextStatus === "cancelled") {
    // Keep providerShipmentId so cancel webhooks can still find this row.
    // Reclaim on re-book clears the id before booking a fresh label.
    shipmentUpdate.deliveredAt = null;
  }
  if (nextStatus === "cancelled" || nextStatus === "booked") {
    // clear prior failure on recovery path only when booked via webhook (rare)
    if (nextStatus === "booked") shipmentUpdate.failureReason = null;
  }

  const order = shipment.order;
  let appliedOrderStatus: OrderStatus | null = null;
  let rolledBackToPaid = false;

  // Persist shipment + order together so lastWebhookEventId cannot ACK a
  // duplicate before Order.status has advanced (crash/retry safety).
  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: shipmentUpdate,
    });
    if (orderTarget && shouldUpgradeOrderStatus(order.status, orderTarget)) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: orderTarget },
      });
      appliedOrderStatus = orderTarget;
    }
    if (nextStatus === "cancelled" || nextStatus === "failed") {
      const siblings = await tx.shipment.findMany({
        where: { orderId: order.id },
        select: { id: true, status: true, providerShipmentId: true },
      });
      // After this update, current row is cancelled/failed — exclude it.
      if (!hasSiblingLiveShipment(siblings, shipment.id)) {
        const rolled = await tx.order.updateMany({
          where: {
            id: order.id,
            status: { in: ["shipping", "shipped"] },
          },
          data: { status: "paid" },
        });
        rolledBackToPaid = rolled.count > 0;
      }
    }
  });

  logActivityEntry({
    actorSub: null,
    orgId: order.orgId ?? null,
    action: "Shipment webhook",
    entityType: "Order",
    entityId: order.id,
    description: `${input.provider} webhook → shipment ${nextStatus}${
      appliedOrderStatus
        ? `, order ${appliedOrderStatus}`
        : rolledBackToPaid
          ? ", order paid (re-bookable)"
          : ""
    }`,
    metadata: {
      shipmentId: shipment.id,
      provider: input.provider,
      providerShipmentId,
      eventId: input.eventId,
      eventName: input.eventName,
      providerStatus: input.providerStatus,
      shipmentStatus: nextStatus,
      orderStatus: appliedOrderStatus,
      rolledBackToPaid,
    },
  });

  // Side effects after ACK-critical DB work — do not block webhook 200 on SMTP.
  const email = order.user?.email?.trim();
  const customerName =
    [order.user?.firstName, order.user?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    order.user?.username ||
    undefined;
  const trackingUrl =
    safeTrackingUrl ||
    sanitizePublicHttpUrl(shipment.trackingUrl) ||
    undefined;
  const courierNameForEmail =
    safeCourierName || shipment.courierName || undefined;
  const priorShipmentStatus = shipment.status;
  const orderUserId = order.userId;
  const orderIdForNotify = order.id;
  const shipmentOrgId = shipment.orgId;
  const shipmentIdForNotify = shipment.id;
  const orderStatusSnapshot = order.status;

  void (async () => {
    try {
      const { notifyCustomerShipmentUpdate, notifyStaffShipmentFailed } =
        await import("@/lib/notifyShipmentStatus");
      const shipmentBecameBooked =
        nextStatus === "booked" && priorShipmentStatus !== "booked";
      if (
        email &&
        shipmentBecameBooked &&
        (appliedOrderStatus === "shipping" ||
          orderStatusSnapshot === "shipping" ||
          orderStatusSnapshot === "paid")
      ) {
        await sendOrderStatusEmail({
          to: email,
          customerName,
          orderId: orderIdForNotify,
          status: "shipping",
          trackingUrl: trackingUrl || undefined,
          courierName: courierNameForEmail,
          trackingNumber:
            safeTrackingNumber || shipment.trackingNumber || undefined,
          orgId: shipment.order.orgId ?? null,
        });
      } else if (email && appliedOrderStatus === "shipped") {
        await sendOrderStatusEmail({
          to: email,
          customerName,
          orderId: orderIdForNotify,
          status: "shipped",
          trackingUrl: trackingUrl || undefined,
          courierName: courierNameForEmail,
          trackingNumber:
            safeTrackingNumber || shipment.trackingNumber || undefined,
          orgId: shipment.order.orgId ?? null,
        });
      } else if (email && appliedOrderStatus === "delivered") {
        await sendOrderStatusEmail({
          to: email,
          customerName,
          orderId: orderIdForNotify,
          status: "delivered",
          trackingUrl: trackingUrl || undefined,
          courierName: courierNameForEmail,
          trackingNumber:
            safeTrackingNumber || shipment.trackingNumber || undefined,
          orgId: shipment.order.orgId ?? null,
        });
      }

      if (
        shipmentBecameBooked &&
        (appliedOrderStatus === "shipping" ||
          orderStatusSnapshot === "shipping" ||
          orderStatusSnapshot === "paid")
      ) {
        await notifyCustomerShipmentUpdate({
          userId: orderUserId,
          orderId: orderIdForNotify,
          shipmentId: shipmentIdForNotify,
          status: "shipping",
          trackingUrl,
        });
      } else if (appliedOrderStatus === "shipped") {
        await notifyCustomerShipmentUpdate({
          userId: orderUserId,
          orderId: orderIdForNotify,
          shipmentId: shipmentIdForNotify,
          status: "shipped",
          trackingUrl,
        });
      } else if (appliedOrderStatus === "delivered") {
        await notifyCustomerShipmentUpdate({
          userId: orderUserId,
          orderId: orderIdForNotify,
          shipmentId: shipmentIdForNotify,
          status: "delivered",
          trackingUrl,
        });
      } else if (nextStatus === "cancelled" || nextStatus === "failed") {
        await notifyCustomerShipmentUpdate({
          userId: orderUserId,
          orderId: orderIdForNotify,
          shipmentId: shipmentIdForNotify,
          status: nextStatus,
          trackingUrl: null,
        });
      }

      if (nextStatus === "cancelled" || nextStatus === "failed") {
        await notifyStaffShipmentFailed({
          orgId: shipmentOrgId,
          orderId: orderIdForNotify,
          shipmentId: shipmentIdForNotify,
          reason: `Order #${orderIdForNotify.slice(-8)} shipment is ${nextStatus}. Re-book or update manually.`,
        });
      }
    } catch (sideErr) {
      console.error("[statusSync] webhook side effects failed:", sideErr);
    }
  })();

  return { ok: true, shipmentId: shipment.id };
}

export function buildWebhookEventId(payload: {
  event?: string | null;
  event_id?: string | null;
  order_id?: string | null;
  status?: string | null;
  date?: string | null;
}): string {
  if (payload.event_id?.trim()) return payload.event_id.trim();
  return [
    payload.event || "event",
    payload.order_id || "",
    payload.status || "",
    payload.date || "",
  ].join("|");
}
