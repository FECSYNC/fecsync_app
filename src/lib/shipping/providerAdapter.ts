import type { ShippingProviderCode } from "@prisma/client";
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
} from "./types";

/**
 * Provider adapter contract.
 * Core methods: getRates / bookShipment (live for Shipbubble).
 * STEP 3 / F2 also defines validateConfig, fetchRates, createShipment,
 * cancelShipment, and webhook helpers — implemented where the provider supports them.
 */
export interface ShippingProviderAdapter {
  readonly code: ShippingProviderCode;

  /** Fetch live rate quotes for a destination parcel. */
  getRates(input: RateQuoteInput): Promise<ShippingRateQuote[]>;

  /** Book a shipment after payment using a validated rate token. */
  bookShipment(input: BookShipmentInput): Promise<BookShipmentResult>;

  /** Optional: validate a rate token still matches quoted fee. */
  validateRateToken?(
    rateToken: string,
    expectedFee: number
  ): Promise<boolean>;

  /** Confirm API credentials / config are usable. */
  validateConfig?(): Promise<void>;

  /**
   * STEP 3 rate fetch shape (origin + parcel + org).
   * Prefer getRates / fetchShipbubbleLiveRates (cart-aware) for checkout.
   */
  fetchRates?(input: {
    origin: ShippingOriginAddress;
    destination: ShippingAddress;
    parcel: ParcelSpec;
    orgId: string;
  }): Promise<RateQuoteOption[]>;

  /**
   * STEP 3 book shape. Live providers should delegate to bookShipment —
   * do not stub if booking is already implemented.
   */
  createShipment?(input: {
    order: { id: string; orgId: string };
    method: ShippingMethodSelection;
    parcel: ParcelSpec;
  }): Promise<ShipmentBookResult>;

  cancelShipment?(providerShipmentId: string): Promise<void>;

  verifyWebhookSignature?(
    headers: Headers | Record<string, string | null | undefined>,
    rawBody: string
  ): boolean;

  parseWebhookEvent?(rawBody: string): ParsedWebhookEvent;
}

export type ShippingProviderRegistry = Partial<
  Record<ShippingProviderCode, ShippingProviderAdapter>
>;

export function getProviderAdapter(
  registry: ShippingProviderRegistry,
  code: ShippingProviderCode
): ShippingProviderAdapter | null {
  return registry[code] ?? null;
}
