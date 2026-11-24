'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Megaphone,
  Plus,
  Search,
  Link2,
  Pencil,
  Archive,
  Loader2,
  Users,
  Coins,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import {
  campaignKeys,
  useArchiveCampaignMutation,
  useCampaignsQuery,
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
} from '@/hooks/useMeasurementCampaigns';
import { useMyTailorQuery } from '@/hooks/useTailors';
import {
  DEFAULT_CAMPAIGN_CATEGORIES,
  type MeasurementCampaignDto,
} from '@/lib/measurementCampaigns.shared';
import CampaignFormModal from '@/components/Protected/tailor/CampaignFormModal';
import CampaignParticipantsModal from '@/components/Protected/tailor/CampaignParticipantsModal';
import { isUnlimitedPlanCap } from '@/lib/subscriptionPlans';

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    draft: 'bg-stone-100 text-stone-700',
    archived: 'bg-stone-100 text-stone-500',
    expired: 'bg-red-50 text-red-700',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        styles[status] ?? styles.draft
      }`}
    >
      {status}
    </span>
  );
}

export default function CampaignsPage() {
  const { addToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const deepLinkCampaignId = searchParams.get('campaign')?.trim() || '';
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({ page, q, status: statusFilter, category: categoryFilter, sort }),
    [page, q, statusFilter, categoryFilter, sort]
  );

  const { data: tailor } = useMyTailorQuery();
  const canShareJoinLink = tailor?.status === 'approved';

  const { data, isLoading, isFetching, isError, error, refetch } =
    useCampaignsQuery(filters);
  const createMut = useCreateCampaignMutation();
  const updateMut = useUpdateCampaignMutation();
  const archiveMut = useArchiveCampaignMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MeasurementCampaignDto | null>(null);
  const [participantsCampaign, setParticipantsCampaign] =
    useState<MeasurementCampaignDto | null>(null);
  const [archiveTarget, setArchiveTarget] =
    useState<MeasurementCampaignDto | null>(null);

  const campaigns = data?.campaigns ?? [];
  const campaignPlanLimit = data?.planLimit;
  const campaignPlanUsed = data?.planUsed;
  const planReady =
    typeof campaignPlanLimit === 'number' &&
    typeof campaignPlanUsed === 'number';
  const campaignUnlimited = planReady && isUnlimitedPlanCap(campaignPlanLimit);
  const campaignUsed = planReady ? campaignPlanUsed : 0;
  // null = unlimited for the form; 0 while loading / incomplete so create stays blocked.
  const campaignRemaining = !planReady
    ? 0
    : campaignUnlimited
      ? null
      : Math.max(0, campaignPlanLimit - campaignUsed);
  const campaignsAtLimit =
    !planReady ||
    (!campaignUnlimited && (campaignRemaining ?? 0) <= 0);

  // Open participants from notification deep link (?campaign=id).
  useEffect(() => {
    if (!deepLinkCampaignId || participantsCampaign) return;
    const match = campaigns.find((c) => c._id === deepLinkCampaignId);
    if (match) {
      setParticipantsCampaign(match);
      return;
    }
    // If not on this page of results, still open with a minimal stub; modal fetches detail.
    if (!isLoading && data) {
      setParticipantsCampaign({
        _id: deepLinkCampaignId,
        slug: '',
        name: 'Campaign',
        category: 'Other',
        startDate: new Date().toISOString(),
        status: 'active',
        sponsoredScansPerInvitee: 0,
        aiCreditsPurchased: 0,
        aiCreditsUsed: 0,
        aiCreditsReserved: 0,
        aiCreditsAvailable: 0,
        customCategories: [],
        ownerLabel: 'You',
        participantCount: 0,
        stats: {
          invited: 0,
          accepted: 0,
          completed: 0,
          pending: 0,
          completionPercent: 0,
        },
        joinPath: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [deepLinkCampaignId, campaigns, participantsCampaign, isLoading, data]);

  const closeParticipants = () => {
    setParticipantsCampaign(null);
    void queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    if (deepLinkCampaignId) {
      router.replace('/tailor/campaigns');
    }
  };
  const totalPages = data?.totalPages ?? 1;
  const hasActiveFilters =
    Boolean(q.trim()) ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all';

  const clearFilters = () => {
    setQ('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setSort('newest');
    setPage(1);
  };

  const categoryOptions = useMemo(() => {
    const fromRows = campaigns.map((c) => c.category).filter(Boolean);
    return Array.from(
      new Set([...DEFAULT_CAMPAIGN_CATEGORIES, ...fromRows])
    ).sort((a, b) => a.localeCompare(b));
  }, [campaigns]);

  const copyJoinLink = async (campaign: MeasurementCampaignDto) => {
    if (!canShareJoinLink) {
      addToast(
        'Your tailor profile must be approved before join links work for customers',
        'error'
      );
      return;
    }
    if (campaign.status !== 'active') {
      addToast(
        campaign.status === 'expired'
          ? 'This campaign has expired — extend the expiry date or create a new one'
          : 'Set the campaign to Active before sharing the join link',
        'error'
      );
      return;
    }
    const url = `${window.location.origin}${campaign.joinPath || `/join/${campaign.slug}`}`;
    try {
      await navigator.clipboard.writeText(url);
      addToast('Join link copied', 'success');
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-24 md:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-stone-900">Campaigns</h2>
          <p className="mt-1 text-sm text-stone-500">
            Measurement collection for weddings, uniforms, and events.
            {!campaignUnlimited && campaignPlanLimit != null
              ? ` · ${campaignUsed}/${campaignPlanLimit} on your company plan`
              : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/tailor/campaigns/credits"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4AF37]/40 bg-[#FFF8E7] px-4 py-2 text-sm font-medium text-[#8A6D00] hover:bg-[#FFF0CC]"
          >
            <Coins size={16} />
            AI credits
          </Link>
          <button
            type="button"
            disabled={campaignsAtLimit}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
            <Megaphone size={18} />
          </span>
          <div>
            <h3 className="font-semibold text-stone-900">
              Measurement Campaigns
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Collect measurements from many people at once — weddings,
              uniforms, teams, graduations. Plan limits apply; archive a
              campaign to free a slot.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block sm:col-span-2">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search campaigns"
              className="w-full rounded-xl border border-stone-200 py-2.5 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-xl border border-stone-200 px-3 py-2.5 text-sm"
            aria-label="Sort campaigns"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm sm:max-w-xs"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </section>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-stone-400" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
          <p className="font-medium">Could not load campaigns</p>
          <p className="mt-1 text-amber-900/80">
            {error instanceof Error
              ? error.message
              : 'Check your connection or tailor access, then try again.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-stone-800"
          >
            Retry
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-12 text-center">
          <Megaphone className="mx-auto text-stone-300" size={32} />
          {hasActiveFilters ? (
            <>
              <p className="mt-3 text-stone-600">
                No campaigns match your filters.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="mt-3 text-stone-600">No campaigns yet.</p>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="mt-4 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white"
              >
                Create your first campaign
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Participants</th>
                <th className="px-4 py-3">Completion</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {campaigns.map((c) => (
                <tr key={c._id} className="hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setParticipantsCampaign(c)}
                      className="text-left"
                    >
                      <p className="font-medium text-stone-900 hover:text-[#B8960C]">
                        {c.name}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {c.participantCount} participant
                        {c.participantCount === 1 ? '' : 's'}
                      </p>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{c.category}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {c.ownerLabel || 'You'}
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {formatShortDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3 text-stone-600 tabular-nums">
                    {c.participantCount}
                  </td>
                  <td className="min-w-[130px] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <div
                          className="h-full rounded-full bg-[#D4AF37]"
                          style={{
                            width: `${Math.min(100, c.stats.completionPercent)}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs text-stone-500">
                        {c.stats.completionPercent}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-600">
                    {formatDate(c.expiryDate)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title="Participants"
                        onClick={() => setParticipantsCampaign(c)}
                        className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                      >
                        <Users size={15} />
                      </button>
                      <button
                        type="button"
                        title="Copy join link"
                        onClick={() => void copyJoinLink(c)}
                        className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                      >
                        <Link2 size={15} />
                      </button>
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                      >
                        <Pencil size={15} />
                      </button>
                      {c.status !== 'archived' ? (
                        <button
                          type="button"
                          title="Archive"
                          onClick={() => setArchiveTarget(c)}
                          className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                        >
                          <Archive size={15} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-stone-600">
        <p>
          Page {page} of {totalPages} · {data?.total ?? 0} campaign
          {(data?.total ?? 0) === 1 ? '' : 's'}
          {isFetching && !isLoading ? ' · Updating…' : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-stone-200 px-3 py-1 disabled:opacity-40"
          >
            ←
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-stone-200 px-3 py-1 disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>

      <CampaignFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        initial={editing}
        busy={createMut.isPending || updateMut.isPending}
        remainingCampaigns={campaignRemaining}
        planLimit={campaignUnlimited ? null : campaignPlanLimit ?? null}
        planResolved={data?.planResolved ?? null}
        billingEntitled={data?.billingEntitled}
        onSubmit={async (payload) => {
          try {
            if (editing) {
              await updateMut.mutateAsync({ id: editing._id, payload });
              addToast('Campaign updated', 'success');
            } else {
              await createMut.mutateAsync(payload);
              addToast('Campaign created', 'success');
            }
            setFormOpen(false);
            setEditing(null);
          } catch (err) {
            addToast(
              err instanceof Error ? err.message : 'Save failed',
              'error'
            );
          }
        }}
      />

      <CampaignParticipantsModal
        open={Boolean(participantsCampaign)}
        campaign={participantsCampaign}
        onClose={closeParticipants}
      />

      {archiveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-campaign-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3
              id="archive-campaign-title"
              className="text-lg font-semibold text-stone-900"
            >
              Archive this campaign?
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              <span className="font-medium text-stone-800">
                {archiveTarget.name}
              </span>{' '}
              will leave your active list. Join links stop working; you can
              still find it under Archived.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchiveTarget(null)}
                className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveMut.isPending}
                onClick={() =>
                  void archiveMut
                    .mutateAsync(archiveTarget._id)
                    .then(() => {
                      addToast('Campaign archived', 'success');
                      setArchiveTarget(null);
                    })
                    .catch((err) =>
                      addToast(
                        err instanceof Error ? err.message : 'Archive failed',
                        'error'
                      )
                    )
                }
                className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {archiveMut.isPending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
