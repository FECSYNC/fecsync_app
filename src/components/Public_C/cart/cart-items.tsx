'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertCircle } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/contexts/toast-context';
import { useUpdateCartQuantityMutation, useRemoveFromCartMutation } from '@/hooks/useCart';
import { usePendingOrderQuery } from '@/hooks/useOrders';
import { useQueryClient } from '@tanstack/react-query';
import { CartItem } from '@/components/Public_C/shop/CartItem';
import { dedupeCartLines, getCartLineKey } from '@/utils/cartDisplay';
import { canSetCartQuantity, ensureCartLineStock } from '@/utils/cartStock';

export default function CartItems() {
  const { addToast } = useToast();
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set());
  const [sizePopover, setSizePopover] = useState<{ itemId: string; mode: 'increase' | 'decrease' } | null>(null);

  const items = useCartStore((s) => s.items);
  const cartId = useCartStore((s) => s.cartId);
  const updateQuantityLocal = useCartStore((s) => s.updateQuantity);
  const updateSizeQuantityLocal = useCartStore((s) => s.updateSizeQuantity);
  const removeItemLocal = useCartStore((s) => s.removeItem);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { hasPendingOrder } = usePendingOrderQuery();

  const queryClient = useQueryClient();
  const updateCartMutation = useUpdateCartQuantityMutation();
  const removeCartMutation = useRemoveFromCartMutation();

  // Items should already be deduplicated by the cartStore
  const uniqueItems = useMemo(() => dedupeCartLines(items), [items]);

  const handleQuantityChange = async (id: string, mode: 'increase' | 'decrease', showPopover?: boolean) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const lineType = (item.lineType ?? 'product') as 'product' | 'fabric';
    const pendingKey = `${lineType}:${id}`;
    if (pendingOperations.has(pendingKey)) return;

    // If showPopover is true, open the size selector
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
        await onChangeSizeQty(id, size, next);
        return;
      }
    }

    const newQty = mode === 'increase' ? line.quantity + 1 : Math.max(0, line.quantity - 1);
    if (mode === 'increase') {
      const stockCheck = canSetCartQuantity(line, newQty);
      if (!stockCheck.ok) {
        addToast(stockCheck.message, 'error');
        return;
      }
    }
    await onChangeQty(id, newQty, lineType);
  };

  const onChangeSizeQty = async (id: string, size: string, newQty: number) => {
    const line = items.find((i) => i.id === id);
    const lineType = (line?.lineType ?? 'product') as 'product' | 'fabric';
    const pendingKey = `${lineType}:${id}`;
    if (pendingOperations.has(pendingKey)) return;

    if (line) {
      const breakdown = { ...(line.sizeBreakdown || {}) };
      const prevSizeQty = breakdown[size] || 0;
      const nextTotal = line.quantity - prevSizeQty + Math.max(0, newQty);
      if (newQty > prevSizeQty) {
        const stockCheck = canSetCartQuantity(line, nextTotal);
        if (!stockCheck.ok) {
          addToast(stockCheck.message, 'error');
          return;
        }
      }
    }
    const before = line ? { ...line } : null;

    try {
      setPendingOperations(prev => new Set(prev).add(pendingKey));
      updateSizeQuantityLocal(id, size, newQty);

      if (isAuthenticated && cartId) {
        try {
          const freshItems = useCartStore.getState().items;
          const updatedItem = freshItems.find((i) => i.id === id);
          await updateCartMutation.mutateAsync({
            cartId,
            productId: id,
            quantity: updatedItem?.quantity || newQty,
            currentItems: freshItems,
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
              : 'Failed to update quantity. Changes may not be saved.';
          addToast(msg, 'error');
        }
      }
    } catch (error) {
      addToast('Failed to update quantity. Please try again.', 'error');
      console.error('Failed to update quantity:', error);
    } finally {
      setPendingOperations(prev => {
        const newSet = new Set(prev);
        newSet.delete(pendingKey);
        return newSet;
      });
      setSizePopover(null);
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

      // Update local state immediately for optimistic UI
      updateQuantityLocal(id, qty, lineType);

      if (isAuthenticated && cartId) {
        try {
          const freshItems = useCartStore.getState().items;
          await updateCartMutation.mutateAsync({
            cartId,
            productId: id,
            quantity: qty,
            currentItems: freshItems,
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
              : 'Failed to update quantity. Changes may not be saved.';
          addToast(msg, 'error');
        }
      }
    } catch (error) {
      addToast('Failed to update quantity. Please try again.', 'error');
      console.error('Failed to update quantity:', error);
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
      removeItemLocal(id, lineType);
      addToast('Item removed from cart', 'success');

      if (isAuthenticated && cartId) {
        try {
          const line = items.find((i) => i.id === id);
          await removeCartMutation.mutateAsync({
            cartId,
            productId: id,
            lineType: line?.lineType,
          });
        } catch (serverError) {
          console.error('Failed to remove item from server:', serverError);
          addToast('Failed to remove item. Changes may not be saved.', 'error');
        }
      }
    } catch (error) {
      addToast('Failed to remove item. Please try again.', 'error');
      console.error('Failed to remove item:', error);
    }
  };

  if (uniqueItems.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center">
          <Image
            src="/unauthorized.png"
            alt="Empty Cart"
            width={128}
            height={128}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
            priority
          />
        </div>

        <h3 className="text-lg font-medium text-gray-900 mb-2">Your cart is empty</h3>
        <p className="text-gray-500 mb-6">Looks like you haven't added any items to your cart yet.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="/shop"
            className="inline-flex items-center justify-center px-6 py-3 bg-[#D4AF37] hover:bg-[#B8941F] text-white font-medium rounded-xl transition-colors"
          >
            Shop ready-to-wear
          </a>
          <a
            href="/fabrics"
            className="inline-flex items-center justify-center px-6 py-3 border border-[#D4AF37] text-[#B8941F] font-medium rounded-xl hover:bg-[#D4AF37]/10 transition-colors"
          >
            Shop fabrics
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Pending Order Warning Banner */}
      {hasPendingOrder && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">
                Active Order in Progress
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                Changes to your cart are saved, but your pending order total is
                not updated automatically. Pay at checkout to create a fresh
                order (including shipping) from the current cart.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cart Items */}
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
  );
}
