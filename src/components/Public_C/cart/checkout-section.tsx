'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/contexts/toast-context';
import { useNavigationFeedback } from '@/contexts/navigation-feedback';
import { countCartUnits } from '@/utils/cartDisplay';
import { formatPrice } from '@/utils/currency';
import { formatTaxRateLabel } from '@/utils/tax';
import { useCartTaxBreakdown } from '@/hooks/useCartTaxBreakdown';

export default function CheckoutSection() {
  const { addToast } = useToast();
  const { navigate, navigating, isBusyHref } = useNavigationFeedback();
  const { breakdown, items } = useCartTaxBreakdown(0);

  const itemCount = countCartUnits(items);
  const lineCount = items.length;
  const hasFabric = items.some((i) => i.lineType === 'fabric');
  const checkoutBusy = isBusyHref('/checkout');

  const handleCheckout = () => {
    if (itemCount === 0) {
      addToast('Your cart is empty. Add some items before checkout.', 'error');
      return;
    }

    navigate('/checkout');
  };

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6"
      >
        <h2 className="text-xl font-bold text-gray-900 mb-6">Order summary</h2>

        <div className="flex justify-between items-center mb-4 text-sm">
          <span className="text-gray-600">
            {lineCount} line{lineCount === 1 ? '' : 's'} · {itemCount} units
          </span>
          <span className="font-medium text-gray-900">
            {formatPrice(breakdown.subtotal)}
          </span>
        </div>

        <div className="flex justify-between items-center mb-4 text-sm">
          <span className="text-gray-600">Shipping</span>
          <span className="font-medium text-[#B8941F]">Calculated at checkout</span>
        </div>

        {breakdown.taxAmount > 0 && (
          <div className="flex justify-between items-center mb-4 text-sm">
            <span className="text-gray-600">
              {formatTaxRateLabel(breakdown.effectiveRate, breakdown.label)}
            </span>
            <span className="font-medium text-gray-900">
              {formatPrice(breakdown.taxAmount)}
            </span>
          </div>
        )}

        {hasFabric && (
          <p className="text-xs text-gray-500 mb-4 rounded-lg bg-[#D4AF37]/8 border border-[#D4AF37]/15 px-3 py-2">
            Includes fabric sold by the bundle (4 or 6 yards). Not for customization orders.
          </p>
        )}

        <div className="border-t border-gray-200 my-4" />

        <div className="flex justify-between items-center mb-6">
          <span className="text-lg font-bold text-gray-900">Total</span>
          <span className="text-lg font-bold text-gray-900">
            {formatPrice(breakdown.total)}
          </span>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: itemCount === 0 || navigating ? 1 : 1.02 }}
          whileTap={{ scale: itemCount === 0 || navigating ? 1 : 0.98 }}
          onClick={handleCheckout}
          disabled={itemCount === 0 || (navigating && !checkoutBusy)}
          className="w-full py-4 bg-[#D4AF37] cursor-pointer text-gray-900 font-bold rounded-xl hover:bg-[#B8941F] transition-colors disabled:opacity-50 disabled:cursor-wait shadow-md shadow-[#D4AF37]/20"
        >
          {itemCount === 0
            ? 'Cart is empty'
            : checkoutBusy
              ? 'Opening…'
              : 'Proceed to checkout'}
        </motion.button>

        <a
          href="/shop"
          className="mt-4 block text-center text-sm font-medium text-[#B8941F] hover:text-[#D4AF37] transition-colors"
        >
          Continue browsing
        </a>
      </motion.div>
    </div>
  );
}
