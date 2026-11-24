'use client';

import dynamic from 'next/dynamic';

const VenueBookHome = dynamic(
  () => import('@/components/Public_C/booking/VenueBookHome'),
  {
    ssr: false,
    loading: () => (
      <p className="p-8 text-sm text-stone-500">Loading booking…</p>
    ),
  }
);

export default function BookVenueClient({
  orgSlug,
  venueSlug,
}: {
  orgSlug: string;
  venueSlug: string;
}) {
  return <VenueBookHome orgSlug={orgSlug} venueSlug={venueSlug} />;
}
