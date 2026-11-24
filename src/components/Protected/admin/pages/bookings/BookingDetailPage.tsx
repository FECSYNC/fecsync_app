'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { useAdminBooking } from '@/hooks/useBookings';
import {
  adminBookingKeys,
  assignAdminBookingStaff,
  assignAdminBookingTicketIds,
  cancelAdminBooking,
  confirmAdminBooking,
  createAdminBookingPaymentLink,
  getAdminBookingTickets,
  holdAdminBooking,
  logAdminBookingCall,
  patchAdminBookingNotes,
  patchAdminBookingPassExpiry,
  patchAdminBookingPosNotes,
  patchAdminBookingTaxExemption,
  reactivateAdminBooking,
  refundAdminBooking,
  resendAdminBookingConfirmation,
  reserveAdminBooking,
  reviewAdminBooking,
} from '@/services/adminBookings';
import { listOrgMembers } from '@/services/members';
import {
  createAdminBookingInvoice,
  listAdminBookingInvoices,
  adminInvoiceKeys,
} from '@/services/adminBookingInvoices';
import {
  btnDangerClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldClass,
  formatBookingChannel,
  formatMoney,
} from '../ticketing/ticketingUi';
import { formatClockDateTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import TakePaymentModal from './TakePaymentModal';
import PartyDetailPage from '../parties/PartyDetailPage';
import BookingWaiverPanel from './BookingWaiverPanel';
import { AccountingEntriesPanel } from '../accounting/shared';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';

type Tab =
  | 'overview'
  | 'payments'
  | 'invoices'
  | 'tickets'
  | 'notes'
  | 'activity'
  | 'party'
  | 'company';

export default function BookingDetailPage() {
  const params = useParams();
  const bookingId = String(params?.bookingId ?? '');
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canTax = can(P.BookingsTaxExempt);
  const canWrite = can(P.BookingsWrite);
  const canPay = can(P.BookingsPaymentsTake);
  const canInvoice = can(P.BookingInvoicesManage);
  const canRefund = can(P.BookingsRefund);
  const canAssign = can(P.BookingsAssign);

  const query = useAdminBooking(bookingId);
  const invoicesQ = useQuery({
    queryKey: adminInvoiceKeys.list({ bookingId }),
    queryFn: () => listAdminBookingInvoices({ bookingId }),
    enabled: Boolean(bookingId),
  });
  const ticketsQ = useQuery({
    queryKey: [...adminBookingKeys.detail(bookingId), 'tickets'],
    queryFn: () => getAdminBookingTickets(bookingId),
    enabled: Boolean(bookingId),
  });
  const membersQuery = useQuery({
    queryKey: ['admin', 'members', 'active'],
    queryFn: () => listOrgMembers({ status: 'active' }),
    enabled: canAssign,
  });

  const booking = query.data;
  const { timeFormat } = useTimeClockFormat(booking?.locationId ?? null);
  const [notes, setNotes] = useState('');
  const [posNotes, setPosNotes] = useState('');
  const [allowUnpaid, setAllowUnpaid] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [callNote, setCallNote] = useState('');
  const [activityFilter, setActivityFilter] = useState('all');
  const [payOpen, setPayOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState<'original' | 'gift_card'>('original');
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!booking) return;
    setNotes(booking.notes ?? '');
    setPosNotes(booking.posNotes ?? '');
  }, [booking?.id, booking?.notes, booking?.posNotes]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: adminBookingKeys.detail(bookingId) });
    invalidateAfterBookingMutation(qc);
  };

  const actionMutation = useMutation({
    mutationFn: async (
      kind: 'confirm' | 'cancel' | 'reactivate' | 'review' | 'hold' | 'reserve'
    ) => {
      if (kind === 'confirm') return confirmAdminBooking(bookingId, allowUnpaid);
      if (kind === 'cancel') return cancelAdminBooking(bookingId);
      if (kind === 'reactivate') return reactivateAdminBooking(bookingId);
      if (kind === 'hold') return holdAdminBooking(bookingId);
      if (kind === 'reserve') return reserveAdminBooking(bookingId);
      return reviewAdminBooking(bookingId);
    },
    onSuccess: (data) => {
      qc.setQueryData(adminBookingKeys.detail(bookingId), data);
      invalidate();
    },
  });

  if (query.isLoading) return <p className="text-sm text-stone-500">Loading booking…</p>;
  if (!booking) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{(query.error as Error)?.message || 'Booking not found'}</p>
        <Link href="/admin/bookings" className="text-sm text-[#D4AF37]">Back to bookings</Link>
      </div>
    );
  }

  const pastLocked =
    Boolean(booking.visitStartsAt) &&
    new Date(booking.visitStartsAt as string).getTime() < Date.now();
  const busy = actionMutation.isPending;
  const tabs: Tab[] = [
    'overview',
    'payments',
    'invoices',
    'tickets',
    'notes',
    'activity',
    ...(booking.partyDetail ? (['party'] as Tab[]) : []),
    ...(booking.accountId ? (['company'] as Tab[]) : []),
  ];

  return (
    <div className="space-y-6">
      {pastLocked ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Past-locked: edits after the visit may be rejected.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/admin/bookings" className="text-sm text-stone-500 hover:text-[#D4AF37]">
            ← Bookings
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">{booking.publicId}</h1>
          <p className="mt-1 text-sm text-stone-600">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{booking.status}</span>
            {' · '}
            {formatBookingChannel(booking.channel)}
            {' · '}
            {booking.location?.name ?? '—'}
            {booking.amountDue > 0 ? ` · due ${formatMoney(booking.amountDue)}` : ''}
            {booking.assignedStaff?.name ? ` · ${booking.assignedStaff.name}` : ''}
          </p>
          {booking.partyDetail ? (
            <Link
              href={`/admin/parties/${booking.id}`}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#D4AF37]/15 px-2.5 py-0.5 text-xs font-semibold text-stone-900 ring-1 ring-[#D4AF37]/40 hover:bg-[#D4AF37]/25"
            >
              Party · open in Parties →
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite ? (
            <Link
              href={
                booking.partyDetail
                  ? `/admin/parties/${booking.id}?edit=1`
                  : `/admin/bookings/${booking.id}/edit`
              }
              className={btnSecondaryClass}
            >
              {booking.partyDetail ? 'Edit party' : 'Edit'}
            </Link>
          ) : null}
          {canPay && booking.amountDue > 0 && booking.status !== 'cancelled' ? (
            <button type="button" className={btnPrimaryClass} onClick={() => setPayOpen(true)}>
              Take payment
            </button>
          ) : null}
          {canPay && booking.amountDue > 0 ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={async () => {
                try {
                  const link = await createAdminBookingPaymentLink(bookingId, {
                    amount: booking.amountDue,
                    to: booking.primaryContactEmail ?? undefined,
                  });
                  setLinkUrl(link.payUrl || `/booking/pay/${link.token}`);
                  addToast('Payment link created', 'success');
                  invalidate();
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Link failed', 'error');
                }
              }}
            >
              Payment link
            </button>
          ) : null}
          {canInvoice ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={async () => {
                try {
                  const inv = await createAdminBookingInvoice(bookingId);
                  addToast(`Invoice ${inv.number} created`, 'success');
                  invalidate();
                  setTab('invoices');
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Invoice failed', 'error');
                }
              }}
            >
              Invoice
            </button>
          ) : null}
          {canWrite && ['draft', 'pending_payment', 'reserved'].includes(booking.status) ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy}
              onClick={() =>
                actionMutation.mutate('hold', {
                  onSuccess: () => addToast('On hold', 'success'),
                  onError: (err: Error) => addToast(err.message, 'error'),
                })
              }
            >
              Hold
            </button>
          ) : null}
          {canWrite && ['draft', 'hold', 'pending_payment'].includes(booking.status) ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy}
              onClick={() =>
                actionMutation.mutate('reserve', {
                  onSuccess: () => addToast('Reserved', 'success'),
                  onError: (err: Error) => addToast(err.message, 'error'),
                })
              }
            >
              Reserve
            </button>
          ) : null}
          {canWrite && booking.status !== 'confirmed' && booking.status !== 'cancelled' ? (
            <>
              <label className="inline-flex items-center gap-1 text-xs text-stone-600">
                <input type="checkbox" checked={allowUnpaid} onChange={(e) => setAllowUnpaid(e.target.checked)} />
                Allow unpaid
              </label>
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy}
                onClick={() =>
                  actionMutation.mutate('confirm', {
                    onSuccess: () => addToast('Confirmed', 'success'),
                    onError: (err: Error) => addToast(err.message, 'error'),
                  })
                }
              >
                {busy ? <ButtonSpinner /> : null}
                Review & confirm
              </button>
            </>
          ) : null}
          {canWrite && !booking.reviewedAt && booking.status !== 'cancelled' ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy}
              onClick={() =>
                actionMutation.mutate('review', {
                  onSuccess: () => addToast('Reviewed', 'success'),
                  onError: (err: Error) => addToast(err.message, 'error'),
                })
              }
            >
              Review
            </button>
          ) : null}
          {canWrite && booking.status === 'cancelled' ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy}
              onClick={() =>
                actionMutation.mutate('reactivate', {
                  onSuccess: () => addToast('Reactivated', 'success'),
                  onError: (err: Error) => addToast(err.message, 'error'),
                })
              }
            >
              Reactivate
            </button>
          ) : canWrite && booking.status !== 'expired' ? (
            <button
              type="button"
              className={btnDangerClass}
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Cancel this booking?')) return;
                actionMutation.mutate('cancel', {
                  onSuccess: () => addToast('Cancelled', 'success'),
                  onError: (err: Error) => addToast(err.message, 'error'),
                });
              }}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={async () => {
              const tickets = await getAdminBookingTickets(booking.id);
              const w = window.open('', '_blank');
              if (!w) return;
              w.document.write(
                `<html><body style="font-family:sans-serif;padding:24px">${tickets
                  .map(
                    (t) =>
                      `<div style="margin-bottom:16px;border:1px solid #ccc;padding:12px"><strong>${t.code}</strong><br/>${t.status}<br/><img width="120" height="120" src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(t.qrPayload || t.code)}"/></div>`
                  )
                  .join('')}</body></html>`
              );
              w.document.close();
              w.print();
            }}
          >
            Download tickets
          </button>
          {canWrite ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={async () => {
                try {
                  await resendAdminBookingConfirmation(booking.id);
                  addToast('Confirmation resent (or skipped if email unset)', 'success');
                  invalidate();
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Resend failed', 'error');
                }
              }}
            >
              Resend confirmation
            </button>
          ) : null}
        </div>
      </div>

      {linkUrl ? (
        <p className="break-all rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
          Payment link: <a className="text-[#D4AF37]" href={linkUrl}>{linkUrl}</a>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-2 text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            className={
              tab === t
                ? 'border-b-2 border-[#D4AF37] px-2 py-1 font-medium capitalize'
                : 'px-2 py-1 capitalize text-stone-500'
            }
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <BookingWaiverPanel bookingId={bookingId} />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
              <p className="text-xs font-semibold uppercase text-stone-500">Guest</p>
              <p className="mt-1 font-medium">{booking.primaryContactName ?? '—'}</p>
              <p className="text-stone-600">{booking.primaryContactEmail ?? '—'}</p>
              <p className="text-stone-600">{booking.primaryContactPhone ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
              <p className="text-xs font-semibold uppercase text-stone-500">Visit</p>
              <p className="mt-1">
                {formatClockDateTime(booking.visitStartsAt, timeFormat)}
              </p>
              <p className="text-stone-600">Staff: {booking.assignedStaff?.name ?? '—'}</p>
              {canAssign ? (
                <select
                  className={`${fieldClass} mt-2`}
                  defaultValue=""
                  onChange={async (e) => {
                    const staffUserId = e.target.value;
                    if (!staffUserId) return;
                    try {
                      const data = await assignAdminBookingStaff(bookingId, staffUserId);
                      qc.setQueryData(adminBookingKeys.detail(bookingId), data);
                      invalidate();
                      addToast('Staff assigned', 'success');
                      e.target.value = '';
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Assign failed', 'error');
                    }
                  }}
                >
                  <option value="">Assign staff…</option>
                  {(membersQuery.data?.members ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {[m.user?.firstName, m.user?.lastName].filter(Boolean).join(' ') ||
                        m.user?.email ||
                        m.userId}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
              <p className="text-xs font-semibold uppercase text-stone-500">Totals</p>
              <p>Subtotal {formatMoney(booking.subtotal)}</p>
              <p>
                Tax {formatMoney(booking.taxAmount)}
                {booking.taxExempt ? ' (exempt)' : ''}
              </p>
              {canTax ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(booking.taxExempt)}
                    onChange={async (e) => {
                      try {
                        const data = await patchAdminBookingTaxExemption(
                          bookingId,
                          e.target.checked
                        );
                        qc.setQueryData(adminBookingKeys.detail(bookingId), data);
                        invalidate();
                        addToast(
                          e.target.checked ? 'Marked tax exempt' : 'Tax restored',
                          'success'
                        );
                      } catch (err) {
                        addToast(err instanceof Error ? err.message : 'Tax update failed', 'error');
                      }
                    }}
                  />
                  Tax exempt
                </label>
              ) : null}
              <p>Total {formatMoney(booking.total)}</p>
              <p>Paid {formatMoney(booking.amountPaid)}</p>
              <p className="font-medium">Due {formatMoney(booking.amountDue)}</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Band</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {booking.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-medium">{l.productName}</td>
                    <td className="px-4 py-3">{l.priceBandCode ?? '—'}</td>
                    <td className="px-4 py-3">{l.qty}</td>
                    <td className="px-4 py-3">{formatMoney(l.unitPrice)}</td>
                    <td className="px-4 py-3">{formatMoney(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'payments' ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Tender</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {booking.payments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-stone-500">No payments yet.</td>
                  </tr>
                ) : (
                  booking.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2">{new Date(p.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">{p.tender}</td>
                      <td className="px-4 py-2">{formatMoney(p.amount, p.currency)}</td>
                      <td className="px-4 py-2">{p.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {canRefund && booking.amountPaid > 0 ? (
            <form
              className="flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await refundAdminBooking(bookingId, {
                    amount: Number(refundAmount),
                    method: refundMethod,
                  });
                  addToast('Refund recorded', 'success');
                  invalidate();
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Refund failed', 'error');
                }
              }}
            >
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className={fieldClass}
                placeholder="Refund amount"
              />
              <select
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as 'original' | 'gift_card')}
                className={`${fieldClass} w-auto`}
              >
                <option value="original">Original tender</option>
                <option value="gift_card">Gift card</option>
              </select>
              <button type="submit" className={btnDangerClass}>Refund</button>
            </form>
          ) : null}
        </div>
      ) : null}

      {tab === 'invoices' ? (
        <div className="space-y-3">
          {(invoicesQ.data ?? []).length === 0 ? (
            <p className="text-sm text-stone-500">No invoices yet. Use Invoice in the header.</p>
          ) : (
            <ul className="divide-y rounded-lg border border-stone-200 bg-white text-sm">
              {(invoicesQ.data ?? []).map((inv) => (
                <li key={inv.id} className="flex justify-between px-4 py-3">
                  <span>
                    {inv.number} · {inv.status} · {formatMoney(inv.amount, inv.currency)}
                  </span>
                  <Link href={`/admin/booking-invoices/${inv.id}`} className="text-[#D4AF37]">
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'tickets' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(ticketsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-stone-500">No credentials yet (issued on confirm).</p>
            ) : (
              (ticketsQ.data ?? []).map((t) => (
                <div key={t.id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
                  <p className="font-mono font-semibold">{t.code}</p>
                  <p className="text-xs text-stone-500">{t.status}</p>
                  {t.customTicketId ? <p className="text-xs">Custom ID: {t.customTicketId}</p> : null}
                  {t.passExpiresAt ? (
                    <p className="text-xs text-stone-500">
                      Pass expires {new Date(t.passExpiresAt).toLocaleDateString()}
                    </p>
                  ) : null}
                  <img
                    alt=""
                    className="mt-2 h-28 w-28"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=112x112&data=${encodeURIComponent(t.qrPayload || t.code)}`}
                  />
                  {canWrite ? (
                    <div className="mt-2 space-y-1">
                      <input
                        className={fieldClass}
                        placeholder="Custom ticket ID"
                        defaultValue={t.customTicketId ?? ''}
                        id={`custom-${t.id}`}
                      />
                      <input
                        type="date"
                        className={fieldClass}
                        id={`expiry-${t.id}`}
                        defaultValue={
                          t.passExpiresAt
                            ? new Date(t.passExpiresAt).toISOString().slice(0, 10)
                            : ''
                        }
                      />
                      <button
                        type="button"
                        className={btnSecondaryClass}
                        onClick={async () => {
                          const custom = (
                            document.getElementById(`custom-${t.id}`) as HTMLInputElement | null
                          )?.value?.trim();
                          const expiry = (
                            document.getElementById(`expiry-${t.id}`) as HTMLInputElement | null
                          )?.value;
                          if (custom) {
                            await assignAdminBookingTicketIds(bookingId, [
                              { credentialId: t.id, customTicketId: custom },
                            ]);
                          }
                          await patchAdminBookingPassExpiry(
                            bookingId,
                            t.id,
                            expiry ? new Date(expiry).toISOString() : null
                          );
                          await ticketsQ.refetch();
                          addToast('Ticket updated', 'success');
                        }}
                      >
                        Save ID / expiry
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {canWrite && (ticketsQ.data ?? []).length > 1 ? (
            <button
              type="button"
              className={btnSecondaryClass}
              onClick={async () => {
                const assignments = (ticketsQ.data ?? []).map((t, i) => ({
                  credentialId: t.id,
                  customTicketId: `TIX-${booking.publicId}-${i + 1}`,
                }));
                await assignAdminBookingTicketIds(bookingId, assignments);
                await ticketsQ.refetch();
                addToast('Bulk custom IDs applied', 'success');
              }}
            >
              Bulk assign custom IDs
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Booking notes</h2>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canWrite}
              className={fieldClass}
            />
            {canWrite ? (
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={async () => {
                  const data = await patchAdminBookingNotes(bookingId, notes.trim() || null);
                  qc.setQueryData(adminBookingKeys.detail(bookingId), data);
                  invalidate();
                  addToast('Notes saved', 'success');
                }}
              >
                Save notes
              </button>
            ) : null}
          </div>
          <div className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">POS notes (staff only)</h2>
            <textarea
              rows={4}
              value={posNotes}
              onChange={(e) => setPosNotes(e.target.value)}
              disabled={!canWrite}
              className={fieldClass}
            />
            {canWrite ? (
              <button
                type="button"
                className={btnSecondaryClass}
                onClick={async () => {
                  const data = await patchAdminBookingPosNotes(bookingId, posNotes.trim() || null);
                  qc.setQueryData(adminBookingKeys.detail(bookingId), data);
                  invalidate();
                  addToast('POS notes saved', 'success');
                }}
              >
                Save POS notes
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {['all', 'payment', 'email', 'sms', 'system', 'call'].map((k) => (
              <button
                key={k}
                type="button"
                className={activityFilter === k ? 'text-[#D4AF37]' : 'text-stone-500'}
                onClick={() => setActivityFilter(k)}
              >
                {k}
              </button>
            ))}
          </div>
          {canWrite ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await logAdminBookingCall(booking.id, {
                  summary: callNote,
                  direction: 'outbound',
                });
                setCallNote('');
                invalidate();
                addToast('Call logged', 'success');
              }}
            >
              <input
                className={fieldClass}
                placeholder="Log a call"
                value={callNote}
                onChange={(e) => setCallNote(e.target.value)}
              />
              <button type="submit" className={btnSecondaryClass} disabled={!callNote.trim()}>
                Log
              </button>
            </form>
          ) : null}
          <ul className="mt-3 space-y-1">
            {booking.activities
              .filter((a) => activityFilter === 'all' || a.kind === activityFilter)
              .map((a) => (
                <li key={a.id}>
                  {new Date(a.createdAt).toLocaleString()} — {a.kind}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {tab === 'party' && booking.partyDetail ? (
        <PartyDetailPage bookingId={booking.id} embedded />
      ) : null}

      {tab === 'company' && booking.accountId ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <p className="font-medium">{booking.account?.name ?? 'Company'}</p>
          <Link href={`/admin/booking-accounts/${booking.accountId}`} className="text-[#D4AF37]">
            Open company account
          </Link>
        </div>
      ) : null}

      <AccountingEntriesPanel
        sourceType="booking"
        sourceId={booking.id}
        currency={booking.currency}
        className="mt-6"
      />

      {payOpen ? <TakePaymentModal booking={booking} onClose={() => setPayOpen(false)} /> : null}
    </div>
  );
}
