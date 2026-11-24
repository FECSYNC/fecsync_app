'use client';

import { useState } from 'react';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { AnimatePresence, motion } from 'framer-motion';
import { useToast } from '@/contexts/toast-context';
import { countCartUnits } from '@/utils/cartDisplay';
import { formatPrice } from '@/utils/currency';
import { formatTaxRateLabel } from '@/utils/tax';
import { useCartTaxBreakdown } from '@/hooks/useCartTaxBreakdown';
import CartSummaryLineCard from '@/components/Public_C/cart/CartSummaryLineCard';
import type { Order } from '@/services/order';
import type { CartLine } from '@/store/cartStore';

interface CartSummaryProps {
  order?: Order | null;
  shippingFee?: number;
  /** When true and fee is 0, show "Select delivery" instead of Free. */
  shippingSelectionPending?: boolean;
  /** While courier rates are loading — never show Free. */
  shippingRatesLoading?: boolean;
  /** Rate fetch failed — do not imply Free shipping. */
  shippingRatesError?: boolean;
}

export default function CartSummary({
  order: _unusedOrder,
  shippingFee = 0,
  shippingSelectionPending = false,
  shippingRatesLoading = false,
  shippingRatesError = false,
}: CartSummaryProps) {
  void _unusedOrder;
  const cartId = useCartStore((s) => s.cartId);
  const removeItemLocal = useCartStore((s) => s.removeItem);
  const { isAuthenticated } = useAuthStore();
  const { addToast } = useToast();
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set());
  const { breakdown, items } = useCartTaxBreakdown(shippingFee);

  const fabricBundles = items
    .filter((i) => i.lineType === 'fabric')
    .reduce((n, i) => n + i.quantity, 0);
  const productUnits = items
    .filter((i) => i.lineType !== 'fabric')
    .reduce((n, i) => n + i.quantity, 0);
  const itemCount = countCartUnits(items);

  const handleRemoveItem = async (item: CartLine) => {
    const pendingKey = `${item.lineType ?? 'product'}:${item.id}`;
    try {
      setPendingOperations((prev) => new Set(prev).add(pendingKey));
      removeItemLocal(item.id, (item.lineType ?? 'product') as 'product' | 'fabric');

      addToast('Item removed from cart', 'success');

      if (isAuthenticated && cartId) {
        const { removeCartLineById } = await import('@/services/cart');
        await removeCartLineById(cartId, {
          id: item.id,
          lineType: item.lineType,
        });
      }
    } catch (error) {
      addToast('Failed to remove item. Please try again.', 'error');
      console.error('Failed to remove item:', error);
    } finally {
      setPendingOperations((prev) => {
        const next = new Set(prev);
        next.delete(pendingKey);
        return next;
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:sticky lg:top-28"
    >
      <h2 className="text-xl font-bold text-gray-900 mb-2">Order summary</h2>
      {(fabricBundles > 0 || productUnits > 0) && (
        <p className="text-xs text-gray-500 mb-6">
          {productUnits > 0 &&
            `${productUnits} product unit${productUnits === 1 ? '' : 's'}`}
          {productUnits > 0 && fabricBundles > 0 && ' · '}
          {fabricBundles > 0 &&
            `${fabricBundles} fabric bundle${fabricBundles === 1 ? '' : 's'}`}
        </p>
      )}

      <div className="space-y-3 mb-6 overflow-visible">
        <AnimatePresence mode="popLayout">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">Your cart is empty</p>
          ) : (
            items.map((item) => {
              const pendingKey = `${item.lineType ?? 'product'}:${item.id}`;
              return (
                <CartSummaryLineCard
                  key={pendingKey}
                  item={item}
                  onRemove={handleRemoveItem}
                  isPending={pendingOperations.has(pendingKey)}
                />
              );
            })
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-3 mb-6 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Subtotal ({itemCount} items)</span>
          <span className="font-medium text-gray-900">
            {formatPrice(breakdown.subtotal)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Shipping</span>
          <span className={`font-medium ${breakdown.shipping > 0 ? 'text-gray-900' : 'text-[#B8941F]'}`}>
            {breakdown.shipping > 0
              ? formatPrice(breakdown.shipping)
              : shippingFee > 0
                ? formatPrice(shippingFee)
                : shippingRatesLoading
                  ? 'Calculating…'
                  : shippingRatesError
                    ? 'Unavailable'
                    : shippingSelectionPending
                      ? 'Select delivery'
                      : 'Free'}
          </span>
        </div>
        {breakdown.taxAmount > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-gray-600">
              {formatTaxRateLabel(breakdown.effectiveRate, breakdown.label)}
            </span>
            <span className="font-medium text-gray-900">
              {formatPrice(breakdown.taxAmount)}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 my-4" />

      <div className="flex justify-between items-center mb-2">
        <span className="text-lg font-bold text-gray-900">Total</span>
        <span className="text-lg font-bold text-gray-900">
          {formatPrice(breakdown.total)}
        </span>
      </div>

      {fabricBundles > 0 && (
        <p className="text-xs text-gray-500 leading-relaxed">
          Fabric is sold in fixed yard bundles and is not customizable.
        </p>
      )}
    </motion.div>
  );
}
