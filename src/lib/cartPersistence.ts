import prisma from "@/lib/prisma";
import type { CartLineType } from "@prisma/client";
import { prismaOwnedByFilter } from "@/lib/commerceSerialize";
import {
  applyCartLineInputs,
  loadCartDocById,
  syncLegacyProductsField,
  type CartDoc,
  type CartLineInput,
} from "@/lib/cartLines";
import { isTransientDbError } from "@/lib/commerceSerialize";

const MAX_CART_RETRIES = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isVersionError(_error: unknown): boolean {
  return false;
}

export function isTransientMongoError(error: unknown): boolean {
  return isTransientDbError(error);
}

export function isRetryableCartError(error: unknown): boolean {
  return isTransientDbError(error);
}

function lineRefId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as { _id?: unknown; id?: unknown };
    if (obj._id != null) return String(obj._id);
    if (obj.id != null) return String(obj.id);
  }
  return String(value);
}

/** Persist in-memory cart lines to Postgres. */
export async function saveCartDoc(cart: CartDoc): Promise<CartDoc> {
  syncLegacyProductsField(cart);

  await prisma.$transaction(async (tx) => {
    await tx.cartLine.deleteMany({ where: { cartId: cart.id } });

    const lineData = (cart.lines ?? []).map((line) => {
      const lineType = line.lineType as CartLineType;
      return {
        cartId: cart.id,
        lineType,
        productId:
          lineType === "product" ? lineRefId(line.product) : null,
        fabricId: lineType === "fabric" ? lineRefId(line.fabric) : null,
        quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
        productNote: line.productNote ?? [],
        bundlePrice: line.bundlePrice ?? null,
        yardBundle: line.yardBundle ?? null,
      };
    });

    if (lineData.length > 0) {
      await tx.cartLine.createMany({ data: lineData });
    }

    await tx.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
  });

  const reloaded = await loadCartDocById(cart.id, cart.userId);
  return reloaded ?? cart;
}

/** Best-effort legacy field sync — never blocks cart reads. */
export async function persistLegacyCartSync(cart: CartDoc | null): Promise<void> {
  if (!cart) return;
  syncLegacyProductsField(cart);
}

/** Apply line inputs with reload + retry to survive concurrent add-to-cart requests. */
export async function addLinesToUserCart(
  userId: string,
  inputs: CartLineInput[]
): Promise<{ cart: CartDoc; created: boolean }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_CART_RETRIES; attempt++) {
    try {
      let row = await prisma.cart.findFirst({
        where: prismaOwnedByFilter({ sub: userId }),
        orderBy: { createdAt: "desc" },
        include: {
          lines: {
            include: {
              product: true,
              fabric: true,
            },
          },
        },
      });
      let created = false;

      if (!row) {
        row = await prisma.cart.create({
          data: { userId },
          include: {
            lines: {
              include: { product: true, fabric: true },
            },
          },
        });
        created = true;
      }

      const cart = (await loadCartDocById(row.id, userId))!;
      await applyCartLineInputs(cart, inputs);
      const saved = await saveCartDoc(cart);
      return { cart: saved, created };
    } catch (error) {
      lastError = error;
      if (!isRetryableCartError(error) || attempt === MAX_CART_RETRIES - 1) {
        throw error;
      }
      await sleep(60 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Failed to update cart");
}
