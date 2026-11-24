'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Loader2,
  Plus,
  QrCode,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import type {
  CoordinatorInviteeDto,
  CustomerCampaignParticipationDto,
} from '@/lib/measurementCampaigns.shared';
import {
  useCoordinatorInviteesQuery,
  useInviteCoordinatorMembersMutation,
} from '@/hooks/useMeasurementCampaigns';

type Props = {
  participation: CustomerCampaignParticipationDto;
};

type InviteRow = {
  id: string;
  fullName: string;
  email: string;
};

function newInviteRow(): InviteRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fullName: '',
    email: '',
  };
}

function inviteeStatusLabel(status: CoordinatorInviteeDto['status']) {
  if (status === 'completed') return 'Submitted';
  if (status === 'accepted') return 'Accepted';
  if (status === 'invited') return 'Invited';
  return status;
}

function inviteeStatusTone(status: CoordinatorInviteeDto['status']) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-800';
  if (status === 'accepted') return 'bg-[#FFF8E7] text-[#8A6D00]';
  return 'bg-stone-100 text-stone-700';
}

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function CoordinatorGroupPanel({ participation }: Props) {
  const { addToast } = useToast();
  const participantId = participation.participantId;
  const isActiveCoordinator =
    participation.participantStatus === 'accepted' ||
    participation.participantStatus === 'completed';
  const campaignClosed = Boolean(participation.campaignClosed);
  const notStartedYet = Boolean(participation.campaignNotStarted);
  const readOnly = campaignClosed;
  const panelEnabled =
    participation.canInviteMembers &&
    isActiveCoordinator &&
    !campaignClosed &&
    !notStartedYet;
  const queryEnabled = participation.canInviteMembers && isActiveCoordinator;

  const { data, isLoading, isError, refetch } = useCoordinatorInviteesQuery(
    participantId,
    queryEnabled,
    { refetchInterval: queryEnabled ? 30_000 : false }
  );
  const inviteMut = useInviteCoordinatorMembersMutation(participantId);

  const [groupLabel, setGroupLabel] = useState(
    participation.coordinatorGroupLabel ?? ''
  );
  const [labelSaving, setLabelSaving] = useState(false);
  const [groupCopied, setGroupCopied] = useState(false);
  const [copiedInviteeId, setCopiedInviteeId] = useState<string | null>(null);
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([newInviteRow()]);

  useEffect(() => {
    setGroupLabel(participation.coordinatorGroupLabel ?? '');
  }, [participation.coordinatorGroupLabel]);

  const groupJoinPath =
    data?.groupJoinPath ?? participation.groupJoinPath ?? '';
  const groupJoinUrl =
    groupJoinPath && typeof window !== 'undefined'
      ? `${window.location.origin}${groupJoinPath}`
      : groupJoinPath;

  const stats = data?.stats ?? participation.inviteeStats;
  const completed = stats?.completed ?? 0;
  const total = stats?.total ?? 0;
  const invitees = data?.invitees ?? [];

  const validInviteRows = useMemo(
    () =>
      inviteRows.filter((row) => row.fullName.trim().length > 0),
    [inviteRows]
  );

  const copyGroupLink = async () => {
    if (!groupJoinUrl) return;
    try {
      await navigator.clipboard.writeText(groupJoinUrl);
      setGroupCopied(true);
      addToast('Group link copied', 'success');
      setTimeout(() => setGroupCopied(false), 2000);
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  const copyInviteeLink = async (invitee: CoordinatorInviteeDto) => {
    if (!invitee.joinPath) return;
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}${invitee.joinPath}`
        : invitee.joinPath;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteeId(invitee._id);
      addToast('Invite link copied', 'success');
      setTimeout(() => setCopiedInviteeId(null), 2000);
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  const saveGroupLabel = async () => {
    const trimmed = groupLabel.trim();
    if (!trimmed) {
      addToast('Enter a group label', 'error');
      return;
    }
    if (trimmed === (participation.coordinatorGroupLabel ?? '').trim()) return;
    setLabelSaving(true);
    try {
      await inviteMut.mutateAsync({
        action: 'set-group-label',
        coordinatorGroupLabel: trimmed,
      });
      addToast('Group label saved', 'success');
      void refetch();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not save group label';
      addToast(msg, 'error');
    } finally {
      setLabelSaving(false);
    }
  };

  const sendInvites = async () => {
    if (validInviteRows.length === 0) {
      addToast('Add at least one name to invite', 'error');
      return;
    }
    try {
      const result = await inviteMut.mutateAsync({
        action: 'invite',
        members: validInviteRows.map((row) => ({
          fullName: row.fullName.trim(),
          ...(row.email.trim() ? { email: row.email.trim() } : {}),
        })),
        ...(groupLabel.trim()
          ? { coordinatorGroupLabel: groupLabel.trim() }
          : {}),
      });
      addToast(
        result.invited === 1
          ? '1 invite sent'
          : `${result.invited} invites sent`,
        'success'
      );
      setInviteRows([newInviteRow()]);
      void refetch();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not send invites';
      addToast(msg, 'error');
    }
  };

  if (!participation.canInviteMembers) return null;

  if (!isActiveCoordinator) {
    return (
      <div className="rounded-xl border border-[#E8DDB8] bg-[#FFF8E7]/40 px-4 py-3 text-sm text-stone-700">
        <p className="inline-flex items-center gap-2 font-medium text-stone-800">
          <Users size={16} className="shrink-0 text-[#8A6D00]" aria-hidden />
          Group coordinator
        </p>
        <p className="mt-1 text-xs text-stone-600">
          Join this campaign first — then you can share your group link and
          invite members.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#E8DDB8] bg-[#FFF8E7]/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Users size={16} className="shrink-0 text-[#8A6D00]" aria-hidden />
            Manage your group
          </h3>
          <p className="mt-0.5 text-xs text-stone-600">
            {campaignClosed
              ? 'This campaign has closed. You can still copy links you shared earlier.'
              : notStartedYet
                ? `Opens ${formatDate(participation.startDate)} — copy your group link now; invites unlock when the campaign opens.`
                : 'Share your group link or invite people individually.'}
          </p>
        </div>
        {stats ? (
          <p className="shrink-0 text-xs font-medium text-stone-700 tabular-nums">
            {completed} of {total} submitted
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-stone-700">
          Group label
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. Bridesmaids"
            disabled={!panelEnabled || labelSaving}
            className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/25 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void saveGroupLabel()}
            disabled={
              !panelEnabled ||
              labelSaving ||
              !groupLabel.trim() ||
              groupLabel.trim() ===
                (participation.coordinatorGroupLabel ?? '').trim()
            }
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {labelSaving ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : null}
            Save
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-stone-700">
          Group link
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700">
            {groupJoinPath || '—'}
          </code>
          <button
            type="button"
            onClick={() => void copyGroupLink()}
            disabled={!groupJoinPath}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={14} aria-hidden />
            {groupCopied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs font-medium text-stone-400 disabled:cursor-not-allowed"
          >
            <QrCode size={14} aria-hidden />
            QR
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-[#E8DDB8]/80 pt-4">
        <p className="text-xs font-medium text-stone-700">Invite individuals</p>
        {campaignClosed ? (
          <p className="text-xs text-stone-500">
            New invites are not accepted while the campaign is closed.
          </p>
        ) : notStartedYet ? (
          <p className="text-xs text-stone-500">
            Individual invites open on{' '}
            {formatDate(participation.startDate)}. Share your group link
            below so people can join once the campaign starts.
          </p>
        ) : (
          <>
        <div className="space-y-2">
          {inviteRows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-start gap-2">
              <input
                type="text"
                value={row.fullName}
                onChange={(e) =>
                  setInviteRows((prev) =>
                    prev.map((r) =>
                      r.id === row.id
                        ? { ...r, fullName: e.target.value }
                        : r
                    )
                  )
                }
                placeholder="Full name"
                maxLength={120}
                disabled={!panelEnabled || inviteMut.isPending}
                className="min-w-[8rem] flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/25"
              />
              <input
                type="email"
                value={row.email}
                onChange={(e) =>
                  setInviteRows((prev) =>
                    prev.map((r) =>
                      r.id === row.id ? { ...r, email: e.target.value } : r
                    )
                  )
                }
                placeholder="Email (optional)"
                maxLength={200}
                disabled={!panelEnabled || inviteMut.isPending}
                className="min-w-[8rem] flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/25"
              />
              {inviteRows.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setInviteRows((prev) =>
                      prev.filter((r) => r.id !== row.id)
                    )
                  }
                  disabled={!panelEnabled || inviteMut.isPending}
                  className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
                  aria-label="Remove row"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setInviteRows((prev) => [...prev, newInviteRow()])}
            disabled={
              !panelEnabled ||
              inviteMut.isPending ||
              inviteRows.length >= 25
            }
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            Add row
          </button>
          <button
            type="button"
            onClick={() => void sendInvites()}
            disabled={
              !panelEnabled ||
              inviteMut.isPending ||
              validInviteRows.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inviteMut.isPending ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <Send size={14} aria-hidden />
            )}
            Send invites
          </button>
        </div>
          </>
        )}
      </div>

      <div className="border-t border-[#E8DDB8]/80 pt-4">
        <p className="mb-2 text-xs font-medium text-stone-700">Your invitees</p>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-stone-400" size={22} />
          </div>
        ) : isError ? (
          <p className="text-xs text-red-600">
            Could not load invitees. Try again later.
          </p>
        ) : invitees.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-200 bg-white/60 px-3 py-4 text-center text-xs text-stone-500">
            No one invited yet. Send individual invites or share your group
            link.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full min-w-[280px] text-left text-xs">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50 text-stone-600">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Link</th>
                </tr>
              </thead>
              <tbody>
                {invitees.map((invitee) => (
                  <tr
                    key={invitee._id}
                    className="border-b border-stone-50 last:border-0"
                  >
                    <td className="px-3 py-2.5 text-stone-900">
                      <span className="font-medium">{invitee.fullName}</span>
                      {invitee.email ? (
                        <span className="mt-0.5 block truncate text-stone-500">
                          {invitee.email}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${inviteeStatusTone(invitee.status)}`}
                      >
                        {inviteeStatusLabel(invitee.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {invitee.joinPath ? (
                        <button
                          type="button"
                          onClick={() => void copyInviteeLink(invitee)}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50"
                        >
                          <Copy size={12} aria-hidden />
                          {copiedInviteeId === invitee._id ? 'Copied' : 'Copy'}
                        </button>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
