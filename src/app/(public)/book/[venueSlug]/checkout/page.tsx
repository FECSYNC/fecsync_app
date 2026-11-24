import { BookCheckoutClient } from '@/components/Public_C/booking/BookFlowClients';
import { loadPublicBookByVenueSlug } from '@/lib/ticketing/loadPublicBook';

export default async function ShortBookCheckoutPage({
  params,
}: {
  params: Promise<{ venueSlug: string }>;
}) {
  const { venueSlug } = await params;
  const { org, venue } = await loadPublicBookByVenueSlug(venueSlug);
  return <BookCheckoutClient orgSlug={org.slug} venueSlug={venue.slug} />;
}
