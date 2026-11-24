import type {
  ShipmentStatus,
  ShippingProviderCode,
} from "@prisma/client";

/** Structured delivery address snapshot stored on Order.shippingAddress. */
export type ShippingAddressSnapshot = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  lga?: string;
  zip?: string;
  country: string;
  phone: string;
  contactName?: string;
  email?: string;
};

/**
 * STEP 3 / F2 name for the structured address.
 * Prefer ShippingAddressSnapshot in new server code.
 */
export type ShippingAddress = ShippingAddressSnapshot;

/** Profile / checkout address shape (extends legacy Address with Nigeria fields). */
export type ProfileShippingAddress = {
  _id?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  lga?: string;
  zip?: string;
  country: string;
  phone?: string;
  contactName?: string;
  email?: string;
  isDefault?: boolean;
};

export type ParcelDimensions = {
  length: number;
  width: number;
  height: number;
};

/** Parcel for rate/book calls (weight + cm dimensions). */
export type ParcelSpec = ParcelDimensions & {
  weightKg: number;
};

/** Rate selection persisted on Order.shippingMethod at create time. */
export type OrderShippingMethod = {
  provider: ShippingProviderCode;
  serviceCode: string;
  courierName?: string;
  /** Shipbubble courier_id — required for label booking when distinct from serviceCode. */
  courierId?: string;
  rateToken: string;
  fee: number;
  currency?: string;
  expiresAt: string;
  requestToken?: string;
  /** Parcel used for the paid quote — book must reuse this, not bare settings defaults. */
  parcel?: ParcelSpec;
};

/** STEP 3 alias for OrderShippingMethod. */
export type ShippingMethodSelection = OrderShippingMethod;

/**
 * Client/API-safe shipping method — omits provider rate/request tokens
 * (booking secrets; server reads full JSON from DB when booking).
 */
export type PublicOrderShippingMethod = {
  provider: ShippingProviderCode;
  serviceCode: string;
  courierName?: string;
  fee: number;
  currency?: string;
  expiresAt: string;
};

export type ShippingOriginAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  lga?: string;
  zip?: string;
  country: string;
  phone: string;
  contactName: string;
};

export type ShippingSettingsDoc = {
  _id: string;
  orgId: string;
  originAddress: ShippingOriginAddress;
  defaultWeightKg: number;
  defaultDimensions: ParcelDimensions;
  autoBookOnPaid: boolean;
  primaryProvider: ShippingProviderCode;
  enabledProviders: ShippingProviderCode[];
  createdAt: Date;
  updatedAt: Date;
};

/** STEP 3 alias for ShippingSettingsDoc. */
export type ShippingSettings = ShippingSettingsDoc;

/** Provider credentials / env resolution (server-only). */
export type ProviderConfig = {
  code: ShippingProviderCode;
  apiKey?: string;
  /** sandbox | production — Shipbubble uses key prefix; host stays api.shipbubble.com/v1 */
  env?: "sandbox" | "production";
  webhookSecret?: string;
  baseUrl?: string;
};

export type ShippingRateQuote = {
  provider: ShippingProviderCode;
  serviceCode: string;
  courierName: string;
  courierId?: string;
  fee: number;
  currency: string;
  rateToken: string;
  expiresAt: string;
  estimatedDaysMin?: number;
  estimatedDaysMax?: number;
  /** Provider request token for booking (server-only; never serialize to clients). */
  requestToken?: string;
  deliveryEta?: string;
};

/** STEP 3 alias for normalized provider rate options. */
export type RateQuoteOption = ShippingRateQuote;

export type RateQuoteInput = {
  orgId: string;
  destination: ShippingAddressSnapshot;
  weightKg: number;
  dimensions: ParcelDimensions;
  origin?: ShippingOriginAddress;
  parcel?: ParcelSpec;
};

export type BookShipmentInput = {
  orderId: string;
  orgId: string;
  provider: ShippingProviderCode;
  serviceCode: string;
  rateToken: string;
  requestToken?: string;
  courierId?: string;
  shippingFee: number;
  /** Declared merchandise value (NGN) for provider insurance / valueOfItem. */
  declaredValueNgn?: number;
  destination: ShippingAddressSnapshot;
  weightKg: number;
  dimensions: ParcelDimensions;
};

export type BookShipmentResult = {
  providerShipmentId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  labelUrl?: string;
  courierName?: string;
  rawProviderPayload?: unknown;
};

/** STEP 3 alias. */
export type ShipmentBookResult = BookShipmentResult;

/** Normalized inbound webhook after provider parse. */
export type ParsedWebhookEvent = {
  provider: ShippingProviderCode;
  eventName?: string | null;
  eventId?: string | null;
  providerShipmentId?: string | null;
  providerStatus?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  courierName?: string | null;
  rawPayload?: unknown;
};

export type SerializedShipment = {
  _id: string;
  id: string;
  orderId: string;
  orgId: string;
  provider: ShippingProviderCode;
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
};

/** Admin deliveries list/detail — same shipment DTO + order context for UI. */
export type ShipmentListItem = SerializedShipment & {
  orderAddress?: string | null;
  orderStatus?: string | null;
  customerName?: string | null;
};

export type { ShipmentStatus, ShippingProviderCode };
