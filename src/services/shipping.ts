import { api, unwrap, ApiError, type MaybeWrapped } from "@/utils/api";
import type { OrderPlacementAddress, ShippingSelectionInput } from "@/services/order";

export type PublicShippingRateOption = {
  optionId: string;
  provider: string;
  serviceCode: string;
  courierName?: string;
  fee: number;
  currency?: string;
  expiresAt: string;
  estimatedDaysLabel?: string;
};

export type ShippingRatesResponse = {
  ratesAvailable: boolean;
  /** Server SSOT — true when isShippingCheckoutRequired(settings). */
  shippingRequired?: boolean;
  quoteSessionId: string | null;
  expiresAt: string | null;
  options: PublicShippingRateOption[];
  message?: string;
};

export type ShipmentDto = {
  _id: string;
  id: string;
  orderId: string;
  orgId: string;
  provider: string;
  providerShipmentId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status: ShipmentStatus;
  courierName?: string | null;
  serviceCode?: string | null;
  shippingFee: number;
  currency: string;
  labelUrl?: string | null;
  failureReason?: string | null;
  bookedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  orderAddress?: string | null;
  orderStatus?: string | null;
  customerName?: string | null;
};

/** Phase 4 alias — same DTO as API responses. */
export type Shipment = ShipmentDto;

export type ShipmentStatus =
  | "pending"
  | "booked"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "cancelled";

export type ShipmentsListResponse = {
  items: ShipmentDto[];
  total: number;
  page: number;
  limit: number;
};

export async function fetchShippingRates(input: {
  address: OrderPlacementAddress;
  cartId?: string;
}): Promise<ShippingRatesResponse> {
  const raw = await api<MaybeWrapped<ShippingRatesResponse>>("/api/shipping/rates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: input.address,
      cartId: input.cartId,
    }),
    credentials: "include",
  });
  const data = unwrap<ShippingRatesResponse>(raw);
  return (
    data ?? {
      ratesAvailable: false,
      quoteSessionId: null,
      expiresAt: null,
      options: [],
      message: "No shipping rates returned",
    }
  );
}

export function toShippingSelection(
  quoteSessionId: string,
  option: PublicShippingRateOption
): ShippingSelectionInput {
  return {
    quoteSessionId,
    optionId: option.optionId,
    fee: option.fee,
    courierName: option.courierName,
    serviceCode: option.serviceCode,
    provider: option.provider,
  };
}

export async function listShipments(params?: {
  status?: string;
  orderId?: string;
  page?: number;
  limit?: number;
}): Promise<ShipmentsListResponse> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.orderId) sp.set("orderId", params.orderId);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const raw = await api<MaybeWrapped<ShipmentsListResponse>>(
    `/api/shipping/shipments${qs ? `?${qs}` : ""}`,
    { credentials: "include" }
  );
  const data = unwrap<ShipmentsListResponse>(raw);
  return (
    data ?? {
      items: [],
      total: 0,
      page: 1,
      limit: params?.limit ?? 20,
    }
  );
}

/** Phase 4 alias for listShipments. */
export const getShipments = listShipments;

export async function getShipmentById(id: string): Promise<ShipmentDto | null> {
  const raw = await api<MaybeWrapped<ShipmentDto>>(
    `/api/shipping/shipments/${encodeURIComponent(id)}`,
    { credentials: "include" }
  );
  return unwrap<ShipmentDto>(raw) ?? null;
}

export async function getShipmentByOrderId(
  orderId: string
): Promise<ShipmentDto | null> {
  try {
    const raw = await api<MaybeWrapped<ShipmentDto>>(
      `/api/shipping/shipments/by-order/${encodeURIComponent(orderId)}`,
      { credentials: "include" }
    );
    return unwrap<ShipmentDto>(raw) ?? null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export async function bookShipmentForOrderId(
  orderId: string
): Promise<ShipmentDto> {
  try {
    const raw = await api<MaybeWrapped<ShipmentDto>>("/api/shipping/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
      credentials: "include",
    });
    const data = unwrap<ShipmentDto>(raw);
    if (!data?.id) {
      throw new Error("Shipment booking returned no data");
    }
    return data;
  } catch (err) {
    // POST may return 400 with { error, data: { shipment } } when booking failed
    // but a failed Shipment row was persisted for ops.
    if (err instanceof ApiError && err.status === 400) {
      const payload = err.payload as
        | {
            data?: { shipment?: ShipmentDto } | ShipmentDto;
            shipment?: ShipmentDto;
          }
        | undefined;
      const nested = payload?.data;
      const shipment =
        payload?.shipment ||
        (nested &&
        typeof nested === "object" &&
        "shipment" in nested &&
        nested.shipment
          ? nested.shipment
          : nested && typeof nested === "object" && "id" in nested
            ? (nested as ShipmentDto)
            : null);
      if (shipment?.id) return shipment;
    }
    throw err;
  }
}

export async function cancelShipmentById(id: string): Promise<ShipmentDto> {
  const raw = await api<MaybeWrapped<ShipmentDto>>(
    `/api/shipping/shipments/${encodeURIComponent(id)}/cancel`,
    {
      method: "POST",
      credentials: "include",
    }
  );
  const data = unwrap<ShipmentDto>(raw);
  if (!data?.id) {
    throw new Error("Cancel returned no shipment");
  }
  return data;
}

/** Phase 4 aliases. */
export const bookShipment = bookShipmentForOrderId;
export const cancelShipment = cancelShipmentById;
