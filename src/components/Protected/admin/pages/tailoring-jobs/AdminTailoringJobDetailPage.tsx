'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  useAdminTailoringJobQuery,
  usePatchAdminTailoringJobMutation,
} from '@/hooks/useTailoringJobs';
import { formatPrice } from '@/utils/currency';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import { useToast } from '@/contexts/toast-context';
import { allowedTransitions } from '@/lib/tailoringJobs.shared';
import { P } from '@/lib/auth/permissions';
import { useAuthStore } from '@/store/authStore';
import TailoringJobReferenceImages from '@/components/tailoring/TailoringJobReferenceImages';
import TailoringJobMeasurements from '@/components/tailoring/TailoringJobMeasurements';
import { AccountingEntriesPanel } from '../accounting/shared';
import { useAccountingInitialized } from '@/hooks/useAccounting';

export default function AdminTailoringJobDetailPage({ id }: { id: string }) {
  const { addToast } = useToast();
  const can = useAuthStore((s) => s.can);
  const canManage = can(P.TailoringJobsManage);
  const { data: job, isLoading, isError } = useAdminTailoringJobQuery(id);
  const patchMut = usePatchAdminTailoringJobMutation();
  const [note, setNote] = useState('');
  const [opsQuote, setOpsQuote] = useState('');
  const { initialized, settings } = useAccountingInitialized(can(P.AccountingRead));

  if (isLoading) return <PageSpinner className="h-64" />;
  if (isError || !job) {
    return (
      <div>
        <p>Job not found</p>
        <Link href="/admin/tailoring-jobs">Back</Link>
      </div>
    );
  }

  const next = canManage ? allowedTransitions('admin', job.status) : [];

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/admin/tailoring-jobs" className="text-sm text-gray-600">
        ← Tailoring jobs
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{job.title}</h1>
        <p className="text-sm text-gray-500 capitalize mt-1">
          {job.status.replace(/_/g, ' ')}
        </p>
      </div>
      <dl className="bg-white rounded-xl border p-5 space-y-2 text-sm">
        <div>
          <dt className="font-medium">Customer</dt>
          <dd>{job.customerEmail || job.customerName || job.customer}</dd>
        </div>
        <div>
          <dt className="font-medium">Tailor</dt>
          <dd>{job.tailorDisplayName || job.tailorProfile}</dd>
        </div>
        <div>
          <dt className="font-medium">Measurements</dt>
          <TailoringJobMeasurements
            snapshot={job.measurementSnapshot}
            label={job.measurementLabel}
          />
        </div>
        <div>
          <dt className="font-medium">Quote</dt>
          <dd>
            {job.quotedPrice != null ? formatPrice(job.quotedPrice) : '—'}
          </dd>
        </div>
        {typeof job.taxAmount === 'number' && job.taxAmount > 0 ? (
          <div>
            <dt className="font-medium">{job.taxLabel || 'Tax'}</dt>
            <dd>{formatPrice(job.taxAmount)}</dd>
          </div>
        ) : null}
        {typeof job.amount === 'number' && job.amount > 0 ? (
          <div>
            <dt className="font-medium">Charged total</dt>
            <dd>{formatPrice(job.amount)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-medium">Payment</dt>
          <dd>
            {job.paymentReference ? (
              <>
                <span className="text-emerald-700">Paid</span>
                {job.paidAt
                  ? ` · ${new Date(job.paidAt).toLocaleString()}`
                  : ''}
                <div className="text-xs text-gray-500 break-all mt-1">
                  {job.paymentProvider}: {job.paymentReference}
                </div>
              </>
            ) : (
              'Unpaid'
            )}
          </dd>
        </div>
      </dl>
      <TailoringJobReferenceImages
        images={job.referenceImages}
        className="bg-white rounded-xl border p-5"
      />
      <section className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold mb-3">Timeline</h2>
        <ol className="space-y-2 text-sm">
          {job.statusHistory.map((h, i) => (
            <li key={`${h.updatedAt}-${i}`}>
              <span className="font-medium capitalize">
                {h.status.replace(/_/g, ' ')}
              </span>
              {h.note ? ` — ${h.note}` : ''}
              <div className="text-xs text-gray-400">
                {new Date(h.updatedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {next.length > 0 ? (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold">Ops transitions</h2>
          <p className="text-xs text-gray-500">
            Prefer customer Stripe checkout for quoted jobs. Manual cancel
            requires a note when possible.
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (required for cancel)"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          {next.includes('quoted') && job.quotedPrice == null ? (
            <input
              type="number"
              min="1"
              value={opsQuote}
              onChange={(e) => setOpsQuote(e.target.value)}
              placeholder="Quoted price (required for → quoted)"
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {next.map((status) => (
              <button
                key={status}
                type="button"
                disabled={patchMut.isPending}
                onClick={() => {
                  if (status === 'cancelled' && !note.trim()) {
                    addToast('Add a cancel note', 'error');
                    return;
                  }
                  if (status === 'quoted' && job.quotedPrice == null) {
                    const amount = Number(opsQuote);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      addToast('Enter a valid quoted price', 'error');
                      return;
                    }
                  }
                  void patchMut
                    .mutateAsync({
                      id,
                      payload: {
                        status,
                        note: note || undefined,
                        ...(status === 'quoted' && job.quotedPrice == null
                          ? { quotedPrice: Number(opsQuote) }
                          : {}),
                      },
                    })
                    .then(() => addToast(`Moved to ${status}`, 'success'));
                }}
                className="rounded-lg border px-3 py-1.5 text-xs capitalize"
              >
                → {status.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {initialized && settings?.postTailoringJobs && job.paidAt ? (
        <AccountingEntriesPanel
          sourceType="tailoring_payment"
          sourceId={id}
          className="mt-6"
        />
      ) : null}
    </div>
  );
}
