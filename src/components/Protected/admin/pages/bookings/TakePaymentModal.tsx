'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { ButtonSpinner } from '@/components/Protected/admin/components/Spinner';
import {
  adminBookingKeys,
  createAdminBookingPaymentLink,
  refundAdminBooking,
  takeAdminBookingTenders,
  type AdminBookingDto,
} from '@/services/adminBookings';
import { createAdminBookingInvoice } from '@/services/adminBookingInvoices';
import { btnPrimaryClass, btnSecondaryClass, fieldClass } from '../ticketing/ticketingUi';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import { invalidatePartyQueries } from '@/hooks/useParties';

export type TakePaymentBooking = Pick<AdminBookingDto, 'id' | 'publicId' | 'amountDue' | 'primaryContactEmail'>;

export default function TakePaymentModal({
  booking,
  onClose,
  smsAvailable,
  showRefund = true,
}: {
  booking: TakePaymentBooking;
  onClose: () => void;
  /** false → SMS provider not configured (checkbox disabled). undefined → unknown. */
  smsAvailable?: boolean;
  /** Parties use the separate RefundModal. */
  showRefund?: boolean;
}) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canChargeStored = can(P.BookingsChargeStored);
  const canInvoice = can(P.BookingInvoicesManage);
  const canRefund = can(P.BookingsRefund);
  const [tender, setTender] = useState('cash');
  const [amount, setAmount] = useState(String(booking.amountDue));
  const [splitCash, setSplitCash] = useState('');
  const [splitCard, setSplitCard] = useState('');
  const [gift, setGift] = useState('');
  const [storedId, setStoredId] = useState('');
  const [linkTo, setLinkTo] = useState(booking.primaryContactEmail ?? '');
  const [sendSms, setSendSms] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');
  const [refundMethod, setRefundMethod] = useState<'original' | 'gift_card'>('original');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: adminBookingKeys.detail(booking.id) });
    invalidateAfterBookingMutation(qc);
    invalidatePartyQueries(qc, booking.id);
  };

  const payMut = useMutation({
    mutationFn: () => {
      if (tender === 'split') {
        const tenders = [
          splitCash ? { type: 'cash', amount: Number(splitCash) } : null,
          splitCard ? { type: 'card', amount: Number(splitCard) } : null,
        ].filter(Boolean) as Array<{ type: string; amount: number }>;
        return takeAdminBookingTenders(booking.id, tenders);
      }
      return takeAdminBookingTenders(booking.id, [
        {
          type: tender,
          amount: Number(amount),
          giftCardCode: tender === 'gift_card' ? gift.trim() : undefined,
          storedPaymentMethodId: tender === 'stored_card' ? storedId.trim() : undefined,
        },
      ]);
    },
    onSuccess: (res) => {
      if (res.checkoutUrl) {
        window.open(res.checkoutUrl, '_blank');
        addToast('Card checkout opened', 'success');
      } else {
        addToast('Payment recorded', 'success');
      }
      invalidate();
      onClose();
    },
    onError: (err: Error) => addToast(err.message || 'Payment failed', 'error'),
  });

  const linkMut = useMutation({
    mutationFn: () =>
      createAdminBookingPaymentLink(booking.id, {
        amount: Number(amount) || booking.amountDue,
        to: linkTo || undefined,
        sendVia: sendSms && smsAvailable !== false ? ['email', 'sms'] : ['email'],
      }),
    onSuccess: (link) => {
      addToast(`Payment link created${link.payUrl ? '' : ''}`, 'success');
      invalidate();
      onClose();
    },
    onError: (err: Error) => addToast(err.message || 'Link failed', 'error'),
  });

  const invMut = useMutation({
    mutationFn: () => createAdminBookingInvoice(booking.id),
    onSuccess: (inv) => {
      addToast(`Invoice ${inv.number} created`, 'success');
      invalidate();
      onClose();
    },
    onError: (err: Error) => addToast(err.message || 'Invoice failed', 'error'),
  });

  const refundMut = useMutation({
    mutationFn: () =>
      refundAdminBooking(booking.id, {
        amount: Number(refundAmt),
        method: refundMethod,
      }),
    onSuccess: () => {
      addToast('Refund recorded', 'success');
      invalidate();
      onClose();
    },
    onError: (err: Error) => addToast(err.message || 'Refund failed', 'error'),
  });

  const onPay = (e: FormEvent) => {
    e.preventDefault();
    if (tender === 'stored_card' && !canChargeStored) {
      addToast('You need bookings:charge_stored to use stored cards', 'error');
      return;
    }
    payMut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Take payment</h2>
            <p className="text-sm text-stone-500">
              {booking.publicId} · due ${booking.amountDue.toFixed(2)}
            </p>
          </div>
          <button type="button" className={btnSecondaryClass} onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={onPay} className="mt-4 space-y-3">
          <select className={fieldClass} value={tender} onChange={(e) => setTender(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card (Stripe)</option>
            <option value="gift_card">Gift card</option>
            {canChargeStored ? <option value="stored_card">Stored card</option> : null}
            <option value="invoice">Invoice marker</option>
            <option value="split">Split cash + card</option>
          </select>
          {tender === 'split' ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                className={fieldClass}
                placeholder="Cash"
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value)}
              />
              <input
                className={fieldClass}
                placeholder="Card"
                value={splitCard}
                onChange={(e) => setSplitCard(e.target.value)}
              />
            </div>
          ) : (
            <input
              className={fieldClass}
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
          {tender === 'gift_card' ? (
            <input
              className={fieldClass}
              placeholder="Gift card code"
              value={gift}
              onChange={(e) => setGift(e.target.value)}
            />
          ) : null}
          {tender === 'stored_card' && canChargeStored ? (
            <input
              className={fieldClass}
              placeholder="Stored payment method ID"
              value={storedId}
              onChange={(e) => setStoredId(e.target.value)}
            />
          ) : null}
          <button type="submit" className={btnPrimaryClass} disabled={payMut.isPending}>
            {payMut.isPending ? <ButtonSpinner /> : null}
            Record payment
          </button>
        </form>
        <div className="mt-5 space-y-2 border-t border-stone-100 pt-4">
          <p className="text-sm font-semibold">Payment link</p>
          <input
            className={fieldClass}
            placeholder="Send to email or phone"
            value={linkTo}
            onChange={(e) => setLinkTo(e.target.value)}
          />
          <label className={`flex items-center gap-2 text-sm ${smsAvailable === false ? 'text-stone-400' : ''}`}>
            <input
              type="checkbox"
              checked={sendSms && smsAvailable !== false}
              disabled={smsAvailable === false}
              onChange={(e) => setSendSms(e.target.checked)}
            />
            {smsAvailable === false
              ? 'SMS unavailable (no SMS provider is configured)'
              : 'Also send by SMS (skipped if no SMS provider is configured)'}
          </label>
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={linkMut.isPending}
            onClick={() => linkMut.mutate()}
          >
            Send payment link
          </button>
        </div>
        <div className="mt-4 space-y-2 border-t border-stone-100 pt-4">
          <p className="text-sm font-semibold">Invoice / refund</p>
          {canInvoice ? (
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={invMut.isPending}
              onClick={() => invMut.mutate()}
            >
              Create invoice
            </button>
          ) : null}
          {canRefund && showRefund ? (
            <>
              <div className="flex gap-2">
                <input
                  className={fieldClass}
                  placeholder="Refund amount"
                  value={refundAmt}
                  onChange={(e) => setRefundAmt(e.target.value)}
                />
                <select
                  className={fieldClass}
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value as 'original' | 'gift_card')}
                >
                  <option value="original">Original tender</option>
                  <option value="gift_card">Gift card</option>
                </select>
              </div>
              <button
                type="button"
                className={btnSecondaryClass}
                disabled={refundMut.isPending || !refundAmt}
                onClick={() => {
                  if (!window.confirm('Refund this amount?')) return;
                  refundMut.mutate();
                }}
              >
                Refund
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
