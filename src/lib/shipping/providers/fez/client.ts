/**
 * Fez Delivery corporate API — sandbox/production.
 * Docs: https://fez-delivery-co.gitbook.io/fezcorporate-api-docs
 *
 * Auth: POST /user/authenticate → Bearer authToken + org secret-key header.
 * Rates: POST /order/cost (destination state + weight).
 * Book: POST /order (array; thirdparty=true for marketplace origin).
 * Webhook: HMAC-SHA256 of (orderNumber + status + timestamp) with secret-key;
 *          headers X-Signature, X-Timestamp (see order-webhook-request docs).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { ShippingError, ShippingNotConfiguredError, ShippingProviderError } from "../../errors";
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

export const FEZ_ENV_KEYS = {
  apiUrl: "FEZ_API_URL",
  secretKey: "FEZ_SECRET_KEY",
  bearerToken: "FEZ_BEARER_TOKEN",
  userId: "FEZ_USER_ID",
  password: "FEZ_PASSWORD",
  webhookSecret: "FEZ_WEBHOOK_SECRET",
} as const;

const DEFAULT_SANDBOX_URL = "https://apisandbox.fezdelivery.co/v1";
const QUOTE_TTL_MS = 30 * 60 * 1000;

type FezAuthCache = {
  token: string;
  expiresAtMs: number;
};

let authCache: FezAuthCache | null = null;

export function getFezApiBaseUrl(): string {
  const raw = process.env[FEZ_ENV_KEYS.apiUrl]?.trim();
  return (raw || DEFAULT_SANDBOX_URL).replace(/\/+$/, "");
}

export function getFezSecretKey(): string {
  return (
    process.env[FEZ_ENV_KEYS.secretKey]?.trim() ||
    process.env.FEZ_API_KEY?.trim() ||
    ""
  );
}

export function isFezConfigured(): boolean {
  const secret = getFezSecretKey();
  if (!secret) return false;
  if (process.env[FEZ_ENV_KEYS.bearerToken]?.trim()) return true;
  return Boolean(
    process.env[FEZ_ENV_KEYS.userId]?.trim() &&
      process.env[FEZ_ENV_KEYS.password]?.trim()
  );
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

async function authenticateFez(): Promise<string> {
  const cachedBearer = process.env[FEZ_ENV_KEYS.bearerToken]?.trim();
  if (cachedBearer) return cachedBearer;

  if (authCache && authCache.expiresAtMs > Date.now() + 60_000) {
    return authCache.token;
  }

  const userId = process.env[FEZ_ENV_KEYS.userId]?.trim();
  const password = process.env[FEZ_ENV_KEYS.password]?.trim();
  if (!userId || !password) {
    throw new ShippingNotConfiguredError(
      "Fez credentials missing (FEZ_BEARER_TOKEN or FEZ_USER_ID + FEZ_PASSWORD)"
    );
  }

  const res = await fetch(`${getFezApiBaseUrl()}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, password }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    description?: string;
    authDetails?: { authToken?: string; expireToken?: string };
  };
  const token = String(json.authDetails?.authToken || "").trim();
  if (!res.ok || !token) {
    throw new ShippingProviderError(
      "fez",
      json.description || `Fez authenticate failed (${res.status})`,
      { code: "auth_failed", retryable: true }
    );
  }

  const expireRaw = json.authDetails?.expireToken;
  const expireMs = expireRaw ? Date.parse(expireRaw) : Date.now() + 12 * 3600_000;
  authCache = {
    token,
    expiresAtMs: Number.isFinite(expireMs) ? expireMs : Date.now() + 12 * 3600_000,
  };
  return token;
}

export async function fezFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const secret = getFezSecretKey();
  if (!secret) {
    throw new ShippingNotConfiguredError("FEZ_SECRET_KEY is not set");
  }
  const token = await authenticateFez();
  const url = `${getFezApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "secret-key": secret,
      ...(init?.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    status?: string;
    description?: string;
    message?: string;
  };
  if (!res.ok) {
    const msg =
      (json as { description?: string; message?: string }).description ||
      (json as { message?: string }).message ||
      `Fez request failed (${res.status})`;
    throw new ShippingProviderError("fez", msg, {
      code: "http_error",
      retryable: res.status >= 500,
    });
  }
  return json;
}

function normalizeNigeriaState(state: string): string {
  const s = String(state || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "fct" || lower.includes("abuja")) return "FCT";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseFezCostPayload(json: unknown, state: string): number | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  // Docs: prefer lowercase `cost`; may return per-state map when state empty.
  if (typeof root.cost === "number" && Number.isFinite(root.cost)) {
    const vat = typeof root.VAT === "number" ? root.VAT : typeof root.vat === "number" ? root.vat : 0;
    return Math.max(0, root.cost + (Number.isFinite(vat) ? vat : 0));
  }
  if (typeof root.Cost === "number" && Number.isFinite(root.Cost)) {
    return Math.max(0, root.Cost);
  }
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const map = data as Record<string, unknown>;
    const hit =
      map[state] ??
      map[state.toUpperCase()] ??
      map[normalizeNigeriaState(state)];
    if (typeof hit === "number" && Number.isFinite(hit)) return Math.max(0, hit);
    if (hit && typeof hit === "object") {
      const row = hit as Record<string, unknown>;
      const c = row.cost ?? row.Cost;
      if (typeof c === "number" && Number.isFinite(c)) return Math.max(0, c);
    }
  }
  return null;
}

export async function fetchFezDeliveryCost(input: {
  destinationState: string;
  pickUpState?: string;
  weightKg?: number;
}): Promise<{ fee: number; currency: string; raw: unknown }> {
  const state = normalizeNigeriaState(input.destinationState);
  if (!state) {
    throw new ShippingProviderError("fez", "Destination state is required", {
      code: "invalid_destination",
    });
  }
  const body: Record<string, unknown> = { state };
  if (input.pickUpState) body.pickUpState = normalizeNigeriaState(input.pickUpState);
  if (input.weightKg != null && Number.isFinite(input.weightKg)) {
    body.weight = Math.max(1, Math.round(input.weightKg));
  }
  const json = await fezFetch<unknown>("/order/cost", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const fee = parseFezCostPayload(json, state);
  if (fee == null) {
    throw new ShippingProviderError(
      "fez",
      "Fez /order/cost did not return a usable cost",
      { code: "rate_parse_failed" }
    );
  }
  return { fee, currency: "NGN", raw: json };
}

export async function bookFezShipment(
  input: BookShipmentInput
): Promise<BookShipmentResult> {
  const dest = input.destination;
  const uniqueID = `hw-${input.orderId}`.slice(0, 64);
  const batchID = `hw-batch-${input.orderId}`.slice(0, 64);

  let senderName = "FECSYNC";
  let orderLabel = "FECSYNC";
  let senderPhone: string | undefined;
  try {
    const { resolveBrandForOrg } = await import("@/lib/companyProfile");
    const brand = await resolveBrandForOrg(input.orgId);
    senderName = brand.displayName?.trim() || senderName;
    orderLabel = senderName;
    const phone = brand.phone?.trim();
    if (phone) senderPhone = phone;
  } catch (err) {
    console.warn("[fez] brand resolve for sender skipped:", err);
  }

  const payload = [
    {
      recipientAddress: [dest.line1, dest.line2].filter(Boolean).join(", "),
      recipientState: normalizeNigeriaState(dest.state),
      recipientName: dest.contactName || "Customer",
      recipientPhone: dest.phone,
      recipientEmail: dest.email || undefined,
      uniqueID,
      BatchID: batchID,
      valueOfItem: String(
        Math.max(
          1,
          Math.round(
            Number.isFinite(input.declaredValueNgn)
              ? Number(input.declaredValueNgn)
              : Math.max(input.shippingFee, 1000)
          )
        )
      ),
      weight: Math.max(1, Math.round(input.weightKg || 1)),
      itemDescription: `${orderLabel} order ${input.orderId.slice(-8)}`,
      thirdparty: "true",
      senderName,
      senderAddress: undefined as string | undefined,
      senderPhone,
    },
  ];

  const json = await fezFetch<{
    status?: string;
    description?: string;
    orderNos?: Record<string, string>;
  }>("/order", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const orderNos = json.orderNos || {};
  const providerShipmentId =
    orderNos[uniqueID] ||
    Object.values(orderNos)[0] ||
    "";
  if (!providerShipmentId) {
    throw new ShippingProviderError(
      "fez",
      json.description || "Fez booking did not return an order number",
      { code: "book_failed" }
    );
  }

  return {
    providerShipmentId: String(providerShipmentId),
    trackingNumber: String(providerShipmentId),
    courierName: "Fez Delivery",
    rawProviderPayload: json,
  };
}

/**
 * Cancel / delete a Fez order (DELETE /order with orderNo).
 * Docs: https://fez-delivery-co.gitbook.io/fezcorporate-api-docs/api-endpoints/orders/delete
 */
export async function cancelFezShipment(
  providerShipmentId: string
): Promise<void> {
  const orderNo = String(providerShipmentId || "").trim();
  if (!orderNo) {
    throw new ShippingProviderError("fez", "Missing Fez order number to cancel", {
      code: "cancel_missing_id",
    });
  }
  await fezFetch("/order", {
    method: "DELETE",
    body: JSON.stringify({ orderNo }),
  });
}

/**
 * Verify Fez webhook: HMAC-SHA256 hex of (orderNumber + status + timestamp)
 * with FEZ_WEBHOOK_SECRET. In non-production only, falls back to FEZ_SECRET_KEY.
 * Empty secret → reject (fail closed).
 */
export function verifyFezWebhookSignature(
  headers: Headers | Record<string, string | null | undefined>,
  rawBody: string
): boolean {
  const signature = headerGet(headers, "x-signature") || headerGet(headers, "X-Signature");
  const timestamp =
    headerGet(headers, "x-timestamp") || headerGet(headers, "X-Timestamp");
  const dedicated = process.env[FEZ_ENV_KEYS.webhookSecret]?.trim() || "";
  const secret =
    dedicated ||
    (process.env.NODE_ENV === "production" ? "" : getFezSecretKey());
  if (!signature || !timestamp || !secret) return false;

  let orderNumber = "";
  let status = "";
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    orderNumber = String(
      parsed.orderNumber || parsed.orderNo || parsed.order_number || ""
    ).trim();
    status = String(
      parsed.status || parsed.orderStatus || parsed.order_status || ""
    ).trim();
  } catch {
    return false;
  }
  if (!orderNumber || !status) return false;

  const payload = `${orderNumber}${status}${timestamp}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature).trim(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * @param timestampHeader X-Timestamp used in the HMAC (required for stable eventId).
 * Never uses Date.now() — that would break webhook idempotency on retries.
 */
export function parseFezWebhookEvent(
  rawBody: string,
  timestampHeader?: string | null
): ParsedWebhookEvent {
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  const orderNumber = String(
    parsed.orderNumber || parsed.orderNo || parsed.order_number || ""
  ).trim();
  const status = String(
    parsed.status || parsed.orderStatus || parsed.order_status || ""
  ).trim();
  const ts = String(
    timestampHeader || parsed.timestamp || parsed.updatedAt || ""
  ).trim();
  // Prefer header timestamp (signed); status+order alone is still idempotent for replays.
  const eventId = ts
    ? `fez:${orderNumber}:${status}:${ts}`
    : `fez:${orderNumber}:${status}`;
  const trackingUrlRaw = String(
    parsed.trackingUrl ||
      parsed.tracking_url ||
      parsed.trackUrl ||
      parsed.track_url ||
      ""
  ).trim();

  return {
    provider: "fez",
    eventName: "order.status.changed",
    eventId,
    providerShipmentId: orderNumber,
    providerStatus: status,
    trackingNumber: orderNumber,
    trackingUrl: trackingUrlRaw || null,
    labelUrl: null,
    courierName: "Fez Delivery",
    rawPayload: parsed,
  };
}

function fezQuoteFromCost(
  fee: number,
  destinationState: string
): RateQuoteOption {
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const rateToken = `fez:${destinationState}:${fee.toFixed(2)}:${expiresAt}`;
  return {
    provider: "fez",
    serviceCode: "fez-standard",
    courierName: "Fez Delivery",
    courierId: "fez-standard",
    fee,
    currency: "NGN",
    rateToken,
    expiresAt,
    requestToken: rateToken,
    estimatedDaysMin: 2,
    estimatedDaysMax: 5,
  };
}

export const fezAdapter: ShippingProviderAdapter = {
  code: "fez",

  async validateConfig(): Promise<void> {
    if (!isFezConfigured()) {
      throw new ShippingNotConfiguredError(
        "Fez is not configured (need FEZ_SECRET_KEY and bearer or user/password)"
      );
    }
    await authenticateFez();
  },

  async getRates(input: RateQuoteInput): Promise<ShippingRateQuote[]> {
    if (!isFezConfigured()) return [];
    const { fee } = await fetchFezDeliveryCost({
      destinationState: input.destination.state,
      pickUpState: input.origin?.state,
      weightKg: input.parcel?.weightKg ?? input.weightKg,
    });
    return [fezQuoteFromCost(fee, input.destination.state)];
  },

  async fetchRates(input: {
    origin: ShippingOriginAddress;
    destination: ShippingAddress;
    parcel: ParcelSpec;
    orgId: string;
  }): Promise<RateQuoteOption[]> {
    void input.orgId;
    if (!isFezConfigured()) return [];
    const { fee } = await fetchFezDeliveryCost({
      destinationState: input.destination.state,
      pickUpState: input.origin.state,
      weightKg: input.parcel.weightKg,
    });
    return [fezQuoteFromCost(fee, input.destination.state)];
  },

  async bookShipment(input: BookShipmentInput): Promise<BookShipmentResult> {
    return bookFezShipment(input);
  },

  async createShipment(_input: {
    order: { id: string; orgId: string };
    method: ShippingMethodSelection;
    parcel: ParcelSpec;
  }): Promise<ShipmentBookResult> {
    void _input;
    throw new ShippingError(
      "provider_unsupported",
      "Fez createShipment requires a destination — use bookShipment with BookShipmentInput"
    );
  },

  verifyWebhookSignature: verifyFezWebhookSignature,
  parseWebhookEvent: parseFezWebhookEvent,
};
