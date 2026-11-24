'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Link2,
  Loader2,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import {
  useExportAllCampaignParticipantsMutation,
  useExportCampaignParticipantsMutation,
  useTailorCreditsQuery,
} from '@/hooks/useMeasurementCampaigns';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TailorCreditsPage() {
  const { addToast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } =
    useTailorCreditsQuery();
  const exportMut = useExportCampaignParticipantsMutation();
  const exportAllMut = useExportAllCampaignParticipantsMutation();
  const [exportCampaignId, setExportCampaignId] = useState('all');

  const wallet = data?.wallet ?? {
    purchased: 0,
    used: 0,
    reserved: 0,
    available: 0,
  };
  const progress = data?.measurementProgress ?? {
    completed: 0,
    total: 0,
    percent: 0,
  };

  const exportTargetId = useMemo(() => {
    if (exportCampaignId === 'all') return null;
    return exportCampaignId;
  }, [exportCampaignId]);

  const runExport = () => {
    const pending = exportTargetId
      ? exportMut.mutateAsync(exportTargetId)
      : exportAllMut.mutateAsync();
    void pending
      .then(({ filename, blob }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        addToast('Report downloaded', 'success');
      })
      .catch((err) =>
        addToast(err instanceof Error ? err.message : 'Export failed', 'error')
      );
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      <div>
        <Link
          href="/tailor/campaigns"
          className="mb-2 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
        >
          <ArrowLeft size={14} />
          Campaigns
        </Link>
        <h2 className="text-xl font-semibold text-stone-900">
          Sponsored AI credits
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Campaign creation follows your company plan limit. Buy AI credits so
          your participants never pay for their scan.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-stone-400" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-800">Could not load credit summary.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['Purchased', wallet.purchased, Wallet, 'text-stone-900'],
                ['Used', wallet.used, Sparkles, 'text-stone-800'],
                ['Reserved', wallet.reserved, Sparkles, 'text-stone-800'],
                ['Available', wallet.available, Link2, 'text-emerald-700'],
              ] as const
            ).map(([label, value, Icon, color]) => (
              <div
                key={label}
                className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm"
              >
                <div className="flex items-center gap-2 text-stone-400">
                  <Icon size={16} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {label}
                  </span>
                </div>
                <p className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            No AI credit packs are available right now. Please check back shortly.
            {isFetching ? (
              <Loader2
                size={14}
                className="ml-2 inline animate-spin text-stone-400"
              />
            ) : null}
          </p>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-stone-800">
                Measurement progress
              </span>
              <span className="text-stone-600">
                {progress.completed}/{progress.total} completed ·{' '}
                {progress.percent}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-stone-900 transition-all"
                style={{ width: `${Math.min(100, progress.percent)}%` }}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-2">
              <Download size={18} className="mt-0.5 text-stone-500" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-stone-900">Export report</h3>
                <p className="mt-1 text-xs text-stone-500">
                  Each participant occupies one row with name, email, phone,
                  status, campaign details and all measurements.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="min-w-[200px] flex-1 text-sm">
                <span className="mb-1 block font-medium text-stone-700">
                  Participants
                </span>
                <select
                  value={exportCampaignId}
                  onChange={(e) => setExportCampaignId(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2.5"
                >
                  <option value="all">All participants</option>
                  {data?.campaigns.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={
                  exportMut.isPending ||
                  exportAllMut.isPending ||
                  (exportCampaignId !== 'all' && !exportTargetId)
                }
                onClick={runExport}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-40"
              >
                CSV
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-stone-900">Recent activity</h3>
            {(data?.recentActivity.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                Invites, joins, and submissions will show here.
              </p>
            ) : (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {data?.recentActivity.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-stone-100 px-3 py-2.5 text-sm"
                  >
                    <span className="text-stone-800">{item.label}</span>
                    <span className="shrink-0 text-xs text-stone-400">
                      {formatWhen(item.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-stone-900">
              Purchase history &amp; credit transactions
            </h3>
            {(data?.creditTransactions.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-stone-500">
                Credit usage will appear here when sponsored scans run.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                      <th className="px-2 py-2">When</th>
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Credits</th>
                      <th className="px-2 py-2">Amount</th>
                      <th className="px-2 py-2">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {data?.creditTransactions.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-2 py-2.5 text-stone-600">
                          {formatWhen(row.occurredAt)}
                        </td>
                        <td className="px-2 py-2.5 text-stone-700">
                          {row.type}
                        </td>
                        <td className="px-2 py-2.5 font-medium text-red-600">
                          {row.credits}
                        </td>
                        <td className="px-2 py-2.5 text-stone-400">—</td>
                        <td className="px-2 py-2.5 text-stone-600">
                          {row.reference}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
