'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listMyBookings, meBookingKeys } from '@/services/meBookings';
import { formatMoney, formatWhen } from '@/components/Public_C/booking/bookingUi';

export default function ProfileBookingsSection() {
  const query = useQuery({
    queryKey: meBookingKeys.list(),
    queryFn: listMyBookings,
  });
  const bookings = query.data ?? [];
  const now = Date.now();
  const upcoming = bookings.filter(
    (b) => b.visitStartsAt && new Date(b.visitStartsAt).getTime() >= now && b.status !== 'cancelled'
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="space-y-6 px-3 py-4 sm:px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">Profile</p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">My bookings</h1>
        <p className="mt-1 text-sm text-stone-600">
          Tickets you booked as a guest. Staff tools, invoices, and POS notes are not available here.
        </p>
      </div>
      {query.isLoading ? (
        <p className="text-sm text-stone-500">Loading bookings…</p>
      ) : bookings.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">
          No venue bookings yet.
        </p>
      ) : (
        <>
          <List title="Upcoming" rows={upcoming} />
          <List title="Past" rows={past} />
        </>
      )}
    </div>
  );
}

function List({
  title,
  rows,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listMyBookings>>;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-stone-800">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">None</p>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {rows.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="font-medium text-stone-900">{b.publicId}</p>
                <p className="text-xs text-stone-500">
                  {b.location?.name ?? 'Venue'} ·{' '}
                  {formatWhen(b.visitStartsAt, b.location?.timezone, b.timeFormat)}{' '}
                  · {b.status}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {b.amountDue > 0 ? (
                  <span className="text-xs font-semibold text-amber-800">
                    Due {formatMoney(b.amountDue)}
                  </span>
                ) : null}
                <Link
                  href={`/profile/bookings/${b.id}`}
                  className="text-sm font-medium text-[#D4AF37]"
                >
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
