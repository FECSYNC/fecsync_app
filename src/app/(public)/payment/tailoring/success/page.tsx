'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import PaymentResultShell from '@/components/Public_C/payment/PaymentResultShell';
import PaymentVerifyingAnimation from '@/components/Public_C/payment/PaymentVerifyingAnimation';
import PaymentConfetti from '@/components/Public_C/payment/PaymentConfetti';
import { formatPrice } from '@/utils/currency';
import { invalidateTailoringQueryCaches } from '@/hooks/useTailoringJobs';

function TailoringPaymentSuccessContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [phase, setPhase] = useState<'verifying' | 'success' | 'failed'>(
    'verifying'
  );
  const [receipt, setReceipt] = useState<{
    jobId?: string;
    amount?: number;
    currency?: string;
    paymentReference?: string;
    title?: string;
  }>({});

  useEffect(() => {
    const verify = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setPhase('failed');
        addToast('No payment session found', 'error');
        return;
      }

      try {
        const response = await fetch(
          `/api/payment/tailoring/confirm?session_id=${encodeURIComponent(sessionId)}`,
          { method: 'GET', credentials: 'include' }
        );
        const data = await response.json();

        if (response.ok && data.success) {
          const job = data.data?.job;
          setReceipt({
            jobId: job?._id || data.data?.jobId,
            amount: data.data?.amount ?? job?.amount,
            currency: data.data?.currency ?? job?.currency,
            paymentReference: data.data?.paymentReference,
            title: job?.title,
          });
          setPhase('success');
          invalidateTailoringQueryCaches(queryClient);
          addToast('Tailoring payment confirmed', 'success');
        } else {
          setPhase('failed');
          addToast(data.message || 'Payment verification failed', 'error');
        }
      } catch (err) {
        console.error(err);
        setPhase('failed');
        addToast('Failed to verify payment', 'error');
      }
    };

    void verify();
  }, [searchParams, queryClient, addToast]);

  if (phase === 'verifying') {
    return (
      <PaymentResultShell>
        <PaymentVerifyingAnimation />
      </PaymentResultShell>
    );
  }

  if (phase === 'success') {
    return (
      <>
        <PaymentConfetti active />
        <PaymentResultShell>
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          >
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
              <svg
                className="h-10 w-10 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              Payment successful
            </h1>
            {receipt.title ? (
              <p className="mt-2 text-sm text-gray-600">{receipt.title}</p>
            ) : null}
            {typeof receipt.amount === 'number' ? (
              <p className="mt-3 text-lg font-semibold text-gray-900">
                {formatPrice(receipt.amount)}
              </p>
            ) : null}
            {receipt.paymentReference ? (
              <p className="mt-2 text-xs text-gray-500">
                Ref {receipt.paymentReference.slice(0, 24)}
                {receipt.paymentReference.length > 24 ? '…' : ''}
              </p>
            ) : null}
            <p className="mt-4 text-gray-600">
              Your tailor can start work now. A receipt email is on its way.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {receipt.jobId ? (
                <Link href={`/profile/tailoring-jobs/${receipt.jobId}`} className="flex-1">
                  <button
                    type="button"
                    className="w-full rounded-xl bg-[#D4AF37] px-6 py-3.5 font-semibold text-black shadow-md shadow-[#D4AF37]/25 hover:bg-[#B8941F]"
                  >
                    View job
                  </button>
                </Link>
              ) : null}
              <Link href="/profile/tailoring-jobs" className="flex-1">
                <button
                  type="button"
                  className="w-full rounded-xl border border-gray-200 bg-white px-6 py-3.5 font-semibold text-gray-800 hover:bg-gray-50"
                >
                  All jobs
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
          <svg
            className="h-10 w-10 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          Verification failed
        </h1>
        <p className="mt-3 text-gray-600">
          We couldn&apos;t confirm this payment. Your quote is still open if
          payment did not go through.
        </p>
        <div className="mt-8">
          <Link href="/profile/tailoring-jobs">
            <button
              type="button"
              className="w-full rounded-xl bg-[#D4AF37] px-6 py-3.5 font-semibold text-black"
            >
              Back to jobs
            </button>
          </Link>
        </div>
      </motion.div>
    </PaymentResultShell>
  );
}

export default function TailoringPaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <PaymentResultShell>
          <PaymentVerifyingAnimation />
        </PaymentResultShell>
      }
    >
      <TailoringPaymentSuccessContent />
    </Suspense>
  );
}
