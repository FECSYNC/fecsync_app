/**
 * Product (RTW) stock checks for cart and checkout.
 * Stock is tracked at product level (remainingInStock), not per size.
 */

export type ProductStockLike = {
  name?: string | null;
  remainingInStock?: number | null;
  quantity?: number | null;
};

/** Effective units available for sale. */
export function getProductStock(product: ProductStockLike | null | undefined): number | null {
  if (!product) return null;
  if (typeof product.remainingInStock === "number" && Number.isFinite(product.remainingInStock)) {
    return Math.max(0, Math.floor(product.remainingInStock));
  }
  if (typeof product.quantity === "number" && Number.isFinite(product.quantity)) {
    return Math.max(0, Math.floor(product.quantity));
  }
  return null;
}

export function assertProductStock(
  product: ProductStockLike | null | undefined,
  requestedQty: number
): void {
  if (!product) {
    throw new Error("Product not found");
  }
  const qty = Math.floor(Number(requestedQty));
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("Quantity must be a positive integer");
  }
  const stock = getProductStock(product);
  if (stock === null) return;
  const label = product.name?.trim() || "this product";
  if (stock <= 0) {
    throw new Error(`"${label}" is out of stock`);
  }
  if (qty > stock) {
    throw new Error(
      stock === 1
        ? `Only 1 unit available for "${label}"`
        : `Only ${stock} units available for "${label}"`
    );
  }
}

export function productStockMessage(
  productName: string | undefined,
  stock: number
): string {
  const label = productName?.trim() || "this product";
  if (stock <= 0) return `"${label}" is out of stock`;
  if (stock === 1) return `Only 1 unit left for "${label}"`;
  return `Only ${stock} units available for "${label}"`;
}
