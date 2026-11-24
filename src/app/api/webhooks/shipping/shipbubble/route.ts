export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import connectDB from "@/lib/db";
import { ok, unauthorized, badRequest, serverError } from "@/lib/response";
import {
  applyShipmentWebhookEvent,
  buildWebhookEventId,
  normalizeProviderShipmentStatus,
} from "@/lib/shipping/statusSync";
import { verifyShipbubbleWebhookSignature } from "@/lib/shipping/providers/shipbubble/webhook";
import type { ShipbubbleWebhookPayload } from "@/lib/shipping/providers/shipbubble/types";

/**
 * POST /api/webhooks/shipping/shipbubble
 * Signature-only auth via x-ship-signature (HMAC-SHA512).
 * Always acknowledge quickly; invalid signatures are rejected.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-ship-signature") ||
    request.headers.get("X-Ship-Signature");

  if (!verifyShipbubbleWebhookSignature(rawBody, signature)) {
    return unauthorized("Invalid Shipbubble webhook signature");
  }

  let payload: ShipbubbleWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ShipbubbleWebhookPayload;
  } catch {
    return badRequest("Invalid JSON");
  }

  try {
    await connectDB();

    const providerShipmentId = String(
      payload.order_id ||
        (payload.data && typeof payload.data.order_id === "string"
          ? payload.data.order_id
          : "") ||
        ""
    ).trim();

    const statusRaw = String(
      payload.status ||
        payload.package_status?.[payload.package_status.length - 1]?.status ||
        ""
    ).trim();

    const trackingNumber =
      String(payload.courier?.tracking_code || "").trim() || null;
    const trackingUrl = String(payload.tracking_url || "").trim() || null;
    const labelUrl =
      typeof payload.waybill_document === "string"
        ? payload.waybill_document.trim() || null
        : null;
    const courierName = String(payload.courier?.name || "").trim() || null;

    const eventId = buildWebhookEventId({
      event: payload.event,
      event_id: payload.event_id,
      order_id: providerShipmentId,
      status: statusRaw,
      date: payload.date,
    });

    const result = await applyShipmentWebhookEvent({
      provider: "shipbubble",
      providerShipmentId,
      eventId,
      eventName: payload.event,
      providerStatus: statusRaw,
      trackingNumber,
      trackingUrl,
      labelUrl,
      courierName,
      eventAt: payload.date ?? null,
      rawPayload: payload,
    });

    // Race: label webhook can arrive before local Shipment.providerShipmentId
    // is committed. Ask Shipbubble to retry instead of ACK-dropping the event.
    // Cancel/fail not-found still ACK (legacy rows that cleared the courier id).
    if (result.skipped === "shipment_not_found") {
      const mapped = normalizeProviderShipmentStatus(
        statusRaw,
        payload.event
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
    console.error("Shipbubble webhook error:", err);
    return serverError("Webhook processing failed");
  }
}
