import type { Order, Shipment, ShippingProviderCode, ShipmentStatus } from "@prisma/client";
import { ShippingError } from "./errors";

/**
 * Enforce Shipment.orderId / orgId / fee consistency with the parent Order.
 * Call before creating or updating shipment rows (Phase 3 booking).
 */
export function assertShipmentMatchesOrder(
  order: Pick<Order, "id" | "orgId" | "shippingFee">,
  shipment: {
    orderId: string;
    orgId: string;
    shippingFee: number;
    provider: ShippingProviderCode;
  }
): void {
  if (shipment.orderId !== order.id) {
    throw new ShippingError(
      "shipment_order_mismatch",
      "Shipment orderId does not match order"
    );
  }
  if (shipment.orgId !== order.orgId) {
    throw new ShippingError(
      "shipment_org_mismatch",
      "Shipment orgId does not match order org"
    );
  }
  const orderFee = Math.round((Number(order.shippingFee) || 0) * 100);
  const shipFee = Math.round((Number(shipment.shippingFee) || 0) * 100);
  if (Math.abs(orderFee - shipFee) > 1) {
    throw new ShippingError(
      "shipment_fee_mismatch",
      "Shipment shippingFee does not match order.shippingFee"
    );
  }
}

function createdAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

const PROGRESSING_STATUSES = new Set<ShipmentStatus>([
  "booked",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
]);

/**
 * True when another shipment on the order is still in-flight (or recoverable),
 * so cancelling/failing `excludeShipmentId` must not roll Order.status → paid.
 */
export function hasSiblingLiveShipment(
  shipments: Array<
    Pick<Shipment, "id" | "status" | "providerShipmentId">
  >,
  excludeShipmentId: string
): boolean {
  return shipments.some((s) => {
    if (s.id === excludeShipmentId) return false;
    if (s.status === "cancelled" || s.status === "failed") return false;
    if (PROGRESSING_STATUSES.has(s.status)) return true;
    // Mid-book pending claim
    if (s.status === "pending") return true;
    return false;
  });
}

/**
 * Prefer a progressing courier row (booked+) over bare pending claims.
 * When multiple exist, prefer `preferredProvider` (order.shippingMethod.provider).
 * Fall back to newest failed, then newest cancelled, so the UI can still show history.
 */
export function findActiveShipment<
  T extends Pick<
    Shipment,
    "status" | "createdAt" | "id" | "provider" | "providerShipmentId"
  >,
>(
  shipments: T[],
  preferredProvider?: ShippingProviderCode | string | null
): T | null {
  if (!shipments?.length) return null;

  const pickNewest = (pool: T[]): T | null =>
    [...pool].sort(
      (a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt)
    )[0] ?? null;

  const prefer = (pool: T[]): T | null => {
    if (!pool.length) return null;
    if (preferredProvider) {
      const match = pool.filter((s) => s.provider === preferredProvider);
      if (match.length) return pickNewest(match);
    }
    return pickNewest(pool);
  };

  const progressing = shipments.filter((s) =>
    PROGRESSING_STATUSES.has(s.status)
  );
  const fromProgressing = prefer(progressing);
  if (fromProgressing) return fromProgressing;

  // Recoverable persist-split: pending/failed with a courier id.
  const recoverable = shipments.filter(
    (s) =>
      Boolean(String(s.providerShipmentId || "").trim()) &&
      (s.status === "pending" || s.status === "failed")
  );
  const fromRecoverable = prefer(recoverable);
  if (fromRecoverable) return fromRecoverable;

  const barePending = shipments.filter(
    (s) => s.status === "pending" && !String(s.providerShipmentId || "").trim()
  );
  const fromPending = prefer(barePending);
  if (fromPending) return fromPending;

  const failed = shipments.filter((s) => s.status === "failed");
  const fromFailed = prefer(failed);
  if (fromFailed) return fromFailed;

  return prefer(shipments.filter((s) => s.status === "cancelled"));
}
