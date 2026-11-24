import { createHash } from "crypto";
import type { CartLike } from "@/lib/orderFulfillment";
import {
  calculateLineSubtotal,
  getCartLines,
} from "@/lib/orderFulfillment";
import {
  formatShippingAddressLine,
  isNigeriaCountry,
} from "../../address";
import { ShippingNotConfiguredError, ShippingProviderError } from "../../errors";
import type {
  ParcelDimensions,
  ShippingAddressSnapshot,
  ShippingOriginAddress,
  ShippingRateQuote,
} from "../../types";
import { shipbubbleFetch } from "./http";
import { SHIPBUBBLE_ENV_KEYS } from "./constants";
import type {
  ShipbubbleCourierRate,
  ShipbubbleFetchRatesRequest,
  ShipbubbleFetchRatesResponse,
  ShipbubblePackageItem,
  ShipbubbleValidateAddressRequest,
  ShipbubbleValidateAddressResponse,
} from "./types";

const DEFAULT_CATEGORY_ID = 4; // Fashion / apparel — override via env
const RATE_TTL_MS = 30 * 60 * 1000;

function categoryId(): number {
  const raw = process.env.SHIPBUBBLE_CATEGORY_ID?.trim();
  const n = raw ? Number(raw) : DEFAULT_CATEGORY_ID;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CATEGORY_ID;
}

function senderEmailFallback(): string {
  return (
    process.env.SHIPBUBBLE_SENDER_EMAIL?.trim() ||
    "shipping@fecsync.com"
  );
}

/** Tomorrow in Africa/Lagos as yyyy-mm-dd for Shipbubble pickup_date. */
export function nextPickupDateLagos(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const tomorrow = new Date(utcNoon + 24 * 60 * 60 * 1000);
  return fmt.format(tomorrow);
}

function toValidatePayload(
  name: string,
  email: string,
  phone: string,
  address: ShippingAddressSnapshot | ShippingOriginAddress
): ShipbubbleValidateAddressRequest {
  const line = formatShippingAddressLine(address);
  const withCountry =
    isNigeriaCountry(address.country) && !/nigeria/i.test(line)
      ? `${line}, Nigeria`
      : line;
  return {
    name: name.trim() || "Customer",
    email: email.trim() || senderEmailFallback(),
    phone: phone.trim(),
    address: withCountry,
  };
}

export async function validateShipbubbleAddress(
  payload: ShipbubbleValidateAddressRequest
): Promise<number> {
  const res = await shipbubbleFetch<ShipbubbleValidateAddressResponse>(
    "/shipping/address/validate",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  const code = res.data?.address_code;
  if (!code || !Number.isFinite(Number(code))) {
    throw new ShippingProviderError(
      "shipbubble",
      res.message || "Address validation did not return an address code",
      { code: "address_invalid" }
    );
  }
  return Number(code);
}

export function buildPackageItemsFromCart(
  cart: CartLike,
  totalWeightKg: number
): ShipbubblePackageItem[] {
  const lines = getCartLines(cart);
  if (lines.length === 0) {
    return [
      {
        name: "Order",
        description: "FECSYNC order",
        unit_weight: String(Math.max(0.1, totalWeightKg)),
        unit_amount: "0",
        quantity: "1",
      },
    ];
  }

  const perLineWeight = Math.max(0.1, totalWeightKg / lines.length);

  return lines.map((line) => {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const lineTotal = calculateLineSubtotal(line);
    const unitAmount = qty > 0 ? lineTotal / qty : lineTotal;

    if (line.lineType === "fabric") {
      const fabric =
        typeof line.fabric === "object" && line.fabric ? line.fabric : null;
      const name =
        (fabric as { name?: string } | null)?.name?.trim() || "Fabric bundle";
      return {
        name,
        description: "Fabric yard bundle",
        unit_weight: String(perLineWeight),
        unit_amount: String(Math.max(0, Math.round(unitAmount * 100) / 100)),
        quantity: String(qty),
      };
    }

    const product =
      typeof line.product === "object" && line.product ? line.product : null;
    const name =
      (product as { name?: string } | null)?.name?.trim() || "Product";
    return {
      name,
      description: "Ready-to-wear",
      unit_weight: String(perLineWeight),
      unit_amount: String(Math.max(0, Math.round(unitAmount * 100) / 100)),
      quantity: String(qty),
    };
  });
}

function mapCourierToQuote(
  courier: ShipbubbleCourierRate,
  requestToken: string,
  expiresAt: string
): ShippingRateQuote & { requestToken: string; deliveryEta?: string } {
  const fee = Number(courier.total);
  const serviceCode = String(courier.service_code || courier.courier_id || "").trim();
  const courierId = String(courier.courier_id || "").trim();
  // Prefer courier-specific rate_token; fall back to courier_id for booking identity.
  const rateToken =
    String(courier.rate_token || "").trim() || courierId || serviceCode;

  return {
    provider: "shipbubble",
    serviceCode: serviceCode || courierId,
    courierName: String(courier.courier_name || serviceCode || "Courier").trim(),
    courierId: courierId || undefined,
    fee: Number.isFinite(fee) ? Math.max(0, fee) : 0,
    currency: String(courier.currency || "NGN").replace("₦", "NGN").trim() || "NGN",
    rateToken,
    expiresAt,
    requestToken,
    deliveryEta: courier.delivery_eta,
  };
}

export type ShipbubbleLiveRatesResult = {
  requestToken: string;
  quotes: Array<
    ShippingRateQuote & { requestToken: string; deliveryEta?: string }
  >;
  expiresAt: string;
};

/**
 * Validate origin + destination, then fetch courier rates from Shipbubble.
 */
export async function fetchShipbubbleLiveRates(input: {
  origin: ShippingOriginAddress;
  destination: ShippingAddressSnapshot;
  senderEmail?: string;
  recipientEmail?: string;
  weightKg: number;
  dimensions: ParcelDimensions;
  cart: CartLike;
}): Promise<ShipbubbleLiveRatesResult> {
  if (!process.env[SHIPBUBBLE_ENV_KEYS.apiKey]?.trim()) {
    throw new ShippingNotConfiguredError(
      `${SHIPBUBBLE_ENV_KEYS.apiKey} is not set`
    );
  }

  const originPhone = input.origin.phone?.trim();
  const destPhone = input.destination.phone?.trim();
  if (!originPhone) {
    throw new ShippingNotConfiguredError(
      "Store origin phone is required for shipping rates"
    );
  }
  if (!destPhone) {
    throw new ShippingProviderError(
      "shipbubble",
      "Delivery phone number is required for shipping rates",
      { code: "phone_required" }
    );
  }
  if (!input.origin.line1?.trim()) {
    throw new ShippingNotConfiguredError(
      "Store origin address is not configured"
    );
  }

  const senderName = input.origin.contactName?.trim() || "FECSYNC";
  const recipientName =
    input.destination.contactName?.trim() || senderName || "Customer";

  const [senderCode, receiverCode] = await Promise.all([
    validateShipbubbleAddress(
      toValidatePayload(
        senderName,
        input.senderEmail || senderEmailFallback(),
        originPhone,
        input.origin
      )
    ),
    validateShipbubbleAddress(
      toValidatePayload(
        recipientName,
        input.recipientEmail || senderEmailFallback(),
        destPhone,
        input.destination
      )
    ),
  ]);

  const body: ShipbubbleFetchRatesRequest = {
    sender_address_code: senderCode,
    reciever_address_code: receiverCode,
    pickup_date: nextPickupDateLagos(),
    category_id: categoryId(),
    package_items: buildPackageItemsFromCart(input.cart, input.weightKg),
    package_dimension: {
      length: input.dimensions.length,
      width: input.dimensions.width,
      height: input.dimensions.height,
    },
    service_type: "pickup",
  };

  const res = await shipbubbleFetch<ShipbubbleFetchRatesResponse>(
    "/shipping/fetch_rates",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

  const requestToken = String(res.data?.request_token || "").trim();
  const couriers = res.data?.couriers ?? [];
  if (!requestToken || couriers.length === 0) {
    throw new ShippingProviderError(
      "shipbubble",
      res.message || "No courier rates returned for this address",
      { code: "no_rates" }
    );
  }

  const expiresAt = new Date(Date.now() + RATE_TTL_MS).toISOString();
  const quotes = couriers
    .map((c) => mapCourierToQuote(c, requestToken, expiresAt))
    .filter((q) => q.serviceCode && q.rateToken && Number.isFinite(q.fee));

  if (quotes.length === 0) {
    throw new ShippingProviderError(
      "shipbubble",
      "No valid courier rates returned",
      { code: "no_rates" }
    );
  }

  return { requestToken, quotes, expiresAt };
}

/** Stable option id within a quote session (no secrets). */
export function makeRateOptionId(quote: {
  provider: string;
  serviceCode: string;
  rateToken: string;
  fee: number;
}): string {
  return createHash("sha256")
    .update(
      `${quote.provider}|${quote.serviceCode}|${quote.rateToken}|${quote.fee}`
    )
    .digest("hex")
    .slice(0, 24);
}
