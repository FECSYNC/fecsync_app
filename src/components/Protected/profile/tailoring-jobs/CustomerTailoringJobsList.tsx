'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import {
  useMyTailoringJobsQuery,
  usePatchTailoringJobMutation,
  useCancelTailoringCheckoutMutation,
} from '@/hooks/useTailoringJobs';
import { formatPrice } from '@/utils/currency';
import { useToast } from '@/contexts/toast-context';

export default function CustomerTailoringJobsList() {
  const { addToast } = useToast();
  const { data: jobs = [], isLoading } = useMyTailoringJobsQuery();
  const patchMut = usePatchTailoringJobMutation();
  const cancelCheckoutMut = useCancelTailoringCheckoutMutation();

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Tailoring jobs</h2>
        <p className="text-sm text-gray-600 mt-1">
          Track requests you submitted to FECSYNC tailors.
        </p>
      </div>
      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-gray-600">
          No jobs yet.{' '}
          <Link href="/tailors" className="text-[#B8960C] font-medium">
            Find a tailor
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job._id}
              className="bg-white rounded-xl border p-4 flex flex-wrap justify-between gap-3"
            >
              <div>
                <Link
                  href={`/profile/tailoring-jobs/${job._id}`}
                  className="font-semibold text-gray-900 hover:underline"
                >
                  {job.title}
                </Link>
                <p className="text-sm text-gray-500 mt-1">
                  {job.tailorDisplayName || 'Tailor'} ·{' '}
                  <span className="capitalize">
                    {job.status.replace(/_/g, ' ')}
                  </span>
                  {job.quotedPrice != null
                    ? ` · ${formatPrice(job.quotedPrice)}`
                    : ''}
                  {job.canReview ? (
                    <span className="ml-2 text-emerald-700 font-medium">
                      · Leave a review
                    </span>
                  ) : null}
                  {job.hasReview ? (
                    <span className="ml-2 text-emerald-600">· Reviewed</span>
                  ) : null}
                </p>
              </div>
              {job.status === 'submitted' ? (
                <button
                  type="button"
                  disabled={patchMut.isPending}
                  onClick={() =>
                    void patchMut
                      .mutateAsync({
                        id: job._id,
                        payload: {
                          status: 'cancelled',
                          note: 'Cancelled by customer',
                        },
                      })
                      .then(() => addToast('Job cancelled', 'success'))
                  }
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700"
                >
                  Cancel
                </button>
              ) : null}
              {job.status === 'payment_pending' ? (
                <button
                  type="button"
                  disabled={cancelCheckoutMut.isPending}
                  onClick={() =>
                    void cancelCheckoutMut
                      .mutateAsync(job._id)
                      .then(() => addToast('Checkout cancelled', 'success'))
                      .catch((err) =>
                        addToast(
                          err instanceof Error
                            ? err.message
                            : 'Could not cancel checkout',
                          'error'
                        )
                      )
                  }
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700"
                >
                  Cancel checkout
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
