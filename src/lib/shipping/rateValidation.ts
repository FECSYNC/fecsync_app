import { createHash, randomBytes } from "crypto";
import { amountsMatch } from "@/lib/orderPaymentSettle";
import { roundMoney } from "@/utils/tax";
import {
  isShippingMethodExpired,
  parseShippingAddressJson,
  toShippingAddressSnapshot,
} from "./address";
import {
  ShippingRateExpiredError,
  ShippingRateInvalidError,
} from "./errors";
import type {
  OrderShippingMethod,
  ParcelSpec,
  ProfileShippingAddress,
  PublicOrderShippingMethod,
  ShippingAddressSnapshot,
  ShippingProviderCode,
  ShippingRateQuote,
} from "./types";
import { makeRateOptionId } from "./providers/shipbubble/rates";

const QUOTE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

export type PublicShippingRateOption = PublicOrderShippingMethod & {
  optionId: string;
  estimatedDaysLabel?: string;
};

export type ShippingSelectionInput = {
  quoteSessionId: string;
  optionId: string;
  /** Client-claimed fee — must match cached quote (tamper check). */
  fee?: number;
  /** Used to rematch on cache miss / live re-fetch (S13). */
  serviceCode?: string;
  provider?: string;
  courierName?: string;
};

type CachedRateOption = {
  optionId: string;
  provider: ShippingProviderCode;
  serviceCode: string;
  courierName: string;
  courierId?: string;
  fee: number;
  currency: string;
  expiresAt: string;
  rateToken: string;
  requestToken?: string;
  estimatedDaysLabel?: string;
};

export type CachedQuoteSession = {
  quoteSessionId: string;
  userId: string;
  orgId: string;
  cartId: string;
  cartFingerprint: string;
  addressFingerprint: string;
  createdAt: number;
  expiresAt: string;
  options: CachedRateOption[];
  parcel?: ParcelSpec;
};

type GlobalQuoteCache = {
  __harewaShippingQuoteCache?: Map<string, CachedQuoteSession>;
};

function quoteCache(): Map<string, CachedQuoteSession> {
  const g = globalThis as GlobalQuoteCache;
  if (!g.__harewaShippingQuoteCache) {
    g.__harewaShippingQuoteCache = new Map();
  }
  return g.__harewaShippingQuoteCache;
}

function pruneCache(cache: Map<string, CachedQuoteSession>): void {
  const now = Date.now();
  for (const [id, session] of cache) {
    if (new Date(session.expiresAt).getTime() <= now) {
      cache.delete(id);
    }
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function fingerprintShippingAddress(
  address: ShippingAddressSnapshot
): string {
  // Omit contactName — rates/order create often fill it from profile independently;
  // it must not invalidate an otherwise identical delivery destination.
  const parts = [
    address.line1,
    address.line2 ?? "",
    address.city,
    address.state,
    address.lga ?? "",
    address.zip ?? "",
    address.country,
    address.phone,
  ].map((p) => p.trim().toLowerCase());
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function lineRefId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const obj = value as { id?: unknown; _id?: unknown };
    if (obj.id != null) return String(obj.id);
    if (obj._id != null) return String(obj._id);
  }
  return String(value);
}

/**
 * Fingerprint cart *contents* (line ids + qty), not updatedAt.
 * updatedAt changes on fabric snapshot refresh during order create and would
 * falsely invalidate an otherwise valid quote session.
 */
export function fingerprintCart(
  cart: {
    _id?: string;
    id?: string;
    lines?: Array<{
      lineType?: string;
      product?: unknown;
      fabric?: unknown;
      quantity?: number;
    }>;
  },
  /** @deprecated ignored — kept so older call sites still typecheck if any remain */
  _cartUpdatedAt?: Date | string | null
): string {
  void _cartUpdatedAt;
  const cartId = String(cart._id ?? cart.id ?? "").trim();
  const lines = Array.isArray(cart.lines) ? cart.lines : [];
  const parts = lines
    .map((line) => {
      const type = line.lineType === "fabric" ? "fabric" : "product";
      const ref =
        type === "fabric" ? lineRefId(line.fabric) : lineRefId(line.product);
      const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
      return `${type}:${ref}:${qty}`;
    })
    .sort();
  return createHash("sha256")
    .update(`${cartId}|${parts.join(",")}`)
    .digest("hex")
    .slice(0, 32);
}

export function createQuoteSession(input: {
  userId: string;
  orgId: string;
  cartId: string;
  cartFingerprint: string;
  destination: ShippingAddressSnapshot;
  quotes: Array<
    ShippingRateQuote & { requestToken?: string; deliveryEta?: string }
  >;
  expiresAt?: string;
  parcel?: ParcelSpec;
}): {
  quoteSessionId: string;
  expiresAt: string;
  options: PublicShippingRateOption[];
} {
  const cache = quoteCache();
  pruneCache(cache);

  const expiresAt =
    input.expiresAt ||
    new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const quoteSessionId = randomBytes(16).toString("hex");

  const options: CachedRateOption[] = input.quotes.map((q) => {
    const optionId = makeRateOptionId(q);
    return {
      optionId,
      provider: q.provider,
      serviceCode: q.serviceCode,
      courierName: q.courierName,
      courierId: q.courierId,
      fee: roundMoney(Math.max(0, q.fee)),
      currency: q.currency || "NGN",
      expiresAt: q.expiresAt || expiresAt,
      rateToken: q.rateToken,
      requestToken: q.requestToken,
      estimatedDaysLabel: q.deliveryEta,
    };
  });

  const session: CachedQuoteSession = {
    quoteSessionId,
    userId: input.userId,
    orgId: input.orgId,
    cartId: input.cartId,
    cartFingerprint: input.cartFingerprint,
    addressFingerprint: fingerprintShippingAddress(input.destination),
    createdAt: Date.now(),
    expiresAt,
    options,
    parcel: input.parcel,
  };
  cache.set(quoteSessionId, session);

  return {
    quoteSessionId,
    expiresAt,
    options: options.map(toPublicOption),
  };
}

function toPublicOption(opt: CachedRateOption): PublicShippingRateOption {
  return {
    optionId: opt.optionId,
    provider: opt.provider,
    serviceCode: opt.serviceCode,
    courierName: opt.courierName,
    fee: opt.fee,
    currency: opt.currency,
    expiresAt: opt.expiresAt,
    estimatedDaysLabel: opt.estimatedDaysLabel,
  };
}

export function getQuoteSession(
  quoteSessionId: string
): CachedQuoteSession | null {
  const cache = quoteCache();
  pruneCache(cache);
  const session = cache.get(quoteSessionId);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    cache.delete(quoteSessionId);
    return null;
  }
  return session;
}

export type ValidatedShippingSelection = {
  shippingFee: number;
  shippingMethod: OrderShippingMethod;
  publicMethod: PublicOrderShippingMethod;
};

/**
 * Re-validate client shipping selection against the server quote cache.
 * Rejects expired sessions, wrong user/cart/address, unknown options, and fee tampering.
 */
export function validateShippingSelection(input: {
  selection: ShippingSelectionInput;
  userId: string;
  cartId: string;
  cartFingerprint: string;
  destination: ShippingAddressSnapshot;
  /** Checkout/order org — must match the quote session org. */
  orgId?: string;
}): ValidatedShippingSelection {
  const sessionId = String(input.selection.quoteSessionId || "").trim();
  const optionId = String(input.selection.optionId || "").trim();
  if (!sessionId || !optionId) {
    throw new ShippingRateInvalidError(
      "Shipping selection is incomplete. Please choose a delivery method."
    );
  }

  const session = getQuoteSession(sessionId);
  if (!session) {
    throw new ShippingRateExpiredError(
      "Shipping quote expired. Please select a delivery method again."
    );
  }

  if (session.userId !== input.userId) {
    throw new ShippingRateInvalidError("Shipping quote does not belong to this user.");
  }
  if (input.orgId && session.orgId && session.orgId !== input.orgId) {
    throw new ShippingRateInvalidError(
      "Shipping quote does not belong to this store. Please refresh shipping options."
    );
  }
  if (session.cartId !== input.cartId) {
    throw new ShippingRateInvalidError(
      "Cart changed since rates were quoted. Please refresh shipping options."
    );
  }
  if (session.cartFingerprint !== input.cartFingerprint) {
    throw new ShippingRateInvalidError(
      "Cart contents changed since rates were quoted. Please refresh shipping options."
    );
  }

  const addrFp = fingerprintShippingAddress(input.destination);
  if (session.addressFingerprint !== addrFp) {
    throw new ShippingRateInvalidError(
      "Delivery address changed since rates were quoted. Please refresh shipping options."
    );
  }

  const option = session.options.find((o) => o.optionId === optionId);
  if (!option) {
    throw new ShippingRateInvalidError(
      "Selected shipping method is not valid for this quote."
    );
  }

  if (isShippingMethodExpired(option)) {
    throw new ShippingRateExpiredError();
  }

  const fee = roundMoney(Math.max(0, option.fee));
  if (
    input.selection.fee !== undefined &&
    input.selection.fee !== null &&
    Number.isFinite(Number(input.selection.fee)) &&
    !amountsMatch(Number(input.selection.fee), fee)
  ) {
    throw new ShippingRateInvalidError(
      "Shipping fee does not match the quoted rate."
    );
  }
  if (
    input.selection.fee !== undefined &&
    input.selection.fee !== null &&
    !Number.isFinite(Number(input.selection.fee))
  ) {
    throw new ShippingRateInvalidError(
      "Shipping fee does not match the quoted rate."
    );
  }

  if (!option.rateToken) {
    throw new ShippingRateInvalidError("Quoted rate is missing booking credentials.");
  }

  const shippingMethod: OrderShippingMethod = {
    provider: option.provider,
    serviceCode: option.serviceCode,
    courierName: option.courierName,
    courierId: option.courierId,
    rateToken: option.rateToken,
    fee,
    currency: option.currency,
    expiresAt: option.expiresAt,
    requestToken: option.requestToken,
    parcel: session.parcel,
  };

  return {
    shippingFee: fee,
    shippingMethod,
    publicMethod: {
      provider: option.provider,
      serviceCode: option.serviceCode,
      courierName: option.courierName,
      fee,
      currency: option.currency,
      expiresAt: option.expiresAt,
    },
  };
}

const DEST_FIELD_MAX = 200;
const DEST_PHONE_MAX = 32;

function clipDest(value: unknown, max = DEST_FIELD_MAX): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim().slice(0, max);
  }
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function clipDestinationSnapshot(
  snap: ShippingAddressSnapshot
): ShippingAddressSnapshot {
  return {
    line1: clipDest(snap.line1),
    line2: clipDest(snap.line2) || undefined,
    city: clipDest(snap.city),
    state: clipDest(snap.state),
    lga: clipDest(snap.lga) || undefined,
    zip: clipDest(snap.zip, 32) || undefined,
    country: clipDest(snap.country) || "NG",
    phone: clipDest(snap.phone, DEST_PHONE_MAX),
    contactName: clipDest(snap.contactName) || undefined,
  };
}

export function resolveDestinationSnapshot(
  address: ProfileShippingAddress | ShippingAddressSnapshot | null | undefined,
  fallbackPhone?: string | null,
  fallbackName?: string | null
): ShippingAddressSnapshot | null {
  if (!address || typeof address !== "object" || Array.isArray(address)) {
    return null;
  }
  if ("phone" in address && typeof (address as ShippingAddressSnapshot).line1 === "string") {
    const parsed = parseShippingAddressJson(address);
    if (parsed?.phone) {
      const clipped = clipDestinationSnapshot(parsed);
      if (!clipped.line1 || !clipped.city || !clipped.state || !clipped.phone) {
        return null;
      }
      return clipped;
    }
  }
  const snap = toShippingAddressSnapshot(
    address as ProfileShippingAddress,
    fallbackPhone,
    fallbackName
  );
  const clipped = clipDestinationSnapshot(snap);
  if (!clipped.line1 || !clipped.city || !clipped.state || !clipped.phone) {
    return null;
  }
  return clipped;
}

/** Test helper — clears quote cache (unit tests / scripts). */
export function clearShippingQuoteCacheForTests(): void {
  quoteCache().clear();
}
