'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { signInHref } from '@/utils/authRedirect';
import {
  useJoinCampaignMutation,
  usePublicCampaignQuery,
} from '@/hooks/useMeasurementCampaigns';
import { useToast } from '@/contexts/toast-context';
import CampaignJoinHero from './CampaignJoinHero';
import SubmitMeasurementsModal from './SubmitMeasurementsModal';

export default function JoinCampaignClient({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite')?.trim() || undefined;
  const groupToken = searchParams.get('group')?.trim() || undefined;
  const { addToast } = useToast();
  const { user, hasHydratedAuth } = useAuthStore();
  const authed = Boolean(user);
  const { data: campaign, isLoading, isError, refetch } =
    usePublicCampaignQuery(slug, authed, inviteToken, groupToken);
  const joinMut = useJoinCampaignMutation(slug);
  const [submitOpen, setSubmitOpen] = useState(false);

  const returnPath = inviteToken
    ? `/join/${slug}?invite=${encodeURIComponent(inviteToken)}`
    : groupToken
      ? `/join/${slug}?group=${encodeURIComponent(groupToken)}`
      : `/join/${slug}`;

  const notStartedYet = Boolean(campaign?.campaignNotStarted);
  const campaignClosed = Boolean(campaign?.campaignClosed);
  const invalidGroupLink = Boolean(campaign?.invalidGroupLink);
  const groupLinkNotActive = Boolean(campaign?.groupLinkNotActive);

  const participantStatus = campaign?.participantStatus;
  const inviteExpired = Boolean(campaign?.participantInviteExpired);
  const emailVerificationRequired = Boolean(campaign?.emailVerificationRequired);
  const inviteEmailMismatch = Boolean(campaign?.participantInviteEmailMismatch);
  const isCompleted = participantStatus === 'completed';
  /** §6.4.1: existing direct invitees may accept via a group URL without becoming members. */
  const canAcceptDirectViaGroupLink =
    Boolean(groupToken) &&
    campaign?.participantRole === 'direct' &&
    participantStatus === 'invited' &&
    !invalidGroupLink;
  const canJoin =
    authed &&
    !emailVerificationRequired &&
    !inviteEmailMismatch &&
    !isCompleted &&
    !campaignClosed &&
    !notStartedYet &&
    !invalidGroupLink &&
    (canAcceptDirectViaGroupLink ||
      (!inviteExpired && !(groupToken && groupLinkNotActive))) &&
    (participantStatus == null || participantStatus === 'invited');
  const canSubmit =
    authed &&
    participantStatus === 'accepted' &&
    !isCompleted &&
    !campaignClosed &&
    !notStartedYet;

  const onJoin = () => {
    void joinMut
      .mutateAsync({ inviteToken, groupToken })
      .then(() => {
        addToast("You've joined this campaign", 'success');
        void refetch();
      })
      .catch((err) => {
        addToast(
          err instanceof Error ? err.message : 'Could not join campaign',
          'error'
        );
      });
  };

  if (isLoading || !hasHydratedAuth) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-stone-400" />
      </div>
    );
  }

  if (isError || !campaign) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-stone-900">
          Campaign not found
        </h1>
        <p className="mt-2 text-stone-600">
          This link may have expired or the campaign is no longer active.
        </p>
        <Link
          href="/home"
          className="mt-6 inline-block text-[#B8960C] hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12 space-y-6">
      {campaign.joiningViaGroup && campaign.groupCoordinatorName ? (
        <p className="rounded-xl border border-[#E8D48B] bg-[#FFF8E7] px-4 py-3 text-center text-sm text-stone-800">
          You&apos;re joining{' '}
          <span className="font-semibold">{campaign.groupCoordinatorName}</span>
          &apos;s group
          {campaign.groupCoordinatorLabel
            ? ` (${campaign.groupCoordinatorLabel})`
            : ''}
          .
        </p>
      ) : null}

      {invalidGroupLink ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          This group link is invalid or no longer active. Ask your group
          coordinator for a new link.
        </p>
      ) : null}

      {groupLinkNotActive && campaign.groupCoordinatorName && !canAcceptDirectViaGroupLink ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          <span className="font-semibold">{campaign.groupCoordinatorName}</span>
          &apos;s group link is not active yet. They need to join the campaign
          first — check back soon.
        </p>
      ) : null}

      <CampaignJoinHero campaign={campaign} />

      {campaign.startDate && notStartedYet ? (
        <p className="text-center text-sm text-amber-700">
          This campaign opens{' '}
          {new Date(campaign.startDate).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          .
        </p>
      ) : null}

      {campaign.expiryDate ? (
        <p className="text-center text-xs text-stone-500">
          Closes{' '}
          {new Date(campaign.expiryDate).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      ) : null}

      {/* Anonymous */}
      {!user ? (
        <div className="space-y-3 pt-2">
          {inviteToken ? (
            <p className="text-center text-sm text-stone-500">
              You opened a personal invitation link. Sign in with the invited
              email to continue.
            </p>
          ) : groupToken ? (
            <p className="text-center text-sm text-stone-500">
              Sign in to join this measurement group.
            </p>
          ) : null}
          <Link
            href={signInHref(returnPath)}
            className="flex w-full items-center justify-center rounded-full bg-stone-900 py-3.5 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Sign in to join
          </Link>
        </div>
      ) : null}

      {/* Signed in — completed */}
      {user && isCompleted ? (
        <div className="space-y-4 pt-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
            <CheckCircle2 size={18} />
            Measurements submitted
          </div>
          <p className="text-sm text-stone-600">
            Your tailor has received your measurements for this campaign.
          </p>
          {campaign.canInviteMembers ? (
            <Link
              href="/profile?tab=campaigns"
              className="inline-flex rounded-full border border-[#E8D48B] bg-[#FFF8E7] px-6 py-3 text-sm font-semibold text-[#8A6D00] hover:bg-[#FFF0CC]"
            >
              Manage your measurement group
            </Link>
          ) : null}
          <Link
            href="/profile?tab=campaigns"
            className="inline-flex rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            View my campaigns
          </Link>
        </div>
      ) : null}

      {/* Signed in — joined, not completed */}
      {user && participantStatus === 'accepted' && !isCompleted && campaignClosed ? (
        <div className="space-y-3 pt-2 text-center">
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            This campaign has closed. You joined but did not submit measurements
            before the deadline. Contact your tailor if you still need to
            participate.
          </p>
          <Link
            href="/profile?tab=campaigns"
            className="inline-flex rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            View my campaigns
          </Link>
        </div>
      ) : null}

      {user && canSubmit ? (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3.5 shadow-sm">
            <CheckCircle2
              size={22}
              className="shrink-0 text-emerald-600"
              aria-hidden
            />
            <p className="text-sm font-medium text-emerald-800">
              You&apos;ve joined this campaign.
            </p>
          </div>
          {campaign.canInviteMembers ? (
            <Link
              href="/profile?tab=campaigns"
              className="flex w-full items-center justify-center rounded-full border border-[#E8D48B] bg-[#FFF8E7] py-3 text-sm font-semibold text-[#8A6D00] hover:bg-[#FFF0CC]"
            >
              Manage your measurement group
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="w-full rounded-full bg-stone-900 py-3.5 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Submit my measurements
          </button>
          <p className="text-center text-sm text-stone-500">
            Pick a measurement profile, then enter by hand or use a sponsored AI
            scan.
          </p>
        </div>
      ) : null}

      {/* Signed in — verify email before join */}
      {user && emailVerificationRequired ? (
        <div className="space-y-3 pt-2 text-center">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Verify your email address before joining this campaign.
          </p>
          <Link
            href="/profile?tab=info"
            className="inline-flex rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            Account settings
          </Link>
        </div>
      ) : null}

      {/* Signed in — wrong account for personal invite */}
      {user && inviteEmailMismatch && inviteToken ? (
        <div className="space-y-3 pt-2 text-center">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Sign in with the email address that received this invitation to
            join this campaign.
          </p>
        </div>
      ) : null}

      {/* Signed in — invitation expired */}
      {user && inviteExpired && !isCompleted && !canAcceptDirectViaGroupLink ? (
        <div className="space-y-3 pt-2 text-center">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your invitation to this campaign has expired. Ask your tailor to
            send a new invite link.
          </p>
        </div>
      ) : null}

      {/* Signed in — invited but campaign closed */}
      {user &&
      participantStatus === 'invited' &&
      !inviteExpired &&
      campaignClosed &&
      !isCompleted ? (
        <div className="space-y-3 pt-2 text-center">
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            This campaign has closed before you could join. Contact your tailor
            if you still need to participate.
          </p>
          <Link
            href="/profile?tab=campaigns"
            className="inline-flex rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white hover:bg-stone-800"
          >
            View my campaigns
          </Link>
        </div>
      ) : null}

      {/* Signed in — not yet participant (or invited) */}
      {user && canJoin ? (
        <div className="space-y-3 pt-2">
          <button
            type="button"
            disabled={joinMut.isPending || notStartedYet}
            onClick={onJoin}
            className="w-full rounded-full bg-stone-900 py-3.5 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {joinMut.isPending
              ? 'Joining…'
              : notStartedYet
                ? 'Not open yet'
                : 'Join campaign'}
          </button>
          <p className="text-center text-xs text-stone-500">
            Join first, then submit your measurements when you&apos;re ready.
          </p>
        </div>
      ) : null}

      <SubmitMeasurementsModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        slug={slug}
        campaignName={campaign.name}
        inviteToken={inviteToken}
        groupToken={groupToken}
        sponsoredScansRemaining={campaign.sponsoredScansRemaining ?? 0}
        onSubmitted={() => void refetch()}
      />
    </div>
  );
}
