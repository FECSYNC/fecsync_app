import type { CartLike } from "@/lib/orderFulfillment";
import { ShippingNotConfiguredError } from "../../errors";
import type { ShippingProviderAdapter } from "../../providerAdapter";
import type {
  BookShipmentInput,
  BookShipmentResult,
  ParcelSpec,
  ParsedWebhookEvent,
  RateQuoteInput,
  RateQuoteOption,
  ShippingAddress,
  ShippingMethodSelection,
  ShippingOriginAddress,
  ShippingRateQuote,
  ShipmentBookResult,
} from "../../types";
import {
  bookShipbubbleShipment,
  cancelShipbubbleShipment,
} from "./book";
import { SHIPBUBBLE_ENV_KEYS } from "./constants";
import { fetchShipbubbleLiveRates } from "./rates";
import {
  parseShipbubbleWebhookEvent,
  verifyShipbubbleWebhookSignature,
} from "./webhook";

// Re-export HTTP helpers so existing imports from ./client keep working.
export { shipbubbleFetch, getShipbubbleWebhookSecret } from "./http";

function resolveShipbubbleEnv(): "sandbox" | "production" {
  const raw = process.env[SHIPBUBBLE_ENV_KEYS.env]?.trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  return "sandbox";
}

function headerGet(
  headers: Headers | Record<string, string | null | undefined>,
  name: string
): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string | null | undefined>;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower) return v ?? null;
  }
  return null;
}

/** Empty cart for adapter fetchRates when no line items are available. */
const EMPTY_CART_FOR_RATES = { lines: [] } as unknown as CartLike;

/**
 * Shipbubble provider adapter.
 * Live rates: fetchRates / fetchShipbubbleLiveRates (cart-aware checkout path).
 * Live book: bookShipment / createShipment → POST /shipping/labels.
 */
export const shipbubbleAdapter: ShippingProviderAdapter = {
  code: "shipbubble",

  async validateConfig(): Promise<void> {
    const key = process.env[SHIPBUBBLE_ENV_KEYS.apiKey]?.trim();
    if (!key) {
      throw new ShippingNotConfiguredError(
        `${SHIPBUBBLE_ENV_KEYS.apiKey} is not set`
      );
    }
    // Env is informational — Shipbubble selects sandbox/live via API key prefix.
    void resolveShipbubbleEnv();
  },

  async getRates(input: RateQuoteInput): Promise<ShippingRateQuote[]> {
    if (!input.origin) return [];
    const parcel: ParcelSpec = input.parcel ?? {
      weightKg: input.weightKg,
      ...input.dimensions,
    };
    return shipbubbleAdapter.fetchRates!({
      origin: input.origin,
      destination: input.destination,
      parcel,
      orgId: input.orgId,
    });
  },

  async fetchRates(input: {
    origin: ShippingOriginAddress;
    destination: ShippingAddress;
    parcel: ParcelSpec;
    orgId: string;
  }): Promise<RateQuoteOption[]> {
    void input.orgId;
    const result = await fetchShipbubbleLiveRates({
      origin: input.origin,
      destination: input.destination,
      weightKg: input.parcel.weightKg,
      dimensions: {
        length: input.parcel.length,
        width: input.parcel.width,
        height: input.parcel.height,
      },
      cart: EMPTY_CART_FOR_RATES,
    });
    return result.quotes;
  },

  async bookShipment(input: BookShipmentInput): Promise<BookShipmentResult> {
    return bookShipbubbleShipment(input);
  },

  async createShipment(input: {
    order: { id: string; orgId: string };
    method: ShippingMethodSelection;
    parcel: ParcelSpec;
  }): Promise<ShipmentBookResult> {
    return bookShipbubbleShipment({
      orderId: input.order.id,
      orgId: input.order.orgId,
      provider: "shipbubble",
      serviceCode: input.method.serviceCode,
      rateToken: input.method.rateToken,
      requestToken: input.method.requestToken,
      courierId: input.method.courierId,
      shippingFee: input.method.fee,
      // Label book uses request_token + courier ids; destination was validated at quote time.
      destination: {
        line1: "",
        city: "",
        state: "",
        country: "NG",
        phone: "",
      },
      weightKg: input.parcel.weightKg,
      dimensions: {
        length: input.parcel.length,
        width: input.parcel.width,
        height: input.parcel.height,
      },
    });
  },

  async cancelShipment(providerShipmentId: string): Promise<void> {
    await cancelShipbubbleShipment(providerShipmentId);
  },

  verifyWebhookSignature(
    headers: Headers | Record<string, string | null | undefined>,
    rawBody: string
  ): boolean {
    const signature =
      headerGet(headers, "x-ship-signature") ||
      headerGet(headers, "X-Ship-Signature");
    return verifyShipbubbleWebhookSignature(rawBody, signature);
  },

  parseWebhookEvent(rawBody: string): ParsedWebhookEvent {
    return parseShipbubbleWebhookEvent(rawBody);
  },
};
