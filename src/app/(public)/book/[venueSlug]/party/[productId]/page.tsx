import { BookProductClient } from '@/components/Public_C/booking/BookFlowClients';
import { loadPublicBookByVenueSlug } from '@/lib/ticketing/loadPublicBook';

export default async function ShortBookPartyPage({
  params,
}: {
  params: Promise<{ venueSlug: string; productId: string }>;
}) {
  const { venueSlug, productId } = await params;
  const { org, venue } = await loadPublicBookByVenueSlug(venueSlug);
  return (
    <BookProductClient
      orgSlug={org.slug}
      venueSlug={venue.slug}
      productId={productId}
      partyMode
    />
  );
}
