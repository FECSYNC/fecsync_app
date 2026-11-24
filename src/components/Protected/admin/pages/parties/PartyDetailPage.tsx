'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { useToast } from '@/contexts/toast-context';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  useCancelPartyMutation,
  useConfirmPartyMutation,
  usePartyHostsQuery,
  usePartyPackageQuery,
  usePartyQuery,
  usePatchPartyMutation,
  useReactivatePartyMutation,
} from '@/hooks/useParties';
import { resendAdminBookingConfirmation } from '@/services/adminBookings';
import { partySummaryUrl, type PartyDetailDto } from '@/services/adminParties';
import { AccountingEntriesPanel } from '../accounting/shared';
import { usePartyCrossTabSync } from '@/utils/partyCrossTabSync';
import TakePaymentModal from '../bookings/TakePaymentModal';
import PartyRefundModal from './PartyRefundModal';
import PartyEditDrawer from './PartyEditDrawer';
import PartyGuestsTab from './PartyGuestsTab';
import PartyInvitationsTab from './PartyInvitationsTab';
import PartyFoodTab from './PartyFoodTab';
import PartyRoomTab from './PartyRoomTab';
import PartyBalanceTab from './PartyBalanceTab';
import PartyRunSheetTab from './PartyRunSheetTab';
import PartyWaiversTab from './PartyWaiversTab';
import { PartiesErrorBanner, btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import {
  OPS_STATUS_LABELS,
  allowedOpsTransitions,
  balanceChip,
  centsLabel,
  formatInZone,
  partyErrorMessage,
  ymdInZone,
} from './partyFormat';

const TABS = [
  'Overview',
  'Guests',
  'Invitations',
  'Food',
  'Room',
  'Balance',
  'Host',
  'Add-ons',
  'Run sheet',
  'Waivers',
  'Activity',
] as const;
type Tab = (typeof TABS)[number];

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className={btnSecondaryClass} onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p className="text-xs uppercase text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-stone-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function OverviewTab({ party }: { party: PartyDetailDto }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Package" value={party.package?.name ?? '—'} hint={party.location?.name} />
        <Stat label="Guests" value={`${party.kidCount} kids · ${party.adultCount} adults`} hint={`${party.guests.length} named`} />
        <Stat label="Room" value={party.room?.name ?? 'Unassigned'} />
        <Stat
          label="Honoree"
          value={party.honoreeName ?? '—'}
          hint={
            party.honoreeAge != null || party.honoreeBirthDate
              ? [party.honoreeAge != null ? `Turning ${party.honoreeAge}` : null, party.honoreeBirthDate?.slice(0, 10)]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        />
        <Stat
          label="Total"
          value={centsLabel(party.totalCents)}
          hint={`Subtotal ${centsLabel(party.subtotalCents)} · tax ${centsLabel(party.taxCents)}`}
        />
        <Stat label="Amount due" value={centsLabel(party.amountDueCents)} hint={`Paid ${centsLabel(party.amountPaidCents)}`} />
        <Stat
          label="Deposit"
          value={`${centsLabel(party.depositPaidCents)} / ${centsLabel(party.depositRequiredCents)}`}
          hint={
            party.depositOutstandingCents > 0
              ? `${centsLabel(party.depositOutstandingCents)} outstanding · due ${formatInZone(party.depositDueAt, party.timezone, { dateStyle: 'medium' })}`
              : 'Deposit covered'
          }
        />
        <Stat label="Balance due" value={formatInZone(party.balanceDueAt, party.timezone, { dateStyle: 'medium' })} />
        <Stat
          label="Contact"
          value={party.primaryContactName ?? '—'}
          hint={[party.primaryContactEmail, party.primaryContactPhone].filter(Boolean).join(' · ') || undefined}
        />
      </div>
      {party.notes ? (
        <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <span className="text-xs uppercase text-stone-500">Staff notes</span>
          <span className="mt-1 block">{party.notes}</span>
        </p>
      ) : null}
    </div>
  );
}

function HostTab({ party, canWrite }: { party: PartyDetailDto; canWrite: boolean }) {
  const { addToast } = useToast();
  const hostsQ = usePartyHostsQuery(canWrite);
  const patch = usePatchPartyMutation();
  const [notes, setNotes] = useState(party.hostNotes ?? '');
  useEffect(() => setNotes(party.hostNotes ?? ''), [party.hostNotes]);
  const save = (payload: Record<string, unknown>, msg: string) =>
    patch.mutate(
      { bookingId: party.bookingId, payload },
      { onSuccess: () => addToast(msg, 'success'), onError: (err) => addToast(partyErrorMessage(err), 'error') }
    );
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <p>
        Host: <strong>{party.host?.name ?? 'Unassigned'}</strong>
        {party.host?.email ? <span className="text-stone-500"> · {party.host.email}</span> : null}
      </p>
      {canWrite ? (
        <>
          <label className="block max-w-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Assign staff host</span>
            <select
              className={fieldClass}
              disabled={patch.isPending || hostsQ.isPending}
              value={party.hostStaffUserId ?? ''}
              onChange={(e) => save({ hostStaffUserId: e.target.value || null }, e.target.value ? 'Host assigned' : 'Host cleared')}
            >
              <option value="">Unassigned</option>
              {(hostsQ.data ?? []).map((h) => (
                <option key={h.userId} value={h.userId}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-stone-500">Host notes</span>
            <textarea className={fieldClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={patch.isPending || notes === (party.hostNotes ?? '')}
            onClick={() => save({ hostNotes: notes.trim() || null }, 'Host notes saved')}
          >
            Save notes
          </button>
        </>
      ) : party.hostNotes ? (
        <p className="text-stone-600">{party.hostNotes}</p>
      ) : null}
    </div>
  );
}

function AddOnsTab({ party, canWrite }: { party: PartyDetailDto; canWrite: boolean }) {
  const { addToast } = useToast();
  const pkgQ = usePartyPackageQuery(party.package?.id ?? null);
  const patch = usePatchPartyMutation();
  const available = (pkgQ.data?.addOns ?? []).filter((a) => a.published && !a.archived);
  const [pick, setPick] = useState('');
  const current = party.addOns.map((a) => ({ productId: a.productId, qty: a.qty }));
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  const apply = (next: Array<{ productId: string; qty: number }>, msg: string) =>
    patch.mutate(
      { bookingId: party.bookingId, payload: { addOns: next } },
      { onSuccess: () => addToast(msg, 'success'), onError: (err) => addToast(partyErrorMessage(err, 'Could not update add-ons'), 'error') }
    );
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      {party.addOns.length === 0 ? (
        <p className="text-stone-500">No add-ons on this party.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {party.addOns.map((a) => (
            <li key={a.productId} className="flex items-center justify-between gap-2 py-2">
              <span>
                {a.qty} × {a.name} <span className="text-stone-500">{centsLabel(a.lineTotalCents)}</span>
              </span>
              {canWrite && live ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs"
                    disabled={patch.isPending}
                    onClick={() => apply(current.map((c) => (c.productId === a.productId ? { ...c, qty: c.qty + 1 } : c)), 'Add-on updated')}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-700"
                    disabled={patch.isPending}
                    onClick={() =>
                      apply(
                        current
                          .map((c) => (c.productId === a.productId ? { ...c, qty: c.qty - 1 } : c))
                          .filter((c) => c.qty > 0),
                        'Add-on updated'
                      )
                    }
                  >
                    −1
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite && live ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          <select className={`${fieldClass} w-auto`} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add-on">
            <option value="">Add an add-on…</option>
            {available.map((a) => (
              <option key={a.productId} value={a.productId}>
                {a.name}
                {a.priceCents != null ? ` · ${centsLabel(a.priceCents)}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={!pick || patch.isPending}
            onClick={() => {
              const existing = current.find((c) => c.productId === pick);
              apply(
                existing ? current.map((c) => (c.productId === pick ? { ...c, qty: c.qty + 1 } : c)) : [...current, { productId: pick, qty: 1 }],
                'Add-on added'
              );
              setPick('');
            }}
          >
            {patch.isPending ? <ButtonSpinner /> : null}
            Add
          </button>
          {available.length === 0 && !pkgQ.isPending ? (
            <span className="text-xs text-stone-500">This package has no add-ons linked.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function activityLabel(a: PartyDetailDto['activities'][number]): string {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const event = typeof p.event === 'string' ? p.event.replace(/_/g, ' ') : a.kind;
  const extra =
    typeof p.reason === 'string'
      ? ` — ${p.reason}`
      : typeof p.overbookReason === 'string'
        ? ` — ${p.overbookReason}`
        : typeof p.template === 'string'
          ? ` — ${String(p.template).replace(/_/g, ' ')}${p.ok === false ? ' (not sent)' : ''}`
          : '';
  return `${event}${extra}`;
}

function ActivityTab({ party }: { party: PartyDetailDto }) {
  const items = useMemo(
    () => [...party.activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [party.activities]
  );
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
      {items.length === 0 ? (
        <p className="text-stone-500">No activity yet.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-2">
              <span className="w-44 shrink-0 text-xs text-stone-500">{formatInZone(a.createdAt, party.timezone)}</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{a.kind}</span>
              <span>{activityLabel(a)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function PartyDetailPage({
  bookingId: bookingIdProp,
  embedded = false,
}: {
  bookingId?: string;
  embedded?: boolean;
}) {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const bookingId = bookingIdProp || String(params?.bookingId ?? '');
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.PartiesWrite);
  const canInvite = can(P.PartiesInvitations);
  const canFood = can(P.PartiesFood);
  const canPay = can(P.BookingsPaymentsTake);
  const canRefund = can(P.BookingsRefund);
  const canOverbook = can(P.BookingsOverbook);
  const canChase = can(P.WaiversWrite);
  const { addToast } = useToast();

  const query = usePartyQuery(bookingId);
  usePartyCrossTabSync();
  const party = query.data as PartyDetailDto | undefined;
  const confirm = useConfirmPartyMutation();
  const cancel = useCancelPartyMutation();
  const reactivate = useReactivatePartyMutation();
  const patch = usePatchPartyMutation();

  const tabParam = sp?.get('tab') ?? '';
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : 'Overview');
  const [editOpen, setEditOpen] = useState(sp?.get('edit') === '1');
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [modal, setModal] = useState<null | 'confirm' | 'cancel' | 'reactivate'>(null);
  const [reason, setReason] = useState('');
  const [reactTarget, setReactTarget] = useState<'held' | 'confirmed'>('held');
  const [reactOverbook, setReactOverbook] = useState(false);
  const [resending, setResending] = useState(false);

  const selectTab = (t: Tab) => {
    setTab(t);
    if (embedded) return;
    const next = new URLSearchParams(sp?.toString() ?? '');
    next.set('tab', t);
    next.delete('edit');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 w-64 rounded bg-stone-200" />
        <div className="h-4 w-96 rounded bg-stone-200" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-stone-100" />
          ))}
        </div>
      </div>
    );
  }
  if (!party) {
    return (
      <div className="space-y-3">
        <PartiesErrorBanner error={query.error ?? new Error(partyErrorMessage('PARTY_NOT_FOUND'))} />
        <Link href="/admin/parties" className="text-sm text-[#D4AF37]">
          Back to parties
        </Link>
      </div>
    );
  }

  const chip = balanceChip(party.amountDueCents, party.status);
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  const transitions = allowedOpsTransitions(party.status, party.opsStatus, party.visitStartsAt);
  const caps = party.capabilities;
  const depositShort = party.depositRequiredCents > party.amountPaidCents;
  const confirmBlocked = Boolean(caps?.requireDepositToConfirm && depositShort);
  const canOverrideDeposit = Boolean(caps?.allowConfirmWithoutDeposit && canWrite);

  const header = (
    <div className="space-y-3">
      {!embedded ? (
        <Link href="/admin/parties" className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← Parties
        </Link>
      ) : (
        <Link href={`/admin/parties/${party.bookingId}`} className="text-sm font-medium text-[#D4AF37]">
          Open full party workspace →
        </Link>
      )}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">{party.partyName}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {formatInZone(party.visitStartsAt, party.timezone, { dateStyle: 'full', timeStyle: 'short' })} ·{' '}
            {party.location?.name ?? '—'} · Room {party.room?.name ?? 'unassigned'} · {party.publicId}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${chip.className}`}>{chip.label}</span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5">booking {party.status.replace(/_/g, ' ')}</span>
            {canWrite && transitions.length ? (
              <select
                className="rounded-full border border-stone-200 bg-white px-2 py-0.5"
                value=""
                disabled={patch.isPending}
                onChange={(e) =>
                  e.target.value &&
                  patch.mutate(
                    { bookingId: party.bookingId, payload: { opsStatus: e.target.value } },
                    {
                      onSuccess: () => addToast('Status updated', 'success'),
                      onError: (err) => addToast(partyErrorMessage(err), 'error'),
                    }
                  )
                }
                aria-label="Change ops status"
              >
                <option value="">{OPS_STATUS_LABELS[party.opsStatus] ?? party.opsStatus} ▾</option>
                {transitions.map((t) => (
                  <option key={t} value={t}>
                    Mark {OPS_STATUS_LABELS[t]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-full bg-[#D4AF37]/15 px-2 py-0.5 font-medium">
                {OPS_STATUS_LABELS[party.opsStatus] ?? party.opsStatus}
              </span>
            )}
            <span className="text-stone-500">Host {party.host?.name ?? 'unassigned'}</span>
          </div>
        </div>
        {!embedded ? (
          <div className="flex flex-wrap gap-2">
            {canWrite && live ? (
              <button type="button" className={btnSecondaryClass} onClick={() => setEditOpen(true)}>
                Edit
              </button>
            ) : null}
            {canWrite && live && party.status !== 'confirmed' ? (
              <button type="button" className={btnPrimaryClass} onClick={() => setModal('confirm')}>
                Confirm
              </button>
            ) : null}
            {canPay && live && party.amountDueCents > 0 ? (
              <button type="button" className={btnPrimaryClass} onClick={() => setPayOpen(true)}>
                Take payment
              </button>
            ) : null}
            {canPay && live && party.amountDueCents > 0 ? (
              <button type="button" className={btnSecondaryClass} onClick={() => selectTab('Balance')}>
                Payment link
              </button>
            ) : null}
            {canInvite && live ? (
              <button type="button" className={btnSecondaryClass} onClick={() => selectTab('Invitations')}>
                Send invitations
              </button>
            ) : null}
            <Link
              href={`/admin/parties/run-sheets?bookingId=${party.bookingId}&date=${ymdInZone(party.visitStartsAt, party.timezone)}&locationId=${party.locationId}&print=1`}
              target="_blank"
              className={btnSecondaryClass}
            >
              Print run sheet
            </Link>
            <a href={partySummaryUrl(party.bookingId, 'csv')} className={btnSecondaryClass}>
              Download summary
            </a>
            <a href={partySummaryUrl(party.bookingId, 'html')} target="_blank" rel="noreferrer" className={btnSecondaryClass}>
              Printable summary
            </a>
            {canWrite && party.status === 'confirmed' ? (
              <button
                type="button"
                className={btnSecondaryClass}
                disabled={resending}
                onClick={async () => {
                  setResending(true);
                  try {
                    const r = await resendAdminBookingConfirmation(party.bookingId);
                    addToast(r.sent ? 'Confirmation sent' : `Not sent (${r.reason ?? 'unknown'})`, r.sent ? 'success' : 'error');
                  } catch (err) {
                    addToast(partyErrorMessage(err), 'error');
                  } finally {
                    setResending(false);
                  }
                }}
              >
                Resend confirmation
              </button>
            ) : null}
            {canRefund && party.amountPaidCents > 0 ? (
              <button type="button" className={btnSecondaryClass} onClick={() => setRefundOpen(true)}>
                Refund
              </button>
            ) : null}
            {canWrite && live ? (
              <button type="button" className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={() => setModal('cancel')}>
                Cancel
              </button>
            ) : null}
            {canWrite && party.status === 'cancelled' ? (
              <button type="button" className={btnPrimaryClass} onClick={() => setModal('reactivate')}>
                Reactivate
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        {header}
        <OverviewTab party={party} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <div className="flex flex-wrap gap-1 border-b border-stone-200 pb-2 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'border-b-2 border-[#D4AF37] px-2 py-1 font-medium text-stone-900' : 'px-2 py-1 text-stone-500 hover:text-stone-800'}
            onClick={() => selectTab(t)}
          >
            {t}
            {t === 'Waivers' && party.waiverMissingCount > 0 ? (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-900">{party.waiverMissingCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? <OverviewTab party={party} /> : null}
      {tab === 'Guests' ? <PartyGuestsTab party={party} canWrite={canWrite} /> : null}
      {tab === 'Invitations' ? <PartyInvitationsTab party={party} canInvite={canInvite} /> : null}
      {tab === 'Food' ? <PartyFoodTab party={party} canFood={canFood} /> : null}
      {tab === 'Room' ? <PartyRoomTab party={party} canWrite={canWrite} canOverbook={canOverbook} /> : null}
      {tab === 'Balance' ? (
        <PartyBalanceTab party={party} onTakePayment={() => setPayOpen(true)} onRefund={() => setRefundOpen(true)} />
      ) : null}
      {tab === 'Host' ? <HostTab party={party} canWrite={canWrite} /> : null}
      {tab === 'Add-ons' ? <AddOnsTab party={party} canWrite={canWrite} /> : null}
      {tab === 'Run sheet' ? <PartyRunSheetTab party={party} canWrite={canWrite} /> : null}
      {tab === 'Waivers' ? <PartyWaiversTab bookingId={party.bookingId} canChase={canChase} /> : null}
      {tab === 'Activity' ? <ActivityTab party={party} /> : null}

      {editOpen ? (
        <PartyEditDrawer
          party={party}
          canOverbook={canOverbook}
          onClose={() => {
            setEditOpen(false);
            if (sp?.get('edit')) {
              const next = new URLSearchParams(sp.toString());
              next.delete('edit');
              router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
            }
          }}
        />
      ) : null}
      {payOpen ? (
        <TakePaymentModal
          booking={{
            id: party.bookingId,
            publicId: party.publicId,
            amountDue: party.amountDueCents / 100,
            primaryContactEmail: party.primaryContactEmail,
          }}
          smsAvailable={caps?.smsAvailable}
          showRefund={false}
          onClose={() => setPayOpen(false)}
        />
      ) : null}
      {refundOpen ? (
        <PartyRefundModal
          bookingId={party.bookingId}
          publicId={party.publicId}
          refundableCents={party.payments
            .filter((p) => ['completed', 'partial_refund'].includes(p.status))
            .reduce((s, p) => s + p.amountCents - p.amountRefundedCents, 0)}
          onClose={() => setRefundOpen(false)}
        />
      ) : null}

      {modal === 'confirm' ? (
        <Modal title="Confirm party" onClose={() => setModal(null)}>
          {confirmBlocked ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              The deposit of {centsLabel(party.depositRequiredCents)} is not fully paid ({centsLabel(party.amountPaidCents)} received).
              {canOverrideDeposit
                ? ' You can confirm anyway with a reason (logged).'
                : ' Take the deposit first, or turn on “Allow confirm without deposit” in Party settings.'}
            </p>
          ) : (
            <p className="text-sm text-stone-600">Confirming issues {party.kidCount + party.adultCount} entry tickets and sends the confirmation.</p>
          )}
          {confirmBlocked && canOverrideDeposit ? (
            <input className={fieldClass} placeholder="Reason to confirm without the deposit" value={reason} onChange={(e) => setReason(e.target.value)} />
          ) : null}
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={confirm.isPending || (confirmBlocked && (!canOverrideDeposit || !reason.trim()))}
            onClick={() =>
              confirm.mutate(
                { bookingId: party.bookingId, depositOverrideReason: confirmBlocked ? reason.trim() : undefined },
                {
                  onSuccess: () => {
                    setModal(null);
                    setReason('');
                    addToast('Party confirmed', 'success');
                  },
                  onError: (err) => addToast(partyErrorMessage(err, 'Could not confirm'), 'error'),
                }
              )
            }
          >
            {confirm.isPending ? <ButtonSpinner /> : null}
            Confirm party
          </button>
        </Modal>
      ) : null}

      {modal === 'cancel' ? (
        <Modal title="Cancel party" onClose={() => setModal(null)}>
          <p className="text-sm text-stone-600">
            Cancelling releases the room and unused capacity, voids unused tickets, and cancels open invitations, food orders, and
            reminders. It does not refund — use Refund separately.
          </p>
          <textarea className={fieldClass} rows={2} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={cancel.isPending || !reason.trim()}
            onClick={() =>
              cancel.mutate(
                { bookingId: party.bookingId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    setModal(null);
                    setReason('');
                    addToast('Party cancelled', 'success');
                  },
                  onError: (err) => addToast(partyErrorMessage(err, 'Could not cancel'), 'error'),
                }
              )
            }
          >
            {cancel.isPending ? <ButtonSpinner /> : null}
            Cancel party
          </button>
        </Modal>
      ) : null}

      {modal === 'reactivate' ? (
        <Modal title="Reactivate party" onClose={() => setModal(null)}>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase text-stone-500">Restore as</span>
            <select className={fieldClass} value={reactTarget} onChange={(e) => setReactTarget(e.target.value as 'held' | 'confirmed')}>
              <option value="held">Held</option>
              <option value="confirmed">Confirmed (deposit gate applies)</option>
            </select>
          </label>
          {canOverbook ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reactOverbook} onChange={(e) => setReactOverbook(e.target.checked)} />
              Overbook if the room or slot is taken
            </label>
          ) : null}
          {reactOverbook ? (
            <input className={fieldClass} placeholder="Overbook reason (logged)" value={reason} onChange={(e) => setReason(e.target.value)} />
          ) : null}
          <button
            type="button"
            className={btnPrimaryClass}
            disabled={reactivate.isPending || (reactOverbook && !reason.trim())}
            onClick={() =>
              reactivate.mutate(
                {
                  bookingId: party.bookingId,
                  target: reactTarget,
                  ...(reactOverbook ? { overbook: true, overbookReason: reason.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setModal(null);
                    setReason('');
                    addToast('Party reactivated', 'success');
                  },
                  onError: (err) => addToast(partyErrorMessage(err, 'Could not reactivate'), 'error'),
                }
              )
            }
          >
            {reactivate.isPending ? <ButtonSpinner /> : null}
            Reactivate
          </button>
        </Modal>
      ) : null}

      {party ? (
        <AccountingEntriesPanel
          sourceType="booking"
          sourceId={party.bookingId}
          currency={party.currency}
          className="mt-6"
        />
      ) : null}
    </div>
  );
}
