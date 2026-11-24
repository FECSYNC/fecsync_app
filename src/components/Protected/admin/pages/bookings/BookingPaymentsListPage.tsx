'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  listAdminVenueLocations,
  venueLocationKeys,
} from '@/services/venueLocations';
import { useHqLocationFilter } from '@/hooks/useHqLocationFilter';
import {
  adminPaymentKeys,
  listAdminBookingPayments,
} from '@/services/adminBookingPayments';
import { fieldClass, formatMoney } from '../ticketing/ticketingUi';
import { adminListQueryDefaults } from '@/lib/adminListCache';
import { withAdminListSnapshot } from '@/lib/adminListSnapshot';
import { formatClockDateTime } from '@/lib/timeClock';
import { useTimeClockFormat } from '@/hooks/useTimeClock';
import AdminHowToGuideModal, {
  AdminHowToGuideButton,
  BOOKING_PAYMENTS_GUIDE_STEPS,
} from '@/components/Protected/admin/components/AdminHowToGuideModal';
import { AccountingEntriesPanel } from '../accounting/shared';

export default function BookingPaymentsListPage() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [ledgerPaymentId, setLedgerPaymentId] = useState<string | null>(null);
  const {
    locationId,
    setLocationId,
    scopedLocationId,
  } = useHqLocationFilter();
  const { timeFormat } = useTimeClockFormat(locationId || null);

  const filters = useMemo(
    () => ({
      q: q.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
      locationId: locationId || undefined,
    }),
    [q, from, to, locationId]
  );

  const venuesKey = venueLocationKeys.list('all');
  const venuesQuery = useQuery({
    queryKey: venuesKey,
    queryFn: () => listAdminVenueLocations({ scope: 'all' }),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(venuesKey),
    placeholderData: (previous) => previous,
  });

  const paymentsKey = adminPaymentKeys.list(filters);
  const listQuery = useQuery({
    queryKey: paymentsKey,
    queryFn: () => listAdminBookingPayments(filters),
    ...adminListQueryDefaults,
    ...withAdminListSnapshot(paymentsKey),
    placeholderData: (previous) => previous,
  });

  const payments = listQuery.data ?? [];
  const ledgerPayment = payments.find((p) => p.id === ledgerPaymentId);
  const venues = (venuesQuery.data ?? []).filter((v) => {
    if (v.status === 'archived') return false;
    if (scopedLocationId) return v.id === scopedLocationId;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#D4AF37]">
            Bookings
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">Payments</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Venue booking payment ledger for your company. Open the guide if you
            are doing this for the first time.
          </p>
        </div>
        <AdminHowToGuideButton onClick={() => setGuideOpen(true)} />
      </div>

      <AdminHowToGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Payments"
        subtitle="Follow these steps in order — written for first-time admins."
        steps={BOOKING_PAYMENTS_GUIDE_STEPS}
      />

      <div className="flex flex-wrap gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search guest / email / booking / PI…"
          className={`${fieldClass} min-w-[14rem] flex-1`}
        />
        <input
          type="date"
          className={`${fieldClass} w-auto`}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className={`${fieldClass} w-auto`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <select
          className={`${fieldClass} w-auto`}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          disabled={Boolean(scopedLocationId)}
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Booking</th>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Venue</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Tender</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {listQuery.isPending && payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-stone-500">
                  Loading…
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-stone-500">
                  No payments found.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-stone-600">
                    {p.createdAt
                      ? formatClockDateTime(p.createdAt, timeFormat)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${p.bookingId}`}
                      className="font-medium text-[#D4AF37] hover:underline"
                    >
                      {p.bookingPublicId || p.bookingId}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div>{p.guest ?? '—'}</div>
                    {p.email ? (
                      <div className="text-xs text-stone-500">{p.email}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{p.venue?.name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                  </td>
                  <td className="px-4 py-3">{p.tender}</td>
                  <td className="px-4 py-3">{p.status}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-[#D4AF37] hover:underline"
                      onClick={() =>
                        setLedgerPaymentId((cur) => (cur === p.id ? null : p.id))
                      }
                    >
                      {ledgerPaymentId === p.id ? 'Hide ledger' : 'Ledger'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {ledgerPaymentId && ledgerPayment ? (
        <AccountingEntriesPanel
          sourceType="booking_payment"
          sourceId={ledgerPaymentId}
          currency={ledgerPayment.currency}
        />
      ) : null}
    </div>
  );
}
