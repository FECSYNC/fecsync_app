/**
 * Polymorphic cart lines: products (RTW) and fabric yard bundles.
 */

import prisma from "@/lib/prisma";
import { assertFabricStock } from "@/lib/fabricCommerce";
import { assertProductStock } from "@/lib/productCommerce";
import { storefrontOrgFilter } from "@/lib/org";
import {
  type CartDoc,
  legacyProductsFromLines,
  prismaCartToDoc,
  type SerializedCartLine,
} from "@/lib/commerceSerialize";

export const CART_LINE_TYPES = ["product", "fabric"] as const;
export type CartLineType = (typeof CART_LINE_TYPES)[number];

export type ProductCartLineInput = {
  lineType?: "product";
  product: string;
  quantity: number;
  productNote?: string[];
};

export type FabricCartLineInput = {
  lineType: "fabric";
  fabric: string;
  quantity: number;
};

export type CartLineInput = ProductCartLineInput | FabricCartLineInput;

export function isFabricLineInput(
  item: CartLineInput
): item is FabricCartLineInput {
  if (item.lineType === "fabric") return true;
  if (item.lineType === "product") return false;
  return "fabric" in item && Boolean((item as unknown as FabricCartLineInput).fabric);
}

export function normalizeCartLineInput(item: CartLineInput): CartLineInput {
  if (item.lineType === "fabric" || ("fabric" in item && item.fabric)) {
    return {
      lineType: "fabric",
      fabric: (item as FabricCartLineInput).fabric,
      quantity: (item as FabricCartLineInput).quantity,
    };
  }
  const productItem = item as ProductCartLineInput;
  return {
    lineType: "product",
    product: productItem.product,
    quantity: productItem.quantity,
    productNote: productItem.productNote,
  };
}

/** No-op — Postgres carts only use `lines`; kept for call-site compatibility. */
export function migrateCartToLines(_cart: CartDoc): void {}

/** Keep deprecated `products[]` in sync for older clients (product lines only). */
export function syncLegacyProductsField(cart: CartDoc): void {
  if (!cart) return;
  cart.products = legacyProductsFromLines(cart.lines ?? []);
}

export async function addProductLineToCart(
  cart: CartDoc,
  item: ProductCartLineInput
): Promise<void> {
  if (!item.product) return;

  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const orgFilter = await storefrontOrgFilter();
  const product = await prisma.product.findFirst({
    where: { id: item.product, ...orgFilter },
  });
  if (!product) {
    throw new Error("Product not found");
  }

  const lines = cart.lines ?? [];
  cart.lines = lines;

  const existing = lines.find(
    (l) =>
      l.lineType === "product" && refId(l.product) === String(item.product)
  );

  const nextQty = existing
    ? Number(existing.quantity || 0) + quantity
    : quantity;
  assertProductStock(product, nextQty);

  if (existing) {
    existing.quantity = nextQty;
    if (item.productNote) {
      existing.productNote = item.productNote;
    }
  } else {
    lines.push({
      _id: `tmp-product-${item.product}`,
      lineType: "product",
      product: item.product,
      quantity,
      productNote: item.productNote ?? [],
    });
  }

  syncLegacyProductsField(cart);
}

export async function addFabricLineToCart(
  cart: CartDoc,
  item: FabricCartLineInput
): Promise<void> {
  if (!item.fabric) {
    throw new Error("Fabric id is required");
  }

  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const orgFilter = await storefrontOrgFilter();
  const fabric = await prisma.fabric.findFirst({
    where: { id: item.fabric, ...orgFilter },
  });
  if (!fabric) {
    throw new Error("Fabric not found");
  }
  assertFabricStock(fabric, quantity);

  const lines = cart.lines ?? [];
  cart.lines = lines;

  const existing = lines.find(
    (l) =>
      l.lineType === "fabric" && refId(l.fabric) === String(item.fabric)
  );

  const snapshot = {
    bundlePrice: fabric.bundlePrice,
    yardBundle: fabric.yardBundle,
  };

  if (existing) {
    const newQty = Number(existing.quantity || 0) + quantity;
    assertFabricStock(fabric, newQty);
    existing.quantity = newQty;
    existing.bundlePrice = snapshot.bundlePrice;
    existing.yardBundle = snapshot.yardBundle;
  } else {
    lines.push({
      _id: `tmp-fabric-${item.fabric}`,
      lineType: "fabric",
      fabric: item.fabric,
      quantity,
      bundlePrice: snapshot.bundlePrice,
      yardBundle: snapshot.yardBundle,
    });
  }

  syncLegacyProductsField(cart);
}

export async function applyCartLineInputs(
  cart: CartDoc,
  items: CartLineInput[]
): Promise<void> {
  for (const raw of items) {
    const item = normalizeCartLineInput(raw);
    if (isFabricLineInput(item)) {
      await addFabricLineToCart(cart, item);
    } else {
      await addProductLineToCart(cart, item as ProductCartLineInput);
    }
  }
}

/**
 * Validate absolute quantities on a cart (after replace/PUT).
 * Product stock is product-level (all sizes share remainingInStock).
 */
export async function assertCartDocStock(cart: CartDoc): Promise<void> {
  const lines = cart.lines ?? [];
  if (lines.length === 0) return;

  const productQty = new Map<string, number>();
  const fabricQty = new Map<string, number>();

  for (const line of lines) {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    if (line.lineType === "fabric") {
      const id = refId(line.fabric);
      if (!id) continue;
      fabricQty.set(id, (fabricQty.get(id) || 0) + qty);
    } else {
      const id = refId(line.product);
      if (!id) continue;
      productQty.set(id, (productQty.get(id) || 0) + qty);
    }
  }

  const orgFilter = await storefrontOrgFilter();
  const [products, fabrics] = await Promise.all([
    productQty.size > 0
      ? prisma.product.findMany({
          where: { id: { in: [...productQty.keys()] }, ...orgFilter },
          select: { id: true, name: true, remainingInStock: true, quantity: true },
        })
      : Promise.resolve([]),
    fabricQty.size > 0
      ? prisma.fabric.findMany({
          where: { id: { in: [...fabricQty.keys()] }, ...orgFilter },
        })
      : Promise.resolve([]),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const fabricMap = new Map(fabrics.map((f) => [f.id, f]));

  for (const [id, qty] of productQty) {
    const product = productMap.get(id);
    if (!product) throw new Error("Product not found");
    assertProductStock(product, qty);
  }
  for (const [id, qty] of fabricQty) {
    const fabric = fabricMap.get(id);
    if (!fabric) throw new Error("Fabric not found");
    assertFabricStock(fabric, qty);
  }
}

function refId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as { _id?: unknown; id?: unknown };
    if (obj._id != null) return String(obj._id);
    if (obj.id != null) return String(obj.id);
  }
  return String(value);
}

export function removeProductLine(cart: CartDoc, productId: string): void {
  const target = String(productId);
  cart.lines = (cart.lines ?? []).filter(
    (l) => !(l.lineType === "product" && refId(l.product) === target)
  );
  syncLegacyProductsField(cart);
}

export function removeFabricLine(cart: CartDoc, fabricId: string): void {
  const target = String(fabricId);
  cart.lines = (cart.lines ?? []).filter(
    (l) => !(l.lineType === "fabric" && refId(l.fabric) === target)
  );
  syncLegacyProductsField(cart);
}

export function clearAllCartLines(cart: CartDoc): void {
  cart.lines = [];
  cart.products = [];
}

/** Load cart with populated catalog refs as a mutable CartDoc. */
export async function loadCartDocById(
  cartId: string,
  userId?: string
): Promise<CartDoc | null> {
  const row = await prisma.cart.findFirst({
    where: {
      id: cartId,
      ...(userId ? { userId } : {}),
    },
    include: {
      lines: {
        include: {
          product: { select: { id: true, name: true, price: true, images: true, description: true, orgId: true, taxRate: true, taxExempt: true, remainingInStock: true } },
          fabric: { select: { id: true, name: true, image: true, bundlePrice: true, yardBundle: true, color: true, type: true, orgId: true, taxRate: true, taxExempt: true, stockBundles: true, inStock: true, isSellable: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!row) return null;
  return prismaCartToDoc(row);
}

export type { CartDoc, SerializedCartLine };
