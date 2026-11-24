/**
 * Multi-provider rate/book routing (Phase 5).
 * Primary from settings; Fez fills in when enabled and primary empty/failed.
 * Rematch paths pass preferProvider so Fez (or any non-primary) is not skipped
 * when the primary later returns quotes.
 */

import type { ShippingProviderCode } from "@prisma/client";
import type { CartLike } from "@/lib/orderFulfillment";
import { computeParcelFromCart } from "./parcelDefaults";
import type { ShippingProviderRegistry } from "./providerAdapter";
import { isFezConfigured, fezAdapter } from "./providers/fez/client";
import { shipbubbleAdapter } from "./providers/shipbubble/client";
import { fetchShipbubbleLiveRates } from "./providers/shipbubble/rates";
import type {
  BookShipmentInput,
  BookShipmentResult,
  RateQuoteOption,
  ShippingAddressSnapshot,
  ShippingOriginAddress,
  ShippingSettingsDoc,
} from "./types";
import { ShippingError, ShippingProviderError } from "./errors";

function registry(): ShippingProviderRegistry {
  return {
    shipbubble: shipbubbleAdapter,
    fez: fezAdapter,
  };
}

function resolvePrimary(
  enabled: ShippingProviderCode[],
  primary: ShippingProviderCode
): ShippingProviderCode {
  if (enabled.includes(primary)) return primary;
  return enabled[0] ?? "manual";
}

export function getActiveProviders(
  settings: Pick<ShippingSettingsDoc, "enabledProviders" | "primaryProvider">
): ShippingProviderCode[] {
  const enabled = (settings.enabledProviders?.length
    ? settings.enabledProviders
    : [settings.primaryProvider]
  ).filter(Boolean) as ShippingProviderCode[];

  const primary = resolvePrimary(enabled, settings.primaryProvider);
  const ordered: ShippingProviderCode[] = [primary];
  for (const code of enabled) {
    if (!ordered.includes(code)) ordered.push(code);
  }
  return ordered.filter((code) => {
    if (code === "shipbubble") {
      return Boolean(process.env.SHIPBUBBLE_API_KEY?.trim());
    }
    if (code === "fez") return isFezConfigured();
    return false;
  });
}

function orderProvidersForFetch(
  active: ShippingProviderCode[],
  preferProvider?: ShippingProviderCode | null
): ShippingProviderCode[] {
  if (!preferProvider || !active.includes(preferProvider)) return active;
  return [preferProvider, ...active.filter((c) => c !== preferProvider)];
}

export type FetchRatesWithFallbackInput = {
  cart: CartLike;
  settings: ShippingSettingsDoc;
  origin: ShippingOriginAddress;
  destination: ShippingAddressSnapshot;
  recipientEmail?: string | null;
  senderEmail?: string | null;
  /**
   * Rematch / order-create revalidation: force this provider first and do not
   * stop early on another provider's quotes until preferProvider has been tried.
   */
  preferProvider?: ShippingProviderCode | null;
  /** When cart was cleared after fulfill, reuse the paid quote parcel. */
  parcelOverride?: {
    weightKg: number;
    length: number;
    width: number;
    height: number;
  } | null;
};

export type FetchRatesWithFallbackResult = {
  requestToken: string;
  quotes: RateQuoteOption[];
  expiresAt: string;
  parcel: ReturnType<typeof computeParcelFromCart>;
  providersTried: ShippingProviderCode[];
};

/**
 * Try primary (usually Shipbubble) first; if empty/failed and Fez enabled, use Fez quote.
 * With preferProvider (rematch), that provider is tried first and early-break waits for it.
 */
export async function fetchRatesWithFallback(
  input: FetchRatesWithFallbackInput
): Promise<FetchRatesWithFallbackResult> {
  const parcel = input.parcelOverride
    ? {
        weightKg: input.parcelOverride.weightKg,
        length: input.parcelOverride.length,
        width: input.parcelOverride.width,
        height: input.parcelOverride.height,
      }
    : computeParcelFromCart(input.cart, input.settings);
  const providers = orderProvidersForFetch(
    getActiveProviders(input.settings),
    input.preferProvider
  );
  const prefer = input.preferProvider ?? null;
  const providersTried: ShippingProviderCode[] = [];
  const quotes: RateQuoteOption[] = [];
  let requestToken = "";
  let expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const adapters = registry();
  /** Last provider coverage/config error — rethrow when every provider yields zero quotes. */
  let lastCoverageError: ShippingProviderError | null = null;

  for (const code of providers) {
    providersTried.push(code);
    try {
      if (code === "shipbubble") {
        const live = await fetchShipbubbleLiveRates({
          origin: input.origin,
          destination: input.destination,
          senderEmail: input.senderEmail ?? undefined,
          recipientEmail: input.recipientEmail ?? undefined,
          weightKg: parcel.weightKg,
          dimensions: {
            length: parcel.length,
            width: parcel.width,
            height: parcel.height,
          },
          cart: input.cart,
        });
        if (live.quotes.length) {
          quotes.push(...live.quotes);
          requestToken = live.requestToken || requestToken;
          expiresAt = live.expiresAt || expiresAt;
        }
      } else {
        const adapter = adapters[code];
        if (!adapter?.fetchRates) continue;
        const more = await adapter.fetchRates({
          origin: input.origin,
          destination: input.destination,
          parcel,
          orgId: input.settings.orgId,
        });
        if (more.length) {
          quotes.push(...more);
          requestToken = more[0]?.requestToken || requestToken;
          expiresAt = more[0]?.expiresAt || expiresAt;
        }
      }
    } catch (err) {
      console.warn(
        `[providerRouter] rates failed provider=${code}:`,
        err instanceof Error ? err.message : err
      );
      if (err instanceof ShippingProviderError) {
        lastCoverageError = err;
      }
    }

    if (prefer) {
      // Rematch: stop once preferProvider produced quotes (or after it was tried empty).
      if (code === prefer) break;
      continue;
    }

    // Checkout: stop after primary success so Fez is only a true fallback.
    if (quotes.length > 0 && code === providers[0]) {
      break;
    }
  }

  // Surface clear no-coverage UX to POST /api/shipping/rates (200 + message, not silent []).
  if (quotes.length === 0 && lastCoverageError) {
    throw lastCoverageError;
  }
  if (quotes.length === 0 && providersTried.length > 0) {
    throw new ShippingProviderError(
      providersTried[providersTried.length - 1] ?? "shipbubble",
      "No delivery available to this address",
      { code: "no_rates" }
    );
  }

  return {
    requestToken: requestToken || `fallback:${Date.now()}`,
    quotes,
    expiresAt,
    parcel,
    providersTried,
  };
}

/**
 * Book with the method's provider; on failure retry Fez when enabled.
 */
export async function bookShipmentWithFallback(
  input: BookShipmentInput,
  settings: Pick<ShippingSettingsDoc, "enabledProviders" | "primaryProvider">
): Promise<BookShipmentResult & { usedProvider: ShippingProviderCode }> {
  const adapters = registry();
  const primary = input.provider;

  const tryBook = async (
    code: ShippingProviderCode
  ): Promise<BookShipmentResult> => {
    const a = adapters[code];
    if (!a?.bookShipment) {
      throw new ShippingError(
        "provider_unsupported",
        `Booking not implemented for provider ${code}`
      );
    }
    return a.bookShipment({ ...input, provider: code });
  };

  try {
    const booked = await tryBook(primary);
    return { ...booked, usedProvider: primary };
  } catch (primaryErr) {
    const active = getActiveProviders(settings);
    const fallback = active.find((c) => c !== primary && c === "fez");
    if (!fallback) throw primaryErr;
    console.warn(
      `[providerRouter] book failed provider=${primary}; trying ${fallback}:`,
      primaryErr instanceof Error ? primaryErr.message : primaryErr
    );
    try {
      const booked = await tryBook(fallback);
      return { ...booked, usedProvider: fallback };
    } catch (fallbackErr) {
      throw fallbackErr instanceof ShippingProviderError ||
        fallbackErr instanceof ShippingError
        ? fallbackErr
        : primaryErr;
    }
  }
}
