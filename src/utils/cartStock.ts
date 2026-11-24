import type { CartLine } from "@/store/cartStore";
import { productStockMessage } from "@/lib/productCommerce";

/** Resolve max units allowed for a product cart line (null = unknown / no cap). */
export function getLineStockLimit(
  item: Pick<CartLine, "remainingInStock" | "stockBundles" | "lineType">
): number | null {
  if (item.lineType === "fabric") {
    if (typeof item.stockBundles === "number" && Number.isFinite(item.stockBundles)) {
      return Math.max(0, Math.floor(item.stockBundles));
    }
    return null;
  }
  if (typeof item.remainingInStock === "number" && Number.isFinite(item.remainingInStock)) {
    return Math.max(0, Math.floor(item.remainingInStock));
  }
  return null;
}

export function canSetCartQuantity(
  item: Pick<CartLine, "name" | "remainingInStock" | "stockBundles" | "lineType">,
  desiredQty: number
): { ok: true } | { ok: false; message: string; max: number } {
  const max = getLineStockLimit(item);
  if (max === null) return { ok: true };
  const qty = Math.floor(Number(desiredQty));
  if (qty <= max) return { ok: true };
  if (item.lineType === "fabric") {
    return {
      ok: false,
      max,
      message:
        max <= 0
          ? `"${item.name || "This fabric"}" is out of stock`
          : `Only ${max} bundle(s) available for "${item.name || "this fabric"}"`,
    };
  }
  return {
    ok: false,
    max,
    message: productStockMessage(item.name, max),
  };
}

/** When adding `delta` more units of a product already in cart (or new). */
export function canAddCartQuantity(
  currentQty: number,
  delta: number,
  stock: number | null | undefined,
  productName?: string,
  kind: "product" | "fabric" = "product"
):
  | { ok: true; nextQty: number }
  | { ok: false; message: string; max: number } {
  const nextQty =
    Math.max(0, Math.floor(currentQty)) + Math.max(0, Math.floor(delta));
  if (stock == null || !Number.isFinite(stock)) {
    return { ok: true, nextQty };
  }
  const max = Math.max(0, Math.floor(stock));
  if (nextQty <= max) return { ok: true, nextQty };
  const label =
    productName?.trim() || (kind === "fabric" ? "this fabric" : "this product");
  if (kind === "fabric") {
    return {
      ok: false,
      max,
      message:
        max <= 0
          ? `"${label}" is out of stock`
          : `Only ${max} bundle(s) available for "${label}"`,
    };
  }
  return {
    ok: false,
    max,
    message: productStockMessage(productName, max),
  };
}

/**
 * Ensure a cart line has stock metadata (guest carts often lack it).
 * Fetches the product when needed, writes stock onto the line, and clamps
 * quantity if the line already exceeds inventory.
 */
export async function ensureCartLineStock(
  item: CartLine
): Promise<{
  item: CartLine;
  clamped: boolean;
  message?: string;
  /** false when we could not learn inventory for this product */
  stockKnown: boolean;
}> {
  if (item.lineType === "fabric") {
    return {
      item,
      clamped: false,
      stockKnown: typeof item.stockBundles === "number",
    };
  }

  if (typeof item.remainingInStock === "number" && Number.isFinite(item.remainingInStock)) {
    const max = Math.max(0, Math.floor(item.remainingInStock));
    if (item.quantity > max) {
      const { useCartStore } = await import("@/store/cartStore");
      useCartStore.getState().updateQuantity(item.id, max, "product");
      const refreshed =
        useCartStore.getState().items.find((i) => i.id === item.id) ?? {
          ...item,
          quantity: max,
          remainingInStock: max,
        };
      return {
        item: { ...refreshed, remainingInStock: max },
        clamped: true,
        message: productStockMessage(item.name, max),
        stockKnown: true,
      };
    }
    return { item, clamped: false, stockKnown: true };
  }

  try {
    const { getProductById } = await import("@/services/products");
    const product = await getProductById(item.id);
    const raw =
      typeof product?.remainingInStock === "number"
        ? product.remainingInStock
        : typeof product?.quantity === "number"
          ? Number(product.quantity)
          : null;
    if (raw === null || !Number.isFinite(raw)) {
      return { item, clamped: false, stockKnown: false };
    }
    const max = Math.max(0, Math.floor(raw));
    const { useCartStore } = await import("@/store/cartStore");
    useCartStore.setState((state) => {
      const items = state.items.map((i) =>
        i.id === item.id && (i.lineType ?? "product") !== "fabric"
          ? { ...i, remainingInStock: max }
          : i
      );
      if (state.isGuestCart) {
        try {
          localStorage.setItem("guest_cart", JSON.stringify(items));
        } catch {
          /* ignore quota */
        }
      }
      return { items };
    });

    const withStock =
      useCartStore.getState().items.find((i) => i.id === item.id) ?? {
        ...item,
        remainingInStock: max,
      };

    if (withStock.quantity > max) {
      useCartStore.getState().updateQuantity(item.id, max, "product");
      const clampedItem =
        useCartStore.getState().items.find((i) => i.id === item.id) ?? {
          ...withStock,
          quantity: max,
        };
      return {
        item: { ...clampedItem, remainingInStock: max },
        clamped: true,
        message: productStockMessage(item.name, max),
        stockKnown: true,
      };
    }

    return {
      item: { ...withStock, remainingInStock: max },
      clamped: false,
      stockKnown: true,
    };
  } catch {
    return { item, clamped: false, stockKnown: false };
  }
}
