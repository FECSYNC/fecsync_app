'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import {
  useTailoringJobQuery,
  usePatchTailoringJobMutation,
} from '@/hooks/useTailoringJobs';
import { formatPrice } from '@/utils/currency';
import { useToast } from '@/contexts/toast-context';
import { useState } from 'react';
import TailoringJobReferenceImages from '@/components/tailoring/TailoringJobReferenceImages';
import TailoringJobMeasurements from '@/components/tailoring/TailoringJobMeasurements';

export default function TailorJobDetailClient({ id }: { id: string }) {
  const { addToast } = useToast();
  const { data: job, isLoading, isError } = useTailoringJobQuery(id);
  const patchMut = usePatchTailoringJobMutation();
  const [quote, setQuote] = useState('');
  const [declineNote, setDeclineNote] = useState('');

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (isError || !job) {
    return (
      <div className="text-center py-16">
        <p>Job not found</p>
        <Link href="/tailor/jobs" className="text-sm text-[#B8960C]">
          Back to jobs
        </Link>
      </div>
    );
  }

  const canComplete =
    job.status === 'paid' || job.status === 'in_progress';

  return (
    <div className="space-y-6">
      <Link href="/tailor/jobs" className="text-sm text-stone-600">
        ← Jobs
      </Link>
      <div>
        <h2 className="text-2xl font-semibold">{job.title}</h2>
        <p className="text-sm text-stone-500 mt-1 capitalize">
          {job.status.replace(/_/g, ' ')}
        </p>
      </div>
      <dl className="bg-white rounded-xl border p-5 space-y-3 text-sm">
        <div>
          <dt className="font-medium">Customer</dt>
          <dd>{job.customerName || job.customerEmail || job.customer}</dd>
        </div>
        {job.description ? (
          <div>
            <dt className="font-medium">Description</dt>
            <dd className="whitespace-pre-line">{job.description}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium">Style / event</dt>
          <dd>
            {[job.style, job.eventType].filter(Boolean).join(' · ') || '—'}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Measurements</dt>
          <TailoringJobMeasurements
            snapshot={job.measurementSnapshot}
            label={job.measurementLabel}
          />
        </div>
        {job.quotedPrice != null ? (
          <div>
            <dt className="font-medium">Quote</dt>
            <dd>{formatPrice(job.quotedPrice)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium">Payment</dt>
          <dd>
            {job.paymentReference || job.paidAt ? (
              <span className="text-emerald-700">
                Paid
                {job.paidAt
                  ? ` · ${new Date(job.paidAt).toLocaleString()}`
                  : ''}
                {typeof job.amount === 'number'
                  ? ` · ${formatPrice(job.amount)}`
                  : ''}
              </span>
            ) : job.status === 'quoted' || job.status === 'payment_pending' ? (
              <span className="text-amber-700">Awaiting customer payment</span>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>

      <TailoringJobReferenceImages
        images={job.referenceImages}
        className="bg-white rounded-xl border p-5"
      />

      <section className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold mb-3">Timeline</h3>
        <ol className="space-y-2 text-sm">
          {job.statusHistory.map((h, i) => (
            <li
              key={`${h.status}-${i}`}
              className="border-l-2 border-stone-200 pl-3"
            >
              <p className="font-medium capitalize">
                {h.status.replace(/_/g, ' ')}
              </p>
              {h.note ? <p className="text-stone-600">{h.note}</p> : null}
              <p className="text-xs text-stone-400">
                {new Date(h.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {job.status === 'submitted' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white"
            onClick={() =>
              void patchMut
                .mutateAsync({ id, payload: { status: 'accepted' } })
                .then(() => addToast('Accepted', 'success'))
            }
          >
            Accept
          </button>
          <input
            value={declineNote}
            onChange={(e) => setDeclineNote(e.target.value)}
            placeholder="Decline reason"
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <button
            type="button"
            className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700"
            onClick={() =>
              void patchMut
                .mutateAsync({
                  id,
                  payload: {
                    status: 'cancelled',
                    note: declineNote || 'Declined by tailor',
                  },
                })
                .then(() => addToast('Declined', 'success'))
            }
          >
            Decline
          </button>
        </div>
      ) : null}

      {job.status === 'accepted' ? (
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="Quoted price"
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <button
            type="button"
            className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-white"
            onClick={() => {
              const amount = Number(quote);
              if (!Number.isFinite(amount) || amount <= 0) {
                addToast('Enter a valid amount', 'error');
                return;
              }
              void patchMut
                .mutateAsync({
                  id,
                  payload: { status: 'quoted', quotedPrice: amount },
                })
                .then(() => addToast('Quote sent', 'success'));
            }}
          >
            Send quote
          </button>
        </div>
      ) : null}

      {canComplete ? (
        <button
          type="button"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
          disabled={patchMut.isPending}
          onClick={() =>
            void patchMut
              .mutateAsync({
                id,
                payload: {
                  status: 'completed',
                  note: 'Marked completed by tailor',
                },
              })
              .then(() => addToast('Marked completed', 'success'))
          }
        >
          Mark completed
        </button>
      ) : null}
    </div>
  );
}
