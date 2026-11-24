'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import { refundAdminBooking } from '@/services/adminBookings';
import { invalidatePartyQueries } from '@/hooks/useParties';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from './partiesUi';
import { centsLabel, partyErrorMessage } from './partyFormat';

/** Refund through the booking refund lib (bookings:refund). Never shown without that permission. */
export default function PartyRefundModal({
  bookingId,
  publicId,
  refundableCents,
  onClose,
}: {
  bookingId: string;
  publicId: string;
  refundableCents: number;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState((refundableCents / 100).toFixed(2));
  const [method, setMethod] = useState<'original' | 'gift_card'>('original');
  const [reason, setReason] = useState('');

  const mut = useMutation({
    mutationFn: () => refundAdminBooking(bookingId, { amount: Number(amount), method, reason: reason.trim() }),
    onSuccess: () => {
      addToast('Refund recorded', 'success');
      invalidatePartyQueries(qc, bookingId);
      invalidateAfterBookingMutation(qc);
      onClose();
    },
    onError: (err) => addToast(partyErrorMessage(err, 'Refund failed'), 'error'),
  });

  if (!can(P.BookingsRefund)) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      addToast('Add a reason for the refund', 'error');
      return;
    }
    if (!window.confirm(`Refund $${Number(amount).toFixed(2)} on ${publicId}?`)) return;
    mut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={onSubmit} className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Refund</h2>
            <p className="text-sm text-stone-500">
              {publicId} · up to {centsLabel(refundableCents)} refundable
            </p>
          </div>
          <button type="button" className={btnSecondaryClass} onClick={onClose}>
            Close
          </button>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Amount</span>
          <input
            className={fieldClass}
            type="number"
            min={0.01}
            max={refundableCents / 100}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Refund to</span>
          <select className={fieldClass} value={method} onChange={(e) => setMethod(e.target.value as 'original' | 'gift_card')}>
            <option value="original">Original tender</option>
            <option value="gift_card">Gift card</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase text-stone-500">Reason</span>
          <textarea className={fieldClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <p className="text-xs text-stone-500">
          Refunding does not cancel the party or release the room. Cancel the party separately if needed.
        </p>
        <button type="submit" className={btnPrimaryClass} disabled={mut.isPending}>
          {mut.isPending ? <ButtonSpinner /> : null}
          Refund
        </button>
      </form>
    </div>
  );
}
