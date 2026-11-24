'use client';

import { useState } from 'react';
import Link from 'next/link';
import { bookBtn, bookBtnGhost, formatMoney, formatWhen, TicketCard } from './bookingUi';
import { beginPublicPayNow, type GuestBookingDto } from '@/services/publicBooking';

export default function GuestBookingPanel({
  booking,
  payHref,
  viewToken,
  showPay = true,
}: {
  booking: GuestBookingDto;
  payHref?: string;
  /** When set, Pay balance can start Stripe Checkout via pay-now. */
  viewToken?: string;
  showPay?: boolean;
}) {
  const tickets = booking.credentials ?? [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onPayNow() {
    if (!viewToken) return;
    setBusy(true);
    setErr('');
    try {
      const res = await beginPublicPayNow(booking.publicId, viewToken);
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setErr('Could not start payment');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  const canPay = showPay && booking.amountDue > 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">
          Booking {booking.publicId}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">
          {booking.status.replace('_', ' ')}
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          {booking.location?.name ?? 'Venue'} ·{' '}
          {formatWhen(
            booking.visitStartsAt,
            booking.location?.timezone,
            booking.timeFormat
          )}
        </p>
      </header>

      <dl className="grid gap-2 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-stone-500">Guest</dt>
          <dd>{booking.primaryContactName ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Email</dt>
          <dd>{booking.primaryContactEmail ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Total</dt>
          <dd>{formatMoney(booking.total)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">Paid</dt>
          <dd>{formatMoney(booking.amountPaid)}</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Due</dt>
          <dd>{formatMoney(booking.amountDue)}</dd>
        </div>
        {booking.taxAmount != null && booking.taxAmount > 0 ? (
          <div className="flex justify-between text-stone-600">
            <dt>Tax</dt>
            <dd>{formatMoney(booking.taxAmount)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-100 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {booking.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">{l.productName}</td>
                <td className="px-4 py-2">{l.qty}</td>
                <td className="px-4 py-2">{formatMoney(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tickets.length ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tickets</h2>
            <button type="button" className={bookBtnGhost} onClick={() => window.print()}>
              Download / print
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {tickets.map((t) => (
              <div key={t.id}>
                <TicketCard code={t.code} status={t.status} qrPayload={t.qrPayload} />
                {t.ticketToken ? (
                  <Link
                    href={`/booking/tickets/${t.ticketToken}`}
                    className="mt-1 inline-block text-xs text-[#D4AF37]"
                  >
                    Open ticket
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-stone-500">Tickets appear after confirmation.</p>
      )}

      {canPay && payHref ? (
        <Link href={payHref} className={bookBtn}>
          Pay balance {formatMoney(booking.amountDue)}
        </Link>
      ) : null}
      {canPay && !payHref && viewToken ? (
        <button type="button" className={bookBtn} disabled={busy} onClick={() => void onPayNow()}>
          {busy ? 'Starting…' : `Pay balance ${formatMoney(booking.amountDue)}`}
        </button>
      ) : null}
      {err ? <p className="text-sm text-red-700">{err}</p> : null}
    </div>
  );
}
