'use client';

import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPaymentLink, payPaymentLink } from '@/services/publicBooking';
import { getPublicPartyPayLink, publicPartyKeys } from '@/services/publicParties';
import { guestSafeParkPayoutsMessage } from '@/lib/marketplace/guestParkPayoutsMessage';
import { formatInZone, partyErrorMessage } from '@/components/Protected/admin/pages/parties/partyFormat';
import { bookBtn, formatMoney } from './bookingUi';

type PartyPayInfo = {
  partyName: string;
  honoreeName: string | null;
  depositRequiredCents: number;
  depositPaidCents: number;
  visitStartsAt: string | null;
  venueName: string | null;
  timezone: string | null;
};

export default function PaymentLinkPage({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const query = useQuery({
    queryKey: ['public', 'booking', 'pay', token],
    queryFn: () => getPaymentLink(token),
    enabled: Boolean(token),
    retry: false,
  });
  const partyQ = useQuery({
    queryKey: publicPartyKeys.payLink(token),
    queryFn: () => getPublicPartyPayLink(token),
    enabled: Boolean(token) && query.isSuccess,
    retry: false,
  });
  const party = (partyQ.data?.party ?? null) as PartyPayInfo | null;
  const data = query.data as
    | {
        booking?: { publicId?: string; amountDue?: number; primaryContactName?: string; status?: string };
        link?: { amountDue?: number; expiresAt?: string };
        amountDue?: number;
        expiresAt?: string;
      }
    | undefined;
  const due = Number(data?.booking?.amountDue ?? data?.link?.amountDue ?? data?.amountDue ?? 0) || 0;
  const expiresAt = data?.link?.expiresAt ?? data?.expiresAt ?? null;
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
  const cancelled = ['cancelled', 'expired', 'refunded'].includes(data?.booking?.status ?? '');
  const paid = !cancelled && due <= 0;

  async function onPay(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await payPaymentLink(token);
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      window.location.reload();
    } catch (ex) {
      const raw = ex instanceof Error ? ex.message : 'Payment failed';
      setErr(guestSafeParkPayoutsMessage(partyErrorMessage(raw, raw)));
    } finally {
      setBusy(false);
    }
  }

  if (query.isError) {
    const e = query.error as { status?: number; message?: string };
    const state =
      e?.status === 410
        ? { title: 'Payment link expired', body: 'This payment link has expired. Ask the venue to send a new one.' }
        : e?.message === 'INVALID_STATUS_TRANSITION'
          ? { title: 'Booking cancelled', body: 'This booking was cancelled, so no payment is due. Contact the venue about refunds.' }
          : e?.message === 'PAYMENT_INCOMPLETE'
            ? { title: 'Paid in full', body: 'Nothing is due on this booking. Thank you!' }
            : { title: 'Payment link unavailable', body: 'This payment link is not valid. Ask the venue to send a new one.' };
    return (
      <main className="mx-auto max-w-lg space-y-3 px-4 py-10">
        <h1 className="text-2xl font-semibold">{state.title}</h1>
        <p className="text-sm text-stone-600">{state.body}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">{party ? `Pay for ${party.partyName}` : 'Pay booking'}</h1>
      {query.isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
      {party ? (
        <p className="text-sm text-stone-600">
          {formatInZone(party.visitStartsAt, party.timezone, { dateStyle: 'full', timeStyle: 'short' })}
          {party.venueName ? ` · ${party.venueName}` : ''}
        </p>
      ) : null}
      {data?.booking?.publicId ? (
        <p className="text-sm text-stone-600">
          {data.booking.publicId}
          {data.booking.primaryContactName ? ` · ${data.booking.primaryContactName}` : ''}
        </p>
      ) : null}
      {cancelled ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
          This {party ? 'party' : 'booking'} was cancelled, so no payment is due. Contact the venue about refunds.
        </p>
      ) : paid ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Paid in full — nothing is due. Thank you!</p>
      ) : expired ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This payment link has expired. Ask the venue to send a new one.
        </p>
      ) : (
        <>
          <p className="text-lg font-medium">Amount due {formatMoney(due)}</p>
          {party && party.depositRequiredCents > party.depositPaidCents ? (
            <p className="text-sm text-stone-600">
              Deposit outstanding {formatMoney((party.depositRequiredCents - party.depositPaidCents) / 100)}
            </p>
          ) : null}
          {err ? <p className="text-sm text-red-700">{err}</p> : null}
          <form onSubmit={onPay}>
            <button type="submit" className={bookBtn} disabled={busy || due <= 0}>
              {busy ? 'Opening checkout…' : 'Pay now'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
