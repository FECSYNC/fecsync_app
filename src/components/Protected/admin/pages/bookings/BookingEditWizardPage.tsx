'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/contexts/toast-context';
import { useAuthStore } from '@/store/authStore';
import { P } from '@/lib/auth/permissions';
import {
  adminBookingKeys,
  getAdminBooking,
  patchAdminBookingLines,
} from '@/services/adminBookings';
import {
  getTicketingAvailability,
  listTicketingProducts,
  ticketingKeys,
} from '@/services/ticketing';
import { btnPrimaryClass, btnSecondaryClass, fieldClass, formatMoney } from '../ticketing/ticketingUi';
import { formatClockDateTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';

export default function BookingEditWizardPage() {
  const params = useParams();
  const bookingId = String(params?.bookingId ?? '');
  const router = useRouter();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const canWrite = can(P.BookingsWrite);
  const query = useQuery({
    queryKey: adminBookingKeys.detail(bookingId),
    queryFn: () => getAdminBooking(bookingId),
    enabled: Boolean(bookingId),
  });
  const booking = query.data;
  const locationId = booking?.locationId ?? '';
  const { timeFormat } = useTimeClockFormat(locationId || null);

  // Party bookings are edited through the party engine (counts, room, food, deposits).
  useEffect(() => {
    if (booking?.partyDetail) router.replace(`/admin/parties/${booking.id}?edit=1`);
  }, [booking, router]);

  const [qty, setQty] = useState(1);
  const [productId, setProductId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [band, setBand] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const productsQ = useQuery({
    queryKey: ticketingKeys.products({ locationId, published: 'all' }),
    queryFn: () => listTicketingProducts({ locationId, published: 'all' }),
    enabled: Boolean(locationId),
  });

  useEffect(() => {
    if (!booking?.lines[0]) return;
    const l = booking.lines[0];
    setProductId(l.productId);
    setQty(l.qty);
    setSessionId(l.sessionId ?? '');
    setVisitDate(l.visitDate ? l.visitDate.slice(0, 10) : '');
    setBand(l.priceBandCode ?? '');
  }, [booking]);

  const product = (productsQ.data ?? []).find((p) => p.id === productId);
  const needsSlot = ['timed_session', 'party_package', 'group', 'camp_event'].includes(
    product?.type ?? ''
  );
  const dateForAvail =
    visitDate ||
    (booking?.visitStartsAt ? booking.visitStartsAt.slice(0, 10) : new Date().toISOString().slice(0, 10));

  const availQ = useQuery({
    queryKey: ticketingKeys.availability({ productId, date: dateForAvail, qty }),
    queryFn: () =>
      getTicketingAvailability({
        productId,
        requestedQty: qty,
        from: `${dateForAvail}T00:00:00.000Z`,
        to: `${dateForAvail}T23:59:59.999Z`,
      }),
    enabled: Boolean(productId && needsSlot && dateForAvail),
  });

  const mainProducts = useMemo(
    () => (productsQ.data ?? []).filter((p) => p.type !== 'add_on' && !p.archivedAt),
    [productsQ.data]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!booking || !canWrite) return;
    setBusy(true);
    setErr('');
    try {
      const rest = booking.lines.slice(1).map((l) => ({
        productId: l.productId,
        qty: l.qty,
        sessionId: l.sessionId,
        visitDate: l.visitDate,
        priceBandCode: l.priceBandCode,
      }));
      await patchAdminBookingLines(bookingId, [
        {
          productId,
          qty,
          sessionId: needsSlot ? sessionId || undefined : undefined,
          visitDate: !needsSlot ? visitDate || undefined : undefined,
          priceBandCode: band || undefined,
        },
        ...rest,
      ]);
      invalidateAfterBookingMutation(qc);
      addToast('Booking updated', 'success');
      router.push(`/admin/bookings/${bookingId}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return <p className="text-sm text-stone-500">Loading…</p>;
  if (!booking) return <p className="text-sm text-red-700">Booking not found</p>;
  if (!canWrite) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700">You need bookings:write to edit this booking.</p>
        <Link href={`/admin/bookings/${bookingId}`} className="text-sm text-[#D4AF37]">
          Back to booking
        </Link>
      </div>
    );
  }

  const past = booking.visitStartsAt && new Date(booking.visitStartsAt).getTime() < Date.now();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <Link href={`/admin/bookings/${bookingId}`} className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← {booking.publicId}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit booking</h1>
        <p className="text-sm text-stone-600">Update the primary line (product, qty, session/date).</p>
      </div>
      {past ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This visit may be past-locked. Saving can be rejected by the engine.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-stone-200 bg-white p-5">
        <label className="block text-sm">
          Product
          <select
            className={`${fieldClass} mt-1`}
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setSessionId('');
              setBand('');
            }}
          >
            <option value="">Select product</option>
            {mainProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Quantity
          <input
            type="number"
            min={1}
            className={`${fieldClass} mt-1`}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </label>
        {product?.prices?.length ? (
          <label className="block text-sm">
            Price band
            <select className={`${fieldClass} mt-1`} value={band} onChange={(e) => setBand(e.target.value)}>
              <option value="">Default</option>
              {product.prices.map((pr) => (
                <option key={pr.code} value={pr.code}>
                  {pr.code} · {formatMoney(pr.amount, pr.currency)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-sm">
          Visit date
          <input
            type="date"
            className={`${fieldClass} mt-1`}
            value={visitDate || dateForAvail}
            onChange={(e) => setVisitDate(e.target.value)}
          />
        </label>
        {needsSlot ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Session</legend>
            {(availQ.data ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={sessionId === s.id}
                  onChange={() => setSessionId(s.id)}
                />
                {s.label ? `${s.label} · ` : ''}
                {formatClockDateTime(s.startsAt, timeFormat)} · {s.remaining}/
                {s.capacity}
              </label>
            ))}
            {!availQ.isLoading && !(availQ.data ?? []).length ? (
              <p className="text-sm text-red-700">No sessions that day.</p>
            ) : null}
          </fieldset>
        ) : null}
        {booking.lines.length > 1 ? (
          <p className="text-xs text-stone-500">
            {booking.lines.length - 1} additional line(s) kept as-is (add-ons).
          </p>
        ) : null}
        {err ? <p className="text-sm text-red-700">{err}</p> : null}
        <div className="flex gap-2">
          <button type="submit" className={btnPrimaryClass} disabled={busy || !productId}>
            {busy ? 'Saving…' : 'Save lines'}
          </button>
          <Link href={`/admin/bookings/${bookingId}`} className={btnSecondaryClass}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
