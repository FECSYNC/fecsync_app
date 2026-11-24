/**
 * Order totals, validation, payment payloads, and inventory on paid orders.
 */

import prisma from "@/lib/prisma";
import { isValidId } from "@/lib/ids";
import {
  calcFabricLineTotal,
  assertFabricStock,
  assertSellableFabric,
} from "@/lib/fabricCommerce";
import { assertProductStock } from "@/lib/productCommerce";
import {
  loadCartDocById,
  migrateCartToLines,
  type CartDoc,
} from "@/lib/cartLines";
import { saveCartDoc as persistCart, saveCartDoc } from "@/lib/cartPersistence";
import {
  getOrCreateTaxSettings,
  toTaxSettingsLike,
} from "@/lib/taxSettings";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import {
  calculateTaxBreakdown,
  type TaxBreakdown,
  type TaxableLineInput,
  parseOptionalTaxRate,
} from "@/utils/tax";
import {
  orgIdForOrder,
  soleLineOrgId,
  storefrontOrgFilter,
} from "@/lib/org";
import { recordInventoryMovement } from "@/lib/accounting/inventory/movements";
import { flushAccountingQueueSoon } from "@/lib/accounting/postingQueue";

export type CartLike = CartDoc;

export function getOrderCartPopulateConfig() {
  return null;
}

export function isMongoObjectId(value: string): boolean {
  return isValidId(value);
}

export async function loadCartForCheckout(
  cartId: string,
  ownerUserId: string
): Promise<CartDoc> {
  if (!isValidId(cartId)) {
    throw new Error("Cart not found");
  }
  const cart = await loadCartDocById(cartId, ownerUserId);
  if (!cart) {
    throw new Error("Cart not found");
  }
  migrateCartToLines(cart);
  return cart;
}

export function getCartLines(cart: CartLike): CartLike["lines"] {
  migrateCartToLines(cart);
  return cart.lines ?? [];
}

export function getCartItemCount(cart: CartLike): number {
  return getCartLines(cart).length;
}

export function assertCartNotEmpty(cart: CartLike): void {
  if (getCartItemCount(cart) === 0) {
    throw new Error("Cart is empty");
  }
}

export function calculateCartTotal(cart: CartLike): number {
  const lines = getCartLines(cart);
  return lines.reduce((sum, line) => sum + calculateLineSubtotal(line), 0);
}

export function calculateLineSubtotal(line: CartLike["lines"][number]): number {
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));

  if (line.lineType === "fabric") {
    const bundlePrice =
      Number(line.bundlePrice) ||
      Number(
        typeof line.fabric === "object" && line.fabric
          ? (line.fabric as { bundlePrice?: number }).bundlePrice
          : 0
      );
    return calcFabricLineTotal(bundlePrice, qty);
  }

  const product =
    typeof line.product === "object" && line.product ? line.product : null;
  const price = Number((product as { price?: number } | null)?.price ?? 0);
  return price * qty;
}

function getLineTaxMeta(
  line: CartLike["lines"][number]
): Pick<TaxableLineInput, "taxExempt" | "taxRate"> {
  if (line.lineType === "fabric") {
    const fabric =
      typeof line.fabric === "object" && line.fabric ? line.fabric : null;
    return {
      taxExempt: Boolean(
        (fabric as { taxExempt?: boolean } | null)?.taxExempt
      ),
      taxRate: parseOptionalTaxRate(
        (fabric as { taxRate?: number | null } | null)?.taxRate
      ),
    };
  }

  const product =
    typeof line.product === "object" && line.product ? line.product : null;
  return {
    taxExempt: Boolean(
      (product as { taxExempt?: boolean } | null)?.taxExempt
    ),
    taxRate: parseOptionalTaxRate(
      (product as { taxRate?: number | null } | null)?.taxRate
    ),
  };
}

export function collectCartLineOrgIds(cart: CartLike): unknown[] {
  const ids: unknown[] = [];
  for (const line of getCartLines(cart)) {
    if (line.lineType === "fabric") {
      const fabric =
        typeof line.fabric === "object" && line.fabric ? line.fabric : null;
      const fabricOrgId = (fabric as { orgId?: string } | null)?.orgId;
      if (fabricOrgId) {
        ids.push(fabricOrgId);
      }
      continue;
    }
    const product =
      typeof line.product === "object" && line.product ? line.product : null;
    const productOrgId = (product as { orgId?: string } | null)?.orgId;
    if (productOrgId) {
      ids.push(productOrgId);
    }
  }
  return ids;
}

export async function resolveOrderOrgId(cart: CartLike) {
  const fromPopulate = soleLineOrgId(collectCartLineOrgIds(cart));
  if (fromPopulate) return fromPopulate;

  const fabricIds = new Set<string>();
  const productIds = new Set<string>();
  for (const line of getCartLines(cart)) {
    if (line.lineType === "fabric") {
      const fabricId =
        typeof line.fabric === "object" && line.fabric
          ? (line.fabric as { id?: string; _id?: string }).id ??
            (line.fabric as { _id?: string })._id
          : line.fabric;
      if (fabricId) fabricIds.add(String(fabricId));
      continue;
    }
    const productId =
      typeof line.product === "object" && line.product
        ? (line.product as { id?: string; _id?: string }).id ??
          (line.product as { _id?: string })._id
        : line.product;
    if (productId) productIds.add(String(productId));
  }

  const [fabrics, products] = await Promise.all([
    fabricIds.size > 0
      ? prisma.fabric.findMany({
          where: { id: { in: [...fabricIds] } },
          select: { orgId: true },
        })
      : Promise.resolve([]),
    productIds.size > 0
      ? prisma.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { orgId: true },
        })
      : Promise.resolve([]),
  ]);

  return orgIdForOrder([
    ...fabrics.map((f) => f.orgId),
    ...products.map((p) => p.orgId),
  ]);
}

export async function calculateOrderTotals(
  cart: CartLike,
  shipping = 0
): Promise<TaxBreakdown> {
  const settings = toTaxSettingsLike(await getOrCreateTaxSettings());
  const taxableLines: TaxableLineInput[] = getCartLines(cart).map((line) => ({
    subtotal: calculateLineSubtotal(line),
    ...getLineTaxMeta(line),
  }));
  const safeShipping = Math.max(0, Number(shipping) || 0);
  return calculateTaxBreakdown(taxableLines, settings, safeShipping);
}

export async function validateCartForOrder(cart: CartLike): Promise<void> {
  assertCartNotEmpty(cart);
  const lines = getCartLines(cart);

  const fabricIds = new Set<string>();
  const productIds = new Set<string>();
  const checks: Array<
    | { kind: "fabric"; id: string; qty: number }
    | { kind: "product"; id: string; qty: number }
  > = [];

  for (const line of lines) {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));

    if (line.lineType === "fabric") {
      const fabricId =
        typeof line.fabric === "object" && line.fabric
          ? (line.fabric as { id?: string; _id?: string }).id ??
            (line.fabric as { _id?: string })._id
          : line.fabric;
      if (!fabricId) {
        throw new Error("Invalid fabric line in cart");
      }
      const id = String(fabricId);
      fabricIds.add(id);
      checks.push({ kind: "fabric", id, qty });
      continue;
    }

    const productId =
      typeof line.product === "object" && line.product
        ? (line.product as { id?: string; _id?: string }).id ??
          (line.product as { _id?: string })._id
        : line.product;
    if (!productId) {
      throw new Error("Invalid product line in cart");
    }
    const id = String(productId);
    productIds.add(id);
    checks.push({ kind: "product", id, qty });
  }

  const orgFilter = await storefrontOrgFilter();
  const [fabrics, products] = await Promise.all([
    fabricIds.size > 0
      ? prisma.fabric.findMany({
          where: { id: { in: [...fabricIds] }, ...orgFilter },
        })
      : Promise.resolve([]),
    productIds.size > 0
      ? prisma.product.findMany({
          where: { id: { in: [...productIds] }, ...orgFilter },
        })
      : Promise.resolve([]),
  ]);

  const fabricMap = new Map(fabrics.map((f) => [f.id, f]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const check of checks) {
    if (check.kind === "fabric") {
      if (!fabricMap.has(check.id)) {
        throw new Error("Fabric not found");
      }
      const fabricRow = fabricMap.get(check.id)!;
      assertFabricStock(fabricRow, check.qty);
      continue;
    }

    const product = productMap.get(check.id);
    if (!product) {
      throw new Error("Product not found");
    }
    assertProductStock(product, check.qty);
  }
}

export type PaymentLineItem =
  | {
      lineType: "fabric";
      fabricId: string;
      name: string;
      yardBundle: number;
      bundlePrice: number;
      quantity: number;
      lineTotal: number;
    }
  | {
      lineType: "product";
      productId: string;
      name: string;
      price: number;
      quantity: number;
      productNote?: string[];
      lineTotal: number;
    };

function refFromLine(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as { _id?: unknown; id?: unknown };
    if (obj._id != null) return String(obj._id);
    if (obj.id != null) return String(obj.id);
  }
  return String(value);
}

export function buildPaymentLineItems(cart: CartLike): PaymentLineItem[] {
  return getCartLines(cart).map((line) => {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const lineTotal = calculateLineSubtotal(line);

    if (line.lineType === "fabric") {
      const fabric =
        typeof line.fabric === "object" && line.fabric ? line.fabric : null;
      const fabricId = refFromLine(fabric ?? line.fabric);
      const yardBundle = Number(
        line.yardBundle ??
          (fabric as { yardBundle?: number } | null)?.yardBundle ??
          0
      );
      const bundlePrice = Number(
        line.bundlePrice ??
          (fabric as { bundlePrice?: number } | null)?.bundlePrice ??
          0
      );
      return {
        lineType: "fabric",
        fabricId,
        name: (fabric as { name?: string } | null)?.name ?? "Fabric",
        yardBundle,
        bundlePrice,
        quantity: qty,
        lineTotal,
      };
    }

    const product =
      typeof line.product === "object" && line.product ? line.product : null;
    return {
      lineType: "product",
      productId: refFromLine(product ?? line.product),
      name: (product as { name?: string } | null)?.name ?? "Product",
      price: Number((product as { price?: number } | null)?.price ?? 0),
      quantity: qty,
      productNote: line.productNote,
      lineTotal,
    };
  });
}

export async function decrementInventoryForCart(
  cart: CartLike,
  opts?: { orderId?: string; orgId?: string | null }
): Promise<void> {
  const lines = getCartLines(cart);
  const orgFilter = await storefrontOrgFilter();
  let flushedOrg: string | null = null;

  for (const line of lines) {
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));

    if (line.lineType === "fabric") {
      const fabricId = refFromLine(line.fabric);
      const fabric = await prisma.fabric.findFirst({
        where: { id: fabricId, ...orgFilter },
      });
      if (!fabric) continue;

      if (typeof fabric.stockBundles === "number") {
        const stockBundles = Math.max(0, fabric.stockBundles - qty);
        await prisma.fabric.update({
          where: { id: fabric.id },
          data: {
            stockBundles,
            inStock: stockBundles > 0,
          },
        });
      }
      continue;
    }

    const productId = refFromLine(line.product);
    const product = await prisma.product.findFirst({
      where: { id: productId, ...orgFilter },
    });
    if (!product) continue;

    if (typeof product.remainingInStock === "number") {
      const orgId = opts?.orgId || product.orgId;
      if (!orgId) continue;
      await recordInventoryMovement(prisma, {
        orgId,
        productRef: { shopProductId: product.id },
        kind: "sale",
        qty: -qty,
        sourceType: "shop_order",
        sourceId: `${opts?.orderId ?? "order"}:product:${product.id}`,
        failIfInsufficient: false,
        enforceNonNegative: true,
      });
      flushedOrg = orgId;
    }
  }
  if (flushedOrg) flushAccountingQueueSoon(flushedOrg);
}

/** Reverse shop product stock when a fulfilled order is cancelled. */
export async function restockInventoryForOrder(opts: {
  orderId: string;
  orgId: string;
  cartId: string;
  userId: string;
}): Promise<void> {
  const cart = await loadCartForCheckout(opts.cartId, opts.userId);
  const lines = getCartLines(cart);
  let flushed = false;
  for (const line of lines) {
    if (line.lineType === "fabric") continue;
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const productId = refFromLine(line.product);
    if (!productId) continue;
    const product = await prisma.product.findFirst({
      where: { id: productId, orgId: opts.orgId },
    });
    if (!product || typeof product.remainingInStock !== "number") continue;
    await recordInventoryMovement(prisma, {
      orgId: opts.orgId,
      productRef: { shopProductId: product.id },
      kind: "sale_return",
      qty,
      sourceType: "shop_order_refund",
      sourceId: `${opts.orderId}:restock:product:${product.id}`,
      reason: "order_cancelled",
    });
    flushed = true;
  }
  if (flushed) flushAccountingQueueSoon(opts.orgId);
}

export async function createFreshCartForUser(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: prismaOwnedByFilter({ sub: String(userId) }),
  });
  if (existing) {
    await prisma.cartLine.deleteMany({ where: { cartId: existing.id } });
    return existing;
  }
  return prisma.cart.create({
    data: { userId: String(userId) },
  });
}

export async function completeOrderFulfillment(
  orderId: string,
  userId: string
): Promise<void> {
  const ownerId = String(userId);

  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      userId: ownerId,
      // Payment may already be shipping/shipped/delivered (auto-book or admin)
      // while inventory claim never ran — still allow one-time fulfill.
      status: { in: ["paid", "shipping", "shipped", "delivered"] },
      fulfilledAt: null,
    },
    data: { fulfilledAt: new Date() },
  });

  if (claimed.count === 0) {
    const existing = await prisma.order.findFirst({
      where: { id: orderId, userId: ownerId },
      select: { status: true, fulfilledAt: true },
    });
    if (!existing) {
      throw new Error("Order not found");
    }
    if (existing.fulfilledAt) {
      return;
    }
    if (
      existing.status !== "paid" &&
      existing.status !== "shipping" &&
      existing.status !== "shipped" &&
      existing.status !== "delivered"
    ) {
      throw new Error("Order is not paid");
    }
    throw new Error("Order fulfillment could not be claimed");
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: ownerId },
    select: { cartId: true, orgId: true },
  });
  if (!order) {
    throw new Error("Order not found");
  }

  try {
    const cart = await loadCartForCheckout(order.cartId, ownerId);
    await validateCartForOrder(cart);
    await decrementInventoryForCart(cart, {
      orderId,
      orgId: order.orgId,
    });
    await createFreshCartForUser(userId);
  } catch (err) {
    await prisma.order.updateMany({
      where: { id: orderId, userId: ownerId },
      data: { fulfilledAt: null },
    });
    throw err;
  }
}

export async function refreshFabricLineSnapshots(cart: CartLike): Promise<void> {
  migrateCartToLines(cart);
  const fabricLines = getCartLines(cart).filter(
    (line) => line.lineType === "fabric"
  );
  if (fabricLines.length === 0) return;

  const fabricIds = [
    ...new Set(fabricLines.map((line) => refFromLine(line.fabric))),
  ].filter(Boolean);

  const orgFilter = await storefrontOrgFilter();
  const fabrics = await prisma.fabric.findMany({
    where: { id: { in: fabricIds }, ...orgFilter },
  });
  const fabricMap = new Map(fabrics.map((f) => [f.id, f]));

  for (const line of fabricLines) {
    const fabricId = refFromLine(line.fabric);
    const fabric = fabricMap.get(fabricId);
    assertSellableFabric(fabric);
    line.bundlePrice = fabric!.bundlePrice;
    line.yardBundle = fabric!.yardBundle;
  }

  await persistCart(cart);
}

// Re-export for routes that called cart.save()
export { saveCartDoc };
