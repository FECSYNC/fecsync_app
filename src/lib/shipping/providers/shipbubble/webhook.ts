import { createHmac, timingSafeEqual } from "crypto";
import { getShipbubbleWebhookSecret } from "./http";
import type { ParsedWebhookEvent } from "../../types";
import type { ShipbubbleWebhookPayload } from "./types";

/**
 * Verify Shipbubble webhook HMAC-SHA512 signature (`x-ship-signature`).
 * Uses SHIPBUBBLE_WEBHOOK_SECRET only — never the API key (outbound credential).
 */
export function verifyShipbubbleWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  const secret = getShipbubbleWebhookSecret();
  if (!secret || !signatureHeader?.trim()) return false;

  const expectedHex = createHmac("sha512", secret)
    .update(rawBody, "utf8")
    .digest("hex")
    .toLowerCase();
  const provided = signatureHeader.trim();

  // Accept hex digest (docs) or sha512=<hex>
  let normalized = provided.toLowerCase().startsWith("sha512=")
    ? provided.slice("sha512=".length).trim()
    : provided;
  normalized = normalized.toLowerCase();

  try {
    const a = Buffer.from(expectedHex, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Normalize Shipbubble webhook JSON into ParsedWebhookEvent. */
export function parseShipbubbleWebhookEvent(
  rawBody: string
): ParsedWebhookEvent {
  const payload = JSON.parse(rawBody) as ShipbubbleWebhookPayload;
  const providerShipmentId = String(
    payload.order_id ||
      (payload.data && typeof payload.data.order_id === "string"
        ? payload.data.order_id
        : "") ||
      ""
  ).trim();

  const providerStatus = String(
    payload.status ||
      payload.package_status?.[payload.package_status.length - 1]?.status ||
      ""
  ).trim();

  return {
    provider: "shipbubble",
    eventName: payload.event ?? null,
    eventId: payload.event_id ?? null,
    providerShipmentId: providerShipmentId || null,
    providerStatus: providerStatus || null,
    trackingNumber:
      String(payload.courier?.tracking_code || "").trim() || null,
    trackingUrl: String(payload.tracking_url || "").trim() || null,
    labelUrl:
      typeof payload.waybill_document === "string"
        ? payload.waybill_document.trim() || null
        : null,
    courierName: String(payload.courier?.name || "").trim() || null,
    rawPayload: payload,
  };
}
