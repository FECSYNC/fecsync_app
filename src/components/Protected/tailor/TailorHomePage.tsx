'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Film,
  Loader2,
  Megaphone,
  Bell,
  Ruler,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMyTailorQuery } from '@/hooks/useTailors';
import {
  useDeleteTailorClientMutation,
  useTailorClientsQuery,
} from '@/hooks/useMeasurementCampaigns';
import AddClientModal from '@/components/Protected/tailor/AddClientModal';
import InviteClientToCampaignModal from '@/components/Protected/tailor/InviteClientToCampaignModal';
import { useToast } from '@/contexts/toast-context';
import { isUnlimitedPlanCap } from '@/lib/subscriptionPlans';
import { softGateInlineHint } from '@/utils/planLimitSoftGate';
import type {
  CampaignParticipantStatus,
  TailorClientDto,
} from '@/lib/measurementCampaigns.shared';

const FEATURES = [
  {
    href: '/tailor/jobs',
    label: 'Jobs',
    icon: Calendar,
    color: 'bg-blue-50 text-blue-600',
  },
  {
    href: '/tailor/notifications',
    label: 'Notifications',
    icon: Bell,
    color: 'bg-violet-50 text-violet-600',
  },
  {
    href: '/tailor/campaigns',
    label: 'Campaigns',
    icon: Megaphone,
    color: 'bg-orange-50 text-orange-600',
  },
  {
    href: '/tailor/dashboard',
    label: 'My portfolio',
    icon: Film,
    color: 'bg-pink-50 text-pink-600',
  },
] as const;

function clientCampaignChip(status: CampaignParticipantStatus) {
  if (status === 'completed') {
    return {
      label: 'Measurements ✓',
      className: 'bg-emerald-50 text-emerald-700',
    };
  }
  if (status === 'accepted') {
    return { label: 'Joined', className: 'bg-stone-100 text-stone-700' };
  }
  return { label: 'Invited', className: 'bg-amber-50 text-amber-800' };
}

export default function TailorHomePage() {
  const { addToast } = useToast();
  const {
    data: tailor,
    isLoading: tailorLoading,
    isError: tailorError,
    error: tailorErr,
  } = useMyTailorQuery();
  const {
    data: clientsData,
    isLoading: clientsLoading,
    isError: clientsError,
  } = useTailorClientsQuery(1, {
    enabled: Boolean(tailor),
    refetchInterval: 20_000,
  });
  const deleteMut = useDeleteTailorClientMutation();
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [inviteClient, setInviteClient] = useState<TailorClientDto | null>(null);

  const clients = clientsData?.clients ?? [];
  // Org-wide meter (matches assertWithinPlanLimit); `total` is this tailor's roster only.
  const usedRaw = clientsData?.planUsed;
  const limitRaw = clientsData?.planLimit;
  const planReady =
    typeof limitRaw === 'number' && typeof usedRaw === 'number';
  const used = planReady ? usedRaw : 0;
  const unlimited = planReady && isUnlimitedPlanCap(limitRaw);
  const limit = unlimited ? null : planReady ? limitRaw : null;
  // Until the API returns both cap and used, keep Add disabled (do not treat missing as unlimited).
  const remaining = !planReady
    ? 0
    : unlimited
      ? Number.POSITIVE_INFINITY
      : Math.max(0, limitRaw - used);
  const atLimit = !planReady || (!unlimited && remaining <= 0);
  const initial =
    tailor?.displayName?.charAt(0)?.toUpperCase() ||
    tailor?.userName?.charAt(0)?.toUpperCase() ||
    'T';

  if (tailorLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-stone-400" />
      </div>
    );
  }

  if (tailorError || !tailor) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">
          No tailor profile yet
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          {tailorErr instanceof Error
            ? tailorErr.message
            : 'Ask a FECSYNC admin to link your account as a tailor before using the studio.'}
        </p>
        <Link
          href="/home"
          className="mt-4 inline-block text-sm font-medium text-[#B8960C] hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-[#1a2744] p-5 text-white shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/12 text-xl font-semibold">
            {initial}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
              Tailor
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {tailor.displayName || 'Your studio'}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/75">
              Keep client measurements organized and showcase your craft.
            </p>
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(212,175,55,0.55) 0 2px, transparent 2px 10px, rgba(255,255,255,0.35) 10px 11px, transparent 11px 20px)',
          }}
        />
      </section>

      <section className="grid grid-cols-2 gap-3">
        {FEATURES.map(({ href, label, icon: Icon, color }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-[96px] items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm transition hover:border-[#D4AF37]/50 hover:shadow"
          >
            <span
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${color}`}
            >
              <Icon size={20} />
            </span>
            <span className="text-sm font-medium text-stone-800">{label}</span>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-stone-900">
              <Users size={18} className="text-orange-500" />
              <h3 className="text-lg font-semibold">Your clients</h3>
            </div>
            <p className="mt-1 text-sm text-stone-500">
              {!planReady
                ? clientsLoading
                  ? 'Loading company plan usage…'
                  : 'Company plan usage unavailable'
                : softGateInlineHint(
                    {
                      billingEntitled: clientsData?.billingEntitled,
                      planResolved: clientsData?.planResolved,
                    },
                    'tailorClients',
                    atLimit,
                    { zeroCap: planReady && !unlimited && limitRaw === 0 }
                  ) ??
                  (unlimited
                    ? `${used} clients · unlimited on your company plan`
                    : `Company plan · ${used}/${limit} used · ${remaining} available`)}
            </p>
          </div>
          {clients.length > 0 ? (
            <button
              type="button"
              disabled={atLimit}
              onClick={() => setAddClientOpen(true)}
              className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add client
            </button>
          ) : null}
        </div>

        {clientsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-stone-400" />
          </div>
        ) : clientsError ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Could not load your client roster. If this keeps happening, the
            database may need a schema update (`yarn db:push`).
          </div>
        ) : clients.length === 0 ? (
          <button
            type="button"
            disabled={atLimit}
            onClick={() => setAddClientOpen(true)}
            className="mt-6 flex w-full flex-col items-center rounded-xl py-12 text-center transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ruler size={32} className="rotate-[-20deg] text-orange-400" />
            <p className="mt-3 text-sm text-stone-600">
              Add your first client to start.
            </p>
          </button>
        ) : (
          <ul className="mt-4 divide-y divide-stone-100">
            {clients.map((client) => {
              const chip = client.campaignLink
                ? clientCampaignChip(client.campaignLink.status)
                : null;
              return (
              <li
                key={client._id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-stone-900">{client.name}</p>
                    {chip ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}
                      >
                        {chip.label}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-stone-500">
                    {[client.email, client.phone, client.garmentOccasion]
                      .filter(Boolean)
                      .join(' · ') || 'No extra details'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!client.campaignLink ? (
                    <button
                      type="button"
                      title="Add to campaign"
                      onClick={() => setInviteClient(client)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[#8A6D00] hover:bg-[#FFF8E7]"
                    >
                      <UserPlus size={14} />
                      <span className="hidden sm:inline">Add to campaign</span>
                    </button>
                  ) : null}
                <button
                  type="button"
                  disabled={deleteMut.isPending}
                  aria-label={`Remove ${client.name}`}
                  onClick={() => {
                    if (!confirm(`Remove ${client.name} from your roster?`)) {
                      return;
                    }
                    void deleteMut
                      .mutateAsync(client._id)
                      .then(() => addToast('Client removed', 'success'))
                      .catch((err) =>
                        addToast(
                          err instanceof Error ? err.message : 'Could not remove',
                          'error'
                        )
                      );
                  }}
                  className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </button>
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </section>

      <AddClientModal
        open={addClientOpen}
        remaining={remaining}
        onClose={() => setAddClientOpen(false)}
      />
      {inviteClient ? (
        <InviteClientToCampaignModal
          open
          client={inviteClient}
          onClose={() => setInviteClient(null)}
        />
      ) : null}
    </div>
  );
}
