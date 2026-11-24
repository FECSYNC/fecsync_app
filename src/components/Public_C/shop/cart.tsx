"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCartStore, useCartTotalItemsOptimistic } from "@/store/cartStore";
import { useAuthStore } from "@/store/authStore";
import { useToast } from "@/contexts/toast-context";
import { useNavigationFeedback } from "@/contexts/navigation-feedback";
import { useUpdateCartQuantityMutation, useRemoveFromCartMutation, useCartRawQuery } from "@/hooks/useCart";
import { usePendingOrderQuery } from "@/hooks/useOrders";
import { formatPrice } from "@/utils/currency";
import { AlertCircle } from "lucide-react";
import { CartItem } from "./CartItem";
import { dedupeCartLines, getCartLineKey } from "@/utils/cartDisplay";
import { formatTaxRateLabel } from "@/utils/tax";
import { signInHref, signupHref } from "@/utils/authRedirect";
import { useCartTaxBreakdown } from "@/hooks/useCartTaxBreakdown";
import { canSetCartQuantity, ensureCartLineStock } from "@/utils/cartStock";

interface CartUIProps {
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
}

declare global {
  interface Window {
    __scrollLockCount?: number;
    __scrollLockPrev?: {
      htmlOverflow?: string;
      bodyOverflow?: string;
      htmlOverscroll?: string;
      bodyOverscroll?: string;
      bodyTouchAction?: string;
    };
  }
}

const CartUI = ({ isOpen = true, setIsOpen }: CartUIProps) => {
  const { addToast, clearToasts } = useToast();
  const { navigate, navigating, isBusyHref } = useNavigationFeedback();

  // Track pending operations per product to prevent double-submit
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set());

  // Size selector popover state
  const [sizePopover, setSizePopover] = useState<{
    itemId: string;
    mode: 'increase' | 'decrease';
  } | null>(null);

  // React Query hook for pending order warning
  const { hasPendingOrder } = usePendingOrderQuery();

  const items = useCartStore((s) => s.items);
  const cartId = useCartStore((s) => s.cartId);
  const isGuestCart = useCartStore((s) => s.isGuestCart);
  const isLoading = useCartStore((s) => s.isLoading);
  const error = useCartStore((s) => s.error);
  const updateQuantityLocal = useCartStore((s) => s.updateQuantity);
  const updateSizeQuantityLocal = useCartStore((s) => s.updateSizeQuantity);
  const removeItemLocal = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const setCartId = useCartStore((s) => s.setCartId);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // React Query mutations for cart operations
  const updateCartMutation = useUpdateCartQuantityMutation();
  const removeCartMutation = useRemoveFromCartMutation();
  // Optimized: Only fetch when authenticated, with proper caching to prevent constant refetches
  const { data: rawCart } = useCartRawQuery(isAuthenticated, {
    enabled: isAuthenticated, // Only fetch if authenticated
    staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh, no refetch
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache (formerly cacheTime)
    refetchOnMount: false, // Don't refetch when cart opens
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Set cartId from rawCart when it loads
  useEffect(() => {
    if (rawCart && isAuthenticated) {
      const id = (rawCart as any)._id || (rawCart as any).id;
      if (id) {
        setCartId(id);
      }
    }
  }, [rawCart, isAuthenticated, setCartId]);

  // Items should already be deduplicated by the cartStore
  const uniqueItems = useMemo(() => dedupeCartLines(items), [items]);
  const { breakdown } = useCartTaxBreakdown(0);

  // Clear toasts when cart opens (consolidated with cart open logic)
  useEffect(() => {
    if (isOpen) {
      clearToasts();
      console.log('[Cart] Drawer opened - toasts cleared');
    }
  }, [isOpen, clearToasts]);

  // Guest carts may lack remainingInStock — hydrate + clamp oversold lines on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const syncStock = async () => {
      const lines = useCartStore.getState().items.filter(
        (i) => (i.lineType ?? 'product') !== 'fabric'
      );
      for (const line of lines) {
        if (cancelled) return;
        const result = await ensureCartLineStock(line);
        if (cancelled) return;
        if (result.clamped && result.message) {
          addToast(result.message, 'error');
        }
      }
    };
    void syncStock();
    return () => {
      cancelled = true;
    };
  }, [isOpen, addToast]);

  // Show error toasts when cart errors occur
  useEffect(() => {
    if (error) {
      addToast(error, "error");
    }
  }, [error, addToast]);

  // Scroll lock management
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const lock = () => {
      if (typeof window === "undefined") return;

      if (!window.__scrollLockCount) {
        window.__scrollLockCount = 0;
      }

      if (window.__scrollLockCount > 1) return;

      window.__scrollLockCount++;

      if (window.__scrollLockCount === 1) {
        window.__scrollLockPrev = {
          htmlOverflow: html.style.overflow,
          bodyOverflow: body.style.overflow,
          htmlOverscroll: (html.style as any).overscrollBehavior,
          bodyOverscroll: (body.style as any).overscrollBehavior,
          bodyTouchAction: (body.style as any).touchAction,
        };

        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
        (html.style as any).overscrollBehavior = "none";
        (body.style as any).overscrollBehavior = "none";
        (body.style as any).touchAction = "none";
      }
    };

    const unlock = () => {
      if (typeof window === "undefined") return;

      if (!window.__scrollLockCount) return;

      window.__scrollLockCount--;

      if (window.__scrollLockCount > 0) return;

      const prev = window.__scrollLockPrev;
      if (prev) {
        html.style.overflow = prev.htmlOverflow ?? "";
        body.style.overflow = prev.bodyOverflow ?? "";
        (html.style as any).overscrollBehavior = prev.htmlOverscroll ?? "";
        (body.style as any).overscrollBehavior = prev.bodyOverscroll ?? "";
        (body.style as any).touchAction = prev.bodyTouchAction ?? "";
        window.__scrollLockPrev = undefined;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen?.(false);
    };
    window.addEventListener("keydown", onKey);

    if (isOpen) lock();
    else unlock();

    return () => {
      window.removeEventListener("keydown", onKey);
      if (isOpen) unlock();
    };
  }, [isOpen, setIsOpen]);

  // Handle quantity change - shows popover if multiple sizes are already in the cart
  const handleQuantityChange = async (id: string, mode: 'increase' | 'decrease', showPopover: boolean = false) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const pendingKey = `${item.lineType ?? 'product'}:${id}`;
    if (pendingOperations.has(pendingKey)) return;

    const lineType = item.lineType ?? 'product';

    // If should show popover, show it to let user choose size
    if (showPopover) {
      setSizePopover({ itemId: id, mode });
      return;
    }

    let line = item;
    if (mode === 'increase' && lineType === 'product') {
      const ensured = await ensureCartLineStock(item);
      if (ensured.clamped && ensured.message) {
        addToast(ensured.message, 'error');
      }
      if (!ensured.stockKnown) {
        addToast(
          "Couldn't verify stock for this product. Please try again.",
          'error'
        );
        return;
      }
      line =
        useCartStore.getState().items.find((i) => i.id === id) ?? ensured.item;
    }

    // Exactly one size in the cart — bump that size (keeps sizeBreakdown accurate)
    if (lineType === 'product' && line.sizeBreakdown) {
      const active = Object.entries(line.sizeBreakdown).filter(([, q]) => q > 0);
      if (active.length === 1) {
        const [size, qty] = active[0];
        const next = mode === 'increase' ? qty + 1 : Math.max(0, qty - 1);
        if (mode === 'increase') {
          const nextTotal = line.quantity - qty + next;
          const stockCheck = canSetCartQuantity(line, nextTotal);
          if (!stockCheck.ok) {
            addToast(stockCheck.message, 'error');
            return;
          }
        }
        void onChangeSizeQty(id, size, next);
        return;
      }
    }

    // Single size or no breakdown - update directly
    const newQty = mode === 'increase' ? line.quantity + 1 : Math.max(0, line.quantity - 1);
    if (mode === 'increase') {
      const stockCheck = canSetCartQuantity(line, newQty);
      if (!stockCheck.ok) {
        addToast(stockCheck.message, 'error');
        return;
      }
    }
    onChangeQty(id, newQty, lineType);
  };

  // Handle size-specific quantity change (from popover)
  const onChangeSizeQty = async (id: string, size: string, qty: number) => {
    const line = items.find((i) => i.id === id);
    const lineType = (line?.lineType ?? 'product') as 'product' | 'fabric';
    const pendingKey = `${lineType}:${id}`;
    console.log('[CartUI] onChangeSizeQty called', { id, size, qty, isPending: pendingOperations.has(pendingKey) });

    if (pendingOperations.has(pendingKey)) {
      console.warn('[CartUI] Operation blocked by pendingOperations', id);
      return;
    }

    if (line) {
      let stockLine = line;
      if (qty > (line.sizeBreakdown?.[size] || 0)) {
        const ensured = await ensureCartLineStock(line);
        if (ensured.clamped && ensured.message) {
          addToast(ensured.message, 'error');
        }
        stockLine =
          useCartStore.getState().items.find((i) => i.id === id) ?? ensured.item;
      }
      const breakdown = { ...(stockLine.sizeBreakdown || {}) };
      const prevSizeQty = breakdown[size] || 0;
      const nextTotal = stockLine.quantity - prevSizeQty + Math.max(0, qty);
      if (qty > prevSizeQty) {
        const stockCheck = canSetCartQuantity(stockLine, nextTotal);
        if (!stockCheck.ok) {
          addToast(stockCheck.message, 'error');
          return;
        }
      }
    }

    const before = line ? { ...line } : null;

    try {
      setPendingOperations(prev => new Set(prev).add(pendingKey));

      // Update local state immediately (optimistic)
      console.log('[CartUI] calling updateSizeQuantityLocal');
      updateSizeQuantityLocal(id, size, qty);

      // Sync to server if authenticated
      if (isAuthenticated && cartId) {
        try {
          // IMPORTANT: Get FRESH state after local update
          const freshItems = useCartStore.getState().items;
          const updatedItem = freshItems.find(i => i.id === id);

          await updateCartMutation.mutateAsync({
            cartId,
            productId: id,
            quantity: updatedItem?.quantity || qty,
            currentItems: freshItems, // Use fresh items with updated productNote
          });
        } catch (serverError) {
          console.error('Failed to update quantity on server:', serverError);
          if (before) {
            useCartStore.getState().setItems(
              useCartStore.getState().items.map((i) =>
                i.id === id ? before : i
              )
            );
          }
          const msg =
            serverError instanceof Error
              ? serverError.message
              : "Failed to update quantity on server. Changes may not be saved.";
          addToast(msg, "error");
        }
      }
    } catch (error) {
      addToast("Failed to update quantity. Please try again.", "error");
      console.error("Failed to update quantity:", error);
    } finally {
      setPendingOperations(prev => {
        const newSet = new Set(prev);
        newSet.delete(pendingKey);
        return newSet;
      });
    }
  };

  const onChangeQty = async (id: string, qty: number, lineType: 'product' | 'fabric' = 'product') => {
    const pendingKey = `${lineType}:${id}`;
    if (pendingOperations.has(pendingKey)) return;

    const line = items.find(
      (i) => i.id === id && (i.lineType ?? 'product') === lineType
    );
    if (line && qty > line.quantity) {
      const stockCheck = canSetCartQuantity(line, qty);
      if (!stockCheck.ok) {
        addToast(stockCheck.message, 'error');
        return;
      }
    }
    const before = line ? { ...line } : null;

    try {
      setPendingOperations(prev => new Set(prev).add(pendingKey));

      // Update local state immediately (optimistic)
      updateQuantityLocal(id, qty, lineType);

      // Sync to server if authenticated
      if (isAuthenticated && cartId) {
        try {
          // IMPORTANT: Get FRESH state after local update
          const freshItems = useCartStore.getState().items;

          await updateCartMutation.mutateAsync({
            cartId,
            productId: id,
            quantity: qty,
            currentItems: freshItems, // Use fresh items with updated productNote
          });
        } catch (serverError) {
          console.error('Failed to update quantity on server:', serverError);
          if (before) {
            useCartStore.getState().setItems(
              useCartStore.getState().items.map((i) =>
                i.id === id && (i.lineType ?? 'product') === lineType
                  ? before
                  : i
              )
            );
          }
          const msg =
            serverError instanceof Error
              ? serverError.message
              : "Failed to update quantity on server. Changes may not be saved.";
          addToast(msg, "error");
          // React Query will handle rollback if mutation fails
        }
      }
    } catch (error) {
      addToast("Failed to update quantity. Please try again.", "error");
      console.error("Failed to update quantity:", error);
    } finally {
      setPendingOperations(prev => {
        const newSet = new Set(prev);
        newSet.delete(pendingKey);
        return newSet;
      });
    }
  };

  const onRemove = async (id: string) => {
    try {
      const line = items.find((i) => i.id === id);
      const lineType = (line?.lineType ?? 'product') as 'product' | 'fabric';
      // Update local state immediately (optimistic)
      removeItemLocal(id, lineType);
      addToast("Item removed from cart", "success");

      // Sync to server if authenticated
      if (isAuthenticated && cartId) {
        try {
          await removeCartMutation.mutateAsync({
            cartId,
            productId: id,
            lineType: line?.lineType,
          });
        } catch (serverError) {
          console.error('Failed to remove item from server:', serverError);
          addToast("Failed to remove item from server. Changes may not be saved.", "error");
          // React Query will handle rollback if mutation fails
        }
      }
    } catch (error) {
      addToast("Failed to remove item. Please try again.", "error");
      console.error("Failed to remove item:", error);
    }
  };

  const onClearCart = async () => {
    try {
      clearCart();
      addToast("Cart cleared successfully", "success");

      // For logged-in users, clearing is handled by updating cart to empty on server
      // This will be implemented when clear cart button is added
    } catch (error) {
      addToast("Failed to clear cart. Please try again.", "error");
      console.error("Failed to clear cart:", error);
    }
  };

  // Instant navigation - order creation moved to checkout page
  const handleCheckout = () => {
    if (uniqueItems.length === 0) {
      addToast("Your cart is empty. Add some items before checkout.", "error");
      return;
    }

    // Auth gate first
    if (!isAuthenticated) {
      addToast('Please sign in or create an account to checkout', 'error');
      setIsOpen?.(false);
      navigate(signInHref('/checkout'));
      return;
    }

    // Navigate immediately - order will be created on payment
    setIsOpen?.(false);
    navigate('/checkout');
  };

  if (!isOpen) return null;

  const cartDrawer = (
    <div className="fixed inset-0 z-[99999]" style={{ zIndex: 99999 }}>
      {/* Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={() => setIsOpen?.(false)}
      />

      {/* Cart Drawer */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl flex flex-col"
        style={{ zIndex: 100000 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 py-1">
          <h2 className="text-xl font-bold text-black uppercase tracking-wide">
            MY CART
          </h2>
          <button
            onClick={() => setIsOpen?.(false)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            aria-label="Close cart"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>

        {/* Cart Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {uniqueItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center">
                <Image
                  src="/unauthorized.png"
                  alt="Empty Cart"
                  width={128}
                  height={128}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>

              <h3 className="text-lg font-medium text-gray-900 mb-2">Your cart is empty</h3>
              <p className="text-gray-500 mb-6">Looks like you haven't added any items to your cart yet.</p>
              <button
                onClick={() => setIsOpen?.(false)}
                className="inline-flex items-center px-6 py-3 bg-[#D4AF37] hover:bg-[#B8941F] text-white font-medium rounded-lg transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <>
              {/* Pending Order Warning Banner */}
              {hasPendingOrder && (
                <div className="mx-6 mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">
                        Active Order in Progress
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        You have a pending order. At checkout, paying creates a
                        fresh order from your current cart (including shipping).
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Cart Items */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <AnimatePresence>
                  {uniqueItems.map((item) => (
                    <CartItem
                      key={getCartLineKey(item)}
                      item={item}
                      pendingOperations={pendingOperations}
                      handleQuantityChange={handleQuantityChange}
                      onChangeSizeQty={onChangeSizeQty}
                      onRemove={onRemove}
                      setSizePopover={setSizePopover}
                      sizePopover={sizePopover}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {/* Cart Summary */}
              <div className="border-t border-gray-200 p-6 space-y-4">
                {!isAuthenticated && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full" aria-hidden />
                      <span className="text-sm font-medium text-yellow-800">
                        Guest User
                      </span>
                    </div>
                    <p className="text-xs text-yellow-700 mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen?.(false);
                          navigate(signInHref('/checkout'));
                        }}
                        className="font-semibold text-[#8A6D00] underline underline-offset-2 hover:text-[#6B5010]"
                      >
                        Sign in
                      </button>
                      {' '}or{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen?.(false);
                          navigate(signupHref('/checkout'));
                        }}
                        className="font-semibold text-[#8A6D00] underline underline-offset-2 hover:text-[#6B5010]"
                      >
                        register your company
                      </button>
                      {' '}to continue (guest shop signup is closed).
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-medium text-gray-900">{formatPrice(breakdown.subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Shipping</span>
                    <span className="font-medium text-[#B8941F]">Calculated at checkout</span>
                  </div>
                  {breakdown.taxAmount > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">
                        {formatTaxRateLabel(breakdown.effectiveRate, breakdown.label)}
                      </span>
                      <span className="font-medium text-gray-900">{formatPrice(breakdown.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold text-gray-900">Total:</span>
                    <span className="text-lg font-bold text-gray-900">{formatPrice(breakdown.total)}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleCheckout}
                    disabled={
                      uniqueItems.length === 0 ||
                      (navigating && !isBusyHref('/checkout') && !isBusyHref('/signin'))
                    }
                    className="w-full bg-[#D4AF37] text-black font-medium py-3 px-4 rounded-lg hover:bg-[#B8941F] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                  >
                    {isBusyHref('/checkout') || isBusyHref('/signin')
                      ? 'Opening…'
                      : 'CHECKOUT'}
                  </button>

                  <button
                    onClick={() => {
                      if (!isAuthenticated) {
                        addToast('Please sign in or create an account to view your cart', 'error');
                        setIsOpen?.(false);
                        navigate(signInHref('/cart'));
                        return;
                      }
                      setIsOpen?.(false);
                      navigate('/cart');
                    }}
                    disabled={navigating && !isBusyHref('/cart') && !isBusyHref('/signin')}
                    className="w-full bg-white text-black font-medium py-3 px-4 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
                  >
                    {isBusyHref('/cart') || isBusyHref('/signin')
                      ? 'Opening…'
                      : 'VIEW CART'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );

  return typeof window !== 'undefined'
    ? createPortal(cartDrawer, document.body)
    : null;
};

export default CartUI;