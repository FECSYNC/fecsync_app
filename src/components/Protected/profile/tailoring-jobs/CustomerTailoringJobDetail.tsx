'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  useTailoringJobQuery,
  usePatchTailoringJobMutation,
  useCancelTailoringCheckoutMutation,
  useInitiateTailoringPaymentMutation,
  jobKeys,
} from '@/hooks/useTailoringJobs';
import { useSubmitTailorReviewMutation } from '@/hooks/useTailors';
import { useQueryClient } from '@tanstack/react-query';
import { formatPrice } from '@/utils/currency';
import { useToast } from '@/contexts/toast-context';
import TailoringJobReferenceImages from '@/components/tailoring/TailoringJobReferenceImages';
import TailoringJobMeasurements from '@/components/tailoring/TailoringJobMeasurements';

export default function CustomerTailoringJobDetail({ id }: { id: string }) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const { data: job, isLoading, isError, refetch } = useTailoringJobQuery(id);
  const patchMut = usePatchTailoringJobMutation();
  const cancelCheckoutMut = useCancelTailoringCheckoutMutation();
  const payMut = useInitiateTailoringPaymentMutation();
  const reviewMut = useSubmitTailorReviewMutation();
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (isError || !job) {
    return (
      <div className="p-6 text-center">
        <p>Job not found</p>
        <Link href="/profile/tailoring-jobs" className="text-[#B8960C] text-sm">
          Back
        </Link>
      </div>
    );
  }

  const canPay =
    (job.status === 'quoted' || job.status === 'payment_pending') &&
    typeof job.quotedPrice === 'number' &&
    job.quotedPrice > 0 &&
    !job.paidAt &&
    job.status !== 'paid' &&
    job.status !== 'in_progress' &&
    job.status !== 'completed';

  const startPayment = async () => {
    try {
      const url = await payMut.mutateAsync(id);
      window.location.href = url;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Payment failed', 'error');
      void refetch();
    }
  };

  const submitReview = async () => {
    if (!job.tailorSlug) {
      addToast('Tailor profile unavailable for review', 'error');
      return;
    }
    try {
      await reviewMut.mutateAsync({
        slug: job.tailorSlug,
        jobId: id,
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      queryClient.setQueryData(jobKeys.detail(id), (prev: typeof job) =>
        prev ? { ...prev, canReview: false, hasReview: true } : prev
      );
      addToast('Thanks for your review', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Review failed', 'error');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <Link href="/profile/tailoring-jobs" className="text-sm text-gray-600">
        ← Tailoring jobs
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{job.title}</h1>
        <p className="text-sm text-gray-500 mt-1 capitalize">
          {job.status.replace(/_/g, ' ')}
          {job.quotedPrice != null ? ` · ${formatPrice(job.quotedPrice)}` : ''}
        </p>
      </div>
      <dl className="bg-white rounded-xl border p-5 space-y-3 text-sm">
        <div>
          <dt className="font-medium">Tailor</dt>
          <dd>
            {job.tailorSlug ? (
              <Link
                href={`/tailors/${job.tailorSlug}`}
                className="text-[#B8960C]"
              >
                {job.tailorDisplayName || job.tailorSlug}
              </Link>
            ) : (
              job.tailorDisplayName || '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Measurements</dt>
          <TailoringJobMeasurements
            snapshot={job.measurementSnapshot}
            label={job.measurementLabel}
          />
        </div>
        {job.description ? (
          <div>
            <dt className="font-medium">Description</dt>
            <dd className="whitespace-pre-line">{job.description}</dd>
          </div>
        ) : null}
        {job.style || job.eventType ? (
          <div>
            <dt className="font-medium">Style / event</dt>
            <dd>{[job.style, job.eventType].filter(Boolean).join(' · ')}</dd>
          </div>
        ) : null}
        {job.quotedPrice != null ? (
          <div>
            <dt className="font-medium">Quote</dt>
            <dd>{formatPrice(job.quotedPrice)}</dd>
          </div>
        ) : null}
        {typeof job.taxAmount === 'number' && job.taxAmount > 0 ? (
          <div>
            <dt className="font-medium">{job.taxLabel || 'Tax'}</dt>
            <dd>{formatPrice(job.taxAmount)}</dd>
          </div>
        ) : null}
        {typeof job.amount === 'number' && job.amount > 0 ? (
          <div>
            <dt className="font-medium">Total</dt>
            <dd className="font-semibold">{formatPrice(job.amount)}</dd>
          </div>
        ) : null}
        {job.paymentReference ? (
          <div>
            <dt className="font-medium">Payment receipt</dt>
            <dd>
              <span className="text-emerald-700">Paid</span>
              {job.paidAt
                ? ` · ${new Date(job.paidAt).toLocaleString()}`
                : ''}
              {job.paymentProvider ? ` via ${job.paymentProvider}` : ''}
              <div className="text-xs text-gray-500 break-all mt-1">
                Ref {job.paymentReference}
              </div>
            </dd>
          </div>
        ) : null}
      </dl>

      <TailoringJobReferenceImages
        images={job.referenceImages}
        className="bg-white rounded-xl border p-5"
      />

      {canPay ? (
        <div className="bg-[#FFF8E7] border border-[#E8D48B] rounded-xl p-5 space-y-3">
          <p className="text-sm text-gray-800">
            Your quote is ready. Pay securely to start the job.
          </p>
          <button
            type="button"
            disabled={payMut.isPending}
            onClick={() => void startPayment()}
            className="rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#c4a030] disabled:opacity-60"
          >
            {payMut.isPending ? 'Redirecting…' : 'Pay with Stripe'}
          </button>
        </div>
      ) : null}

      <section className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3">Timeline</h2>
        <ol className="space-y-2 text-sm">
          {job.statusHistory.map((h, i) => (
            <li key={`${h.updatedAt}-${i}`} className="border-l-2 pl-3">
              <p className="font-medium capitalize">
                {h.status.replace(/_/g, ' ')}
              </p>
              {h.note ? <p className="text-gray-600">{h.note}</p> : null}
              <p className="text-xs text-gray-400">
                {new Date(h.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {job.canReview ? (
        <section className="bg-white rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold">Leave a review</h2>
          <label className="block text-sm">
            Rating
            <select
              value={reviewRating}
              onChange={(e) => setReviewRating(Number(e.target.value))}
              className="mt-1 block rounded-lg border px-3 py-2"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} stars
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            placeholder="Optional comment"
            className="w-full rounded-lg border px-3 py-2 text-sm min-h-[80px]"
          />
          <button
            type="button"
            disabled={reviewMut.isPending}
            onClick={() => void submitReview()}
            className="rounded-xl bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {reviewMut.isPending ? 'Submitting…' : 'Submit review'}
          </button>
        </section>
      ) : null}
      {job.hasReview ? (
        <p className="text-sm text-emerald-700">Review submitted. Thank you!</p>
      ) : null}

      {job.status === 'submitted' ? (
        <button
          type="button"
          className="rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700"
          onClick={() =>
            void patchMut
              .mutateAsync({
                id,
                payload: {
                  status: 'cancelled',
                  note: 'Cancelled by customer',
                },
              })
              .then(() => addToast('Cancelled', 'success'))
          }
        >
          Cancel request
        </button>
      ) : null}
      {job.status === 'payment_pending' ? (
        <button
          type="button"
          disabled={cancelCheckoutMut.isPending}
          className="rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700"
          onClick={() =>
            void cancelCheckoutMut
              .mutateAsync(id)
              .then(() => {
                void refetch();
                addToast('Checkout cancelled — quote still open', 'success');
              })
              .catch((err) =>
                addToast(
                  err instanceof Error ? err.message : 'Could not cancel checkout',
                  'error'
                )
              )
          }
        >
          Cancel checkout
        </button>
      ) : null}
    </div>
  );
}
