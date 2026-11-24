'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelMyBooking,
  getMyBooking,
  meBookingKeys,
  patchMyPartyGuests,
} from '@/services/meBookings';
import GuestBookingPanel from '@/components/Public_C/booking/GuestBookingPanel';
import { bookBtn, bookBtnGhost, bookField } from '@/components/Public_C/booking/bookingUi';
import { invalidateAfterBookingMutation } from '@/utils/invalidateTicketingQueries';
import ProfileBookingBilling from '@/components/Protected/profile/billing/ProfileBookingBilling';

export default function ProfileBookingDetail({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: meBookingKeys.detail(bookingId),
    queryFn: () => getMyBooking(bookingId),
    enabled: Boolean(bookingId),
  });
  const booking = query.data;
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [err, setErr] = useState('');

  const cancelMut = useMutation({
    mutationFn: () => cancelMyBooking(bookingId),
    onSuccess: (data) => {
      qc.setQueryData(meBookingKeys.detail(bookingId), data);
      invalidateAfterBookingMutation(qc);
    },
  });

  async function addGuest(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    setErr('');
    try {
      // Send ids only: the replace API keeps stored name / age / RSVP / waiver links for matched rows.
      const existing =
        (booking.partyDetail?.guests as Array<{ id?: string }> | undefined)?.flatMap((g) => (g.id ? [{ id: g.id }] : [])) ?? [];
      await patchMyPartyGuests(bookingId, [
        ...existing,
        { kind: 'kid', name: name.trim(), age: age ? Number(age) : null },
      ]);
      setName('');
      setAge('');
      await query.refetch();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not update guests');
    }
  }

  if (query.isLoading) {
    return <p className="p-6 text-sm text-stone-500">Loading booking…</p>;
  }
  if (!booking) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-700">Booking not found.</p>
        <Link href="/profile?tab=bookings" className="mt-2 inline-block text-sm text-[#D4AF37]">
          Back
        </Link>
      </div>
    );
  }

  const canCancel = !['cancelled', 'expired', 'refunded'].includes(booking.status);

  return (
    <div className="space-y-6 px-3 py-4 sm:px-6">
      <Link href="/profile?tab=bookings" className="text-sm text-stone-500 hover:text-[#D4AF37]">
        ← My bookings
      </Link>
      <GuestBookingPanel
        booking={booking}
        viewToken={booking.viewToken || undefined}
        showPay={booking.amountDue > 0}
      />
      <ProfileBookingBilling bookingId={bookingId} />
      <div className="flex flex-wrap gap-2">
        {canCancel ? (
          <button
            type="button"
            className={bookBtnGhost}
            onClick={() => {
              if (!window.confirm('Cancel this booking? Cutoff rules may apply.')) return;
              cancelMut.mutate();
            }}
          >
            Cancel booking
          </button>
        ) : null}
      </div>
      {cancelMut.isError ? (
        <p className="text-sm text-red-700">{(cancelMut.error as Error).message}</p>
      ) : null}
      {booking.partyDetail ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Party guests</h2>
          <ul className="mt-2 text-sm">
            {(booking.partyDetail.guests ?? []).map((g) => (
              <li key={g.id}>{g.name ?? 'Guest'}</li>
            ))}
          </ul>
          <form onSubmit={addGuest} className="mt-3 flex flex-wrap gap-2">
            <input
              className={`${bookField} flex-1`}
              placeholder="Guest name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={`${bookField} w-20`}
              placeholder="Age"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
            <button type="submit" className={bookBtn} disabled={!name.trim()}>
              Add
            </button>
          </form>
          {err ? <p className="mt-2 text-sm text-red-700">{err}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
