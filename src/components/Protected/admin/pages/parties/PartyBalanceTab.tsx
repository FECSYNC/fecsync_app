'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import { createAdminBookingPaymentLink } from '@/services/adminBookings';
import { createAdminBookingInvoice, sendAdminBookingInvoice } from '@/services/adminBookingInvoices';
import { invalidatePartyQueries } from '@/hooks/useParties';
import type { PartyDetailDto } from '@/services/adminParties';
import { btnPrimaryClass, btnSecondaryClass } from './partiesUi';
import { centsLabel, formatInZone, partyErrorMessage } from './partyFormat';

export default function PartyBalanceTab({
  party,
  onTakePayment,
  onRefund,
}: {
  party: PartyDetailDto;
  onTakePayment: () => void;
  onRefund: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const canPay = can(P.BookingsPaymentsTake);
  const canInvoice = can(P.BookingInvoicesManage);
  const canSendInvoice = can(P.BookingInvoicesSend);
  const canRefund = can(P.BookingsRefund);
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const live = !['cancelled', 'expired', 'refunded'].includes(party.status);
  const refundable = party.payments
    .filter((p) => ['completed', 'partial_refund'].includes(p.status))
    .reduce((s, p) => s + p.amountCents - p.amountRefundedCents, 0);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      invalidatePartyQueries(qc, party.bookingId);
    } catch (err) {
      addToast(partyErrorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Total', centsLabel(party.totalCents)],
          ['Paid', centsLabel(party.amountPaidCents)],
          ['Amount due', centsLabel(party.amountDueCents)],
          ['Deposit', `${centsLabel(party.depositPaidCents)} of ${centsLabel(party.depositRequiredCents)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-stone-50 p-3">
            <p className="text-xs uppercase text-stone-500">{k}</p>
            <p className="text-lg font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-stone-600">
        Deposit due {formatInZone(party.depositDueAt, party.timezone, { dateStyle: 'medium' })} · Balance due{' '}
        {formatInZone(party.balanceDueAt, party.timezone, { dateStyle: 'medium' })}
      </p>
      <div className="flex flex-wrap gap-2">
        {canPay && live && party.amountDueCents > 0 ? (
          <>
            <button type="button" className={btnPrimaryClass} onClick={onTakePayment}>
              Take payment
            </button>
            <button
              type="button"
              className={btnSecondaryClass}
              disabled={busy === 'link'}
              onClick={() =>
                run('link', async () => {
                  const link = await createAdminBookingPaymentLink(party.bookingId, {
                    amount: party.amountDueCents / 100,
                    to: party.primaryContactEmail ?? undefined,
                    sendVia: ['email'],
                  });
                  setPayUrl(link.payUrl || `${window.location.origin}/booking/pay/${link.token}`);
                  addToast(party.primaryContactEmail ? 'Payment link emailed' : 'Payment link created', 'success');
                })
              }
            >
              Payment link
            </button>
          </>
        ) : null}
        {canInvoice && live && party.amountDueCents > 0 ? (
          <button
            type="button"
            className={btnSecondaryClass}
            disabled={busy === 'invoice'}
            onClick={() =>
              run('invoice', async () => {
                const inv = await createAdminBookingInvoice(party.bookingId);
                if (canSendInvoice) {
                  await sendAdminBookingInvoice(inv.id);
                  addToast(`Invoice ${inv.number} created and sent`, 'success');
                } else {
                  addToast(`Invoice ${inv.number} created`, 'success');
                }
              })
            }
          >
            {canSendInvoice ? 'Create & send invoice' : 'Create invoice'}
          </button>
        ) : null}
        {canRefund && refundable > 0 ? (
          <button type="button" className={btnSecondaryClass} onClick={onRefund}>
            Refund
          </button>
        ) : null}
      </div>
      {payUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-2">
          <span className="break-all text-xs">{payUrl}</span>
          <button
            type="button"
            className={btnSecondaryClass}
            onClick={() => void navigator.clipboard?.writeText(payUrl).then(() => addToast('Link copied', 'success'))}
          >
            Copy
          </button>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Tenders</h3>
        {party.payments.length === 0 ? (
          <p className="text-stone-500">No payments yet.</p>
        ) : (
          <table className="min-w-full text-left">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Tender</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3 text-right">Amount</th>
                <th className="py-1 text-right">Refunded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {party.payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-1 pr-3">{formatInZone(p.createdAt, party.timezone)}</td>
                  <td className="py-1 pr-3">{p.tender.replace(/_/g, ' ')}</td>
                  <td className="py-1 pr-3">{p.status.replace(/_/g, ' ')}</td>
                  <td className="py-1 pr-3 text-right">{centsLabel(p.amountCents)}</td>
                  <td className="py-1 text-right">{p.amountRefundedCents ? centsLabel(p.amountRefundedCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
