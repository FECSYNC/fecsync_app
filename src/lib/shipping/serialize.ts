import type { Shipment } from "@prisma/client";
import type { SerializedShipment } from "./types";

function safeIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normalizeFee(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Only allow http(s) absolute URLs for tracking/label links (blocks javascript:, data:, etc.).
 */
export function sanitizePublicHttpUrl(
  value: string | null | undefined,
  maxLen = 2048
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > maxLen) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type SerializeShipmentOptions = {
  /**
   * Staff/ops responses may include failureReason, labelUrl, providerShipmentId,
   * orgId, and serviceCode. Customer / shared order payloads omit those.
   */
  includeOpsFields?: boolean;
};

/**
 * Public shipment DTO — never includes rateToken / rawProviderPayload.
 * Customer payloads also omit ops-adjacent handles (labelUrl, providerShipmentId, orgId).
 */
export function serializeShipment(
  shipment: Shipment,
  options?: SerializeShipmentOptions
): SerializedShipment {
  const createdAt =
    safeIso(shipment.createdAt) ?? new Date(0).toISOString();
  const updatedAt = safeIso(shipment.updatedAt) ?? createdAt;
  const includeOps = Boolean(options?.includeOpsFields);

  return {
    _id: shipment.id,
    id: shipment.id,
    orderId: shipment.orderId,
    orgId: includeOps ? shipment.orgId : "",
    provider: shipment.provider,
    providerShipmentId: includeOps ? shipment.providerShipmentId : null,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: sanitizePublicHttpUrl(shipment.trackingUrl),
    status: shipment.status,
    courierName: shipment.courierName,
    serviceCode: includeOps ? shipment.serviceCode : null,
    shippingFee: normalizeFee(shipment.shippingFee),
    currency: shipment.currency?.trim() || "NGN",
    labelUrl: includeOps ? sanitizePublicHttpUrl(shipment.labelUrl) : null,
    failureReason: includeOps ? shipment.failureReason : null,
    bookedAt: safeIso(shipment.bookedAt),
    deliveredAt: safeIso(shipment.deliveredAt),
    createdAt,
    updatedAt,
  };
}
