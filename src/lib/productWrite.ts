/**
 * Product write payload. orgId is stamped server-side from the staff actor
 * (Step 5.3) or storefront org for public refs. seller/shop are unused leftovers
 * and must never be taken from the client.
 * Images may arrive as Cloudinary URLs or legacy data: URLs — resolve before save.
 * POST /api/upload* requires uploads:write (Step 4.4).
 */

import { Prisma } from "@prisma/client";
import {
  authErrorToResponse,
  badRequest,
  notFound,
  serverError,
} from "@/lib/response";
import { getStorefrontOrgId } from "@/lib/org";
import { resolveProductImagesForWrite } from "@/lib/resolveCatalogMedia";
import { AUDIT_WRITE_KEYS } from "@/lib/audit/recordAudit";
import { isValidId } from "@/lib/ids";
import {
  genderFromApi,
  resolveCategoryInOrg,
  resolveFabricInOrg,
  sizesFromApi,
} from "@/lib/productPopulate";
import {
  auditCreateToPrisma,
  auditUpdateToPrisma,
} from "@/lib/catalogWrite";
import type { AuditCreateStamp, AuditUpdateStamp } from "@/lib/audit/recordAudit";
import prisma from "@/lib/prisma";
import { insertPublicCategoryPage, retryOnPublicSlugConflict } from "@/lib/publicCategory/pages";

/** Hidden catalog placeholder so products can be created without a fabric UI field. */
const UNSPECIFIED_FABRIC_NAME = "General";
const UNSPECIFIED_CATEGORY_NAME = "General";

function optionalNumber(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalString(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

async function ensureUnspecifiedCategoryId(orgId: string): Promise<string> {
  const byName = await prisma.productCategory.findFirst({
    where: {
      orgId,
      name: { equals: UNSPECIFIED_CATEGORY_NAME, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (byName) return byName.id;

  const any = await prisma.productCategory.findFirst({
    where: { orgId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (any) return any.id;

  const created = await retryOnPublicSlugConflict(() =>
    prisma.$transaction(async (tx) => {
    const row = await tx.productCategory.create({
      data: {
        orgId,
        name: UNSPECIFIED_CATEGORY_NAME,
        description: "Default category",
      },
      select: { id: true },
    });
    await insertPublicCategoryPage(tx, {
      orgId,
      kind: "menu",
      name: UNSPECIFIED_CATEGORY_NAME,
      productCategoryId: row.id,
    });
    return row;
    })
  );
  return created.id;
}

async function ensureUnspecifiedFabricId(orgId: string): Promise<string> {
  const byName = await prisma.fabric.findFirst({
    where: {
      orgId,
      name: { equals: UNSPECIFIED_FABRIC_NAME, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (byName) return byName.id;

  // Prefer any existing fabric so we never block product create on empty fabric UI.
  const any = await prisma.fabric.findFirst({
    where: { orgId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (any) return any.id;

  const created = await prisma.fabric.create({
    data: {
      orgId,
      name: UNSPECIFIED_FABRIC_NAME,
      image: "",
      type: "general",
      color: "n/a",
      inStock: true,
      isSellable: false,
    },
    select: { id: true },
  });
  return created.id;
}

const PRODUCT_WRITE_KEYS = [
  "name",
  "description",
  "price",
  "quantity",
  "remainingInStock",
  "discount",
  "taxRate",
  "taxExempt",
  "location",
  "venueLocationId",
  "images",
  "sizes",
  "gender",
  "category",
  "fabricType",
] as const;

/** seller/shop unused. orgId + audit actors — never from the client. */
const TENANT_KEYS = ["seller", "shop", "orgId", ...AUDIT_WRITE_KEYS] as const;

function requireFiniteNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const err = new Error(`Invalid ${field}: must be a finite number`);
    err.name = "ValidationError";
    throw err;
  }
  return n;
}

export type ProductWriteFields = Partial<
  Record<(typeof PRODUCT_WRITE_KEYS)[number], unknown>
>;

/** 404 unknown/invalid id — same rule as GET/PUT/DELETE /api/product/[id]. */
export function isProductObjectId(id: string | undefined): boolean {
  return typeof id === "string" && isValidId(id);
}

/** Drop seller/shop/orgId/audit so the client cannot choose a tenant or actor. */
export function omitProductTenantKeys<T extends Record<string, unknown>>(
  body: T
): Omit<
  T,
  "seller" | "shop" | "orgId" | (typeof AUDIT_WRITE_KEYS)[number]
> {
  const next = { ...body } as Record<string, unknown>;
  for (const key of TENANT_KEYS) {
    delete next[key];
  }
  return next as Omit<
    T,
    "seller" | "shop" | "orgId" | (typeof AUDIT_WRITE_KEYS)[number]
  >;
}

export function pickProductWriteFields(
  body: Record<string, unknown> | null | undefined
): ProductWriteFields {
  const picked: ProductWriteFields = {};
  if (!body || typeof body !== "object") return picked;
  const sanitized = omitProductTenantKeys(body);
  for (const key of PRODUCT_WRITE_KEYS) {
    if (sanitized[key] !== undefined) {
      picked[key] = sanitized[key];
    }
  }
  return picked;
}

export function hasProductWriteFields(
  fields: ProductWriteFields
): boolean {
  return Object.keys(fields).length > 0;
}

/**
 * Category / fabricType must already belong to the same org as the product write.
 * Prevents cross-tenant refs on create/update (Step 5.1 / 5.3).
 */
export async function assertProductRefsInOrg(
  fields: ProductWriteFields,
  orgId: string
): Promise<string | null> {
  if (fields.category !== undefined) {
    const raw = fields.category;
    if (raw === null || raw === "") {
      // no-op — create path fills a default category
    } else {
      const categoryId = String(raw);
      if (!isProductObjectId(categoryId)) {
        return "Invalid category";
      }
      const category = await resolveCategoryInOrg(categoryId, orgId);
      if (!category) return "Category not found";
    }
  }

  if (fields.fabricType !== undefined) {
    const raw = fields.fabricType;
    if (raw === null || raw === "") {
      return null;
    }
    const fabricId = String(raw);
    if (!isProductObjectId(fabricId)) {
      return "Invalid fabricType";
    }
    const fabric = await resolveFabricInOrg(fabricId, orgId);
    if (!fabric) return "Fabric not found";
  }

  return null;
}

/** @deprecated Prefer assertProductRefsInOrg with actor orgId (Step 5.3). */
export async function assertStorefrontProductRefs(
  fields: ProductWriteFields
): Promise<string | null> {
  return assertProductRefsInOrg(fields, await getStorefrontOrgId());
}

/** Upload any data: images to Cloudinary so list APIs can serve thumbs. */
export async function resolveProductWriteImages(
  fields: ProductWriteFields
): Promise<ProductWriteFields> {
  if (fields.images === undefined) return fields;
  return {
    ...fields,
    images: await resolveProductImagesForWrite(fields.images),
  };
}

/** Map API write fields → Prisma create/update data (resolves ref ids). */
export async function mapProductWriteToPrisma(
  fields: ProductWriteFields,
  orgId: string
): Promise<Prisma.ProductUncheckedCreateInput | Prisma.ProductUncheckedUpdateInput> {
  const data: Prisma.ProductUncheckedUpdateInput = {};

  if (fields.name !== undefined) data.name = String(fields.name);
  if (fields.description !== undefined) data.description = String(fields.description);
  if (fields.location !== undefined) data.location = String(fields.location);
  if (fields.venueLocationId !== undefined) {
    if (
      fields.venueLocationId === null ||
      fields.venueLocationId === ""
    ) {
      data.venueLocationId = null;
    } else if (
      typeof fields.venueLocationId === "string" &&
      isValidId(fields.venueLocationId)
    ) {
      data.venueLocationId = fields.venueLocationId;
    }
  }
  if (fields.price !== undefined) data.price = requireFiniteNumber(fields.price, "price");
  if (fields.quantity !== undefined) {
    data.quantity = requireFiniteNumber(fields.quantity, "quantity");
  }
  if (fields.remainingInStock !== undefined) {
    data.remainingInStock = requireFiniteNumber(
      fields.remainingInStock,
      "remainingInStock"
    );
  }
  if (fields.discount !== undefined) {
    data.discount = requireFiniteNumber(fields.discount, "discount");
  }
  if (fields.taxRate !== undefined) {
    data.taxRate =
      fields.taxRate === null || fields.taxRate === ""
        ? null
        : requireFiniteNumber(fields.taxRate, "taxRate");
  }
  if (fields.taxExempt !== undefined) data.taxExempt = Boolean(fields.taxExempt);
  if (fields.images !== undefined) {
    data.images = Array.isArray(fields.images)
      ? fields.images.map(String)
      : [];
  }
  if (fields.gender !== undefined) {
    const gender = genderFromApi(fields.gender);
    if (gender) data.gender = gender;
  }
  if (fields.sizes !== undefined) {
    data.sizes = sizesFromApi(fields.sizes);
  }
  if (fields.category !== undefined) {
    const raw = fields.category;
    if (raw !== null && raw !== "") {
      const cat = await resolveCategoryInOrg(String(raw), orgId);
      if (cat) data.categoryId = cat.id;
    }
  }
  if (fields.fabricType !== undefined) {
    const raw = fields.fabricType;
    // Empty fabric is allowed (UI no longer collects it) — leave unchanged on update.
    if (raw === null || raw === "") {
      // no-op
    } else {
      const fabric = await resolveFabricInOrg(String(raw), orgId);
      if (fabric) data.fabricTypeId = fabric.id;
    }
  }

  return data;
}

export async function buildProductCreateData(
  orgId: string,
  fields: ProductWriteFields,
  audit: AuditCreateStamp,
  sellerId?: string
): Promise<Prisma.ProductUncheckedCreateInput> {
  const mapped = (await mapProductWriteToPrisma(fields, orgId)) as Prisma.ProductUncheckedCreateInput;
  let fabricTypeId =
    mapped.fabricTypeId != null && String(mapped.fabricTypeId).trim()
      ? String(mapped.fabricTypeId)
      : "";
  if (!fabricTypeId) {
    fabricTypeId = await ensureUnspecifiedFabricId(orgId);
  }
  let categoryId =
    mapped.categoryId != null && String(mapped.categoryId).trim()
      ? String(mapped.categoryId)
      : "";
  if (!categoryId) {
    categoryId = await ensureUnspecifiedCategoryId(orgId);
  }
  const name = optionalString(mapped.name ?? fields.name, "Untitled item");
  return {
    orgId,
    name,
    description: optionalString(mapped.description ?? fields.description, ""),
    location: optionalString(mapped.location ?? fields.location, ""),
    price: optionalNumber(mapped.price ?? fields.price, 0),
    quantity: optionalNumber(mapped.quantity ?? fields.quantity, 0),
    remainingInStock: optionalNumber(
      mapped.remainingInStock ?? fields.remainingInStock,
      0
    ),
    discount: optionalNumber(mapped.discount ?? fields.discount, 0),
    taxRate:
      mapped.taxRate !== undefined
        ? mapped.taxRate
        : fields.taxRate == null || fields.taxRate === ""
          ? null
          : optionalNumber(fields.taxRate, 0),
    taxExempt: Boolean(mapped.taxExempt ?? fields.taxExempt),
    images: mapped.images ?? [],
    sizes: mapped.sizes ?? sizesFromApi(fields.sizes),
    gender: mapped.gender ?? genderFromApi(fields.gender) ?? "unisex",
    categoryId,
    fabricTypeId,
    sellerId: sellerId ?? null,
    venueLocationId:
      mapped.venueLocationId !== undefined
        ? (mapped.venueLocationId as string | null)
        : null,
    ...auditCreateToPrisma(audit),
  };
}

export async function buildProductUpdateData(
  fields: ProductWriteFields,
  orgId: string,
  audit?: AuditUpdateStamp
): Promise<Prisma.ProductUncheckedUpdateInput> {
  const data = await mapProductWriteToPrisma(fields, orgId);
  if (audit) {
    Object.assign(data, auditUpdateToPrisma(audit));
  }
  return data;
}

/** Opening / adjustment stock via inventory movements (keeps on-hand + ledger together). */
export async function applyShopProductStockFromWrite(opts: {
  orgId: string;
  productId: string;
  previousStock: number | null | undefined;
  nextStock: number | null | undefined;
  actorId?: string | null;
  isCreate?: boolean;
}): Promise<void> {
  if (opts.nextStock == null || !Number.isFinite(opts.nextStock)) return;
  const prev = opts.previousStock == null ? 0 : Number(opts.previousStock);
  const next = Math.max(0, Math.floor(Number(opts.nextStock)));
  if (!opts.isCreate && prev === next) return;
  const { recordInventoryMovementNow } = await import(
    "@/lib/accounting/inventory/movements"
  );
  if (opts.isCreate) {
    if (next <= 0) return;
    await recordInventoryMovementNow({
      orgId: opts.orgId,
      productRef: { shopProductId: opts.productId },
      kind: "opening",
      qty: next,
      absoluteQty: next,
      sourceType: "opening_balance",
      sourceId: `shop_product:${opts.productId}:create`,
      actorId: opts.actorId ?? null,
    });
    return;
  }
  const delta = next - prev;
  if (delta === 0) return;
  await recordInventoryMovementNow({
    orgId: opts.orgId,
    productRef: { shopProductId: opts.productId },
    kind: delta > 0 ? "adjustment_in" : "adjustment_out",
    qty: delta,
    absoluteQty: next,
    sourceType: "inventory_movement",
    sourceId: `shop_product:${opts.productId}:adj:${Date.now()}`,
    actorId: opts.actorId ?? null,
  });
}

/** Validation/cast → 400; auth → 401/403; else 500. */
export function productWriteErrorResponse(error: unknown) {
  const authRes = authErrorToResponse(error);
  if (authRes) return authRes;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return badRequest("Product already exists");
    }
    if (error.code === "P2025") {
      return notFound("Product not found");
    }
    if (error.code === "P2003") {
      return badRequest("Invalid category or fabric reference");
    }
  }
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (name === "ValidationError" || name === "CastError") {
    return badRequest("Invalid product data: " + (error as Error).message);
  }
  return serverError(
    error instanceof Error ? error.message : "Failed to save product"
  );
}
