'use client';

import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMagicBooking, patchMagicPartyGuests } from '@/services/publicBooking';
import GuestBookingPanel from './GuestBookingPanel';
import { bookBtn, bookField } from './bookingUi';

export default function MagicPortalPage({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ['public', 'booking', 'magic', token],
    queryFn: () => getMagicBooking(token),
    enabled: Boolean(token),
  });
  const booking = query.data?.booking;
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function addGuest(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    setBusy(true);
    setErr('');
    try {
      // Send ids only: the replace API keeps stored name / age / RSVP / waiver links for matched rows.
      const existing =
        (booking.partyDetail?.guests as Array<{ id?: string }> | undefined)?.flatMap((g) => (g.id ? [{ id: g.id }] : [])) ?? [];
      await patchMagicPartyGuests(token, [
        ...existing,
        { kind: 'kid', name: name.trim(), age: age ? Number(age) : null },
      ]);
      setName('');
      setAge('');
      await query.refetch();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not update guests');
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) {
    return <main className="mx-auto max-w-lg px-4 py-10 text-sm text-stone-500">Loading…</main>;
  }
  if (!booking) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-2xl font-semibold">Link expired</h1>
        <p className="mt-2 text-sm text-stone-600">
          {(query.error as Error)?.message ||
            'This guest portal link is invalid or older than 72 hours.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-8 px-4 py-10">
      <GuestBookingPanel
        booking={booking}
        viewToken={token}
        showPay={booking.amountDue > 0}
      />
      {booking.partyDetail ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Party guests</h2>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {(booking.partyDetail.guests ?? []).map((g) => (
              <li key={g.id} className="py-2">
                {g.name ?? 'Guest'}
              </li>
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
            <button type="submit" className={bookBtn} disabled={busy || !name.trim()}>
              Add
            </button>
          </form>
          {err ? <p className="mt-2 text-sm text-red-700">{err}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
