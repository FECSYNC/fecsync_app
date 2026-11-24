import { api, unwrap, type MaybeWrapped } from "@/utils/api";
import {
  archiveBookingCategory,
  bookingCategoryKeys,
  createBookingCategory,
  listBookingCategories,
  updateBookingCategory,
  type BookingCategoryDto,
} from "@/services/bookingCategories";

export type { BookingCategoryDto };
export {
  archiveBookingCategory,
  bookingCategoryKeys,
  createBookingCategory,
  listBookingCategories,
  updateBookingCategory,
};

const BASE = "/api/admin/ticketing";

export type AdmissionProductType =
  | "timed_session"
  | "day_pass"
  | "group"
  | "camp_event"
  | "party_package"
  | "add_on"
  | "pass";

export type CapacityResourceType =
  | "attraction"
  | "session"
  | "room"
  | "lane"
  | "party_room"
  | "other";

export type BookingCreateMode = "hold" | "reserve" | "prompt";

export type TimeClockFormat = "twelve_hour" | "twenty_four_hour";

export type PriceBandDto = {
  id?: string;
  code: string;
  amount: number;
  currency: string;
  minAge: number | null;
  maxAge: number | null;
};

export type PriceBandInput = {
  code: string;
  amount: number;
  currency?: string;
  minAge?: number | null;
  maxAge?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
};

export type AdmissionProductDto = {
  id: string;
  orgId: string;
  locationId: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  type: AdmissionProductType;
  name: string;
  description: string | null;
  images: string[];
  resourceId: string | null;
  published: boolean;
  waiverRequired: boolean;
  minGuests: number | null;
  maxGuests: number | null;
  defaultPassExpiryDays: number | null;
  taxExemptDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  prices: PriceBandDto[];
  priceFrom: number | null;
  resource: {
    id: string;
    name: string;
    defaultCapacity: number;
  } | null;
  location: { id: string; name: string; slug: string } | null;
  parentLinksCount: number;
  sessionsCount: number;
  addOnLinks?: Array<{
    id: string;
    addOnProductId: string;
    required: boolean;
    maxQty: number | null;
    stockPeriodId: string | null;
    addOnProduct?: { id: string; name: string; type: string };
  }>;
};

export type TicketSessionDto = {
  id: string;
  orgId: string;
  locationId: string;
  productId: string;
  resourceId: string | null;
  /** Guest-facing slot name, e.g. "Morning Adventure". */
  label: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  remaining: number;
  priceOverride: number | null;
  isClosed: boolean;
  createdAt: string;
  updatedAt: string;
  product: { id: string; name: string; type: string } | null;
  resource: { id: string; name: string } | null;
  /** Availability enrichment (admin/public availability APIs). */
  heldQty?: number;
  committedQty?: number;
  nextReleaseAt?: string | null;
  status?: "open" | "limited" | "held" | "sold_out" | "closed";
  statusMessage?: string;
  availableForQty?: boolean;
};

export type CapacityResourceDto = {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  type: CapacityResourceType;
  defaultCapacity: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  location: { id: string; name: string; slug: string } | null;
};

export type StockPeriodDto = {
  id: string;
  orgId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  kind: "available" | "blocked";
  quantity: number | null;
  createdAt: string;
  updatedAt: string;
  productIds: string[];
  products: Array<{ id: string; name: string } | null | undefined>;
};

export type BookingSettingsDto = {
  id: string;
  orgId: string;
  locationId: string | null;
  defaultCreateMode: BookingCreateMode;
  holdTtlMinutes: number;
  reserveTtlHours: number;
  requireReviewBeforeConfirm: boolean;
  allowOnlinePayLater: boolean;
  payLaterMarksConfirmed: boolean;
  pastEditGraceMinutes: number;
  cancelCutoffMinutes: number | null;
  defaultTaxExempt: boolean;
  smsEnabled: boolean;
  timeFormat: TimeClockFormat;
  createdAt: string;
  updatedAt: string;
};

export type ProductListParams = {
  type?: AdmissionProductType | "all";
  published?: boolean | "all";
  locationId?: string;
  categoryId?: string;
  includeArchived?: boolean;
  /** Page size (API caps at 200; default server-side is 100). */
  take?: number;
};

/** Strip empty filters so prefetch keys match the list page. */
export function normalizeTicketingProductListParams(
  filters: ProductListParams = {}
): ProductListParams {
  const next: ProductListParams = {};
  if (filters.type != null) next.type = filters.type;
  if (filters.published != null) next.published = filters.published;
  if (filters.locationId?.trim()) next.locationId = filters.locationId.trim();
  if (filters.categoryId?.trim()) next.categoryId = filters.categoryId.trim();
  if (filters.includeArchived) next.includeArchived = true;
  else if (filters.includeArchived === false) next.includeArchived = false;
  if (filters.take != null && Number.isFinite(Number(filters.take))) {
    const n = Math.min(200, Math.max(1, Math.floor(Number(filters.take))));
    next.take = n;
  }
  return next;
}

function normalizeLooseFilters<
  T extends Record<string, string | boolean | number | undefined>,
>(filters: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

export const ticketingKeys = {
  all: ["admin", "ticketing"] as const,
  categories: (includeArchived?: boolean) =>
    bookingCategoryKeys.list(includeArchived),
  products: (filters: ProductListParams = {}) =>
    [
      ...ticketingKeys.all,
      "products",
      normalizeTicketingProductListParams(filters),
    ] as const,
  product: (id: string) => [...ticketingKeys.all, "product", id] as const,
  sessions: (filters: Record<string, string | boolean | undefined> = {}) =>
    [...ticketingKeys.all, "sessions", normalizeLooseFilters(filters)] as const,
  resources: (filters: Record<string, string | boolean | undefined> = {}) =>
    [...ticketingKeys.all, "resources", normalizeLooseFilters(filters)] as const,
  stockPeriods: (filters: Record<string, string | undefined> = {}) =>
    [
      ...ticketingKeys.all,
      "stock-periods",
      normalizeLooseFilters(filters),
    ] as const,
  settings: (locationId?: string | null) =>
    [...ticketingKeys.all, "settings", locationId ?? null] as const,
  availability: (filters: Record<string, string | number | undefined> = {}) =>
    [
      ...ticketingKeys.all,
      "availability",
      normalizeLooseFilters(filters),
    ] as const,
};

function qs(params: Record<string, string | boolean | number | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ── Products ─────────────────────────────────────────────── */

export async function listTicketingProducts(
  params: ProductListParams = {}
): Promise<AdmissionProductDto[]> {
  const filters = normalizeTicketingProductListParams(params);
  const raw = await api<MaybeWrapped<{ products?: AdmissionProductDto[] }>>(
    `${BASE}/products${qs({
      type: filters.type === "all" ? undefined : filters.type,
      published:
        filters.published === "all"
          ? "all"
          : filters.published === true
            ? "true"
            : filters.published === false
              ? "false"
              : undefined,
      locationId: filters.locationId,
      categoryId: filters.categoryId,
      includeArchived: filters.includeArchived ? "true" : undefined,
      take: filters.take,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.products) ? data.products : [];
}

export async function getTicketingProduct(
  id: string
): Promise<AdmissionProductDto> {
  const raw = await api<MaybeWrapped<{ product: AdmissionProductDto }>>(
    `${BASE}/products/${encodeURIComponent(id)}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not load product");
  return data.product;
}

export async function createTicketingProduct(payload: {
  type: AdmissionProductType;
  name: string;
  description?: string | null;
  images?: string[];
  locationId: string;
  resourceId?: string | null;
  categoryId?: string | null;
  published?: boolean;
  waiverRequired?: boolean;
  minGuests?: number | null;
  maxGuests?: number | null;
  defaultPassExpiryDays?: number | null;
  taxExemptDefault?: boolean;
  prices?: PriceBandInput[];
}): Promise<AdmissionProductDto> {
  const raw = await api<MaybeWrapped<{ product: AdmissionProductDto }>>(
    `${BASE}/products`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not create product");
  return data.product;
}

export async function patchTicketingProduct(
  id: string,
  payload: Record<string, unknown>
): Promise<AdmissionProductDto> {
  const raw = await api<MaybeWrapped<{ product: AdmissionProductDto }>>(
    `${BASE}/products/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not update product");
  return data.product;
}

export async function archiveTicketingProduct(
  id: string
): Promise<AdmissionProductDto> {
  const raw = await api<MaybeWrapped<{ product: AdmissionProductDto }>>(
    `${BASE}/products/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not archive product");
  return data.product;
}

/* ── Prices / add-ons / expiry ─────────────────────────────── */

export async function listProductPrices(productId: string): Promise<PriceBandDto[]> {
  const raw = await api<MaybeWrapped<{ prices?: PriceBandDto[] }>>(
    `${BASE}/products/${encodeURIComponent(productId)}/prices`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.prices) ? data.prices : [];
}

export async function replaceProductPrices(
  productId: string,
  prices: PriceBandInput[]
): Promise<AdmissionProductDto> {
  const raw = await api<
    MaybeWrapped<{ product: AdmissionProductDto; prices?: PriceBandDto[] }>
  >(`${BASE}/products/${encodeURIComponent(productId)}/prices`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ prices }),
  });
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not save prices");
  return data.product;
}

export async function listProductAddOns(productId: string) {
  const raw = await api<MaybeWrapped<{ addOns?: AdmissionProductDto["addOnLinks"] }>>(
    `${BASE}/products/${encodeURIComponent(productId)}/addons`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.addOns) ? data.addOns : [];
}

export async function linkProductAddOn(
  productId: string,
  payload: {
    addOnProductId: string;
    required?: boolean;
    maxQty?: number | null;
    stockPeriodId?: string | null;
  }
) {
  const raw = await api<MaybeWrapped<{ link?: unknown }>>(
    `${BASE}/products/${encodeURIComponent(productId)}/addons`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  return unwrap(raw);
}

export async function unlinkProductAddOn(
  productId: string,
  addOnProductId: string
) {
  const raw = await api<
    MaybeWrapped<{ parentProductId?: string; addOnProductId?: string }>
  >(
    `${BASE}/products/${encodeURIComponent(productId)}/addons${qs({
      addOnProductId,
    })}`,
    { method: "DELETE", credentials: "include" }
  );
  return unwrap(raw);
}

export async function patchProductExpiry(
  productId: string,
  defaultPassExpiryDays: number | null
): Promise<AdmissionProductDto> {
  const raw = await api<MaybeWrapped<{ product: AdmissionProductDto }>>(
    `${BASE}/products/${encodeURIComponent(productId)}/expiry`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify({ defaultPassExpiryDays }),
    }
  );
  const data = unwrap(raw);
  if (!data?.product) throw new Error("Could not update pass expiry");
  return data.product;
}

/* ── Sessions ──────────────────────────────────────────────── */

export async function listTicketSessions(params: {
  productId?: string;
  from?: string;
  to?: string;
  includeClosed?: boolean;
} = {}): Promise<TicketSessionDto[]> {
  const raw = await api<MaybeWrapped<{ sessions?: TicketSessionDto[] }>>(
    `${BASE}/sessions${qs({
      productId: params.productId,
      from: params.from,
      to: params.to,
      includeClosed: params.includeClosed ? "true" : undefined,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.sessions) ? data.sessions : [];
}

export async function createTicketSession(payload: {
  productId: string;
  resourceId?: string | null;
  label?: string | null;
  startsAt?: string;
  endsAt?: string;
  capacity: number;
  priceOverride?: number | null;
  series?: boolean;
  weekdays?: number[];
  untilDate?: string;
  slots?: Array<{
    startsAt: string;
    endsAt: string;
    label?: string | null;
    capacity?: number;
  }>;
}): Promise<{
  session?: TicketSessionDto;
  sessions?: TicketSessionDto[];
  count?: number;
}> {
  const raw = await api<
    MaybeWrapped<{
      session?: TicketSessionDto;
      sessions?: TicketSessionDto[];
      count?: number;
    }>
  >(`${BASE}/sessions`, {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return unwrap(raw) ?? {};
}

export async function patchTicketSession(
  id: string,
  payload: Record<string, unknown>
): Promise<TicketSessionDto> {
  const raw = await api<MaybeWrapped<{ session: TicketSessionDto }>>(
    `${BASE}/sessions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.session) throw new Error("Could not update session");
  return data.session;
}

export async function closeTicketSession(id: string): Promise<TicketSessionDto> {
  const raw = await api<MaybeWrapped<{ session: TicketSessionDto }>>(
    `${BASE}/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.session) throw new Error("Could not close session");
  return data.session;
}

/* ── Resources ─────────────────────────────────────────────── */

export async function listCapacityResources(params: {
  locationId?: string;
  includeArchived?: boolean;
} = {}): Promise<CapacityResourceDto[]> {
  const raw = await api<MaybeWrapped<{ resources?: CapacityResourceDto[] }>>(
    `${BASE}/resources${qs({
      locationId: params.locationId,
      includeArchived: params.includeArchived ? "true" : undefined,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.resources) ? data.resources : [];
}

export async function createCapacityResource(payload: {
  name: string;
  type: CapacityResourceType;
  locationId: string;
  defaultCapacity: number;
}): Promise<CapacityResourceDto> {
  const raw = await api<MaybeWrapped<{ resource: CapacityResourceDto }>>(
    `${BASE}/resources`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.resource) throw new Error("Could not create resource");
  return data.resource;
}

export async function patchCapacityResource(
  id: string,
  payload: Partial<{
    name: string;
    type: CapacityResourceType;
    defaultCapacity: number;
    archive: boolean;
    unarchive: boolean;
  }>
): Promise<CapacityResourceDto> {
  const raw = await api<MaybeWrapped<{ resource: CapacityResourceDto }>>(
    `${BASE}/resources/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.resource) throw new Error("Could not update resource");
  return data.resource;
}

/* ── Stock periods ─────────────────────────────────────────── */

export async function listStockPeriods(params: {
  locationId?: string;
  productId?: string;
} = {}): Promise<StockPeriodDto[]> {
  const raw = await api<MaybeWrapped<{ stockPeriods?: StockPeriodDto[] }>>(
    `${BASE}/stock-periods${qs({
      locationId: params.locationId,
      productId: params.productId,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.stockPeriods) ? data.stockPeriods : [];
}

export async function createStockPeriod(payload: {
  locationId: string;
  startsAt: string;
  endsAt: string;
  kind: "available" | "blocked";
  quantity?: number | null;
  productIds?: string[];
}): Promise<StockPeriodDto> {
  const raw = await api<MaybeWrapped<{ stockPeriod: StockPeriodDto }>>(
    `${BASE}/stock-periods`,
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.stockPeriod) throw new Error("Could not create stock period");
  return data.stockPeriod;
}

export async function patchStockPeriod(
  id: string,
  payload: {
    startsAt?: string;
    endsAt?: string;
    kind?: "available" | "blocked";
    quantity?: number | null;
    productIds?: string[];
  }
): Promise<StockPeriodDto> {
  const raw = await api<MaybeWrapped<{ stockPeriod: StockPeriodDto }>>(
    `${BASE}/stock-periods/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.stockPeriod) throw new Error("Could not update stock period");
  return data.stockPeriod;
}

export async function deleteStockPeriod(id: string): Promise<{ id: string }> {
  const raw = await api<MaybeWrapped<{ id?: string }>>(
    `${BASE}/stock-periods/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.id) throw new Error("Could not delete stock period");
  return { id: data.id };
}

/* ── Settings / availability ───────────────────────────────── */

export async function getTicketingSettings(
  locationId?: string | null
): Promise<BookingSettingsDto> {
  const raw = await api<MaybeWrapped<{ settings: BookingSettingsDto }>>(
    `${BASE}/settings${qs({
      locationId: locationId || undefined,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not load settings");
  return data.settings;
}

export async function patchTicketingSettings(
  payload: Partial<BookingSettingsDto> & { locationId?: string | null }
): Promise<BookingSettingsDto> {
  const raw = await api<MaybeWrapped<{ settings: BookingSettingsDto }>>(
    `${BASE}/settings`,
    {
      method: "PATCH",
      credentials: "include",
      body: JSON.stringify(payload),
    }
  );
  const data = unwrap(raw);
  if (!data?.settings) throw new Error("Could not save settings");
  return data.settings;
}

export async function getTicketingAvailability(params: {
  productId: string;
  requestedQty?: number;
  from?: string;
  to?: string;
  date?: string;
}): Promise<TicketSessionDto[]> {
  const raw = await api<MaybeWrapped<{ sessions?: TicketSessionDto[] }>>(
    `${BASE}/availability${qs({
      productId: params.productId,
      requestedQty: params.requestedQty,
      from: params.from,
      to: params.to,
      date: params.date,
    })}`,
    { method: "GET", credentials: "include" }
  );
  const data = unwrap(raw);
  return Array.isArray(data?.sessions) ? data.sessions : [];
}
