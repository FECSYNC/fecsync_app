/**
 * Book / retry / cancel shipments for paid orders (Phase 3).
 * Payment must never roll back if booking fails — persist status: failed + reason.
 */

import type {
  OrderStatus,
  Shipment,
  ShipmentStatus,
  ShippingProviderCode,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { P } from "@/lib/auth/permissions";
import {
  effectiveMembershipPermissions,
  templatePermissionsForMembership,
} from "@/lib/membership";
import { createNotification } from "@/services/notificationService";
import {
  isShippingMethodExpired,
  parseOrderShippingMethodJson,
  parseShippingAddressJson,
} from "./address";
import {
  assertShipmentMatchesOrder,
  hasSiblingLiveShipment,
} from "./consistency";
import { ShippingError, ShippingProviderError } from "./errors";
import { cancelShipbubbleShipment } from "./providers/shipbubble/book";
import { cancelFezShipment } from "./providers/fez/client";
import { bookShipmentWithFallback } from "./providerRouter";
import { computeParcelFromCart } from "./parcelDefaults";
import { getOrCreateShippingSettings } from "./settings";
import { serializeShipment, sanitizePublicHttpUrl } from "./serialize";
import type {
  BookShipmentResult,
  OrderShippingMethod,
  SerializedShipment,
} from "./types";
import {
  mapShipmentStatusToOrderStatus,
  shouldUpgradeOrderStatus,
} from "./statusSync";
import { refreshExpiredShippingMethodForBooking } from "./resolveSelection";
import { ensureShippingEnvValidated } from "./validateEnv";
import { loadCartForCheckout } from "@/lib/orderFulfillment";

function toOpsShipment(row: Shipment): SerializedShipment {
  return serializeShipment(row, { includeOpsFields: true });
}

function safeProviderUrls(input: {
  trackingUrl?: string | null;
  labelUrl?: string | null;
}): { trackingUrl: string | null; labelUrl: string | null } {
  return {
    trackingUrl: sanitizePublicHttpUrl(input.trackingUrl),
    labelUrl: sanitizePublicHttpUrl(input.labelUrl),
  };
}

const BOOKABLE_ORDER_STATUSES = new Set([
  "paid",
  "shipping",
  "shipped",
]);

const RETRYABLE_SHIPMENT_STATUSES = new Set([
  "pending",
  "failed",
  "cancelled",
]);

/** Active courier rows — never re-book while one of these exists on the order. */
const LIVE_SHIPMENT_STATUSES = new Set<ShipmentStatus>([
  "booked",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
]);

/**
 * Persist-after-provider split: courier created a label but local status stayed
 * failed/pending. Never treat cancelled as recoverable — cancel voids the label.
 */
function canRecoverProviderBookWithoutRebook(
  status: ShipmentStatus,
  providerShipmentId: string | null | undefined
): boolean {
  if (!providerShipmentId) return false;
  return status === "failed" || status === "pending";
}

function findLiveShipmentOnOrder(
  shipments: Array<Shipment>
): Shipment | undefined {
  return shipments.find((s) => LIVE_SHIPMENT_STATUSES.has(s.status));
}

function findRecoverableOrInProgressShipment(
  shipments: Array<Shipment>
): Shipment | undefined {
  return shipments.find(
    (s) =>
      canRecoverProviderBookWithoutRebook(s.status, s.providerShipmentId) ||
      (s.status === "pending" && !s.providerShipmentId)
  );
}

async function notifyStaffBookingFailure(input: {
  orgId: string;
  orderId: string;
  shipmentId: string;
  reason: string;
}): Promise<void> {
  const { notifyStaffShipmentFailed } = await import(
    "@/lib/notifyShipmentStatus"
  );
  await notifyStaffShipmentFailed(input);
}

async function notifyCustomerLabelCreated(input: {
  orderId: string;
  userId: string;
  shipmentId: string;
  trackingUrl?: string | null;
  trackingNumber?: string | null;
  courierName?: string | null;
  orgId?: string | null;
}): Promise<void> {
  try {
    const { notifyCustomerShipmentUpdate } = await import(
      "@/lib/notifyShipmentStatus"
    );
    const trackingUrl = sanitizePublicHttpUrl(input.trackingUrl);
    await notifyCustomerShipmentUpdate({
      userId: input.userId,
      orderId: input.orderId,
      shipmentId: input.shipmentId,
      status: "shipping",
      trackingUrl,
    });

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });
    const email = user?.email?.trim();
    if (!email) return;

    const { sendOrderStatusEmail } = await import("@/lib/mailer");
    const customerName =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      user?.username ||
      undefined;
    await sendOrderStatusEmail({
      to: email,
      customerName,
      orderId: input.orderId,
      status: "shipping",
      trackingUrl: trackingUrl || undefined,
      courierName: input.courierName?.trim() || undefined,
      trackingNumber: input.trackingNumber?.trim() || undefined,
      orgId: input.orgId ?? null,
    });
  } catch (err) {
    console.error(
      `[bookShipment] customer label notify failed order=${input.orderId}:`,
      err
    );
  }
}

async function upsertFailedShipment(input: {
  orderId: string;
  orgId: string;
  provider: ShippingProviderCode;
  shippingFee: number;
  currency: string;
  serviceCode?: string;
  courierName?: string;
  rateToken?: string;
  reason: string;
  /** Keep courier id when recording a post-provider persist failure (avoid double-book). */
  providerShipmentId?: string | null;
  clearProviderHandles?: boolean;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
}): Promise<Shipment> {
  const reason = input.reason.slice(0, 500);
  const clearHandles = input.clearProviderHandles !== false && !input.providerShipmentId;
  const urls = safeProviderUrls({
    trackingUrl: input.trackingUrl,
    labelUrl: input.labelUrl,
  });
  const trackingNumber = input.trackingNumber
    ? String(input.trackingNumber).trim().slice(0, 128) || null
    : null;
  return prisma.shipment.upsert({
    where: {
      orderId_provider: {
        orderId: input.orderId,
        provider: input.provider,
      },
    },
    create: {
      orderId: input.orderId,
      orgId: input.orgId,
      provider: input.provider,
      status: "failed",
      shippingFee: input.shippingFee,
      currency: input.currency,
      serviceCode: input.serviceCode,
      courierName: input.courierName,
      rateToken: input.rateToken,
      failureReason: reason,
      providerShipmentId: input.providerShipmentId ?? undefined,
      trackingNumber: trackingNumber ?? undefined,
      trackingUrl: urls.trackingUrl ?? undefined,
      labelUrl: urls.labelUrl ?? undefined,
    },
    update: {
      status: "failed",
      failureReason: reason,
      shippingFee: input.shippingFee,
      serviceCode: input.serviceCode ?? undefined,
      courierName: input.courierName ?? undefined,
      rateToken: input.rateToken ?? undefined,
      ...(input.providerShipmentId
        ? {
            providerShipmentId: input.providerShipmentId,
            ...(trackingNumber ? { trackingNumber } : {}),
            ...(urls.trackingUrl ? { trackingUrl: urls.trackingUrl } : {}),
            ...(urls.labelUrl ? { labelUrl: urls.labelUrl } : {}),
          }
        : clearHandles
          ? {
              providerShipmentId: null,
              trackingNumber: null,
              trackingUrl: null,
              labelUrl: null,
              bookedAt: null,
              deliveredAt: null,
            }
          : {}),
    },
  });
}

/** If shipment already booked but order lagging (partial book), heal forward. */
async function healOrderStatusAfterExistingShipment(
  orderId: string,
  orderStatus: string,
  shipmentStatus: string
): Promise<void> {
  const target = mapShipmentStatusToOrderStatus(
    shipmentStatus as ShipmentStatus
  );
  if (!target) return;
  if (!shouldUpgradeOrderStatus(orderStatus as OrderStatus, target)) return;
  await prisma.order.updateMany({
    where: { id: orderId, status: orderStatus as OrderStatus },
    data: { status: target },
  });
}

/**
 * Book (or retry) a courier shipment for a paid order.
 * Idempotent when an active non-failed shipment already exists.
 */
export async function bookShipmentForOrder(
  orderId: string,
  options?: { expectedOrgId?: string }
): Promise<SerializedShipment> {
  const id = String(orderId || "").trim();
  if (!id || id.length > 128) {
    throw new ShippingError("invalid_order", "Order id is required");
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      shipments: { orderBy: { createdAt: "desc" }, take: 5 },
      user: { select: { email: true } },
    },
  });
  if (!order) {
    throw new ShippingError("order_not_found", "Order not found");
  }

  if (
    options?.expectedOrgId &&
    order.orgId !== options.expectedOrgId
  ) {
    throw new ShippingError(
      "order_org_mismatch",
      "Order not found in your organization"
    );
  }

  if (!BOOKABLE_ORDER_STATUSES.has(order.status)) {
    throw new ShippingError(
      "order_not_paid",
      `Order must be paid before booking (status=${order.status})`
    );
  }

  const fee = Math.max(0, Number(order.shippingFee) || 0);
  let method = parseOrderShippingMethodJson(order.shippingMethod);
  // Digital / pickup / legacy — no courier label when fee is zero.
  if (fee <= 0) {
    throw new ShippingError(
      "no_shipping",
      "Order has no shipping fee to book"
    );
  }
  if (!method) {
    throw new ShippingError(
      "no_shipping",
      "Order has no shipping method to book"
    );
  }

  // Any live / recoverable shipment on the order (incl. Fez fallback) blocks re-book
  // even when shippingMethod.provider still points at the original quote provider.
  const liveAny = findLiveShipmentOnOrder(order.shipments || []);
  if (liveAny) {
    await healOrderStatusAfterExistingShipment(id, order.status, liveAny.status);
    return toOpsShipment(liveAny);
  }

  const recoverableAny = findRecoverableOrInProgressShipment(
    order.shipments || []
  );
  if (recoverableAny) {
    if (
      canRecoverProviderBookWithoutRebook(
        recoverableAny.status,
        recoverableAny.providerShipmentId
      )
    ) {
      const recovered = await prisma.shipment.update({
        where: { id: recoverableAny.id },
        data: {
          status: "booked",
          failureReason: null,
          bookedAt: recoverableAny.bookedAt ?? new Date(),
        },
      });
      await healOrderStatusAfterExistingShipment(id, order.status, "booked");
      await notifyCustomerLabelCreated({
        orderId: id,
        userId: order.userId,
        shipmentId: recovered.id,
        trackingUrl: recovered.trackingUrl,
        trackingNumber: recovered.trackingNumber,
        courierName: recovered.courierName,
        orgId: order.orgId,
      });
      return toOpsShipment(recovered);
    }
    // Fresh pending without provider id — another worker may own the claim.
    // Fall through to method.provider claim path which enforces stale/in-progress rules.
  }

  // Existing row first — never wipe a live booked shipment via fee-mismatch upsert.
  const existing = await prisma.shipment.findUnique({
    where: {
      orderId_provider: { orderId: id, provider: method.provider },
    },
  });

  if (
    existing &&
    canRecoverProviderBookWithoutRebook(
      existing.status,
      existing.providerShipmentId
    )
  ) {
    // Provider succeeded earlier but local status stayed retryable — do not re-book.
    const recovered = await prisma.shipment.update({
      where: { id: existing.id },
      data: {
        status: "booked",
        failureReason: null,
        bookedAt: existing.bookedAt ?? new Date(),
      },
    });
    await healOrderStatusAfterExistingShipment(id, order.status, "booked");
    await notifyCustomerLabelCreated({
      orderId: id,
      userId: order.userId,
      shipmentId: recovered.id,
      trackingUrl: recovered.trackingUrl,
      trackingNumber: recovered.trackingNumber,
      courierName: recovered.courierName,
      orgId: order.orgId,
    });
    return toOpsShipment(recovered);
  }

  if (existing && !RETRYABLE_SHIPMENT_STATUSES.has(existing.status)) {
    await healOrderStatusAfterExistingShipment(id, order.status, existing.status);
    const fresh = await prisma.shipment.findUnique({
      where: {
        orderId_provider: { orderId: id, provider: method.provider },
      },
    });
    return toOpsShipment(fresh ?? existing);
  }

  const methodFeeCents = Math.round((Number(method.fee) || 0) * 100);
  const orderFeeCents = Math.round(fee * 100);
  if (Math.abs(methodFeeCents - orderFeeCents) > 1) {
    const failed = await upsertFailedShipment({
      orderId: id,
      orgId: order.orgId,
      provider: method.provider,
      shippingFee: fee,
      currency: method.currency || "NGN",
      serviceCode: method.serviceCode,
      courierName: method.courierName,
      rateToken: method.rateToken,
      reason: "Order shippingFee does not match shippingMethod.fee",
    });
    await notifyStaffBookingFailure({
      orgId: order.orgId,
      orderId: id,
      shipmentId: failed.id,
      reason: failed.failureReason || "Fee mismatch",
    });
    return toOpsShipment(failed);
  }

  const destination =
    parseShippingAddressJson(order.shippingAddress) ||
    null;
  if (!destination?.phone) {
    const failed = await upsertFailedShipment({
      orderId: id,
      orgId: order.orgId,
      provider: method.provider,
      shippingFee: fee,
      currency: method.currency || "NGN",
      serviceCode: method.serviceCode,
      courierName: method.courierName,
      rateToken: method.rateToken,
      reason: "Missing shipping address / phone on order",
    });
    await notifyStaffBookingFailure({
      orgId: order.orgId,
      orderId: id,
      shipmentId: failed.id,
      reason: failed.failureReason || "Missing address",
    });
    return toOpsShipment(failed);
  }

  // Checkout quote TTL elapsed — try live rematch (same service + fee) before failing.
  if (isShippingMethodExpired(method)) {
    const refreshed = await refreshExpiredShippingMethodForBooking({
      orderId: id,
      orgId: order.orgId,
      userId: order.userId,
      cartId: order.cartId,
      method,
      destination,
      recipientEmail: order.user?.email,
    });
    if (refreshed) {
      method = refreshed;
    } else {
      const failed = await upsertFailedShipment({
        orderId: id,
        orgId: order.orgId,
        provider: method.provider,
        shippingFee: fee,
        currency: method.currency || "NGN",
        serviceCode: method.serviceCode,
        courierName: method.courierName,
        rateToken: method.rateToken,
        reason:
          "SHIPPING_RATE_EXPIRED: Shipping quote expired before booking and could not be re-matched at the same fee. Re-quote or reconcile manually.",
      });
      await notifyStaffBookingFailure({
        orgId: order.orgId,
        orderId: id,
        shipmentId: failed.id,
        reason: failed.failureReason || "SHIPPING_RATE_EXPIRED",
      });
      return toOpsShipment(failed);
    }
  }

  try {
    assertShipmentMatchesOrder(order, {
      orderId: id,
      orgId: order.orgId,
      shippingFee: fee,
      provider: method.provider,
    });
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Shipment does not match order";
    const failed = await upsertFailedShipment({
      orderId: id,
      orgId: order.orgId,
      provider: method.provider,
      shippingFee: fee,
      currency: method.currency || "NGN",
      serviceCode: method.serviceCode,
      courierName: method.courierName,
      rateToken: method.rateToken,
      reason,
    });
    await notifyStaffBookingFailure({
      orgId: order.orgId,
      orderId: id,
      shipmentId: failed.id,
      reason,
    });
    return toOpsShipment(failed);
  }

  // Claim retryable/empty slot as pending so concurrent callers do not both hit the courier.
  // Fresh `pending` (another worker mid-book) is not reclaimable; only very stale pending
  // (>15m, above typical provider timeouts) can be reclaimed to avoid mid-flight double-book.
  const stalePendingBefore = new Date(Date.now() - 15 * 60 * 1000);

  if (!existing) {
    try {
      await prisma.shipment.create({
        data: {
          orderId: id,
          orgId: order.orgId,
          provider: method.provider,
          status: "pending",
          shippingFee: fee,
          currency: method.currency || "NGN",
          serviceCode: method.serviceCode,
          courierName: method.courierName,
          rateToken: method.rateToken,
        },
      });
    } catch {
      const raced = await prisma.shipment.findUnique({
        where: {
          orderId_provider: { orderId: id, provider: method.provider },
        },
      });
      if (!raced) {
        throw new ShippingError(
          "book_in_progress",
          "Shipment booking could not claim a row for this order"
        );
      }
      if (!RETRYABLE_SHIPMENT_STATUSES.has(raced.status)) {
        await healOrderStatusAfterExistingShipment(id, order.status, raced.status);
        return toOpsShipment(raced);
      }
      if (
        canRecoverProviderBookWithoutRebook(
          raced.status,
          raced.providerShipmentId
        )
      ) {
        const recovered = await prisma.shipment.update({
          where: { id: raced.id },
          data: {
            status: "booked",
            failureReason: null,
            bookedAt: raced.bookedAt ?? new Date(),
          },
        });
        await healOrderStatusAfterExistingShipment(id, order.status, "booked");
        // Persist-after-provider recovery: customer may never have been notified.
        await notifyCustomerLabelCreated({
          orderId: id,
          userId: order.userId,
          shipmentId: recovered.id,
          trackingUrl: recovered.trackingUrl,
          trackingNumber: recovered.trackingNumber,
          courierName: recovered.courierName,
          orgId: order.orgId,
        });
        return toOpsShipment(recovered);
      }
      const claimed = await prisma.shipment.updateMany({
        where: {
          id: raced.id,
          OR: [
            {
              providerShipmentId: null,
              OR: [
                { status: { in: ["failed", "cancelled"] } },
                { status: "pending", updatedAt: { lt: stalePendingBefore } },
              ],
            },
            // Cancelled with leftover courier id — reclaim for a fresh book.
            { status: "cancelled" },
          ],
        },
        data: {
          status: "pending",
          failureReason: null,
          providerShipmentId: null,
          trackingUrl: null,
          labelUrl: null,
          deliveredAt: null,
          shippingFee: fee,
          serviceCode: method.serviceCode,
          courierName: method.courierName,
          rateToken: method.rateToken,
        },
      });
      if (claimed.count === 0) {
        throw new ShippingError(
          "book_in_progress",
          "Shipment booking already in progress for this order"
        );
      }
    }
  } else {
    const claimed = await prisma.shipment.updateMany({
      where: {
        id: existing.id,
        OR: [
          {
            providerShipmentId: null,
            OR: [
              { status: { in: ["failed", "cancelled"] } },
              { status: "pending", updatedAt: { lt: stalePendingBefore } },
            ],
          },
          { status: "cancelled" },
        ],
      },
      data: {
        status: "pending",
        failureReason: null,
        providerShipmentId: null,
        trackingUrl: null,
        labelUrl: null,
        deliveredAt: null,
        shippingFee: fee,
        serviceCode: method.serviceCode,
        courierName: method.courierName,
        rateToken: method.rateToken,
      },
    });
    if (claimed.count === 0) {
      // Own fresh pending from a prior step is OK only when this process created it —
      // existing.status === pending && recent means another worker owns the claim.
      if (existing.status === "pending") {
        throw new ShippingError(
          "book_in_progress",
          "Shipment booking already in progress for this order"
        );
      }
      const raced = await prisma.shipment.findUnique({
        where: {
          orderId_provider: { orderId: id, provider: method.provider },
        },
      });
      if (raced && !RETRYABLE_SHIPMENT_STATUSES.has(raced.status)) {
        await healOrderStatusAfterExistingShipment(id, order.status, raced.status);
        return toOpsShipment(raced);
      }
      if (
        raced &&
        canRecoverProviderBookWithoutRebook(
          raced.status,
          raced.providerShipmentId
        )
      ) {
        const recovered = await prisma.shipment.update({
          where: { id: raced.id },
          data: {
            status: "booked",
            failureReason: null,
            bookedAt: raced.bookedAt ?? new Date(),
          },
        });
        await healOrderStatusAfterExistingShipment(id, order.status, "booked");
        await notifyCustomerLabelCreated({
          orderId: id,
          userId: order.userId,
          shipmentId: recovered.id,
          trackingUrl: recovered.trackingUrl,
          trackingNumber: recovered.trackingNumber,
          courierName: recovered.courierName,
          orgId: order.orgId,
        });
        return toOpsShipment(recovered);
      }
      throw new ShippingError(
        "book_in_progress",
        "Shipment booking already in progress for this order"
      );
    }
  }

  const settings = await getOrCreateShippingSettings(order.orgId);
  ensureShippingEnvValidated();

  // Prefer parcel snapshot from the paid quote; else recompute from cart / settings.
  let parcel = method.parcel;
  if (!parcel) {
    try {
      const cart = await loadCartForCheckout(order.cartId, order.userId);
      parcel = computeParcelFromCart(cart, settings);
    } catch {
      parcel = {
        weightKg: settings.defaultWeightKg,
        length: settings.defaultDimensions.length,
        width: settings.defaultDimensions.width,
        height: settings.defaultDimensions.height,
      };
    }
  }

  let booked: BookShipmentResult & { usedProvider: ShippingProviderCode };
  try {
    const merchandise =
      Number(order.subtotal) > 0
        ? Number(order.subtotal)
        : Math.max(0, Number(order.amount) - fee);
    booked = await bookShipmentWithFallback(
      {
        orderId: id,
        orgId: order.orgId,
        provider: method.provider,
        serviceCode: method.serviceCode,
        rateToken: method.rateToken,
        requestToken: method.requestToken,
        courierId: method.courierId,
        shippingFee: fee,
        declaredValueNgn: merchandise > 0 ? merchandise : fee || 1000,
        destination,
        weightKg: parcel.weightKg,
        dimensions: {
          length: parcel.length,
          width: parcel.width,
          height: parcel.height,
        },
      },
      settings
    );
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Shipment booking failed";
    console.error(`[bookShipment] order=${id} failed:`, err);
    const failed = await upsertFailedShipment({
      orderId: id,
      orgId: order.orgId,
      provider: method.provider,
      shippingFee: fee,
      currency: method.currency || "NGN",
      serviceCode: method.serviceCode,
      courierName: method.courierName,
      rateToken: method.rateToken,
      reason,
    });
    await notifyStaffBookingFailure({
      orgId: order.orgId,
      orderId: id,
      shipmentId: failed.id,
      reason,
    });
    // Never throw after persisting failed — payment path must stay intact;
    // admin/manual callers inspect status === "failed".
    return toOpsShipment(failed);
  }

  const providerUsed = booked.usedProvider;
  const originalProvider = method.provider;
  const now = new Date();
  const urls = safeProviderUrls(booked);

  const nextMethodAfterFallback: OrderShippingMethod | null =
    providerUsed !== originalProvider
      ? {
          provider: providerUsed,
          serviceCode:
            providerUsed === "fez" ? "fez-standard" : method.serviceCode,
          courierName:
            booked.courierName || method.courierName || "Fez Delivery",
          courierId:
            providerUsed === "fez" ? "fez-standard" : method.courierId,
          rateToken:
            providerUsed === "fez"
              ? `fez:fallback:${id}:${fee.toFixed(2)}`
              : method.rateToken,
          fee: method.fee,
          currency: method.currency || "NGN",
          expiresAt: method.expiresAt,
          requestToken:
            providerUsed === "fez" ? undefined : method.requestToken,
          parcel: method.parcel || parcel,
        }
      : null;

  const persistBooked = async () =>
    prisma.$transaction(async (tx) => {
      if (nextMethodAfterFallback) {
        await tx.shipment.updateMany({
          where: {
            orderId: id,
            provider: originalProvider,
            status: "pending",
            providerShipmentId: null,
          },
          data: {
            status: "cancelled",
            failureReason: `Fell back to ${providerUsed} after primary book failure`,
          },
        });
        await tx.order.update({
          where: { id },
          data: { shippingMethod: nextMethodAfterFallback },
        });
      }

      const shipment = await tx.shipment.upsert({
        where: {
          orderId_provider: { orderId: id, provider: providerUsed },
        },
        create: {
          orderId: id,
          orgId: order.orgId,
          provider: providerUsed,
          providerShipmentId: booked.providerShipmentId,
          trackingNumber: booked.trackingNumber,
          trackingUrl: urls.trackingUrl,
          labelUrl: urls.labelUrl,
          status: "booked",
          courierName:
            booked.courierName ||
            nextMethodAfterFallback?.courierName ||
            method.courierName,
          serviceCode:
            nextMethodAfterFallback?.serviceCode || method.serviceCode,
          rateToken:
            nextMethodAfterFallback?.rateToken || method.rateToken,
          shippingFee: fee,
          currency: method.currency || "NGN",
          rawProviderPayload: (booked.rawProviderPayload ?? undefined) as
            | object
            | undefined,
          failureReason: null,
          bookedAt: now,
        },
        update: {
          providerShipmentId: booked.providerShipmentId,
          trackingNumber: booked.trackingNumber,
          trackingUrl: urls.trackingUrl,
          labelUrl: urls.labelUrl,
          status: "booked",
          courierName:
            booked.courierName ||
            nextMethodAfterFallback?.courierName ||
            method.courierName,
          serviceCode:
            nextMethodAfterFallback?.serviceCode || method.serviceCode,
          rateToken:
            nextMethodAfterFallback?.rateToken || method.rateToken,
          shippingFee: fee,
          rawProviderPayload: (booked.rawProviderPayload ?? undefined) as
            | object
            | undefined,
          failureReason: null,
          bookedAt: now,
          deliveredAt: null,
        },
      });

      if (order.status === "paid") {
        await tx.order.updateMany({
          where: { id, status: "paid" },
          data: { status: "shipping" },
        });
      }

      return shipment;
    });

  if (nextMethodAfterFallback) {
    method = nextMethodAfterFallback;
  }

  try {
    const prior = await prisma.shipment.findUnique({
      where: {
        orderId_provider: { orderId: id, provider: providerUsed },
      },
      select: { status: true },
    });
    const row = await persistBooked();
    // Skip if webhook already applied booked (avoids duplicate shipping email/notify).
    if (prior?.status !== "booked") {
      await notifyCustomerLabelCreated({
        orderId: id,
        userId: order.userId,
        shipmentId: row.id,
        trackingUrl: row.trackingUrl,
        trackingNumber: row.trackingNumber,
        courierName: row.courierName || method.courierName,
        orgId: order.orgId,
      });
    }
    return toOpsShipment(row);
  } catch (persistErr) {
    console.error(
      `[bookShipment] persist failed after provider book order=${id} providerShipmentId=${booked.providerShipmentId}:`,
      persistErr
    );
    try {
      const prior = await prisma.shipment.findUnique({
        where: {
          orderId_provider: { orderId: id, provider: providerUsed },
        },
        select: { status: true },
      });
      const row = await persistBooked();
      await notifyStaffBookingFailure({
        orgId: order.orgId,
        orderId: id,
        shipmentId: row.id,
        reason:
          "Courier label created; local save retried successfully after a transient DB error",
      });
      if (prior?.status !== "booked") {
        await notifyCustomerLabelCreated({
          orderId: id,
          userId: order.userId,
          shipmentId: row.id,
          trackingUrl: row.trackingUrl,
          trackingNumber: row.trackingNumber,
          courierName: row.courierName || method.courierName,
          orgId: order.orgId,
        });
      }
      return toOpsShipment(row);
    } catch (persistErr2) {
      console.error(
        `[bookShipment] persist retry failed order=${id}:`,
        persistErr2
      );
      const failed = await upsertFailedShipment({
        orderId: id,
        orgId: order.orgId,
        provider: providerUsed,
        shippingFee: fee,
        currency: method.currency || "NGN",
        serviceCode: method.serviceCode,
        courierName: method.courierName || booked.courierName,
        rateToken: method.rateToken,
        providerShipmentId: booked.providerShipmentId,
        clearProviderHandles: false,
        trackingNumber: booked.trackingNumber,
        trackingUrl: urls.trackingUrl,
        labelUrl: urls.labelUrl,
        reason: `Courier label created (${booked.providerShipmentId}) but local save failed. Do not re-book; reconcile manually.`,
      });
      await notifyStaffBookingFailure({
        orgId: order.orgId,
        orderId: id,
        shipmentId: failed.id,
        reason: failed.failureReason || "Persist failed after courier book",
      });
      return toOpsShipment(failed);
    }
  }
}

/**
 * Auto-book after payment settlement when settings.autoBookOnPaid.
 * Never throws to caller — logs + failed Shipment row + staff notify.
 */
export async function maybeAutoBookShipmentAfterPayment(
  orderId: string
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orgId: true,
        shippingFee: true,
        shippingMethod: true,
        status: true,
      },
    });
    if (!order) return;
    if (!BOOKABLE_ORDER_STATUSES.has(order.status)) return;

    const settings = await getOrCreateShippingSettings(order.orgId);
    if (!settings.autoBookOnPaid) return;

    const fee = Math.max(0, Number(order.shippingFee) || 0);
    // Pickup / digital / legacy orders — never auto-book when fee is zero.
    if (fee <= 0) return;

    const method = parseOrderShippingMethodJson(order.shippingMethod);
    if (!method) {
      // Paid with shipping fee or non-null method blob but unparsable — surface to ops.
      if (fee > 0 || order.shippingMethod != null) {
        const provider =
          settings.primaryProvider ||
          (settings.enabledProviders?.[0] as ShippingProviderCode | undefined) ||
          "shipbubble";
        const failed = await upsertFailedShipment({
          orderId: order.id,
          orgId: order.orgId,
          provider,
          shippingFee: fee,
          currency: "NGN",
          reason:
            "Order shippingMethod is missing or invalid; cannot auto-book",
        });
        await notifyStaffBookingFailure({
          orgId: order.orgId,
          orderId: order.id,
          shipmentId: failed.id,
          reason: failed.failureReason || "Invalid shippingMethod",
        });
      }
      return;
    }

    const allShipments = await prisma.shipment.findMany({
      where: { orderId: order.id },
      select: {
        id: true,
        provider: true,
        status: true,
        providerShipmentId: true,
      },
    });
    // Heal paid→shipping when any provider already has a live/recoverable row
    // (e.g. Fez fallback while shippingMethod still points elsewhere).
    const hasProgress = allShipments.some(
      (s) =>
        ["booked", "picked_up", "in_transit", "out_for_delivery", "delivered"].includes(
          s.status
        ) ||
        (Boolean(s.providerShipmentId) &&
          (s.status === "pending" || s.status === "failed"))
    );
    if (hasProgress) {
      await bookShipmentForOrder(order.id);
      return;
    }

    const existing = allShipments.find((s) => s.provider === method.provider);
    // Auto-book is first-attempt only. Failed/cancelled require admin retry
    // (POST /api/shipping/shipments) so settlement retries do not re-hit the provider.
    if (existing && existing.status !== "pending") {
      return;
    }

    await bookShipmentForOrder(order.id);
  } catch (err) {
    // bookShipmentForOrder already persists failed + notifies on provider errors.
    console.error(
      `[maybeAutoBookShipmentAfterPayment] order=${orderId}:`,
      err
    );
  }
}

function isAlreadyCancelledProviderError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("already cancel") ||
    msg.includes("already_cancel") ||
    msg.includes("already canceled") ||
    msg.includes("label not found") ||
    msg.includes("shipment not found") ||
    msg.includes("order not found")
  );
}

export async function cancelShipmentRecord(
  shipmentId: string,
  orgId: string,
  opts?: { orderUserId?: string }
): Promise<SerializedShipment> {
  const shipment = await prisma.shipment.findFirst({
    where: {
      id: shipmentId,
      orgId,
      ...(opts?.orderUserId
        ? { order: { userId: opts.orderUserId } }
        : {}),
    },
  });
  if (!shipment) {
    throw new ShippingError("shipment_not_found", "Shipment not found");
  }
  if (shipment.status === "cancelled") {
    return toOpsShipment(shipment);
  }
  if (shipment.status === "delivered") {
    throw new ShippingError(
      "cannot_cancel",
      "Delivered shipments cannot be cancelled"
    );
  }

  // Always cancel at the courier when we still have a provider handle — including
  // failed rows after persist-split (skipping left orphaned live labels).
  if (shipment.providerShipmentId) {
    if (shipment.provider === "shipbubble") {
      try {
        await cancelShipbubbleShipment(shipment.providerShipmentId);
      } catch (err) {
        if (!isAlreadyCancelledProviderError(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new ShippingProviderError("shipbubble", msg, {
            code: "cancel_failed",
          });
        }
      }
    } else if (shipment.provider === "fez") {
      try {
        await cancelFezShipment(shipment.providerShipmentId);
      } catch (err) {
        if (!isAlreadyCancelledProviderError(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new ShippingProviderError("fez", msg, {
            code: "cancel_failed",
          });
        }
      }
    }
  }

  let updated: Shipment;
  try {
    updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: "cancelled",
        trackingUrl: null,
        labelUrl: null,
        // Keep providerShipmentId so cancel webhooks can still find this row and
        // heal order status. Reclaim on re-book clears the id before a fresh label.
        deliveredAt: null,
      },
    });
  } catch (persistErr) {
    console.error(
      `[cancelShipment] local cancel persist failed shipment=${shipment.id}:`,
      persistErr
    );
    try {
      updated = await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          status: "cancelled",
          trackingUrl: null,
          labelUrl: null,
          deliveredAt: null,
        },
      });
    } catch (persistErr2) {
      console.error(
        `[cancelShipment] local cancel persist retry failed shipment=${shipment.id}:`,
        persistErr2
      );
      await notifyStaffBookingFailure({
        orgId: shipment.orgId,
        orderId: shipment.orderId,
        shipmentId: shipment.id,
        reason:
          "Courier cancel may have succeeded but local shipment status could not be updated. Reconcile manually.",
      });
      throw new ShippingError(
        "cancel_persist_failed",
        "Shipment was cancelled with the courier but could not be updated locally"
      );
    }
  }

  // Cancel voids courier progress: shipping/shipped → paid so admin can re-book,
  // but only when no sibling live shipment remains (e.g. Fez still in transit).
  const order = await prisma.order.findUnique({
    where: { id: shipment.orderId },
    select: { id: true, status: true, orgId: true, userId: true },
  });
  if (order) {
    const siblings = await prisma.shipment.findMany({
      where: { orderId: order.id },
      select: { id: true, status: true, providerShipmentId: true },
    });
    if (!hasSiblingLiveShipment(siblings, shipment.id)) {
      await prisma.order.updateMany({
        where: {
          id: order.id,
          status: { in: ["shipping", "shipped"] },
        },
        data: { status: "paid" },
      });
    }
  }

  if (order?.userId) {
    try {
      const { notifyCustomerShipmentStatus } = await import(
        "./notifyShipmentStatus"
      );
      await notifyCustomerShipmentStatus({
        userId: order.userId,
        orderId: shipment.orderId,
        shipmentId: shipment.id,
        status: "cancelled",
        trackingUrl: null,
      });
    } catch (err) {
      console.error(
        `[cancelShipment] customer notify failed shipment=${shipment.id}:`,
        err
      );
    }
  }

  try {
    const members = await prisma.membership.findMany({
      where: { orgId: shipment.orgId, status: "active" },
      select: {
        userId: true,
        orgId: true,
        rolePreset: true,
        roleTemplateId: true,
        permissionsOverride: true,
      },
    });
    const short = shipment.orderId.slice(-8);
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
          "Shipment cancelled",
          `Order #${short} shipment was cancelled. Re-book if needed.`,
          "system",
          {
            orderId: shipment.orderId,
            shipmentId: shipment.id,
          }
        );
      })
    );
  } catch (err) {
    console.error("[cancelShipment] staff notify failed:", err);
  }

  return toOpsShipment(updated);
}
