'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAdminTailoringJobsQuery } from '@/hooks/useTailoringJobs';
import { formatPrice } from '@/utils/currency';
import { PageSpinner } from '@/components/Protected/admin/components/Spinner';
import type { TailoringJobStatus } from '@/lib/tailoringJobs.shared';

const STATUS_TABS: Array<{ id: '' | TailoringJobStatus; label: string }> = [
  { id: '', label: 'All' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'payment_pending', label: 'Payment pending' },
  { id: 'paid', label: 'Paid' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function AdminTailoringJobsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | TailoringJobStatus>('');
  const { data: jobs = [], isPending } = useAdminTailoringJobsQuery({
    q,
    status,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tailoring jobs</h1>
        <p className="text-sm text-gray-600 mt-1">
          Org-scoped job list. Detail is read-only for{" "}
          <code className="text-xs">tailoring_jobs:read</code>; status advances
          require <code className="text-xs">tailoring_jobs:manage</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id || 'all'}
            type="button"
            onClick={() => setStatus(tab.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              status === tab.id
                ? 'bg-stone-900 text-white'
                : 'bg-white border text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search title, customer, tailor…"
        className="w-full max-w-md rounded-xl border px-3 py-2 text-sm"
      />

      {isPending && jobs.length === 0 ? (
        <PageSpinner className="h-48" />
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center text-gray-600">
          No jobs found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Tailor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Quote</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job._id} className="border-t">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tailoring-jobs/${job._id}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {job.customerName || job.customerEmail || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {job.tailorDisplayName || '—'}
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {job.status.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    {job.quotedPrice != null
                      ? formatPrice(job.quotedPrice)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
