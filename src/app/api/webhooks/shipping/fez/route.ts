export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, unauthorized, badRequest, serverError } from "@/lib/response";
import {
  applyShipmentWebhookEvent,
  normalizeProviderShipmentStatus,
} from "@/lib/shipping/statusSync";
import {
  verifyFezWebhookSignature,
  parseFezWebhookEvent,
} from "@/lib/shipping/providers/fez/client";

/**
 * POST /api/webhooks/shipping/fez
 *
 * Signature verification (Fez corporate docs — order webhook):
 * HMAC-SHA256 hex of (orderNumber + status + timestamp) using FEZ_WEBHOOK_SECRET
 * (production) or FEZ_SECRET_KEY fallback in non-production only.
 * Headers: X-Signature, X-Timestamp.
 * Body fields: orderNumber / orderNo, status / orderStatus.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyFezWebhookSignature(request.headers, rawBody)) {
    return unauthorized("Invalid Fez webhook signature");
  }

  const timestampHeader =
    request.headers.get("x-timestamp") ||
    request.headers.get("X-Timestamp");
  if (!timestampHeader?.trim()) {
    return badRequest("Missing X-Timestamp");
  }

  let parsed;
  try {
    parsed = parseFezWebhookEvent(rawBody, timestampHeader);
  } catch {
    return badRequest("Invalid JSON");
  }

  const providerShipmentId = String(parsed.providerShipmentId || "").trim();
  if (!providerShipmentId) {
    return badRequest("Missing Fez orderNumber");
  }

  let eventAt: string | null = null;
  const asNum = Number(timestampHeader);
  if (Number.isFinite(asNum) && asNum > 0) {
    const ms = asNum < 1e12 ? asNum * 1000 : asNum;
    eventAt = new Date(ms).toISOString();
  } else if (!Number.isNaN(Date.parse(timestampHeader))) {
    eventAt = new Date(timestampHeader).toISOString();
  }

  const eventId = String(parsed.eventId || "").trim();
  if (!eventId) {
    return badRequest("Unable to build webhook event id");
  }

  try {
    await connectDB();

    const result = await applyShipmentWebhookEvent({
      provider: "fez",
      providerShipmentId,
      eventId,
      eventName: parsed.eventName,
      providerStatus: parsed.providerStatus,
      trackingNumber: parsed.trackingNumber,
      trackingUrl: parsed.trackingUrl,
      labelUrl: parsed.labelUrl,
      courierName: parsed.courierName,
      eventAt,
      rawPayload: parsed.rawPayload,
    });

    if (result.skipped === "shipment_not_found") {
      const mapped = normalizeProviderShipmentStatus(
        parsed.providerStatus,
        parsed.eventName
      );
      if (mapped === "cancelled" || mapped === "failed") {
        return ok({
          received: true,
          ...result,
        });
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: "Shipment not ready; retry webhook",
          data: { received: true, ...result },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    return ok({
      received: true,
      ...result,
    });
  } catch (err) {
    console.error("Fez webhook error:", err);
    return serverError("Webhook processing failed");
  }
}
