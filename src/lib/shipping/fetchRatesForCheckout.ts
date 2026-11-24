import type { CartLike } from "@/lib/orderFulfillment";
import type { ShippingProviderCode } from "@prisma/client";
import { computeParcelFromCart } from "./parcelDefaults";
import { fetchRatesWithFallback } from "./providerRouter";
import { ensureShippingEnvValidated } from "./validateEnv";
import type {
  RateQuoteOption,
  ShippingAddressSnapshot,
  ShippingOriginAddress,
  ShippingSettingsDoc,
} from "./types";

export type FetchRatesForCheckoutInput = {
  cart: CartLike;
  settings: ShippingSettingsDoc;
  origin: ShippingOriginAddress;
  destination: ShippingAddressSnapshot;
  recipientEmail?: string | null;
  senderEmail?: string | null;
  /** Rematch: prefer this provider so primary success does not skip it. */
  preferProvider?: ShippingProviderCode | null;
  /** Paid quote parcel when cart lines were cleared after fulfill. */
  parcelOverride?: {
    weightKg: number;
    length: number;
    width: number;
    height: number;
  } | null;
};

export type FetchRatesForCheckoutResult = {
  requestToken: string;
  quotes: RateQuoteOption[];
  expiresAt: string;
  parcel: ReturnType<typeof computeParcelFromCart>;
};

/**
 * Checkout rate fetch — parcel from cart + settings, then primary→Fez fallback rates.
 * Used by POST /api/shipping/rates and order-create re-validation (S13).
 */
export async function fetchRatesForCheckout(
  input: FetchRatesForCheckoutInput
): Promise<FetchRatesForCheckoutResult> {
  ensureShippingEnvValidated();
  const live = await fetchRatesWithFallback(input);

  return {
    requestToken: live.requestToken,
    quotes: live.quotes,
    expiresAt: live.expiresAt,
    parcel: live.parcel,
  };
}
