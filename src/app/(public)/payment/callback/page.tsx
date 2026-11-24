'use client';

/**
 * Paystack return URL (PAYMENT_POLICY: Paystack UI off; API callback still live).
 * Verifies via GET /api/payment/paystack/callback — never the removed POST /api/payment/verify.
 * Stripe success uses /payment/success → /api/payment/stripe/confirm.
 */

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useOrderStore } from '@/store/orderStore';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/contexts/toast-context';
import { orderKeys } from '@/hooks/useOrders';
import { cartKeys } from '@/hooks/useCart';
import PaymentResultShell from '@/components/Public_C/payment/PaymentResultShell';
import PaymentVerifyingAnimation from '@/components/Public_C/payment/PaymentVerifyingAnimation';
import PaymentConfetti from '@/components/Public_C/payment/PaymentConfetti';

function PaymentCallbackContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const clearCurrentOrder = useOrderStore((s) => s.clearCurrentOrder);
  const clearCart = useCartStore((s) => s.clearCart);
  const { addToast } = useToast();
  const [status, setStatus] = useState<'verifying' | 'success' | 'failed'>('verifying');
  const [orderReference, setOrderReference] = useState('');

  useEffect(() => {
    const verifyPayment = async () => {
      const reference = searchParams.get('reference');
      const trxref = searchParams.get('trxref');

      if (!reference && !trxref) {
        setStatus('failed');
        addToast('No payment reference found', 'error');
        return;
      }

      const paymentRef = reference || trxref || '';
      setOrderReference(paymentRef);

      try {
        // Live Paystack verify (provider secret). Matches PAYMENT_POLICY.methods.paystack.callback.
        const response = await fetch(
          `/api/payment/paystack/callback?reference=${encodeURIComponent(paymentRef)}`,
          { method: 'GET', credentials: 'include' }
        );
        const data = await response.json();

        if (response.ok && data.success) {
          setStatus('success');
          clearCurrentOrder();
          // Fulfillment already creates a fresh server cart — do not create another.
          clearCart();
          await queryClient.invalidateQueries({ queryKey: cartKeys.all });
          await queryClient.invalidateQueries({ queryKey: orderKeys.all });
          await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          window.dispatchEvent(new Event('cart-updated'));
          if (data.data?.fulfillmentError) {
            addToast(
              'Payment received. Order fulfillment is still finishing — refresh orders if items look incomplete.',
              'info'
            );
          } else {
            addToast('Payment successful!', 'success');
          }
        } else {
          setStatus('failed');
          addToast(data.message || data.error || 'Payment verification failed', 'error');
        }
      } catch (error) {
        console.error('Payment verification error:', error);
        setStatus('failed');
        addToast('Failed to verify payment', 'error');
      }
    };

    verifyPayment();
  }, [searchParams, clearCurrentOrder, clearCart, queryClient, addToast]);

  if (status === 'verifying') {
    return (
      <PaymentResultShell>
        <PaymentVerifyingAnimation />
      </PaymentResultShell>
    );
  }

  if (status === 'success') {
    return (
      <>
        <PaymentConfetti active />
        <PaymentResultShell>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
              <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Payment successful</h1>
            {orderReference && (
              <p className="mt-2 text-sm text-gray-500">Reference #{orderReference}</p>
            )}
            <p className="mt-4 text-gray-600">Your order has been confirmed.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/shop" className="flex-1">
                <button type="button" className="w-full cursor-pointer rounded-xl bg-[#D4AF37] px-6 py-3.5 font-semibold text-black shadow-md hover:bg-[#B8941F]">
                  Continue browsing
                </button>
              </Link>
              <Link href="/home" className="flex-1">
                <button type="button" className="w-full cursor-pointer rounded-xl border border-gray-200 px-6 py-3.5 font-semibold text-gray-800 hover:bg-gray-50">
                  Home page
                </button>
              </Link>
            </div>
          </motion.div>
        </PaymentResultShell>
      </>
    );
  }

  return (
    <PaymentResultShell>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 ring-4 ring-red-100">
          <svg className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Verification failed</h1>
        <p className="mt-3 text-gray-600">We couldn&apos;t verify your payment.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/checkout" className="flex-1">
            <button type="button" className="w-full cursor-pointer rounded-xl bg-[#D4AF37] px-6 py-3.5 font-semibold text-black hover:bg-[#B8941F]">
              Try again
            </button>
          </Link>
          <Link href="/home" className="flex-1">
            <button type="button" className="w-full cursor-pointer rounded-xl border border-gray-200 px-6 py-3.5 font-semibold text-gray-800 hover:bg-gray-50">
              Home page
            </button>
          </Link>
        </div>
      </motion.div>
    </PaymentResultShell>
  );
}

export default function PaymentCallback() {
  return (
    <Suspense
      fallback={
        <PaymentResultShell>
          <PaymentVerifyingAnimation />
        </PaymentResultShell>
      }
    >
      <PaymentCallbackContent />
    </Suspense>
  );
}
