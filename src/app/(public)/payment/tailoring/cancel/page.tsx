'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PaymentResultShell from '@/components/Public_C/payment/PaymentResultShell';
import { invalidateTailoringQueryCaches } from '@/hooks/useTailoringJobs';

function TailoringPaymentCancelContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const sessionId = searchParams.get('session_id');
  const jobId = searchParams.get('jobId');
  const [status, setStatus] = useState<'working' | 'done'>('working');

  useEffect(() => {
    const revert = async () => {
      if (!sessionId && !jobId) {
        setStatus('done');
        return;
      }
      try {
        await fetch('/api/payment/tailoring/cancel', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            sessionId ? { sessionId } : { jobId }
          ),
        });
        invalidateTailoringQueryCaches(queryClient);
      } catch (err) {
        console.warn('cancel revert failed', err);
      } finally {
        setStatus('done');
      }
    };
    void revert();
  }, [sessionId, jobId, queryClient]);

  return (
    <PaymentResultShell>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-amber-50 ring-4 ring-amber-100">
          <svg
            className="h-10 w-10 text-amber-600"
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
          Payment cancelled
        </h1>
        <p className="mt-3 text-gray-600">
          {status === 'working'
            ? 'Returning your quote…'
            : 'No charge was completed. Your quote is still open if you want to try again.'}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {jobId ? (
            <Link
              href={`/profile/tailoring-jobs/${jobId}`}
              className="flex-1"
            >
              <button
                type="button"
                className="w-full rounded-xl bg-[#D4AF37] px-6 py-3.5 font-semibold text-black"
              >
                Back to job
              </button>
            </Link>
          ) : null}
          <Link href="/profile/tailoring-jobs" className="flex-1">
            <button
              type="button"
              className="w-full rounded-xl border border-gray-200 bg-white px-6 py-3.5 font-semibold text-gray-800"
            >
              All jobs
            </button>
          </Link>
        </div>
      </motion.div>
    </PaymentResultShell>
  );
}

export default function TailoringPaymentCancelPage() {
  return (
    <Suspense
      fallback={
        <PaymentResultShell>
          <p className="text-gray-600">Loading…</p>
        </PaymentResultShell>
      }
    >
      <TailoringPaymentCancelContent />
    </Suspense>
  );
}
