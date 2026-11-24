import { ShippingProviderError } from "../../errors";
import type { BookShipmentInput, BookShipmentResult } from "../../types";
import { shipbubbleFetch } from "./http";
import type {
  ShipbubbleBookRequest,
  ShipbubbleBookResponse,
} from "./types";

/**
 * Create a Shipbubble shipping label (book) from a previously quoted rate.
 * POST /shipping/labels — requires request_token + service_code + courier_id.
 */
export async function bookShipbubbleShipment(
  input: BookShipmentInput
): Promise<BookShipmentResult> {
  const requestToken = String(input.requestToken || "").trim();
  const serviceCode = String(input.serviceCode || "").trim();
  const courierId = String(
    input.courierId || input.serviceCode || ""
  ).trim();

  if (!requestToken) {
    throw new ShippingProviderError(
      "shipbubble",
      "Missing request token for booking — re-quote rates at checkout",
      { code: "missing_request_token" }
    );
  }
  if (!serviceCode || !courierId) {
    throw new ShippingProviderError(
      "shipbubble",
      "Missing courier service identifiers for booking",
      { code: "missing_courier" }
    );
  }

  const body: ShipbubbleBookRequest = {
    request_token: requestToken,
    service_code: serviceCode,
    courier_id: courierId,
    rate_token: input.rateToken || undefined,
  };

  const res = await shipbubbleFetch<ShipbubbleBookResponse>("/shipping/labels", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = res.data;
  const providerShipmentId = String(data?.order_id || "").trim();
  if (!providerShipmentId) {
    throw new ShippingProviderError(
      "shipbubble",
      res.message || "Shipbubble booking did not return a shipment id",
      { code: "book_failed" }
    );
  }

  const courierName =
    data && typeof data === "object" && data.courier
      ? String(
          (data.courier as { name?: string }).name || ""
        ).trim() || undefined
      : undefined;

  return {
    providerShipmentId,
    trackingNumber:
      String(data?.tracking_number || "").trim() || providerShipmentId,
    trackingUrl: String(data?.tracking_url || "").trim() || undefined,
    labelUrl: String(data?.label_url || "").trim() || undefined,
    courierName,
    rawProviderPayload: data ?? res,
  };
}

/** Cancel a scheduled Shipbubble label by provider order id. */
export async function cancelShipbubbleShipment(
  providerShipmentId: string
): Promise<void> {
  const id = String(providerShipmentId || "").trim();
  if (!id) {
    throw new ShippingProviderError(
      "shipbubble",
      "Missing provider shipment id to cancel",
      { code: "missing_shipment_id" }
    );
  }

  await shipbubbleFetch<{ status?: string; message?: string }>(
    `/shipping/labels/cancel/${encodeURIComponent(id)}`,
    { method: "POST", body: JSON.stringify({}) }
  );
}
