import { api, unwrap, type MaybeWrapped } from "@/utils/api";

/** ---------- Types ---------- */
export type YardBundle = 4 | 6;

export type Fabric = {
  _id: string;                 // Mongo ObjectId (use this in URL path)
  name: string;
  image?: string;
  type?: string;
  color?: string;
  pattern?: string;
  weight?: number;             // gsm
  width?: number;              // cm
  composition?: string;
  supplier?: string;
  /** @deprecated Use bundlePrice + yardBundle */
  pricePerMeter?: number;
  inStock?: boolean;
  yardBundle?: YardBundle;
  bundlePrice?: number;
  stockBundles?: number;
  isSellable?: boolean;
  taxRate?: number | null;
  taxExempt?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdByName?: string;
  updatedByName?: string;
  /** Live count of products using this fabric (staff lists/detail). */
  productCount?: number;
};

export type CreateFabricInput = {
  name: string;
  image?: string;
  type?: string;
  color?: string;
  pattern?: string;
  weight?: number;
  width?: number;
  composition?: string;
  supplier?: string;
  pricePerMeter?: number;
  inStock?: boolean;
  yardBundle?: YardBundle;
  bundlePrice?: number;
  stockBundles?: number;
  isSellable?: boolean;
  taxRate?: number | null;
  taxExempt?: boolean;
};

export type UpdateFabricInput = Partial<CreateFabricInput> & {
  // Name can be optional in updates; include only the fields you want to change
};

/** ---------- Endpoints ---------- */
// Your examples use {{host}}fabric and {{host}}fabric/{{fabricId}}.
// To be consistent with your category service, we’ll prefix with /api here.
// If your backend truly does not use /api, simply change BASE to "/fabric".
const BASE = "/api/fabric";
const paths = {
  add: BASE,                                 // POST   /api/fabric
  update: (_id: string) => `${BASE}/${_id}`, // PUT    /api/fabric/:fabricId
  delete: (_id: string) => `${BASE}/${_id}`, // DELETE /api/fabric/:fabricId
  list: BASE,                                // GET    /api/fabric
  byId: (_id: string) => `${BASE}/${_id}`,   // GET    /api/fabric/:fabricId
};

/** ---------- Helpers ---------- */
const toQS = (params?: Record<string, string | number | boolean | undefined>) =>
  params
    ? `?${new URLSearchParams(
        Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
          if (v !== undefined && v !== null) acc[k] = String(v);
          return acc;
        }, {})
      )}`
    : "";

// remove undefined keys so we only send what’s present
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/** Never send unused seller/shop (not a tenant key). API also strips them. */
function withoutSellerShop<T extends object>(payload: T): T {
  const { seller, shop, ...rest } = payload as T & {
    seller?: unknown;
    shop?: unknown;
  };
  void seller;
  void shop;
  return rest as T;
}

function omitTenantQuery(
  params?: Record<string, string | number | boolean | undefined>
) {
  if (!params) return params;
  const { seller, shop, ...rest } = params;
  void seller;
  void shop;
  return rest;
}

/** ---------- CRUD Operations ---------- */

// Create fabric (requires `name`)
export async function createFabric(payload: CreateFabricInput) {
  if (!payload?.name || !payload.name.trim()) {
    throw new Error("createFabric: `name` is required and cannot be empty.");
  }

  const body = compact({
    name: payload.name.trim(),
    image: payload.image,
    type: payload.type,
    color: payload.color,
    pattern: payload.pattern,
    weight: payload.weight,
    width: payload.width,
    composition: payload.composition,
    supplier: payload.supplier,
    pricePerMeter: payload.pricePerMeter,
    inStock: payload.inStock,
    yardBundle: payload.yardBundle,
    bundlePrice: payload.bundlePrice,
    stockBundles: payload.stockBundles,
    isSellable: payload.isSellable,
    taxRate: payload.taxRate,
    taxExempt: payload.taxExempt,
  });

  console.log('Sending JSON payload:', body);

  const raw = await api<MaybeWrapped<Fabric>>(paths.add, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withoutSellerShop(body)),
    credentials: "include",
  });
  return unwrap<Fabric>(raw);
}

// Update fabric by _id
export async function updateFabric(_id: string, payload: UpdateFabricInput) {
  if (!_id || !_id.trim()) {
    throw new Error("updateFabric: `_id` (ObjectId) is required in the URL path.");
  }
  const body = compact({
    name: payload.name?.trim(),
    image: payload.image,
    type: payload.type,
    color: payload.color,
    pattern: payload.pattern,
    weight: payload.weight,
    width: payload.width,
    composition: payload.composition,
    supplier: payload.supplier,
    pricePerMeter: payload.pricePerMeter,
    inStock: payload.inStock,
    yardBundle: payload.yardBundle,
    bundlePrice: payload.bundlePrice,
    stockBundles: payload.stockBundles,
    isSellable: payload.isSellable,
    taxRate: payload.taxRate,
    taxExempt: payload.taxExempt,
  });

  const raw = await api<MaybeWrapped<Fabric>>(paths.update(_id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withoutSellerShop(body)),
    credentials: "include",
  });
  return unwrap<Fabric>(raw);
}

// Delete fabric by _id
export async function deleteFabric(_id: string) {
  if (!_id || !_id.trim()) {
    throw new Error("deleteFabric: `_id` (ObjectId) is required in the URL path.");
  }
  const raw = await api<MaybeWrapped<{ deleted: boolean }>>(paths.delete(_id), {
    method: "DELETE",
    credentials: "include",
  });
  return unwrap<{ deleted: boolean }>(raw);
}

// Get all fabrics
export async function getFabrics(params?: Record<string, string | number | boolean | undefined>) {
  const raw = await api<MaybeWrapped<Fabric[] | { items: Fabric[] }>>(
    `${paths.list}${toQS(omitTenantQuery(params))}`,
    { credentials: "include" }
  );
  const data = unwrap<Fabric[] | { items: Fabric[] }>(raw);
  return Array.isArray(data) ? data : data?.items ?? [];
}

/** Admin list — Membership org (Step 5.3). */
export async function getAdminFabrics(
  params?: Record<string, string | number | boolean | undefined>
) {
  const cleaned: Record<string, string | number | boolean> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      if (key === "scope") continue;
      cleaned[key] = value;
    }
  }
  cleaned.scope = "staff";
  return getFabrics(cleaned);
}

// Get one fabric by _id (storefront org)
export async function getFabricById(_id: string) {
  if (!_id || !_id.trim()) {
    throw new Error("getFabricById: `_id` (ObjectId) is required.");
  }
  const raw = await api<MaybeWrapped<Fabric>>(paths.byId(_id), {
    credentials: "include",
  });
  const data = unwrap<Fabric>(raw);
  return data ?? null;
}

/** Admin detail — Membership org (Step 5.3). */
export async function getAdminFabricById(_id: string) {
  if (!_id || !_id.trim()) {
    throw new Error("getAdminFabricById: `_id` (ObjectId) is required.");
  }
  const raw = await api<MaybeWrapped<Fabric>>(
    `${paths.byId(_id)}${toQS({ scope: "staff" })}`,
    { credentials: "include" }
  );
  const data = unwrap<Fabric>(raw);
  return data ?? null;
}
