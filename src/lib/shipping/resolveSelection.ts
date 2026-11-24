import type { CartLike } from "@/lib/orderFulfillment";
import { loadCartForCheckout } from "@/lib/orderFulfillment";
import { amountsMatch } from "@/lib/orderPaymentSettle";
import prisma from "@/lib/prisma";
import { roundMoney } from "@/utils/tax";
import {
  ShippingNotConfiguredError,
  ShippingProviderError,
  ShippingRateExpiredError,
  ShippingRateInvalidError,
} from "./errors";
import { fetchRatesForCheckout } from "./fetchRatesForCheckout";
import {
  createQuoteSession,
  fingerprintCart,
  getQuoteSession,
  validateShippingSelection,
  type ShippingSelectionInput,
  type ValidatedShippingSelection,
} from "./rateValidation";
import { getOrCreateShippingSettings } from "./settings";
import type {
  OrderShippingMethod,
  ShippingAddressSnapshot,
  ShippingSettingsDoc,
} from "./types";

/** True when checkout must collect a live courier rate (mirrors rates API gating). */
export function isShippingCheckoutRequired(
  settings: ShippingSettingsDoc
): boolean {
  // Master kill-switch (documented in docs/shipping-env.md). Default: enabled when unset.
  if (process.env.SHIPPING_ENABLED?.trim().toLowerCase() === "false") {
    return false;
  }
  const enabled = settings.enabledProviders?.length
    ? settings.enabledProviders
    : [settings.primaryProvider];
  const shipbubbleOk =
    enabled.includes("shipbubble") &&
    Boolean(process.env.SHIPBUBBLE_API_KEY?.trim());
  const fezOk =
    enabled.includes("fez") &&
    Boolean(
      (process.env.FEZ_SECRET_KEY?.trim() || process.env.FEZ_API_KEY?.trim()) &&
        (process.env.FEZ_BEARER_TOKEN?.trim() ||
          (process.env.FEZ_USER_ID?.trim() && process.env.FEZ_PASSWORD?.trim()))
    );
  if (!shipbubbleOk && !fezOk) return false;
  const origin = settings.originAddress;
  return Boolean(origin.line1?.trim() && origin.phone?.trim());
}

function matchLiveQuote(
  quotes: Array<{
    provider: string;
    serviceCode: string;
    courierName: string;
    courierId?: string;
    fee: number;
    currency: string;
    rateToken: string;
    expiresAt: string;
    requestToken?: string;
  }>,
  selection: ShippingSelectionInput
): (typeof quotes)[number] | null {
  const fee = Number(selection.fee);
  const serviceCode = String(selection.serviceCode ?? "").trim();
  const provider = String(selection.provider ?? "shipbubble").trim();

  // Require serviceCode + fee — never rematch by fee alone (guessing / underpay risk).
  if (!serviceCode || !Number.isFinite(fee)) {
    return null;
  }

  return (
    quotes.find(
      (q) =>
        q.serviceCode === serviceCode &&
        (!provider || q.provider === provider) &&
        amountsMatch(q.fee, fee)
    ) ?? null
  );
}

/**
 * Cache-first validation; on cache miss re-fetch live rates (preferred provider
 * first) and rematch (S13 — required for multi-instance deploys where in-memory
 * cache is empty). Tamper checks on a live cache hit are not bypassed by re-fetch.
 */
export async function resolveShippingSelectionForOrder(input: {
  selection: ShippingSelectionInput;
  userId: string;
  orgId: string;
  cart: CartLike & { _id: string; updatedAt?: Date | string };
  destination: ShippingAddressSnapshot;
  recipientEmail?: string | null;
}): Promise<ValidatedShippingSelection> {
  const cartFingerprint = fingerprintCart(input.cart);

  const sessionId = String(input.selection.quoteSessionId || "").trim();
  const cached = sessionId ? getQuoteSession(sessionId) : null;

  if (cached) {
    try {
      return validateShippingSelection({
        selection: input.selection,
        userId: input.userId,
        cartId: input.cart._id,
        cartFingerprint,
        destination: input.destination,
        orgId: input.orgId,
      });
    } catch (error) {
      // Only re-fetch on expiry or cart composition drift.
      // Wrong optionId / user / address must hard-fail (no rematch bypass).
      const msg = error instanceof Error ? error.message.toLowerCase() : "";
      const canRefetch =
        error instanceof ShippingRateExpiredError ||
        (error instanceof ShippingRateInvalidError && msg.includes("cart"));
      if (!canRefetch) throw error;
    }
  }

  // Cache miss / expired session — re-fetch live rates and rematch (S13).
  const settings = await getOrCreateShippingSettings(input.orgId);
  if (!isShippingCheckoutRequired(settings)) {
    throw new ShippingNotConfiguredError(
      "Shipping rates are not available; remove shipping selection or configure shipping."
    );
  }

  if (!String(input.selection.serviceCode ?? "").trim()) {
    throw new ShippingRateExpiredError(
      "Shipping quote expired. Please select a delivery method again."
    );
  }
  if (
    input.selection.fee === undefined ||
    input.selection.fee === null ||
    !Number.isFinite(Number(input.selection.fee))
  ) {
    throw new ShippingRateInvalidError(
      "Shipping fee is required to re-validate the selected rate."
    );
  }

  const preferRaw = String(input.selection.provider || "").trim();
  const preferProvider =
    preferRaw === "shipbubble" || preferRaw === "fez" || preferRaw === "kwik"
      ? (preferRaw as OrderShippingMethod["provider"])
      : null;

  const live = await fetchRatesForCheckout({
    cart: input.cart,
    settings,
    origin: settings.originAddress,
    destination: input.destination,
    recipientEmail: input.recipientEmail,
    preferProvider,
  }).catch((err) => {
    // Rematch with no courier coverage → treat as expired quote (S13), not a 500.
    if (err instanceof ShippingProviderError) {
      throw new ShippingRateExpiredError(
        err.message ||
          "Shipping quote expired or no longer available. Please select a delivery method again."
      );
    }
    throw err;
  });

  const matched = matchLiveQuote(live.quotes, input.selection);
  if (!matched) {
    throw new ShippingRateExpiredError(
      "Shipping quote expired or changed. Please select a delivery method again."
    );
  }

  createQuoteSession({
    userId: input.userId,
    orgId: input.orgId,
    cartId: input.cart._id,
    cartFingerprint,
    destination: input.destination,
    quotes: live.quotes,
    expiresAt: live.expiresAt,
    parcel: live.parcel,
  });

  const fee = roundMoney(Math.max(0, matched.fee));
  if (
    input.selection.fee !== undefined &&
    input.selection.fee !== null &&
    !amountsMatch(Number(input.selection.fee), fee)
  ) {
    throw new ShippingRateInvalidError(
      "Shipping fee does not match the quoted rate."
    );
  }

  return {
    shippingFee: fee,
    shippingMethod: {
      provider:
        matched.provider as ValidatedShippingSelection["shippingMethod"]["provider"],
      serviceCode: matched.serviceCode,
      courierName: matched.courierName,
      courierId: matched.courierId,
      rateToken: matched.rateToken,
      fee,
      currency: matched.currency,
      expiresAt: matched.expiresAt,
      requestToken: matched.requestToken,
      parcel: live.parcel,
    },
    publicMethod: {
      provider:
        matched.provider as ValidatedShippingSelection["publicMethod"]["provider"],
      serviceCode: matched.serviceCode,
      courierName: matched.courierName,
      fee,
      currency: matched.currency,
      expiresAt: matched.expiresAt,
    },
  };
}

/**
 * When a paid order's checkout quote TTL elapsed before book/retry, re-fetch
 * live rates and rematch by serviceCode + fee (same money). Updates
 * Order.shippingMethod tokens only — never changes shippingFee / amount.
 * Returns null when rematch is impossible (rate moved / shipping off).
 */
export async function refreshExpiredShippingMethodForBooking(input: {
  orderId: string;
  orgId: string;
  userId: string;
  cartId: string;
  method: OrderShippingMethod;
  destination: ShippingAddressSnapshot;
  recipientEmail?: string | null;
}): Promise<OrderShippingMethod | null> {
  const settings = await getOrCreateShippingSettings(input.orgId);
  if (!isShippingCheckoutRequired(settings)) {
    return null;
  }

  let cart: CartLike;
  try {
    cart = await loadCartForCheckout(input.cartId, input.userId);
  } catch {
    // Cart lines are cleared after fulfill — defaults still yield rematchable quotes.
    cart = { _id: input.cartId, lines: [] } as unknown as CartLike;
  }

  let live: Awaited<ReturnType<typeof fetchRatesForCheckout>>;
  try {
    live = await fetchRatesForCheckout({
      cart,
      settings,
      origin: settings.originAddress,
      destination: input.destination,
      recipientEmail: input.recipientEmail,
      preferProvider: input.method.provider,
      parcelOverride: input.method.parcel ?? null,
    });
  } catch (err) {
    console.warn(
      `[refreshExpiredShippingMethod] rates fetch failed order=${input.orderId}:`,
      err
    );
    return null;
  }

  const matched = matchLiveQuote(live.quotes, {
    quoteSessionId: "",
    optionId: "",
    provider: input.method.provider,
    serviceCode: input.method.serviceCode,
    fee: input.method.fee,
  });
  if (!matched) {
    return null;
  }

  const fee = roundMoney(Math.max(0, matched.fee));
  if (!amountsMatch(fee, Number(input.method.fee) || 0)) {
    return null;
  }

  const next: OrderShippingMethod = {
    provider: matched.provider as OrderShippingMethod["provider"],
    serviceCode: matched.serviceCode,
    courierName: matched.courierName || input.method.courierName,
    courierId: matched.courierId || input.method.courierId,
    rateToken: matched.rateToken,
    fee,
    currency: matched.currency || input.method.currency || "NGN",
    expiresAt: matched.expiresAt,
    requestToken: matched.requestToken || input.method.requestToken,
    parcel: live.parcel || input.method.parcel,
  };

  await prisma.order.update({
    where: { id: input.orderId },
    data: { shippingMethod: next },
  });

  return next;
}
