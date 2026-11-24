'use client';

import Link from 'next/link';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import type { CustomerCampaignParticipationDto } from '@/lib/measurementCampaigns.shared';
import {
  DEFAULT_CAMPAIGN_JOIN_INSTRUCTIONS,
  DEFAULT_CAMPAIGN_JOIN_PRIVACY,
} from '@/lib/measurementCampaigns.shared';
import CoordinatorGroupPanel from './CoordinatorGroupPanel';

type Props = {
  participation: CustomerCampaignParticipationDto;
  onSubmit: () => void;
  submitPending?: boolean;
};

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function statusLabel(participation: CustomerCampaignParticipationDto) {
  if (participation.participantStatus === 'completed') return 'Completed';
  if (
    participation.campaignClosed &&
    participation.participantStatus === 'accepted'
  ) {
    return 'Campaign closed';
  }
  if (participation.participantInviteExpired) return 'Invite expired';
  if (participation.participantStatus === 'accepted') return 'Accepted';
  if (participation.participantStatus === 'invited') return 'Invited';
  return participation.participantStatus;
}

function statusTone(participation: CustomerCampaignParticipationDto) {
  if (participation.participantStatus === 'completed') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (participation.campaignClosed) {
    return 'bg-stone-100 text-stone-600 border-stone-200';
  }
  if (participation.participantInviteExpired) {
    return 'bg-amber-50 text-amber-900 border-amber-200';
  }
  if (participation.participantStatus === 'accepted') {
    return 'bg-[#FFF8E7] text-[#8A6D00] border-[#E8DDB8]';
  }
  return 'bg-stone-100 text-stone-700 border-stone-200';
}

export default function CustomerCampaignCard({
  participation,
  onSubmit,
  submitPending = false,
}: Props) {
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const isCompleted = participation.participantStatus === 'completed';
  const campaignClosed = Boolean(participation.campaignClosed);
  const notStartedYet =
    participation.campaignNotStarted ??
    (participation.startDate
      ? new Date(participation.startDate).getTime() > Date.now()
      : false);
  const canSubmit =
    participation.participantStatus === 'accepted' &&
    !isCompleted &&
    !campaignClosed &&
    !notStartedYet;
  const canJoin =
    participation.participantStatus === 'invited' &&
    !participation.participantInviteExpired &&
    !campaignClosed &&
    !notStartedYet;

  const scansAllocated = participation.sponsoredScansAllocated;
  const scansUsed = participation.sponsoredScansUsed;
  const scansLeft = participation.sponsoredScansRemaining;
  const scanPercent =
    scansAllocated > 0
      ? Math.min(100, Math.round((scansUsed / scansAllocated) * 100))
      : 0;

  const instructions =
    participation.instructions?.trim() || DEFAULT_CAMPAIGN_JOIN_INSTRUCTIONS;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-stone-900 truncate">
                {participation.campaignName}
              </h2>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                {participation.category}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-stone-600">
              Organised by {participation.organizerName}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusTone(participation)}`}
          >
            {statusLabel(participation)}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
          {participation.eventDate ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={14} aria-hidden />
              Event {formatDate(participation.eventDate)}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Calendar size={14} aria-hidden />
            Opens {formatDate(participation.startDate)}
          </span>
          {participation.expiryDate ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={14} aria-hidden />
              Closes {formatDate(participation.expiryDate)}
            </span>
          ) : null}
        </div>

        {scansAllocated > 0 ? (
          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-sm text-stone-700">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Sparkles
                  size={16}
                  className="shrink-0 text-[#8A6D00]"
                  aria-hidden
                />
                Sponsored AI scans
              </span>
              <span className="tabular-nums text-xs text-stone-600">
                {scansUsed} / {scansAllocated}
                {scansLeft > 0 ? ` · ${scansLeft} left` : ''}
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-stone-200"
              role="progressbar"
              aria-valuenow={scansUsed}
              aria-valuemin={0}
              aria-valuemax={scansAllocated}
              aria-label={`${scansUsed} of ${scansAllocated} sponsored AI scans used`}
            >
              <div
                className="h-full rounded-full bg-[#D4AF37] transition-[width]"
                style={{ width: `${scanPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-2 text-sm text-stone-600">
          <p className="whitespace-pre-line line-clamp-3">{instructions}</p>
          <p className="text-xs text-stone-500">{DEFAULT_CAMPAIGN_JOIN_PRIVACY}</p>
        </div>

        {participation.canInviteMembers ? (
          <>
            <button
              type="button"
              onClick={() => setGroupPanelOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E8DDB8] bg-[#FFF8E7]/60 px-4 py-3 text-left text-sm font-medium text-stone-800 md:hidden"
              aria-expanded={groupPanelOpen}
            >
              <span>Manage your group</span>
              <ChevronDown
                size={18}
                className={`shrink-0 text-[#8A6D00] transition-transform ${
                  groupPanelOpen ? 'rotate-180' : ''
                }`}
                aria-hidden
              />
            </button>
            <div className={`${groupPanelOpen ? 'block' : 'hidden'} md:block`}>
              <CoordinatorGroupPanel participation={participation} />
            </div>
          </>
        ) : null}
      </div>

      <div className="border-t border-stone-100 bg-stone-50/50 px-5 py-4">
        {isCompleted ? (
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-emerald-800">
            <CheckCircle2 size={18} aria-hidden />
            Measurements submitted
          </div>
        ) : canSubmit ? (
          <button
            type="button"
            disabled={submitPending}
            onClick={onSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-stone-900 py-3 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {submitPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Opening…
              </>
            ) : (
              <>
                <Send size={16} aria-hidden />
                Submit my measurements
              </>
            )}
          </button>
        ) : canJoin ? (
          <Link
            href={participation.joinPath}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-stone-900 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Join campaign
          </Link>
        ) : notStartedYet && participation.participantStatus === 'invited' ? (
          <p className="text-center text-sm text-amber-800">
            Opens {formatDate(participation.startDate)} — check back then to
            join.
          </p>
        ) : participation.participantInviteExpired ? (
          <p className="text-center text-sm text-amber-900">
            Ask your tailor to send a new invitation link.
          </p>
        ) : campaignClosed ? (
          <p className="text-center text-sm text-stone-600">
            This campaign has closed and is no longer accepting measurements.
          </p>
        ) : null}
      </div>
    </article>
  );
}
