import { useShallow } from "zustand/react/shallow";
import { useCartStore, generateProductNote } from "@/store/cartStore";
import { useCartDrawerStore } from "@/store/cartDrawerStore";
import { useAuthStore } from "@/store/authStore";
import {
  useAddToCartMutation,
  useAddFabricToCartMutation,
  useUpdateCartQuantityMutation,
} from "@/hooks/useCart";
import { canAddCartQuantity } from "@/utils/cartStock";
import { getProductStock } from "@/lib/productCommerce";

export const useCartOpen = () => useCartDrawerStore((s) => s.isOpen);

export const useCartActions = () =>
  useCartDrawerStore(
    useShallow((s) => ({
      openCart: s.openCart,
      closeCart: s.closeCart,
      toggleCart: s.toggleCart,
      openCartAndFetch: s.openCartAndFetch,
      openCartForGuest: s.openCartForGuest,
    }))
  );

/** Live stock for guests + logged-in users (hint first, then API). */
async function resolveProductStock(
  productId: string,
  hinted?: number | null
): Promise<number | null> {
  if (typeof hinted === "number" && Number.isFinite(hinted)) {
    return Math.max(0, Math.floor(hinted));
  }
  try {
    const { getProductById } = await import("@/services/products");
    const product = await getProductById(productId);
    return getProductStock(product);
  } catch {
    return null;
  }
}

/**
 * Auth-aware cart actions.
 * Stock caps apply the same for guests (localStorage) and signed-in users (server).
 */
export const useAuthAwareCartActions = () => {
  const { isAuthenticated } = useAuthStore();
  const {
    addItem: addItemLocal,
    updateQuantity: updateQuantityLocal,
    removeItem: removeItemLocal,
    clearCart,
  } = useCartStore();

  const addToCartMutation = useAddToCartMutation();
  const addFabricToCartMutation = useAddFabricToCartMutation();
  const updateCartMutation = useUpdateCartQuantityMutation();
  const cartId = useCartStore((s) => s.cartId);
  const updateSizeQuantityLocal = useCartStore((s) => s.updateSizeQuantity);

  const addToCart = async (item: {
    id: string;
    quantity?: number;
    price?: number;
    name?: string;
    image?: string;
    size?: string;
    availableSizes?: string[];
    remainingInStock?: number;
    taxRate?: number | null;
    taxExempt?: boolean;
  }) => {
    const currentItems = useCartStore.getState().items;
    const currentItem = currentItems.find((i) => i.id === item.id);
    const qtyToAdd = item.quantity ?? 1;

    const stock = await resolveProductStock(
      item.id,
      typeof item.remainingInStock === "number"
        ? item.remainingInStock
        : typeof currentItem?.remainingInStock === "number"
          ? currentItem.remainingInStock
          : null
    );

    if (stock === null) {
      throw new Error(
        "Couldn't verify stock for this product. Please try again."
      );
    }

    const stockCheck = canAddCartQuantity(
      currentItem?.quantity ?? 0,
      qtyToAdd,
      stock,
      item.name || currentItem?.name
    );
    if (!stockCheck.ok) {
      throw new Error(stockCheck.message);
    }

    let nextBreakdown: Record<string, number> = {};
    if (currentItem?.sizeBreakdown) {
      nextBreakdown = { ...currentItem.sizeBreakdown };
    }
    const sizeToAdd = item.size || "default";
    nextBreakdown[sizeToAdd] = (nextBreakdown[sizeToAdd] || 0) + qtyToAdd;
    const finalProductNote = generateProductNote(nextBreakdown);

    addItemLocal({
      ...item,
      remainingInStock: stock,
      sizeBreakdown: nextBreakdown,
      productNote: finalProductNote,
    });

    if (isAuthenticated) {
      try {
        const updatedCart = await addToCartMutation.mutateAsync({
          productId: item.id,
          quantity: qtyToAdd,
          price: item.price,
          productNote: finalProductNote,
        });

        if (updatedCart) {
          const nextCartId =
            (updatedCart as { _id?: string; id?: string })._id ||
            (updatedCart as { id?: string }).id;
          if (nextCartId) {
            useCartStore.setState({
              cartId: nextCartId,
              isGuestCart: false,
            });
          }
        }
      } catch (error) {
        if (currentItem) {
          useCartStore.setState({
            items: useCartStore
              .getState()
              .items.map((i) => (i.id === item.id ? { ...currentItem } : i)),
          });
        } else {
          removeItemLocal(item.id, "product");
        }
        throw error;
      }
    }
  };

  const updateProductSizeQty = async (
    productId: string,
    size: string,
    qty: number
  ) => {
    const before = useCartStore.getState().items.find((i) => i.id === productId);
    const nextBreakdown = { ...(before?.sizeBreakdown || {}) };
    if (qty <= 0) delete nextBreakdown[size];
    else nextBreakdown[size] = qty;
    const nextTotal = Object.values(nextBreakdown).reduce(
      (sum, n) => sum + Math.max(0, Number(n) || 0),
      0
    );

    const stock = await resolveProductStock(
      productId,
      typeof before?.remainingInStock === "number"
        ? before.remainingInStock
        : null
    );

    if (nextTotal > 0) {
      if (stock === null) {
        throw new Error(
          "Couldn't verify stock for this product. Please try again."
        );
      }
      const stockCheck = canAddCartQuantity(0, nextTotal, stock, before?.name);
      if (!stockCheck.ok) {
        throw new Error(stockCheck.message);
      }
    }

    if (typeof stock === "number") {
      useCartStore.setState((state) => ({
        items: state.items.map((i) =>
          i.id === productId ? { ...i, remainingInStock: stock } : i
        ),
      }));
    }

    updateSizeQuantityLocal(productId, size, qty);

    if (isAuthenticated && cartId) {
      try {
        const freshItems = useCartStore.getState().items;
        const updatedItem = freshItems.find((i) => i.id === productId);
        await updateCartMutation.mutateAsync({
          cartId,
          productId,
          quantity: updatedItem?.quantity ?? 0,
          currentItems: freshItems,
        });
      } catch (error) {
        if (before) {
          useCartStore.getState().setItems(
            useCartStore
              .getState()
              .items.map((i) => (i.id === productId ? { ...before } : i))
          );
        }
        throw error;
      }
    }
  };

  const updateCartQuantity = async (
    productId: string,
    quantity: number,
    lineType: "product" | "fabric" = "product"
  ) => {
    updateQuantityLocal(productId, quantity, lineType);
  };

  const removeFromCart = async (
    productId: string,
    lineType: "product" | "fabric" = "product"
  ) => {
    removeItemLocal(productId, lineType);
  };

  const clearUserCart = async () => {
    clearCart();
  };

  const addFabricToCart = async (item: {
    id: string;
    quantity: number;
    price?: number;
    name?: string;
    image?: string;
    yardBundle?: number;
    stockBundles?: number;
    taxRate?: number | null;
    taxExempt?: boolean;
  }) => {
    const qty = Math.max(1, Math.floor(item.quantity));
    const existing = useCartStore
      .getState()
      .items.find((i) => i.id === item.id && i.lineType === "fabric");
    const stock =
      typeof item.stockBundles === "number"
        ? item.stockBundles
        : typeof existing?.stockBundles === "number"
          ? existing.stockBundles
          : null;
    const stockCheck = canAddCartQuantity(
      existing?.quantity ?? 0,
      qty,
      stock,
      item.name || existing?.name,
      "fabric"
    );
    if (!stockCheck.ok) {
      throw new Error(stockCheck.message);
    }

    useCartStore.getState().addFabricItem({
      id: item.id,
      quantity: qty,
      price: item.price,
      name: item.name,
      image: item.image,
      yardBundle: item.yardBundle,
      taxRate: item.taxRate ?? null,
      taxExempt: Boolean(item.taxExempt),
    });
    if (typeof stock === "number") {
      useCartStore.setState({
        items: useCartStore.getState().items.map((i) =>
          i.id === item.id && i.lineType === "fabric"
            ? { ...i, stockBundles: stock }
            : i
        ),
      });
    }

    if (isAuthenticated) {
      try {
        const updatedCart = await addFabricToCartMutation.mutateAsync({
          fabricId: item.id,
          quantity: qty,
        });
        const nextCartId =
          (updatedCart as { _id?: string; id?: string })._id ||
          (updatedCart as { id?: string }).id;
        if (nextCartId) {
          useCartStore.setState({ cartId: nextCartId, isGuestCart: false });
        }
      } catch (error) {
        console.error("Failed to add fabric to cart on server:", error);
        throw error;
      }
    }
  };

  return {
    addToCart,
    addFabricToCart,
    updateProductSizeQty,
    updateCartQuantity,
    removeFromCart,
    clearUserCart,
    isAuthenticated,
  };
};

export const useCartCount = () =>
  useCartStore((s) => s.items.reduce((n, i) => n + i.quantity, 0));

export const useCartTotal = () =>
  useCartStore((s) =>
    s.items.reduce((total, item) => {
      const itemPrice =
        typeof item.price === "number" && Number.isFinite(item.price)
          ? item.price
          : 0;
      return total + itemPrice * item.quantity;
    }, 0)
  );
