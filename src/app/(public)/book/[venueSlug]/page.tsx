import BookVenueClient from '@/components/Public_C/booking/BookVenueClient';
import { loadPublicBookByVenueSlug } from '@/lib/ticketing/loadPublicBook';

export default async function ShortBookVenuePage({
  params,
}: {
  params: Promise<{ venueSlug: string }>;
}) {
  const { venueSlug } = await params;
  const { org, venue } = await loadPublicBookByVenueSlug(venueSlug);
  return <BookVenueClient orgSlug={org.slug} venueSlug={venue.slug} />;
}
