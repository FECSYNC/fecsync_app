import {
  ProductGender,
  ProductSize,
  type Fabric,
  type Product,
  type ProductCategory,
} from "@prisma/client";
import prisma from "@/lib/prisma";
import { catalogIdWhere, whereOrgAndCatalogId } from "@/lib/catalogWrite";

/** Shared include for admin list/detail and write responses. */
export const PRODUCT_CATALOG_INCLUDE = {
  category: {
    select: {
      id: true,
      legacyId: true,
      legacyStringId: true,
      name: true,
      description: true,
    },
  },
  fabricType: {
    select: {
      id: true,
      legacyId: true,
      name: true,
      type: true,
      color: true,
      pattern: true,
      image: true,
      yardBundle: true,
      bundlePrice: true,
      taxRate: true,
      taxExempt: true,
      inStock: true,
    },
  },
} as const;

export type ProductWithCatalogRelations = Product & {
  category: {
    id: string;
    legacyId: string | null;
    legacyStringId: string | null;
    name: string;
    description: string | null;
  };
  fabricType: {
    id: string;
    legacyId: string | null;
    name: string;
    type: string;
    color: string;
    pattern: string | null;
    image: string;
    yardBundle: number | null;
    bundlePrice: number | null;
    taxRate: number | null;
    taxExempt: boolean;
    inStock: boolean;
  };
};

const GENDER_TO_API: Record<ProductGender, string> = {
  male: "male",
  female: "female",
  non_binary: "non-binary",
  unisex: "unisex",
};

const SIZE_TO_API: Record<ProductSize, string> = {
  small: "small",
  medium: "medium",
  large: "large",
  extra_large: "extra-large",
};

export const GENDER_FROM_API: Record<string, ProductGender> = {
  male: "male",
  female: "female",
  "non-binary": "non_binary",
  unisex: "unisex",
};

export const SIZE_FROM_API: Record<string, ProductSize> = {
  small: "small",
  medium: "medium",
  large: "large",
  "extra-large": "extra_large",
  extra_large: "extra_large",
  // Admin UI used to send clothing labels; map them so edits still save.
  XS: "small",
  S: "small",
  M: "medium",
  L: "large",
  XL: "extra_large",
  XXL: "extra_large",
};

export function genderToApi(gender: ProductGender): string {
  return GENDER_TO_API[gender] ?? gender;
}

export function sizesToApi(sizes: ProductSize[]): string[] {
  return sizes.map((s) => SIZE_TO_API[s] ?? s);
}

export function genderFromApi(value: unknown): ProductGender | null {
  if (typeof value !== "string") return null;
  return GENDER_FROM_API[value.trim()] ?? null;
}

export function sizesFromApi(value: unknown): ProductSize[] {
  if (!Array.isArray(value)) return [];
  const out: ProductSize[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const mapped = SIZE_FROM_API[item.trim()];
    if (mapped) out.push(mapped);
  }
  return out;
}

export function shapeCategoryRef(category: {
  id: string;
  legacyId?: string | null;
  legacyStringId?: string | null;
  name: string;
  description?: string | null;
}) {
  const slug = category.legacyStringId?.trim() || category.id;
  return {
    _id: category.id,
    id: slug,
    name: category.name,
    description: category.description ?? undefined,
  };
}

export function shapeCategoryForApi(category: ProductCategory) {
  const slug = category.legacyStringId?.trim() || category.id;
  return {
    ...category,
    _id: category.id,
    id: slug,
    orgId: category.orgId,
    createdBy: category.createdById,
    updatedBy: category.updatedById,
  };
}

export function shapeFabricRef(
  fabric: {
    id: string;
    legacyId?: string | null;
    name: string;
    type: string;
    color: string;
    pattern?: string | null;
    image?: string;
    yardBundle?: number | null;
    bundlePrice?: number | null;
    taxRate?: number | null;
    taxExempt?: boolean;
    inStock?: boolean;
  },
  mode: "full" | "minimal" = "full"
) {
  if (mode === "minimal") {
    return {
      _id: fabric.id,
      name: fabric.name,
      type: fabric.type,
      color: fabric.color,
    };
  }
  return {
    _id: fabric.id,
    name: fabric.name,
    type: fabric.type,
    color: fabric.color,
    pattern: fabric.pattern ?? undefined,
    image: fabric.image,
    yardBundle: fabric.yardBundle ?? undefined,
    bundlePrice: fabric.bundlePrice ?? undefined,
    taxRate: fabric.taxRate ?? undefined,
    taxExempt: fabric.taxExempt,
    inStock: fabric.inStock,
  };
}

export function shapeFabricForApi(fabric: Fabric) {
  return {
    ...fabric,
    _id: fabric.id,
    orgId: fabric.orgId,
    createdBy: fabric.createdById,
    updatedBy: fabric.updatedById,
  };
}

/** Mongo-compatible product JSON for API responses. */
export function shapeProductForApi(
  row: Product & {
    category?: ProductWithCatalogRelations["category"] | null;
    fabricType?: ProductWithCatalogRelations["fabricType"] | null;
  },
  options?: { fabricRefMode?: "full" | "minimal" }
): Record<string, unknown> {
  const {
    id,
    categoryId,
    fabricTypeId,
    sellerId,
    shopId,
    createdById,
    updatedById,
    gender,
    sizes,
    category,
    fabricType,
    ...rest
  } = row;

  const fabricMode = options?.fabricRefMode ?? "full";

  return {
    ...rest,
    _id: id,
    gender: genderToApi(gender),
    sizes: sizesToApi(sizes),
    category: category
      ? shapeCategoryRef(category)
      : categoryId,
    fabricType: fabricType
      ? shapeFabricRef(fabricType, fabricMode)
      : fabricTypeId,
    seller: sellerId ?? undefined,
    shop: shopId ?? undefined,
    createdBy: createdById ?? undefined,
    updatedBy: updatedById ?? undefined,
  };
}

/** Reload a product with category + fabric populated (for create/update JSON). */
export async function findPopulatedProductById(id: string) {
  const row = await prisma.product.findFirst({
    where: catalogIdWhere(id),
    include: PRODUCT_CATALOG_INCLUDE,
  });
  return row ? shapeProductForApi(row) : null;
}

export async function resolveCategoryInOrg(
  categoryId: string,
  orgId: string
): Promise<{ id: string } | null> {
  return prisma.productCategory.findFirst({
    where: { orgId, ...catalogIdWhere(categoryId) },
    select: { id: true },
  });
}

export async function resolveFabricInOrg(
  fabricId: string,
  orgId: string
): Promise<{ id: string } | null> {
  return prisma.fabric.findFirst({
    where: { orgId, ...catalogIdWhere(fabricId) },
    select: { id: true },
  });
}

export async function findProductInOrg(orgId: string, id: string) {
  return prisma.product.findFirst({
    where: whereOrgAndCatalogId(orgId, id),
  });
}

export async function findCategoryInOrg(orgId: string, id: string) {
  return prisma.productCategory.findFirst({
    where: whereOrgAndCatalogId(orgId, id),
  });
}

export async function findFabricInOrg(orgId: string, id: string) {
  return prisma.fabric.findFirst({
    where: whereOrgAndCatalogId(orgId, id),
  });
}

/** Filter data: URLs from product images (storefront list optimization). */
export function firstRemoteProductImage(images: string[] | null | undefined): string[] {
  if (!Array.isArray(images)) return [];
  const remote = images.filter(
    (img) => typeof img === "string" && img.trim() && !img.startsWith("data:")
  );
  return remote.length > 0 ? [remote[0]] : [];
}
