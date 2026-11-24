'use client';

import Link from 'next/link';
import { usePublicPartyPackagesQuery } from '@/hooks/usePublicParties';
import { bookFlowPaths } from '@/lib/ticketing/publicBookPaths';
import { centsLabel, partyErrorMessage } from '@/components/Protected/admin/pages/parties/partyFormat';

/** Published party packages for one venue. */
export default function PublicPartyPackagesIndex({ orgSlug, venueSlug }: { orgSlug: string; venueSlug: string }) {
  const q = usePublicPartyPackagesQuery(orgSlug, venueSlug);
  const paths = bookFlowPaths(venueSlug);
  const venueName = (q.data?.venue?.name as string | undefined) ?? '';
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <Link href={paths.home} className="text-sm text-stone-500 hover:text-[#D4AF37]">
          ← {venueName || 'Bookings'}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900">Party packages{venueName ? ` at ${venueName}` : ''}</h1>
      </div>
      {q.isPending ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : q.error ? (
        <p className="text-sm text-stone-600">{partyErrorMessage(q.error, 'Party booking is not available here.')}</p>
      ) : !q.data?.allowOnlinePartyBooking ? (
        <p className="text-sm text-stone-600">Online party booking is closed for this venue. Please call the venue to book.</p>
      ) : (q.data?.packages ?? []).length === 0 ? (
        <p className="text-sm text-stone-600">No party packages are open for online booking yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(q.data?.packages ?? []).map((p) => (
            <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.images[0]} alt="" className="h-40 w-full object-cover" />
              ) : null}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {p.description ? <p className="line-clamp-3 text-sm text-stone-600">{p.description}</p> : null}
                <p className="text-sm text-stone-700">
                  {centsLabel(p.basePriceCents)} · {p.includedKids} kids + {p.includedAdults} adults · {p.durationMinutes} min
                </p>
                <Link
                  href={paths.product(p.id, true)}
                  className="mt-auto inline-flex w-fit rounded-md bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c4a030]"
                >
                  Book this party
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
