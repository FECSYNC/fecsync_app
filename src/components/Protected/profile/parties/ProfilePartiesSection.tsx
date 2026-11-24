'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listMyParties, mePartyKeys } from '@/services/meParties';
import { centsLabel, formatInZone } from '@/components/Protected/admin/pages/parties/partyFormat';

/** Signed-in host: own party bookings only. Party bookings also stay listed under My Bookings. */
export default function ProfilePartiesSection() {
  const q = useQuery({
    queryKey: mePartyKeys.list(),
    queryFn: listMyParties,
    staleTime: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
  const rows = q.data ?? [];
  const now = Date.now();
  const upcoming = rows.filter(
    (p) => p.visitStartsAt && new Date(p.visitStartsAt).getTime() >= now && !['cancelled', 'expired'].includes(p.status)
  );
  const past = rows.filter((p) => !upcoming.includes(p));
  return (
    <div className="space-y-6 px-3 py-4 sm:px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[#D4AF37]">Profile</p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">My parties</h1>
        <p className="mt-1 text-sm text-stone-600">Parties you booked. Manage the guest list, invitations, and payments.</p>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-stone-500">Loading parties…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">No parties yet.</p>
      ) : (
        [
          ['Upcoming', upcoming],
          ['Past', past],
        ].map(([title, list]) => (
          <section key={title as string}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">{title as string}</h2>
            {(list as typeof rows).length === 0 ? (
              <p className="text-sm text-stone-500">None</p>
            ) : (
              <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
                {(list as typeof rows).map((p) => (
                  <li key={p.bookingId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="font-medium text-stone-900">{p.partyName}</p>
                      <p className="text-xs text-stone-500">
                        {p.location.name} · {formatInZone(p.visitStartsAt, p.timezone)} · {p.kidCount} kids · {p.status.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {p.amountDueCents > 0 && !['cancelled', 'expired'].includes(p.status) ? (
                        <span className="text-xs font-semibold text-amber-800">Due {centsLabel(p.amountDueCents)}</span>
                      ) : null}
                      <Link href={`/profile/parties/${p.bookingId}`} className="text-sm font-medium text-[#D4AF37]">
                        Manage
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
