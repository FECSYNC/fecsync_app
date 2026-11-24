'use client';

import { useMemo, useState } from 'react';
import { Info, Loader2, Megaphone, Search } from 'lucide-react';
import {
  useMyCampaignParticipationsQuery,
} from '@/hooks/useMeasurementCampaigns';
import type { CustomerCampaignParticipationDto } from '@/lib/measurementCampaigns.shared';
import SubmitMeasurementsModal from '@/components/Public_C/campaigns/SubmitMeasurementsModal';
import CustomerCampaignCard from './CustomerCampaignCard';
import Link from 'next/link';

type StatusFilter =
  | 'all'
  | 'invited'
  | 'accepted'
  | 'completed'
  | 'closed';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'invited', label: 'Invited' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'completed', label: 'Completed' },
  { id: 'closed', label: 'Closed' },
];

function matchesStatusFilter(
  p: CustomerCampaignParticipationDto,
  filter: StatusFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'completed') return p.participantStatus === 'completed';
  if (filter === 'closed') {
    return (
      p.participantStatus !== 'completed' &&
      (Boolean(p.campaignClosed) || Boolean(p.participantInviteExpired))
    );
  }
  if (filter === 'invited') {
    return (
      p.participantStatus === 'invited' && !p.participantInviteExpired
    );
  }
  if (filter === 'accepted') {
    return (
      p.participantStatus === 'accepted' &&
      !p.campaignClosed &&
      !p.campaignNotStarted
    );
  }
  return true;
}

function matchesSearch(
  p: CustomerCampaignParticipationDto,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    p.campaignName.toLowerCase().includes(q) ||
    p.organizerName.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q)
  );
}

function parseInviteTokenFromJoinPath(joinPath: string): string | undefined {
  const query = joinPath.split('?')[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get('invite')?.trim() || undefined;
}

function parseGroupTokenFromJoinPath(joinPath: string): string | undefined {
  const query = joinPath.split('?')[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get('group')?.trim() || undefined;
}

/** Resolve invite/group tokens for submit — joinPath, groupJoinPath, or coordinator shareToken. */
function resolveSubmitTokens(
  participation: CustomerCampaignParticipationDto
): { inviteToken?: string; groupToken?: string } {
  const inviteToken = parseInviteTokenFromJoinPath(participation.joinPath);
  const groupToken =
    parseGroupTokenFromJoinPath(participation.joinPath) ??
    parseGroupTokenFromJoinPath(participation.groupJoinPath ?? '') ??
    (participation.shareToken?.trim() || undefined);
  return { inviteToken, groupToken };
}

export default function CustomerCampaignsSection() {
  const { data, isLoading, error, refetch } =
    useMyCampaignParticipationsQuery();
  const participations = data?.participations ?? [];
  const emailVerificationRequired = Boolean(data?.emailVerificationRequired);
  const [submitTarget, setSubmitTarget] =
    useState<CustomerCampaignParticipationDto | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    return participations.filter(
      (p) => matchesSearch(p, search) && matchesStatusFilter(p, statusFilter)
    );
  }, [participations, search, statusFilter]);

  const activeSubmitTarget = useMemo(() => {
    if (!submitTarget) return null;
    return (
      participations.find((p) => p.participantId === submitTarget.participantId) ??
      submitTarget
    );
  }, [submitTarget, participations]);

  const showFilters = participations.length > 0;

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-stone-900 md:text-2xl">
          Measurement campaigns
        </h1>
      </div>

      <div className="flex gap-3 rounded-2xl border border-[#E8DDB8] bg-[#FFF8E7] px-4 py-3.5 text-sm text-stone-800">
        <Info
          size={18}
          className="mt-0.5 shrink-0 text-[#8A6D00]"
          aria-hidden
        />
        <p>
          Measurement campaigns you&apos;re part of appear here. Join from your
          tailor&apos;s link, then submit measurements when you&apos;re ready.
        </p>
      </div>

      {showFilters ? (
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by campaign, organizer, or category…"
              className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/25"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(({ id, label }) => {
              const active = statusFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-stone-900 text-white'
                      : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-stone-400" size={28} />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">Failed to load your campaigns.</p>
      ) : emailVerificationRequired ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <p className="text-sm text-amber-900">
            Verify your email address to see measurement campaigns you were
            invited to.
          </p>
          <Link
            href="/profile?tab=info"
            className="mt-4 inline-flex rounded-full bg-stone-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Go to My info
          </Link>
        </div>
      ) : participations.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF8E7] text-[#8A6D00]">
            <Megaphone size={26} />
          </div>
          <p className="mt-4 text-stone-700">
            You have not joined any measurement campaigns yet. When a tailor
            shares a link with you, join there — then return here to submit
            measurements.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="text-sm text-stone-600">
            No campaigns match your search or filter.
          </p>
        </div>
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Campaigns you were invited to
          </h2>
          <ul className="space-y-4">
            {filtered.map((p) => (
              <li key={p.participantId}>
                <CustomerCampaignCard
                  participation={p}
                  onSubmit={() => setSubmitTarget(p)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeSubmitTarget ? (
        <SubmitMeasurementsModal
          open
          onClose={() => setSubmitTarget(null)}
          slug={activeSubmitTarget.slug}
          campaignName={activeSubmitTarget.campaignName}
          {...resolveSubmitTokens(activeSubmitTarget)}
          sponsoredScansRemaining={activeSubmitTarget.sponsoredScansRemaining}
          onSubmitted={() => void refetch()}
        />
      ) : null}
    </div>
  );
}
