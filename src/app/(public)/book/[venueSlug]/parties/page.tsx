import PublicPartyPackagesIndex from '@/components/Public_C/booking/party/PublicPartyPackagesIndex';
import { loadPublicBookByVenueSlug } from '@/lib/ticketing/loadPublicBook';

export default async function VenuePartyPackagesPage({ params }: { params: Promise<{ venueSlug: string }> }) {
  const { venueSlug } = await params;
  const { org, venue } = await loadPublicBookByVenueSlug(venueSlug);
  return <PublicPartyPackagesIndex orgSlug={org.slug} venueSlug={venue.slug} />;
}
