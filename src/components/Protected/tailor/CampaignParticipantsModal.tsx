'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  X,
  UserPlus,
  Send,
  Link2,
  Copy,
  Check,
  Mail,
  Phone,
  MessageCircle,
  QrCode,
  Loader2,
  Download,
  ChevronDown,
  ChevronRight,
  List,
  GitBranch,
} from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import MeasurementValuesDisplay from '@/components/measurements/MeasurementValuesDisplay';
import {
  useAllocateScansMutation,
  useCampaignParticipantsQuery,
  useCampaignParticipantsTreeQuery,
  useCampaignQuery,
  useExportCampaignParticipantsMutation,
  useInviteParticipantsMutation,
  useSendRemindersMutation,
} from '@/hooks/useMeasurementCampaigns';
import { useMyTailorQuery } from '@/hooks/useTailors';
import {
  partitionCampaignParticipants,
  type CampaignParticipantDto,
  type CampaignParticipantRole,
  type MeasurementCampaignDto,
} from '@/lib/measurementCampaigns.shared';

type Props = {
  open: boolean;
  onClose: () => void;
  campaign: MeasurementCampaignDto | null;
};

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function participantRoleLabel(role: CampaignParticipantRole) {
  if (role === 'coordinator') return 'Coordinator';
  if (role === 'member') return 'Member';
  return 'Direct';
}

function participantRoleBadgeClass(role: CampaignParticipantRole) {
  if (role === 'coordinator') return 'bg-[#FFF8E7] text-[#8A6D00]';
  if (role === 'member') return 'bg-stone-100 text-stone-700';
  return 'bg-stone-50 text-stone-600';
}

function statusBadgeClass(status: CampaignParticipantDto['status']) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700';
  if (status === 'accepted') return 'bg-stone-100 text-stone-700';
  return 'bg-amber-50 text-amber-800';
}

const INVITE_CHANNELS = [
  { id: 'email', icon: Mail, label: 'Email', enabled: true },
  { id: 'sms', icon: Phone, label: 'SMS', enabled: false },
  { id: 'chat', icon: MessageCircle, label: 'Chat', enabled: false },
  { id: 'link', icon: Link2, label: 'Link', enabled: false },
  { id: 'qr', icon: QrCode, label: 'QR', enabled: false },
] as const;

export default function CampaignParticipantsModal({
  open,
  onClose,
  campaign: campaignProp,
}: Props) {
  const { addToast } = useToast();
  const { data: tailor } = useMyTailorQuery();
  const campaignId = campaignProp?._id ?? '';
  const { data: liveCampaign, isFetching: campaignFetching, isError: campaignError } =
    useCampaignQuery(campaignId, open && Boolean(campaignId));
  const campaign = liveCampaign ?? campaignProp;
  const {
    data: participants = [],
    refetch,
    isLoading: participantsLoading,
    isError: participantsError,
  } = useCampaignParticipantsQuery(campaignId, open && Boolean(campaignId), {
    refetchInterval: open ? 20_000 : false,
  });
  const [viewMode, setViewMode] = useState<'list' | 'group'>('list');
  const [expandedCoordinators, setExpandedCoordinators] = useState<Set<string>>(
    new Set()
  );
  const {
    data: participantTree,
    refetch: refetchTree,
    isLoading: treeLoading,
    isError: treeError,
  } = useCampaignParticipantsTreeQuery(
    campaignId,
    open && Boolean(campaignId),
    { refetchInterval: open ? 20_000 : false }
  );
  const inviteMut = useInviteParticipantsMutation(campaignId);
  const remindMut = useSendRemindersMutation(campaignId);
  const allocateMut = useAllocateScansMutation(campaignId);
  const exportMut = useExportCampaignParticipantsMutation();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [defaultInviteRole, setDefaultInviteRole] =
    useState<CampaignParticipantRole>('direct');
  const [expiresAt, setExpiresAt] = useState('');
  const [inviteRows, setInviteRows] = useState([{ fullName: '', email: '' }]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scansEach, setScansEach] = useState(1);
  const [copied, setCopied] = useState(false);
  const [expandedMeasurements, setExpandedMeasurements] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!open || !campaignError) return;
    addToast('Could not load this campaign', 'error');
    onClose();
  }, [open, campaignError, addToast, onClose]);

  useEffect(() => {
    if (open) return;
    setViewMode('list');
    setExpandedCoordinators(new Set());
    setExpandedMeasurements(null);
    setSelected(new Set());
  }, [open]);

  // Drop selections / expansions that no longer exist after refetch.
  useEffect(() => {
    const liveIds = new Set(participants.map((p) => p._id));
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setExpandedCoordinators((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => liveIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setExpandedMeasurements((id) => (id && liveIds.has(id) ? id : null));
  }, [participants]);

  const stats = useMemo(() => {
    const invited = participants.length;
    const accepted = participants.filter(
      (p) => p.status === 'accepted' || p.status === 'completed'
    ).length;
    const completed = participants.filter((p) => p.status === 'completed').length;
    const pending = participants.filter((p) => p.status === 'invited').length;
    const coordinators = participants.filter(
      (p) => p.role === 'coordinator' || p.canInviteMembers
    ).length;
    const members = participants.filter((p) => p.role === 'member').length;
    const { direct: directParticipants } =
      partitionCampaignParticipants(participants);
    return {
      invited,
      accepted,
      completed,
      pending,
      coordinators,
      members,
      direct: directParticipants.length,
    };
  }, [participants]);

  const statsLoading = participantsLoading;

  const remindCount = participants.filter(
    (p) => p.status === 'invited' || p.status === 'accepted'
  ).length;

  const available = campaign?.aiCreditsAvailable ?? 0;
  const reserved = campaign?.aiCreditsReserved ?? 0;
  const usedCredits = campaign?.aiCreditsUsed ?? 0;
  const maxAddEach = Math.max(1, Math.min(100, available || 5));

  const canShare =
    tailor?.status === 'approved' && campaign?.status === 'active';

  if (!open || !campaign) return null;

  const joinUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${campaign.slug}`
      : `/join/${campaign.slug}`;

  const copyLink = async () => {
    if (!canShare) {
      addToast(
        campaign.status !== 'active'
          ? 'Set the campaign to Active before sharing the join link'
          : 'Your tailor profile must be approved before join links work',
        'error'
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      addToast('Link copied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Could not copy link', 'error');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCoordinatorExpanded = (id: string) => {
    setExpandedCoordinators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refetchParticipants = () => {
    void refetch();
    void refetchTree();
  };

  const renderSubmittedCell = (p: CampaignParticipantDto) => (
    <>
      {formatDate(p.submittedAt)}
      {p.status === 'completed' && p.measurementSnapshot ? (
        <button
          type="button"
          onClick={() =>
            setExpandedMeasurements((id) => (id === p._id ? null : p._id))
          }
          className="mt-1 block text-xs font-medium text-[#B8960C] hover:underline"
        >
          {expandedMeasurements === p._id
            ? 'Hide measurements'
            : `View ${p.measurementSnapshot.label}`}
        </button>
      ) : p.status === 'completed' ? (
        <span className="mt-1 block text-xs text-stone-400">No snapshot</span>
      ) : null}
      {expandedMeasurements === p._id && p.measurementSnapshot ? (
        <div className="mt-2 rounded-lg border border-stone-100 bg-stone-50 p-2">
          <MeasurementValuesDisplay
            measurements={p.measurementSnapshot.measurements}
            unit={p.measurementSnapshot.unit}
            showUnitPerValue
            compact
          />
        </div>
      ) : null}
    </>
  );

  const renderParticipantRow = (
    p: CampaignParticipantDto,
    opts?: { nested?: boolean }
  ) => (
    <tr key={p._id} className="hover:bg-stone-50/60">
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected.has(p._id)}
          onChange={() => toggleSelect(p._id)}
          className="h-4 w-4 rounded-full border-stone-300"
          aria-label={`Select ${p.fullName}`}
        />
      </td>
      <td className={`px-3 py-2.5 ${opts?.nested ? 'pl-10' : ''}`}>
        <p className="font-medium text-stone-900">{p.fullName}</p>
        {p.email ? <p className="text-xs text-stone-500">{p.email}</p> : null}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${participantRoleBadgeClass(p.role)}`}
        >
          {participantRoleLabel(p.role)}
        </span>
        {p.role === 'coordinator' && typeof p.inviteeCount === 'number' ? (
          <p className="mt-1 text-xs text-stone-500">
            {p.inviteeCount} in group · {p.inviteeCompletedCount ?? 0} completed
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-sm text-stone-600">
        {p.role === 'member' && p.invitedByName ? p.invitedByName : '—'}
      </td>
      <td className="px-3 py-2.5 text-stone-600">
        {p.channel === 'link'
          ? 'Shareable link'
          : p.channel === 'email'
            ? 'Email'
            : p.channel}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(p.status)}`}
        >
          {p.status}
        </span>
      </td>
      <td className="px-3 py-2.5 tabular-nums text-stone-600">
        {p.aiScansUsed}/{p.aiScansAllocated}
      </td>
      <td className="px-3 py-2.5 text-stone-600">{renderSubmittedCell(p)}</td>
      <td className="px-3 py-2.5 text-stone-600">{formatDate(p.invitedAt)}</td>
    </tr>
  );

  const allSelectableIds =
    viewMode === 'group' && participantTree
      ? [
          ...participantTree.coordinators.flatMap((c) => [
            c._id,
            ...c.invitees.map((i) => i._id),
          ]),
          ...participantTree.direct.map((d) => d._id),
        ]
      : participants.map((p) => p._id);

  const toggleSelectAll = () => {
    if (selected.size === allSelectableIds.length && allSelectableIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectableIds));
    }
  };

  const openInvite = () => {
    setInviteOpen(true);
    setDefaultInviteRole('direct');
    setExpiresAt(
      campaign.expiryDate ? campaign.expiryDate.slice(0, 10) : ''
    );
    setInviteRows([{ fullName: '', email: '' }]);
  };

  const exportCsv = () => {
    void exportMut
      .mutateAsync(campaignId)
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              {campaign.name} — participants
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Track invitation status and nudge anyone who hasn&apos;t finished.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Invited', stats.invited, false],
              ['Accepted', stats.accepted, false],
              ['Completed', stats.completed, true],
              ['Pending', stats.pending, false],
            ].map(([label, value, highlight]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-stone-200 bg-white p-3 text-center"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  {label}
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold ${
                    highlight ? 'text-emerald-600' : 'text-stone-900'
                  }`}
                >
                  {statsLoading ? '—' : value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              ['Coordinators', stats.coordinators ?? 0],
              ['Members', stats.members ?? 0],
              ['Direct', stats.direct ?? 0],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 text-center"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                  {label}
                </p>
                <p className="mt-1 text-xl font-semibold text-stone-900">
                  {statsLoading ? '—' : value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openInvite}
              disabled={
                campaign.status === 'archived' || campaign.status === 'expired'
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-40"
            >
              <UserPlus size={16} />
              Invite people
            </button>
            <button
              type="button"
              disabled={
                remindMut.isPending ||
                remindCount === 0 ||
                campaign.status !== 'active'
              }
              onClick={() =>
                void remindMut
                  .mutateAsync()
                  .then((r) => {
                    addToast(
                      `Reminders sent for ${r.reminded} people`,
                      'success'
                    );
                    void refetchParticipants();
                  })
                  .catch((err) =>
                    addToast(
                      err instanceof Error ? err.message : 'Reminders failed',
                      'error'
                    )
                  )
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-40"
            >
              {remindMut.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              Send reminders ({remindCount})
            </button>
            <button
              type="button"
              disabled={exportMut.isPending || participants.length === 0}
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-40"
            >
              {exportMut.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Export CSV
            </button>
          </div>

          <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50/80 p-4">
            <div>
              <p className="text-sm font-medium text-stone-800">
                Allocate sponsored AI scans
              </p>
              <p className="mt-1 text-sm text-stone-600">
                <strong>{Math.max(0, available)}</strong> credits available to
                allocate — <strong>{reserved}</strong> reserved for invitees,{' '}
                <strong>{usedCredits}</strong> used. You can add up to{' '}
                {maxAddEach} scans per selected participant.
                {campaignFetching ? ' Updating…' : ''}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Reserved credits move to used when an invitee runs a sponsored
                AI scan. Unused allocations are released when they submit
                measurements.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="font-medium text-stone-800">
                  Scans to add each
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={scansEach}
                  onChange={(e) =>
                    setScansEach(
                      Math.min(100, Math.max(1, Number(e.target.value) || 1))
                    )
                  }
                  className="mt-1 block w-28 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5"
                />
              </label>
              <button
                type="button"
                disabled={allocateMut.isPending || selected.size === 0}
                onClick={() =>
                  void allocateMut
                    .mutateAsync({
                      participantIds: [...selected],
                      scansEach,
                    })
                    .then((r) => {
                      addToast(`Updated ${r.updated} participants`, 'success');
                      setSelected(new Set());
                      void refetchParticipants();
                    })
                    .catch((err) =>
                      addToast(
                        err instanceof Error
                          ? err.message
                          : 'Allocation failed',
                        'error'
                      )
                    )
                }
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Add to selected ({selected.size})
              </button>
              <button
                type="button"
                disabled={allocateMut.isPending || participants.length === 0}
                onClick={() =>
                  void allocateMut
                    .mutateAsync({ everyone: true, scansEach })
                    .then((r) => {
                      addToast(`Updated ${r.updated} participants`, 'success');
                      void refetchParticipants();
                    })
                    .catch((err) =>
                      addToast(
                        err instanceof Error
                          ? err.message
                          : 'Allocation failed',
                        'error'
                      )
                    )
                }
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Add to everyone ({participants.length})
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
              <Link2 size={16} className="text-stone-500" />
              Campaign join link
            </div>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={joinUrl}
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700"
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Anyone with this link can join the campaign after signing up or
              logging in.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-800">Participants</p>
            <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  viewMode === 'list'
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <List size={14} />
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('group')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                  viewMode === 'group'
                    ? 'bg-white text-stone-900 shadow-sm'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <GitBranch size={14} />
                By group
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={
                        allSelectableIds.length > 0 &&
                        selected.size === allSelectableIds.length
                      }
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded-full border-stone-300"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2.5">Participant</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Invited by</th>
                  <th className="px-3 py-2.5">Channel</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">AI scans</th>
                  <th className="px-3 py-2.5">Submitted</th>
                  <th className="px-3 py-2.5">Invited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {viewMode === 'list' ? (
                  participantsLoading ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-10 text-center text-stone-500"
                      >
                        <Loader2 className="mx-auto animate-spin" size={20} />
                      </td>
                    </tr>
                  ) : participantsError ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-10 text-center text-stone-500"
                      >
                        Could not load participants.{' '}
                        <button
                          type="button"
                          onClick={() => void refetchParticipants()}
                          className="text-[#B8960C] hover:underline"
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ) : participants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-10 text-center text-stone-500"
                      >
                        No participants yet. Invite people or share the join
                        link.
                      </td>
                    </tr>
                  ) : (
                    participants.map((p) => renderParticipantRow(p))
                  )
                ) : treeLoading ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-10 text-center text-stone-500"
                    >
                      <Loader2 className="mx-auto animate-spin" size={20} />
                    </td>
                  </tr>
                ) : treeError ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-10 text-center text-stone-500"
                    >
                      Could not load group view.{' '}
                      <button
                        type="button"
                        onClick={() => void refetchParticipants()}
                        className="text-[#B8960C] hover:underline"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ) : !participantTree ||
                  (participantTree.coordinators.length === 0 &&
                    participantTree.direct.length === 0) ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-10 text-center text-stone-500"
                    >
                      No participants yet. Invite people or share the join link.
                    </td>
                  </tr>
                ) : (
                  <>
                    {participantTree.coordinators.length > 0 ? (
                      <tr className="bg-stone-50/80">
                        <td
                          colSpan={9}
                          className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
                        >
                          Coordinators &amp; their groups
                        </td>
                      </tr>
                    ) : null}
                    {participantTree.coordinators.map((coord) => {
                      const expanded = expandedCoordinators.has(coord._id);
                      return (
                        <Fragment key={coord._id}>
                          <tr className="bg-[#FFFBF0]/40 hover:bg-stone-50/60">
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={selected.has(coord._id)}
                                onChange={() => toggleSelect(coord._id)}
                                className="h-4 w-4 rounded-full border-stone-300"
                                aria-label={`Select ${coord.fullName}`}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                onClick={() =>
                                  toggleCoordinatorExpanded(coord._id)
                                }
                                className="inline-flex items-start gap-1.5 text-left"
                              >
                                {coord.invitees.length > 0 ? (
                                  expanded ? (
                                    <ChevronDown
                                      size={16}
                                      className="mt-0.5 shrink-0 text-stone-500"
                                    />
                                  ) : (
                                    <ChevronRight
                                      size={16}
                                      className="mt-0.5 shrink-0 text-stone-500"
                                    />
                                  )
                                ) : (
                                  <span className="inline-block w-4" />
                                )}
                                <span>
                                  <p className="font-medium text-stone-900">
                                    {coord.fullName}
                                  </p>
                                  {coord.email ? (
                                    <p className="text-xs text-stone-500">
                                      {coord.email}
                                    </p>
                                  ) : null}
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${participantRoleBadgeClass(coord.role)}`}
                              >
                                {participantRoleLabel(coord.role)}
                              </span>
                              <p className="mt-1 text-xs text-stone-500">
                                {coord.inviteeCompletedCount ?? 0}/
                                {coord.inviteeCount ?? 0} submitted
                              </p>
                            </td>
                            <td className="px-3 py-2.5 text-sm text-stone-600">
                              —
                            </td>
                            <td className="px-3 py-2.5 text-stone-600">
                              {coord.channel === 'link'
                                ? 'Shareable link'
                                : coord.channel === 'email'
                                  ? 'Email'
                                  : coord.channel}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(coord.status)}`}
                              >
                                {coord.status}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-stone-600">
                              {coord.aiScansUsed}/{coord.aiScansAllocated}
                            </td>
                            <td className="px-3 py-2.5 text-stone-600">
                              {renderSubmittedCell(coord)}
                            </td>
                            <td className="px-3 py-2.5 text-stone-600">
                              {formatDate(coord.invitedAt)}
                            </td>
                          </tr>
                          {expanded
                            ? coord.invitees.map((invitee) =>
                                renderParticipantRow(invitee, { nested: true })
                              )
                            : null}
                        </Fragment>
                      );
                    })}
                    {participantTree.direct.length > 0 ? (
                      <tr className="bg-stone-50/80">
                        <td
                          colSpan={9}
                          className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500"
                        >
                          Direct participants
                        </td>
                      </tr>
                    ) : null}
                    {participantTree.direct.map((p) => renderParticipantRow(p))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {inviteOpen ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-participants-title"
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="invite-participants-title"
                    className="text-lg font-semibold text-stone-900"
                  >
                    Invite participants
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Invite people to submit measurements for{' '}
                    <strong>{campaign.name}</strong>. Every invitation carries a
                    secure personal link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
                  aria-label="Close invite"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-4 flex items-center gap-1 rounded-full bg-stone-100 p-1">
                {INVITE_CHANNELS.map(({ id, icon: Icon, label, enabled }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!enabled}
                    title={enabled ? label : `${label} — coming soon`}
                    className={`inline-flex flex-1 items-center justify-center rounded-full py-2 ${
                      id === 'email'
                        ? 'bg-white text-stone-900 shadow-sm'
                        : 'text-stone-400'
                    } disabled:cursor-not-allowed`}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>

              <label className="mt-4 block text-sm">
                <span className="font-medium text-stone-800">
                  Invitation role
                </span>
                <select
                  value={defaultInviteRole}
                  onChange={(e) =>
                    setDefaultInviteRole(
                      e.target.value as CampaignParticipantRole
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                >
                  <option value="direct">Participant (direct)</option>
                  <option value="coordinator">
                    Group coordinator (can invite their group)
                  </option>
                </select>
                <p className="mt-1 text-xs text-stone-500">
                  Coordinators receive a personal invite link, then can share a
                  group link for members after they join.
                </p>
              </label>

              <label className="mt-4 block text-sm">
                <span className="font-medium text-stone-800">
                  Invitation expires
                </span>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
                />
              </label>

              <div className="mt-4 space-y-3">
                {inviteRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/50 p-3"
                  >
                    <input
                      placeholder="Full name"
                      value={row.fullName}
                      onChange={(e) => {
                        const next = [...inviteRows];
                        next[idx] = { ...next[idx], fullName: e.target.value };
                        setInviteRows(next);
                      }}
                      className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="name@example.com"
                      type="email"
                      value={row.email}
                      onChange={(e) => {
                        const next = [...inviteRows];
                        next[idx] = { ...next[idx], email: e.target.value };
                        setInviteRows(next);
                      }}
                      className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
                    />
                    {inviteRows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setInviteRows(inviteRows.filter((_, i) => i !== idx))
                        }
                        className="text-xs text-stone-500 hover:text-stone-800"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setInviteRows([...inviteRows, { fullName: '', email: '' }])
                }
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
              >
                + Add another
              </button>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={inviteMut.isPending}
                  onClick={() => {
                    const people = inviteRows.filter(
                      (r) => r.fullName.trim() && r.email.trim()
                    );
                    if (people.length === 0) {
                      addToast('Add at least one name and email', 'error');
                      return;
                    }
                    void inviteMut
                      .mutateAsync({
                        defaultRole: defaultInviteRole,
                        expiresAt: expiresAt || undefined,
                        participants: people,
                      })
                      .then((r) => {
                        addToast(
                          `Invited ${r.invited} ${r.invited === 1 ? 'person' : 'people'}`,
                          'success'
                        );
                        setInviteOpen(false);
                        setInviteRows([{ fullName: '', email: '' }]);
                        void refetchParticipants();
                      })
                      .catch((err) =>
                        addToast(
                          err instanceof Error ? err.message : 'Invite failed',
                          'error'
                        )
                      );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  {inviteMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Send invitations
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
