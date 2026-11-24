'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Megaphone, X } from 'lucide-react';
import { useToast } from '@/contexts/toast-context';
import {
  useCampaignsQuery,
  useInviteParticipantsMutation,
} from '@/hooks/useMeasurementCampaigns';
import type { TailorClientDto } from '@/lib/measurementCampaigns.shared';

type Props = {
  open: boolean;
  onClose: () => void;
  client: TailorClientDto | null;
  onInvited?: () => void;
};

export default function InviteClientToCampaignModal({
  open,
  onClose,
  client,
  onInvited,
}: Props) {
  const { addToast } = useToast();
  const { data: campaignsData, isLoading: campaignsLoading } = useCampaignsQuery({
    status: 'active',
    sort: 'newest',
    page: 1,
  });
  const [campaignId, setCampaignId] = useState('');
  const [email, setEmail] = useState('');
  const inviteMut = useInviteParticipantsMutation(campaignId);

  const inviteableCampaigns = useMemo(
    () =>
      (campaignsData?.campaigns ?? []).filter((c) => {
        if (c.status !== 'active') return false;
        if (c.expiryDate && new Date(c.expiryDate).getTime() < Date.now()) {
          return false;
        }
        return true;
      }),
    [campaignsData?.campaigns]
  );

  useEffect(() => {
    if (!open || !client) return;
    setEmail(client.email?.trim() ?? '');
    setCampaignId(inviteableCampaigns[0]?._id ?? '');
  }, [open, client, inviteableCampaigns]);

  if (!open || !client) return null;

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (!campaignId) {
      addToast('Choose a campaign', 'error');
      return;
    }
    if (!trimmedEmail) {
      addToast('Email is required to send a campaign invite', 'error');
      return;
    }
    try {
      const result = await inviteMut.mutateAsync({
        defaultRole: 'coordinator',
        tailorClientId: client._id,
        participants: [
          {
            fullName: client.name,
            email: trimmedEmail,
            role: 'coordinator',
          },
        ],
      });
      addToast(
        result.invited === 0
          ? `${client.name} linked to their campaign invite`
          : `${client.name} invited as coordinator`,
        'success'
      );
      onInvited?.();
      onClose();
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not send invite',
        'error'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-client-campaign-title"
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between px-5 pt-4">
          <div>
            <h2
              id="invite-client-campaign-title"
              className="text-lg font-semibold text-stone-900"
            >
              Add to campaign
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Invite {client.name} as a group coordinator
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {campaignsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-stone-400" />
            </div>
          ) : inviteableCampaigns.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No active campaigns. Create one under Campaigns first.
            </div>
          ) : (
            <>
              <label className="block text-sm">
                <span className="font-medium text-stone-800">Campaign</span>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
                >
                  {inviteableCampaigns.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="font-medium text-stone-800">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Coordinator email for the invite"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2.5"
                />
              </label>

              <div className="flex items-start gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-600">
                <Megaphone size={14} className="mt-0.5 shrink-0 text-[#B8960C]" />
                <p>
                  They will receive an email to join as coordinator and can invite
                  their group members after signing in.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 border-t border-stone-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              inviteMut.isPending ||
              campaignsLoading ||
              inviteableCampaigns.length === 0
            }
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inviteMut.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
