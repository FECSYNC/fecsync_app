import type {
  OrderShippingMethod,
  ParcelSpec,
  ProfileShippingAddress,
  PublicOrderShippingMethod,
  ShippingAddress,
  ShippingAddressSnapshot,
  ShippingOriginAddress,
} from "./types";

const NIGERIA_COUNTRY_CODES = new Set(["NG", "Nigeria", "nigeria"]);

export function isNigeriaCountry(country?: string | null): boolean {
  if (!country) return false;
  return NIGERIA_COUNTRY_CODES.has(country.trim());
}

function cleanString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }
  if (typeof value !== "string") return "";
  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SHIPPING_PROVIDER_CODES = new Set([
  "shipbubble",
  "fez",
  "kwik",
  "manual",
]);

/** Normalize profile/checkout address into an order shipping snapshot. */
export function toShippingAddressSnapshot(
  address: ProfileShippingAddress,
  fallbackPhone?: string | null,
  fallbackName?: string | null
): ShippingAddressSnapshot {
  const phone = cleanString(address.phone) || cleanString(fallbackPhone);
  const contactName =
    cleanString(address.contactName) || cleanString(fallbackName);

  return {
    line1: cleanString(address.line1),
    line2: cleanString(address.line2) || undefined,
    city: cleanString(address.city),
    state: cleanString(address.state),
    lga: cleanString(address.lga) || undefined,
    zip: cleanString(address.zip) || undefined,
    country: cleanString(address.country) || "NG",
    phone,
    contactName: contactName || undefined,
    email: cleanString(address.email) || undefined,
  };
}

/**
 * STEP 3 alias — map profile/checkout address (+ optional user phone) to ShippingAddress.
 */
export function profileAddressToShippingAddress(
  profileAddr: ProfileShippingAddress,
  userPhone?: string | null
): ShippingAddress {
  return toShippingAddressSnapshot(profileAddr, userPhone);
}

/** Single-line formatted address for backward-compatible Order.address. */
export function formatShippingAddressLine(
  address: ShippingAddressSnapshot | ShippingOriginAddress
): string {
  // Matches formatDeliveryAddress in services/order.ts (line1, line2, city, lga, state, zip, country).
  const parts = [
    address.line1,
    "line2" in address ? address.line2 : undefined,
    address.city,
    "lga" in address && address.lga ? address.lga : undefined,
    address.state,
    address.zip,
    address.country,
  ].filter(Boolean);
  return parts.join(", ");
}

/** STEP 3 alias for formatShippingAddressLine. */
export function formatAddressString(
  addr: ShippingAddressSnapshot | ShippingOriginAddress
): string {
  return formatShippingAddressLine(addr);
}

/**
 * Validate a shipping address for rate/book.
 * NG requires line1, city, state, country, phone.
 * Zip is required for non-NG destinations (NG postal codes are often blank).
 */
export function validateShippingAddress(
  addr: ShippingAddress | null | undefined
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!addr) {
    return { ok: false, errors: ["Address is required"] };
  }
  if (!cleanString(addr.line1)) errors.push("Street address (line1) is required");
  if (!cleanString(addr.city)) errors.push("City is required");
  if (!cleanString(addr.state)) errors.push("State is required");
  if (!cleanString(addr.country)) errors.push("Country is required");
  if (!cleanString(addr.phone)) errors.push("Phone is required");

  const country = cleanString(addr.country) || "NG";
  if (!isNigeriaCountry(country) && !cleanString(addr.zip)) {
    errors.push("Postal / ZIP code is required");
  }

  return { ok: errors.length === 0, errors };
}

export function parseShippingAddressJson(
  value: unknown
): ShippingAddressSnapshot | null {
  if (!isPlainObject(value)) return null;
  const raw = value;
  const line1 = cleanString(raw.line1);
  const city = cleanString(raw.city);
  const state = cleanString(raw.state);
  const country = cleanString(raw.country) || "NG";
  const phone = cleanString(raw.phone);
  if (!line1 || !city || !state) return null;
  return {
    line1,
    line2: cleanString(raw.line2) || undefined,
    city,
    state,
    lga: cleanString(raw.lga) || undefined,
    zip: cleanString(raw.zip) || undefined,
    country,
    phone,
    contactName: cleanString(raw.contactName) || undefined,
    email: cleanString(raw.email) || undefined,
  };
}

export function parseOrderShippingMethodJson(
  value: unknown
): OrderShippingMethod | null {
  if (!isPlainObject(value)) return null;
  const raw = value;
  const provider = cleanString(raw.provider);
  const serviceCode = cleanString(raw.serviceCode);
  const rateToken = cleanString(raw.rateToken);
  const expiresAt = cleanString(raw.expiresAt);
  const fee = Number(raw.fee);
  if (!provider || !serviceCode || !rateToken || !expiresAt) return null;
  if (!SHIPPING_PROVIDER_CODES.has(provider)) return null;
  if (!Number.isFinite(fee) || fee < 0) return null;
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return null;
  return {
    provider: provider as OrderShippingMethod["provider"],
    serviceCode,
    courierName: cleanString(raw.courierName) || undefined,
    courierId: cleanString(raw.courierId) || undefined,
    rateToken,
    fee,
    currency: cleanString(raw.currency) || "NGN",
    expiresAt,
    requestToken: cleanString(raw.requestToken) || undefined,
    parcel: parseParcelSpec(raw.parcel),
  };
}

function parseParcelSpec(value: unknown): ParcelSpec | undefined {
  if (!isPlainObject(value)) return undefined;
  const weightKg = Number(value.weightKg);
  const length = Number(value.length);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    ![weightKg, length, width, height].every(
      (n) => Number.isFinite(n) && n > 0
    )
  ) {
    return undefined;
  }
  return { weightKg, length, width, height };
}

/** Strip booking secrets before returning shippingMethod to any HTTP client. */
export function toPublicShippingMethod(
  value: unknown
): PublicOrderShippingMethod | null {
  const full = parseOrderShippingMethodJson(value);
  if (!full) return null;
  return {
    provider: full.provider,
    serviceCode: full.serviceCode,
    courierName: full.courierName,
    fee: full.fee,
    currency: full.currency,
    expiresAt: full.expiresAt,
  };
}

export function isShippingMethodExpired(
  method: { expiresAt: string },
  now = new Date()
): boolean {
  const expires = new Date(method.expiresAt);
  if (Number.isNaN(expires.getTime())) return true;
  return expires.getTime() <= now.getTime();
}
