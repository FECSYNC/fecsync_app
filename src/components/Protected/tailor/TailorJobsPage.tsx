'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useTailorJobsQuery, usePatchTailoringJobMutation } from '@/hooks/useTailoringJobs';
import { formatPrice } from '@/utils/currency';
import { useToast } from '@/contexts/toast-context';
import { useState } from 'react';

export default function TailorJobsPageClient() {
  const { addToast } = useToast();
  const { data: jobs = [], isLoading } = useTailorJobsQuery();
  const patchMut = usePatchTailoringJobMutation();
  const [quoteDraft, setQuoteDraft] = useState<Record<string, string>>({});
  const [declineDraft, setDeclineDraft] = useState<Record<string, string>>({});

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-stone-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">Jobs</h2>
        <p className="text-sm text-stone-600 mt-1">
          Accept, decline, or quote customer requests. Work starts after the
          customer pays via Stripe.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-stone-600">
          No jobs yet.
        </div>
      ) : (
        <ul className="space-y-4">
          {jobs.map((job) => (
            <li key={job._id} className="rounded-xl border bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/tailor/jobs/${job._id}`}
                    className="font-semibold text-stone-900 hover:underline"
                  >
                    {job.title}
                  </Link>
                  <p className="text-sm text-stone-500 mt-1">
                    {job.customerName || job.customerEmail || 'Customer'} ·{' '}
                    <span className="capitalize">{job.status.replace('_', ' ')}</span>
                  </p>
                </div>
                {job.quotedPrice != null ? (
                  <span className="text-sm font-medium text-[#B8960C]">
                    {formatPrice(job.quotedPrice)}
                  </span>
                ) : null}
              </div>

              {job.status === 'submitted' ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={patchMut.isPending}
                    onClick={() =>
                      void patchMut
                        .mutateAsync({
                          id: job._id,
                          payload: { status: 'accepted' },
                        })
                        .then(() => addToast('Job accepted', 'success'))
                    }
                    className="rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Accept
                  </button>
                  <input
                    value={declineDraft[job._id] ?? ''}
                    onChange={(e) =>
                      setDeclineDraft((d) => ({
                        ...d,
                        [job._id]: e.target.value,
                      }))
                    }
                    placeholder="Decline reason"
                    className="rounded-lg border px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={patchMut.isPending}
                    onClick={() =>
                      void patchMut
                        .mutateAsync({
                          id: job._id,
                          payload: {
                            status: 'cancelled',
                            note: declineDraft[job._id] || 'Declined by tailor',
                          },
                        })
                        .then(() => addToast('Job declined', 'success'))
                    }
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700"
                  >
                    Decline
                  </button>
                </div>
              ) : null}

              {job.status === 'accepted' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={quoteDraft[job._id] ?? ''}
                    onChange={(e) =>
                      setQuoteDraft((d) => ({
                        ...d,
                        [job._id]: e.target.value,
                      }))
                    }
                    placeholder="Quote amount"
                    className="rounded-lg border px-2 py-1 text-xs w-32"
                  />
                  <button
                    type="button"
                    disabled={patchMut.isPending}
                    onClick={() => {
                      const amount = Number(quoteDraft[job._id]);
                      if (!Number.isFinite(amount) || amount < 0) {
                        addToast('Enter a valid quote', 'error');
                        return;
                      }
                      void patchMut
                        .mutateAsync({
                          id: job._id,
                          payload: {
                            status: 'quoted',
                            quotedPrice: amount,
                          },
                        })
                        .then(() => addToast('Quote sent', 'success'));
                    }}
                    className="rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Send quote
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
