'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { AdminHowToGuideButton } from '@/components/Protected/admin/components/AdminHowToGuideButton';
import { DeferredMembershipsGuideModal } from '@/components/Protected/admin/pages/memberships/DeferredMembershipsGuideModal';
import { MEMBERSHIPS_MEMBERS_GUIDE_STEPS } from '@/components/Protected/admin/pages/memberships/membershipsGuides';
import CreateMembershipMemberModal from '@/components/Protected/admin/pages/memberships/CreateMembershipMemberModal';
import { AccountingEntriesPanel } from '@/components/Protected/admin/pages/accounting/shared';
import {
  btnPrimaryClass,
  fieldClass,
} from '@/components/Protected/admin/pages/ticketing/ticketingUi';
import { ADMIN_LIST_STALE_MS } from '@/lib/adminListCache';
import {
  inviteMembershipGuestToDashboard,
  getMembershipGuestDetail,
  getMembershipMember,
  listMembershipMembers,
  listMembershipPlans,
  membershipKeys,
  membershipMemberAction,
  searchMembershipGuests,
  patchMembershipMedia,
  signMembershipAgreementAsStaff,
} from '@/services/memberships';
import { notifyMembershipChange } from '@/lib/membershipsSync';
import { computeProration } from '@/lib/memberships/proration';

const CANCEL_REASON_CODES = [
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'not_using', label: 'Not visiting enough' },
  { id: 'moving', label: 'Moving away' },
  { id: 'service_issue', label: 'Service / experience issue' },
  { id: 'payment_issue', label: 'Payment issue' },
  { id: 'staff_other', label: 'Other' },
] as const;

function describeCancelReason(raw: string | null): string | null {
  if (!raw) return null;
  const [code, ...rest] = raw.split(':');
  const known = CANCEL_REASON_CODES.find((c) => c.id === code.trim());
  if (!known) return raw;
  const note = rest.join(':').trim();
  return note ? `${known.label} — ${note}` : known.label;
}
import { uploadCatalogImages } from '@/services/upload';
import Link from 'next/link';

function sourceLabel(source: string): string {
  switch (source) {
    case 'admin':
      return 'Desk';
    case 'pos':
      return 'POS';
    case 'online':
      return 'Online';
    default:
      return source || 'Other';
  }
}

export default function MembershipMembersPage() {
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const createIntent = searchParams.get('create') === '1';
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.MembershipsWrite) || can(P.MembershipsAdmin);
  const canSell =
    can(P.MembershipsSell) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsAdmin);
  const canBilling =
    can(P.MembershipsBilling) || can(P.MembershipsAdmin);
  const canCancel =
    can(P.MembershipsCancel) ||
    can(P.MembershipsBilling) ||
    can(P.MembershipsAdmin);
  const canRead =
    can(P.MembershipsRead) || canWrite || canSell || canCancel;
  const canRedeem =
    can(P.MembershipsRedeem) || can(P.MembershipsAdmin);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [editCustomId, setEditCustomId] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [familyEditIds, setFamilyEditIds] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);

  const [upgradePlanId, setUpgradePlanId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [cancelReasonCode, setCancelReasonCode] = useState<string>('staff_other');
  const [cancelReasonNote, setCancelReasonNote] = useState('');
  const [cancelNotifyGuest, setCancelNotifyGuest] = useState(true);
  /** Stable per-attempt keys — regenerate after success so retries dedupe, not double-charge. */
  const renewIdemRef = useRef(`ui-renew:${crypto.randomUUID()}`);
  const reactivateIdemRef = useRef(`ui-reactivate:${crypto.randomUUID()}`);
  const upgradeIdemRef = useRef(`ui-up:${crypto.randomUUID()}`);
  const downgradeIdemRef = useRef(`ui-down:${crypto.randomUUID()}`);
  const creditIdemRef = useRef(`ui-credit:${crypto.randomUUID()}`);

  useEffect(() => {
    if (createIntent && (canWrite || canSell)) {
      setCreateOpen(true);
    }
  }, [createIntent, canWrite, canSell]);

  const membersQuery = useQuery({
    queryKey: membershipKeys.members(searchQ),
    queryFn: () => listMembershipMembers(searchQ),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const guestsQuery = useQuery({
    queryKey: membershipKeys.guests(searchQ),
    queryFn: () => searchMembershipGuests(searchQ),
    enabled: canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const plansQuery = useQuery({
    queryKey: membershipKeys.plans(false),
    queryFn: () => listMembershipPlans(),
    enabled: canSell || canBilling,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const detailQuery = useQuery({
    queryKey: membershipKeys.member(selectedId ?? ''),
    queryFn: () => getMembershipMember(selectedId!),
    enabled: Boolean(selectedId) && canRead,
  });

  const crmGuestId = detailQuery.data?.guestProfileId
    ? String(detailQuery.data.guestProfileId)
    : '';

  const guestCrmQuery = useQuery({
    queryKey: membershipKeys.guestDetail(crmGuestId),
    queryFn: () => getMembershipGuestDetail(crmGuestId),
    enabled: Boolean(crmGuestId) && canRead,
    staleTime: ADMIN_LIST_STALE_MS,
  });

  const inviteMutation = useMutation({
    mutationFn: (guestProfileId: string) =>
      inviteMembershipGuestToDashboard(guestProfileId),
    onSuccess: (data) => {
      addToast(data.note || 'Dashboard invite sent', 'success');
      notifyMembershipChange(qc, { kind: 'guest', action: 'update', id: crmGuestId || undefined });
    },
    onError: (err: Error) =>
      addToast(err.message || 'Invite failed', 'error'),
  });

  const actionMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      membershipMemberAction(selectedId!, body),
    onSuccess: (data) => {
      renewIdemRef.current = `ui-renew:${crypto.randomUUID()}`;
      reactivateIdemRef.current = `ui-reactivate:${crypto.randomUUID()}`;
      upgradeIdemRef.current = `ui-up:${crypto.randomUUID()}`;
      downgradeIdemRef.current = `ui-down:${crypto.randomUUID()}`;
      creditIdemRef.current = `ui-credit:${crypto.randomUUID()}`;
      if (data.paymentMethod && typeof data.paymentMethod === 'object') {
        const pm = data.paymentMethod as {
          setupIntentId?: string;
          clientSecret?: string | null;
        };
        addToast(
          pm.clientSecret
            ? `SetupIntent ${pm.setupIntentId ?? ''} ready — confirm card with Stripe Elements (clientSecret issued).`
            : data.note || 'Payment method session created',
          'success'
        );
      } else {
        addToast(data.note || 'Updated', 'success');
      }
      setConfirmAction(null);
      notifyMembershipChange(qc, {
        kind: 'member',
        action: 'update',
        id: selectedId || undefined,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Action failed', 'error'),
  });

  const mediaMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      patchMembershipMedia(selectedId!, body),
    onSuccess: (data) => {
      addToast(
        data.beta ? 'Family links updated (beta)' : 'Member media updated',
        'success'
      );
      notifyMembershipChange(qc, {
        kind: 'member',
        action: 'update',
        id: selectedId || undefined,
      });
    },
    onError: (err: Error) => addToast(err.message || 'Update failed', 'error'),
  });

  const agreementMutation = useMutation({
    mutationFn: () => signMembershipAgreementAsStaff(selectedId!),
    onSuccess: (data) => {
      addToast(
        data.membershipStatus === 'active'
          ? 'Agreement recorded — membership active'
          : 'Agreement recorded',
        'success'
      );
      notifyMembershipChange(qc, {
        kind: 'member',
        action: 'update',
        id: selectedId || undefined,
      });
    },
    onError: (err: Error) =>
      addToast(err.message || 'Could not record agreement', 'error'),
  });

  if (!canRead) {
    return (
      <div className="p-6 text-sm text-stone-600">
        You do not have permission to view Memberships members.
      </div>
    );
  }

  const members = membersQuery.data?.members ?? [];
  const note = membersQuery.data?.note ?? '';
  const guests = guestsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const detail = detailQuery.data;

  function runConfirmed() {
    if (!confirmAction || !selectedId) return;
    const amount = Number(detail?.plan?.price ?? 0);
    const cancelReason = cancelReasonNote.trim()
      ? `${cancelReasonCode}: ${cancelReasonNote.trim()}`.slice(0, 500)
      : cancelReasonCode;
    if (confirmAction === 'cancel-immediate' || confirmAction === 'cancel-eop') {
      actionMutation.mutate({
        action: 'cancel',
        when: confirmAction === 'cancel-immediate' ? 'immediate' : 'end_of_period',
        reason: cancelReason,
        notifyGuest: cancelNotifyGuest,
      });
      setCancelReasonNote('');
    } else if (confirmAction === 'pause') {
      actionMutation.mutate({ action: 'pause' });
    } else if (confirmAction === 'resume') {
      actionMutation.mutate({ action: 'resume' });
    } else if (confirmAction === 'renew') {
      actionMutation.mutate({
        action: 'renew',
        paymentMethod: 'collected',
        collectedAmount: amount,
        idempotencyKey: renewIdemRef.current,
      });
    } else if (confirmAction === 'reactivate') {
      actionMutation.mutate({
        action: 'reactivate',
        paymentMethod: 'collected',
        collectedAmount: amount,
        idempotencyKey: reactivateIdemRef.current,
      });
    }
  }

  return (
    <div className="space-y-8 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
            Memberships
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Members</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            All guest memberships for this company — desk sells, POS, and online
            accounts. Open a row to renew, cancel, or manage lifecycle.
            {canRedeem ? (
              <>
                {' '}
                <Link
                  href="/admin/memberships/redeem"
                  className="text-[#D4AF37] underline"
                >
                  Open redeem desk
                </Link>
              </>
            ) : null}
            {canRead ? (
              <>
                {' · '}
                <Link
                  href="/admin/memberships/reports"
                  className="text-[#D4AF37] underline"
                >
                  Reports &amp; dunning
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(canWrite || canSell) ? (
            <button
              type="button"
              className={btnPrimaryClass}
              onClick={() => setCreateOpen(true)}
            >
              Create member
            </button>
          ) : null}
          <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
        </div>
      </header>

      {guideOpen ? (
        <DeferredMembershipsGuideModal
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title="Membership members"
          subtitle="Sell and manage guest park memberships."
          steps={MEMBERSHIPS_MEMBERS_GUIDE_STEPS}
        />
      ) : null}

      <CreateMembershipMemberModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        canWrite={canWrite}
        canSell={canSell}
        onSold={(id) => setSelectedId(id)}
      />

      <div className="flex flex-wrap gap-2">
        <input
          className={`${fieldClass} max-w-xs`}
          placeholder="Search name, email, phone, membership id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearchQ(q.trim());
          }}
        />
        <button
          type="button"
          className={btnPrimaryClass}
          onClick={() => setSearchQ(q.trim())}
        >
          Search
        </button>
      </div>

      {note ? (
        <p className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
          {note}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Member roster
            <span className="ml-2 font-normal text-stone-500">
              ({members.length}
              {membersQuery.data?.nextCursor ? '+' : ''})
            </span>
          </h2>
        </div>
        {membersQuery.isLoading ? (
          <p className="px-4 py-6 text-sm text-stone-500">Loading members…</p>
        ) : members.length === 0 ? (
          <div className="space-y-3 px-4 py-8 text-center">
            <p className="text-sm text-stone-500">
              No memberships yet. Create a member at the desk, or they will appear
              here when sold via POS / online.
            </p>
            {(canWrite || canSell) ? (
              <button
                type="button"
                className={btnPrimaryClass}
                onClick={() => setCreateOpen(true)}
              >
                Create member
              </button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Member</th>
                  <th className="px-4 py-2.5 font-semibold">Plan</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                  <th className="px-4 py-2.5 font-semibold">Home venue</th>
                  <th className="px-4 py-2.5 font-semibold">Period end</th>
                  <th className="px-4 py-2.5 font-semibold">Account</th>
                  <th className="px-4 py-2.5 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {members.map((m) => (
                  <tr
                    key={m.id}
                    className={
                      selectedId === m.id
                        ? 'bg-amber-50/80'
                        : 'hover:bg-stone-50'
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-900">
                        {m.guest?.displayName ?? 'Guest'}
                      </p>
                      <p className="text-xs text-stone-500">
                        {m.customMembershipId}
                        {m.guest?.email ? ` · ${m.guest.email}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-stone-700">
                      {m.plan?.name ?? '—'}
                      <span className="block text-xs text-stone-500">
                        {m.plan
                          ? `${m.plan.price} ${m.plan.currency}`
                          : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium capitalize text-stone-700">
                        {m.status.replace('_', ' ')}
                        {m.cancelAtPeriodEnd ? ' · ends' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {sourceLabel(m.source)}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {m.homeLocation?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {m.currentPeriodEnd
                        ? new Date(m.currentPeriodEnd).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-600">
                      {m.guest?.userId ? (
                        <span className="text-emerald-700">Linked</span>
                      ) : (
                        <span className="text-stone-400">Not linked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-sm font-medium text-[#D4AF37] hover:underline"
                        onClick={() => {
                          setSelectedId(m.id);
                          setEditCustomId('');
                          setEditPhotoUrl('');
                          setFamilyEditIds([]);
                          setConfirmAction(null);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {crmGuestId && guestCrmQuery.data ? (
        <section className="space-y-3 border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-800">
            Guest CRM — {guestCrmQuery.data.guest.displayName}
          </h2>
          <p className="text-sm text-stone-600">
            {[guestCrmQuery.data.guest.email, guestCrmQuery.data.guest.phone]
              .filter(Boolean)
              .join(' · ') || 'No email/phone on file'}
            {guestCrmQuery.data.guest.userId
              ? ' · linked to online account'
              : ' · not linked to an online account'}
          </p>
          {canSell || canWrite ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={
                  inviteMutation.isPending ||
                  !guestCrmQuery.data.guest.email?.trim()
                }
                title={
                  guestCrmQuery.data.guest.email?.trim()
                    ? 'Link existing customer or send invite-only set-password email'
                    : 'Guest email required'
                }
                onClick={() =>
                  inviteMutation.mutate(guestCrmQuery.data.guest.id)
                }
              >
                {inviteMutation.isPending ? <ButtonSpinner /> : null}
                {guestCrmQuery.data.guest.userId
                  ? 'Resend dashboard access'
                  : 'Invite to membership dashboard'}
              </button>
            </div>
          ) : null}
          {guestCrmQuery.data.memberships.length === 0 ? (
            <p className="text-sm text-stone-500">No memberships on this guest yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100 border border-stone-100">
              {guestCrmQuery.data.memberships.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">
                      {m.planName}{' '}
                      <span className="font-normal text-stone-500">
                        ({m.customMembershipId})
                      </span>
                    </p>
                    <p className="text-xs text-stone-500">
                      {m.status}
                      {m.cancelAtPeriodEnd ? ' · cancel at period end' : ''}
                      {' · '}
                      {m.homeLocation?.name ?? 'No home venue'}
                      {m.remainingEntries != null
                        ? ` · ${m.remainingEntries} visits left`
                        : ''}
                      {m.visitStatus ? ` · ${m.visitStatus}` : ''}
                      {m.dunningFailCount > 0
                        ? ` · payment health: ${m.dunningFailCount} failed attempt${m.dunningFailCount === 1 ? '' : 's'}`
                        : m.status === 'past_due'
                          ? ' · payment health: past due'
                          : ' · payment health: ok'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-sm text-[#D4AF37] underline"
                    onClick={() => {
                      setSelectedId(m.id);
                      setConfirmAction(null);
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : crmGuestId && guestCrmQuery.isLoading ? (
        <p className="text-sm text-stone-500">Loading guest CRM…</p>
      ) : null}

      {selectedId && detail ? (
        <section className="space-y-4 border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-stone-800">
                {detail.customMembershipId}
              </h2>
              <p className="text-sm text-stone-600">
                {detail.guest.firstName} {detail.guest.lastName}
                {detail.guest.email ? ` · ${detail.guest.email}` : ''}
              </p>
              <p className="text-sm text-stone-600">
                Plan: {detail.plan.name} ({detail.plan.price}{' '}
                {detail.plan.currency})
                {detail.plan.categoryName
                  ? ` · ${detail.plan.categoryName}`
                  : ''}{' '}
                · status <strong>{detail.status}</strong>
              </p>
              <p className="text-xs text-stone-500">
                Home {detail.homeLocation?.name ?? '—'}
                {detail.visitStatus ? ` · ${detail.visitStatus}` : ''}
                {detail.remainingEntries != null
                  ? ` · ${detail.remainingEntries} visits left`
                  : ' · visits unlimited / not tracked'}
              </p>
              <p className="text-xs text-stone-500">
                Period{' '}
                {detail.currentPeriodStart
                  ? new Date(detail.currentPeriodStart).toLocaleDateString()
                  : '—'}{' '}
                →{' '}
                {detail.currentPeriodEnd
                  ? new Date(detail.currentPeriodEnd).toLocaleDateString()
                  : '—'}
                {' · '}Credit {(detail.creditBalanceMinor / 100).toFixed(2)}
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-stone-500 underline"
              onClick={() => setSelectedId(null)}
            >
              Close
            </button>
          </div>

          {detail.status === 'past_due' ? (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
              Past due — fail count {detail.dunningFailCount}
              {detail.dunningNextAt
                ? ` · next retry ${new Date(detail.dunningNextAt).toLocaleString()}`
                : ' · retries exhausted / cancel at period end scheduled'}
              . Collect payment or renew to recover.
            </div>
          ) : null}

          {detail.status === 'pending' && !detail.agreementSignedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <span>
                Pending — membership agreement not yet accepted. The guest can accept
                online (Profile → Memberships), or record in-person acceptance here.
              </span>
              {canSell ? (
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={agreementMutation.isPending}
                  onClick={() => agreementMutation.mutate()}
                >
                  {agreementMutation.isPending ? <ButtonSpinner /> : null}
                  Sign agreement (in person)
                </button>
              ) : null}
            </div>
          ) : null}

          {detail.cancelReason ? (
            <p className="text-xs text-stone-600">
              Cancel reason: {describeCancelReason(detail.cancelReason)}
              {detail.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
            </p>
          ) : null}

          {canWrite ? (
            <div className="grid gap-2 border border-stone-100 bg-stone-50 p-3 sm:grid-cols-2">
              <label className="text-xs text-stone-600">
                Custom membership ID
                <input
                  className={`${fieldClass} mt-1`}
                  value={editCustomId || detail.customMembershipId}
                  onChange={(e) => setEditCustomId(e.target.value)}
                  onFocus={() => {
                    if (!editCustomId) setEditCustomId(detail.customMembershipId);
                  }}
                />
              </label>
              <label className="text-xs text-stone-600">
                Photo URL (https)
                <input
                  className={`${fieldClass} mt-1`}
                  placeholder="https://…"
                  value={editPhotoUrl || detail.photoUrl || ''}
                  onChange={(e) => setEditPhotoUrl(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={mediaMutation.isPending}
                  onClick={() =>
                    mediaMutation.mutate({
                      customMembershipId:
                        editCustomId.trim() || detail.customMembershipId,
                    })
                  }
                >
                  Save custom ID
                </button>
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={mediaMutation.isPending || !editPhotoUrl.trim()}
                  onClick={() =>
                    mediaMutation.mutate({
                      photoUrl: editPhotoUrl.trim(),
                      alsoUpdateGuestProfile: true,
                    })
                  }
                >
                  Save photo URL
                </button>
                <label className="inline-flex cursor-pointer items-center gap-2 border border-stone-300 bg-white px-3 py-2 text-sm">
                  {photoUploading ? 'Uploading…' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className="hidden"
                    disabled={photoUploading || mediaMutation.isPending}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setPhotoUploading(true);
                      try {
                        const urls = await uploadCatalogImages(
                          [file],
                          'memberships'
                        );
                        const url = urls[0];
                        if (!url) throw new Error('Upload returned no URL');
                        setEditPhotoUrl(url);
                        mediaMutation.mutate({
                          photoUrl: url,
                          alsoUpdateGuestProfile: true,
                        });
                      } catch (err) {
                        addToast(
                          err instanceof Error ? err.message : 'Upload failed',
                          'error'
                        );
                      } finally {
                        setPhotoUploading(false);
                      }
                    }}
                  />
                </label>
              </div>
              {detail.plan.familyAllowed ? (
                <div className="sm:col-span-2 space-y-2 border-t border-stone-200 pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Family / group dependents (beta)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {guests
                      .filter((g) => g.id !== detail.guestProfileId)
                      .map((g) => {
                        const seeded =
                          familyEditIds.length > 0
                            ? familyEditIds
                            : detail.familyLinks.map((f) => f.guestProfileId);
                        const checked = seeded.includes(g.id);
                        return (
                          <label
                            key={g.id}
                            className="flex items-center gap-2 border border-stone-300 bg-white px-2 py-1 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const base =
                                  familyEditIds.length > 0
                                    ? familyEditIds
                                    : detail.familyLinks.map(
                                        (f) => f.guestProfileId
                                      );
                                setFamilyEditIds(
                                  checked
                                    ? base.filter((id) => id !== g.id)
                                    : [...base, g.id]
                                );
                              }}
                            />
                            {g.firstName} {g.lastName}
                          </label>
                        );
                      })}
                  </div>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    disabled={mediaMutation.isPending}
                    onClick={() => {
                      const ids =
                        familyEditIds.length > 0
                          ? familyEditIds
                          : detail.familyLinks.map((f) => f.guestProfileId);
                      mediaMutation.mutate({ familyGuestProfileIds: ids });
                    }}
                  >
                    Save family links
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {confirmAction ? (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm">
              <p className="font-medium text-amber-950">
                Confirm: {confirmAction.replace(/-/g, ' ')}?
              </p>
              {confirmAction === 'cancel-eop' || confirmAction === 'cancel-immediate' ? (
                <div className="mt-2 grid max-w-xl gap-2">
                  <label className="block text-xs text-stone-700">
                    Reason code
                    <select
                      className={`${fieldClass} mt-1`}
                      value={cancelReasonCode}
                      onChange={(e) => setCancelReasonCode(e.target.value)}
                    >
                      {CANCEL_REASON_CODES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-stone-700">
                    Notes (optional)
                    <textarea
                      className={`${fieldClass} mt-1`}
                      rows={2}
                      maxLength={450}
                      value={cancelReasonNote}
                      onChange={(e) => setCancelReasonNote(e.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-stone-700">
                    <input
                      type="checkbox"
                      checked={cancelNotifyGuest}
                      onChange={(e) => setCancelNotifyGuest(e.target.checked)}
                      disabled={!detail.guest.email}
                    />
                    Email cancellation confirmation to guest
                    {detail.guest.email ? ` (${detail.guest.email})` : ' (no email on file)'}
                  </label>
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={actionMutation.isPending}
                  onClick={runConfirmed}
                >
                  {actionMutation.isPending ? <ButtonSpinner /> : null}
                  Confirm
                </button>
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canSell || canBilling ? (
                <button
                  type="button"
                  className={btnPrimaryClass}
                  onClick={() => setConfirmAction('renew')}
                  disabled={
                    (detail.status === 'active' || detail.status === 'pending') &&
                    Boolean(detail.hasStripeSubscription)
                  }
                  title={
                    (detail.status === 'active' || detail.status === 'pending') &&
                    detail.hasStripeSubscription
                      ? 'Live Stripe subscription invoices automatically — renew when past_due'
                      : undefined
                  }
                >
                  Renew
                </button>
              ) : null}
              {canBilling ? (
                <>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => setConfirmAction('pause')}
                    disabled={
                      detail.status === 'paused' || detail.status === 'past_due'
                    }
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => setConfirmAction('resume')}
                    disabled={detail.status !== 'paused'}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => setConfirmAction('reactivate')}
                    disabled={
                      detail.status !== 'cancelled' &&
                      detail.status !== 'expired'
                    }
                  >
                    Reactivate
                  </button>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() =>
                      actionMutation.mutate({ action: 'payment-method' })
                    }
                  >
                    Update card
                  </button>
                </>
              ) : null}
              {canCancel ? (
                <>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => setConfirmAction('cancel-eop')}
                  >
                    Cancel end of period
                  </button>
                  <button
                    type="button"
                    className={btnPrimaryClass}
                    onClick={() => setConfirmAction('cancel-immediate')}
                  >
                    Cancel now
                  </button>
                </>
              ) : null}
            </div>
          )}

          {canBilling && detail.status === 'active' ? (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-stone-700">Upgrade / downgrade to</span>
                <select
                  className={fieldClass}
                  value={upgradePlanId}
                  onChange={(e) => setUpgradePlanId(e.target.value)}
                >
                  <option value="">Select plan…</option>
                  {plans
                    .filter((p) => p.id !== detail.planId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.price}
                      </option>
                    ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={!upgradePlanId || actionMutation.isPending}
                  onClick={() => {
                    const target = plans.find((p) => p.id === upgradePlanId);
                    const cur = Number(detail.plan.price);
                    const next = Number(target?.price ?? 0);
                    if (next > cur) {
                      const periodStart = detail.currentPeriodStart
                        ? new Date(detail.currentPeriodStart)
                        : new Date();
                      const periodEnd = detail.currentPeriodEnd
                        ? new Date(detail.currentPeriodEnd)
                        : new Date(periodStart.getTime() + 30 * 86_400_000);
                      let charge = Math.max(0, next - cur);
                      try {
                        charge = Math.max(
                          0,
                          computeProration({
                            oldPriceMajor: cur,
                            newPriceMajor: next,
                            periodStart,
                            periodEnd,
                          }).amountDueMajor
                        );
                      } catch {
                        // Fall back to full delta if period bounds are invalid.
                      }
                      actionMutation.mutate({
                        action: 'upgrade',
                        newPlanId: upgradePlanId,
                        paymentMethod: 'collected',
                        collectedAmount: charge,
                        idempotencyKey: upgradeIdemRef.current,
                      });
                    } else {
                      actionMutation.mutate({
                        action: 'downgrade',
                        newPlanId: upgradePlanId,
                        idempotencyKey: downgradeIdemRef.current,
                      });
                    }
                  }}
                >
                  Apply plan change
                </button>
              </div>
              <label className="block text-sm">
                <span className="text-stone-700">Apply credit (major)</span>
                <input
                  className={fieldClass}
                  type="number"
                  step="0.01"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className={btnPrimaryClass}
                  disabled={!creditAmount || actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      action: 'credit',
                      amountMajor: Number(creditAmount),
                      reason: 'staff_adjustment',
                      idempotencyKey: creditIdemRef.current,
                    })
                  }
                >
                  Apply credit
                </button>
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-stone-500">
              Payment attempts
            </h3>
            {detail.paymentAttempts.length === 0 ? (
              <p className="text-sm text-stone-500">None yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {detail.paymentAttempts.map((a) => (
                  <li key={a.id} className="py-2">
                    {a.status} · {a.amount} {a.currency}
                    {a.errorCode ? ` · ${a.errorCode}` : ''}
                    <span className="ml-2 text-xs text-stone-400">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                    {a.status === 'succeeded' ? (
                      <AccountingEntriesPanel
                        sourceType="membership_payment"
                        sourceId={a.id}
                        currency={a.currency}
                        className="mt-2"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {detail.familyLinks.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-stone-500">
                Family
              </h3>
              <ul className="text-sm">
                {detail.familyLinks.map((f) => (
                  <li key={f.id}>
                    {f.role}: {f.firstName} {f.lastName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-800">
          Guest profiles (CRM hub)
        </h2>
        <p className="text-xs text-stone-500">
          Search above to filter guest CRM rows. To add a member, use{' '}
          <button
            type="button"
            className="text-[#D4AF37] underline"
            onClick={() => setCreateOpen(true)}
          >
            Create member
          </button>
          .
        </p>

        {guests.length === 0 ? (
          <p className="text-sm text-stone-500">No guest profiles match.</p>
        ) : (
          <ul className="divide-y divide-stone-200 border border-stone-200 bg-white">
            {guests.map((g) => (
              <li key={g.id} className="px-4 py-3 text-sm">
                <span className="font-medium text-stone-900">
                  {g.displayName}
                </span>
                {g.email ? (
                  <span className="ml-2 text-stone-500">{g.email}</span>
                ) : null}
                {g.phone ? (
                  <span className="ml-2 text-stone-500">{g.phone}</span>
                ) : null}
                {g.userId ? (
                  <span className="ml-2 text-xs text-emerald-700">
                    · linked online
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
